import { supportsFastRadar } from './fast-radar-source.js';

function normalizeFrames(entries, siteId) {
  return (entries ?? [])
    .map((entry) => ({
      site: siteId,
      objectKey: entry.objectKey ?? entry.key,
      scanStartMs: Number(entry.scanStartMs),
      live: false,
    }))
    .filter((entry) => entry.objectKey && Number.isFinite(entry.scanStartMs))
    .sort((a, b) => a.scanStartMs - b.scanStartMs)
    .filter((entry, index, all) => index === 0 || entry.scanStartMs !== all[index - 1].scanStartMs);
}

export class RadarEngineV2 {
  constructor({
    ui,
    diagnostics = null,
    fastRenderer,
    level2Renderer,
    listFrames,
    createLevel2Session,
    productId = 1,
    pollMs = 20_000,
    warmHistoryDelayMs = 2_000,
    now = () => Date.now(),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  }) {
    this.ui = ui;
    this.diagnostics = diagnostics;
    this.fastRenderer = fastRenderer;
    this.level2Renderer = level2Renderer;
    this.listFrames = listFrames;
    this.createLevel2Session = createLevel2Session;
    this.productId = Number(productId);
    this.pollMs = pollMs;
    this.warmHistoryDelayMs = warmHistoryDelayMs;
    this.now = now;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;

    this.site = null;
    this.frames = [];
    this.currentIndex = 0;
    this.followLive = true;
    this.manifest = null;
    this.elevationNumber = null;
    this.preparedVisible = false;
    this.selectionToken = 0;
    this.viewToken = 0;
    this.pollTimer = null;
    this.warmTimer = null;
    this.refreshInFlight = null;
    this.level2SessionPromise = null;
    this.frameDiscoveryAttempted = false;
    this.frameDiscoveryError = null;
  }

  #log(level, stage, code, message, context = {}, error = null) {
    try { this.diagnostics?.record?.(level, stage, code, message, context, error); } catch {}
  }

  async selectSite(site) {
    const selectionStarted = this.now();
    const token = ++this.selectionToken;
    const viewToken = ++this.viewToken;
    this.site = site;
    this.frames = [];
    this.currentIndex = 0;
    this.followLive = true;
    this.manifest = null;
    this.elevationNumber = null;
    this.preparedVisible = false;
    this.frameDiscoveryAttempted = false;
    this.frameDiscoveryError = null;
    this.#stopTimers();
    this.ui.clearError?.();
    this.ui.site(site);
    this.ui.busy(true);
    this.ui.timeline([], 0, { live: true, syncing: true });
    this.#log('info', 'selection', 'SITE_SELECT', `Selecting ${site.id}`, { site: site.id, productId: this.productId, token });

    let frameDiscovery = null;
    const discoverFrames = () => {
      if (!frameDiscovery) frameDiscovery = this.#discoverFrames(token);
      return frameDiscovery;
    };

    if (this.#canUsePrepared()) {
      const fastStarted = this.now();
      this.#log('info', 'fast-radar', 'FAST_START', `Loading fast radar for ${site.id}`, { site: site.id, productId: this.productId });
      try {
        const shown = await this.fastRenderer.show({ site, productId: this.productId, cacheToken: this.now() });
        if (!shown) throw this.fastRenderer.lastFailure ?? Object.assign(new Error(`Fast radar did not load for ${site.id}`), { code: 'E_FAST_RADAR', stage: 'fast-radar' });
        if (token !== this.selectionToken) return null;
        if (viewToken !== this.viewToken) return null;
        this.level2Renderer.setVisible?.(false);
        this.fastRenderer.reveal?.();
        this.preparedVisible = true;
        this.ui.preparedRadar?.(this.productId);
        this.ui.setStream?.('· live');
        this.#startLiveTimer();
        discoverFrames().then((discovered) => {
          if (token === this.selectionToken && discovered.length) this.#scheduleHistoryWarm(token);
        }).catch((error) => {
          this.#log('warn', error?.stage ?? 'listing', 'FRAME_DISCOVERY_BACKGROUND_FAILED', `Background frame discovery failed for ${site.id}`, {
            site: site.id,
            productId: this.productId,
            sourceId: error?.sourceId ?? '',
          }, error);
        });
        this.#log('info', 'fast-radar', 'FAST_READY', `Fast radar visible for ${site.id}`, { site: site.id, productId: this.productId, elapsedMs: this.now() - fastStarted, selectionElapsedMs: this.now() - selectionStarted });
        return true;
      } catch (fastError) {
        this.#log('warn', 'fast-radar', 'FAST_FAILED', `Fast radar failed for ${site.id}; falling back to Level II`, { site: site.id, productId: this.productId, elapsedMs: this.now() - fastStarted }, fastError);
        if (token !== this.selectionToken) return null;
        // A fast-source failure is allowed to fall through to the Level II lane.
        try {
          await discoverFrames();
          await this.#loadCurrentLevel2(token, viewToken);
          this.#startLiveTimer();
          return true;
        } catch (level2Error) {
          throw level2Error ?? fastError;
        }
      } finally {
        if (token === this.selectionToken && viewToken === this.viewToken) this.ui.busy(false);
      }
    }

    try {
      await discoverFrames();
      await this.#loadCurrentLevel2(token, viewToken);
      this.#startLiveTimer();
      return true;
    } finally {
      if (token === this.selectionToken && viewToken === this.viewToken) this.ui.busy(false);
    }
  }

  async loadIndex(index) {
    if (!this.site || !this.frames.length) return null;
    const viewToken = ++this.viewToken;
    const clamped = Math.max(0, Math.min(this.frames.length - 1, Number(index)));
    this.currentIndex = clamped;
    this.followLive = clamped === this.frames.length - 1;
    this.ui.timeline(this.frames, this.currentIndex, { live: this.followLive });

    if (this.followLive && this.#canUsePrepared()) {
      this.ui.busy(true);
      try {
        const shown = await this.fastRenderer.show({ site: this.site, productId: this.productId, cacheToken: this.now() });
        if (viewToken !== this.viewToken) return null;
        if (!shown) { await this.#loadLevel2Descriptor(this.frames[clamped], this.selectionToken, { viewToken }); return true; }
        this.level2Renderer.setVisible?.(false);
        this.fastRenderer.reveal?.();
        this.preparedVisible = true;
        this.ui.preparedRadar?.(this.productId);
        this.ui.timeline(this.frames, this.currentIndex, { live: true });
        return true;
      } finally {
        if (viewToken === this.viewToken) this.ui.busy(false);
      }
    }

    await this.#loadLevel2Descriptor(this.frames[clamped], this.selectionToken, { viewToken });
    return viewToken === this.viewToken ? true : null;
  }

  async setProduct(productId) {
    const viewToken = ++this.viewToken;
    this.productId = Number(productId);
    if (!this.site) return null;
    if (this.followLive && this.#canUsePrepared()) {
      return this.#showPreparedLatest(this.selectionToken, viewToken);
    }
    if (!this.frames.length) await this.#discoverFrames(this.selectionToken);
    if (viewToken !== this.viewToken) return null;
    await this.#loadCurrentLevel2(this.selectionToken, viewToken);
    return viewToken === this.viewToken ? true : null;
  }

  async setElevation(elevationNumber) {
    const viewToken = ++this.viewToken;
    const value = Number(elevationNumber);
    this.elevationNumber = Number.isFinite(value) && value > 0 ? value : null;
    if (!this.site) return null;
    if (this.followLive && this.#canUsePrepared()) {
      return this.#showPreparedLatest(this.selectionToken, viewToken);
    }
    if (!this.frames.length) await this.#discoverFrames(this.selectionToken);
    if (viewToken !== this.viewToken) return null;
    await this.#loadCurrentLevel2(this.selectionToken, viewToken);
    return viewToken === this.viewToken ? true : null;
  }


  async #showPreparedLatest(token, viewToken = this.viewToken) {
    if (!this.site) return null;
    const site = this.site;
    const started = this.now();
    this.ui.busy(true);
    this.#log('info', 'fast-radar', 'FAST_SWITCH_START', `Switching fast radar for ${site.id}`, { site: site.id, productId: this.productId, elevationNumber: this.elevationNumber });
    try {
      const shown = await this.fastRenderer.show({ site, productId: this.productId, cacheToken: this.now() });
      if (token !== this.selectionToken || viewToken !== this.viewToken || this.site?.id !== site.id) return null;
      if (!shown) {
        const error = this.fastRenderer.lastFailure ?? Object.assign(new Error(`Fast radar did not load for ${site.id}`), { code: 'E_FAST_RADAR', stage: 'fast-radar' });
        this.#log('warn', 'fast-radar', error.code ?? 'E_FAST_RADAR', `Fast radar switch failed for ${site.id}; falling back to Level II`, { site: site.id, productId: this.productId, elapsedMs: this.now() - started }, error);
        if (!this.frames.length) await this.#discoverFrames(token);
        await this.#loadCurrentLevel2(token, viewToken);
        return true;
      }
      this.level2Renderer.setVisible?.(false);
      this.fastRenderer.reveal?.();
      this.preparedVisible = true;
      this.ui.preparedRadar?.(this.productId);
      if (this.frames.length) this.ui.timeline(this.frames, this.frames.length - 1, { live: true });
      this.currentIndex = Math.max(0, this.frames.length - 1);
      this.followLive = true;
      this.#startLiveTimer();
      this.#log('info', 'fast-radar', 'FAST_SWITCH_READY', `Fast radar switched for ${site.id}`, { site: site.id, productId: this.productId, elapsedMs: this.now() - started });
      return true;
    } finally {
      if (token === this.selectionToken && viewToken === this.viewToken) this.ui.busy(false);
    }
  }

  async refreshLive() {
    if (!this.site) return false;
    const refreshStarted = this.now();
    if (this.refreshInFlight) return this.refreshInFlight;
    const token = this.selectionToken;
    const viewToken = this.viewToken;
    const siteId = this.site.id;
    const oldLatest = this.frames.at(-1)?.scanStartMs ?? null;
    const wasFollowing = this.followLive;
    const preparedEligible = wasFollowing && this.#canUsePrepared();
    this.#log('debug', 'live', 'LIVE_REFRESH_START', `Refreshing live radar for ${siteId}`, {
      site: siteId,
      followLive: wasFollowing,
      frameCount: this.frames.length,
      preparedEligible,
      preparedVisible: this.preparedVisible,
    });

    this.refreshInFlight = (async () => {
      const preparedRefresh = preparedEligible
        ? (this.preparedVisible
            ? this.fastRenderer.refresh(this.now())
            : this.fastRenderer.show({ site: this.site, productId: this.productId, cacheToken: this.now() }))
          .then((shown) => {
            if (!shown || token !== this.selectionToken || viewToken !== this.viewToken || this.site?.id !== siteId || !this.followLive) return false;
            this.level2Renderer.setVisible?.(false);
            this.fastRenderer.reveal?.();
            this.preparedVisible = true;
            this.ui.preparedRadar?.(this.productId);
            return true;
          })
          .catch((error) => {
            this.#log('warn', error?.stage ?? 'prepared-radar', error?.code ?? 'PREPARED_REFRESH_FAILED', `Prepared radar refresh failed for ${siteId}`, {
              site: siteId,
              followLive: wasFollowing,
              elapsedMs: this.now() - refreshStarted,
            }, error);
            return false;
          })
        : Promise.resolve(false);

      let newLatest = oldLatest;
      try {
        const listed = await this.listFrames(siteId);
        if (token !== this.selectionToken || viewToken !== this.viewToken || this.site?.id !== siteId) return false;
        this.#applyFrames(listed, { preserveHistorical: !wasFollowing });
        newLatest = this.frames.at(-1)?.scanStartMs ?? null;
      } catch (error) {
        this.#log('warn', error?.stage ?? 'live', error?.code ?? 'LIVE_METADATA_FAILED', `Live frame metadata refresh failed for ${siteId}`, {
          site: siteId,
          followLive: wasFollowing,
          elapsedMs: this.now() - refreshStarted,
          sourceId: error?.sourceId ?? '',
        }, error);
      }

      const preparedUpdated = await preparedRefresh;
      if (wasFollowing && this.followLive && newLatest && newLatest !== oldLatest && (!preparedEligible || !preparedUpdated)) {
        await this.#loadLevel2Descriptor(this.frames.at(-1), token, { viewToken }).catch((error) => {
          this.#log('warn', error?.stage ?? 'level2', error?.code ?? 'LIVE_LEVEL2_FAILED', `Live Level II refresh failed for ${siteId}`, {
            site: siteId,
            scanStartMs: newLatest,
            elapsedMs: this.now() - refreshStarted,
          }, error);
        });
      }

      this.#log('debug', 'live', 'LIVE_REFRESH_OK', `Live refresh completed for ${siteId}`, {
        site: siteId,
        followLive: this.followLive,
        frameCount: this.frames.length,
        preparedUpdated: Boolean(preparedUpdated),
        preparedVisible: this.preparedVisible,
        elapsedMs: this.now() - refreshStarted,
      });
      return true;
    })().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  dispose() {
    ++this.selectionToken;
    ++this.viewToken;
    this.#stopTimers();
    this.fastRenderer.destroy?.();
    this.level2SessionPromise?.then((session) => session?.dispose?.()).catch((error) => {
      this.#log('warn', error?.stage ?? 'worker', 'LEVEL2_SESSION_DISPOSE_FAILED', 'Level II decoder session disposal failed', {
        site: this.site?.id ?? '',
        sourceId: error?.sourceId ?? '',
      }, error);
    });
  }

  #canUsePrepared() {
    if (supportsFastRadar(this.productId, this.elevationNumber)) return true;
    if (!this.manifest || this.elevationNumber == null) return false;
    const selected = this.manifest.elevations?.find((e) => Number(e.number) === Number(this.elevationNumber));
    const lowestAngle = Math.min(...(this.manifest.elevations ?? []).map((e) => Number(e.angle)).filter(Number.isFinite));
    return Boolean(selected) && Number(selected.angle) <= lowestAngle + 0.15 && (this.productId === 1 || this.productId === 2);
  }

  async #discoverFrames(token) {
    if (!this.site) return [];
    const siteId = this.site.id;
    const started = this.now();
    this.frameDiscoveryAttempted = true;
    this.#log('debug', 'listing', 'FRAME_DISCOVERY_START', `Discovering recent frames for ${siteId}`, { site: siteId });
    try {
      const listed = await this.listFrames(siteId);
      if (token !== this.selectionToken || this.site?.id !== siteId) return [];
      this.frameDiscoveryError = null;
      this.#applyFrames(listed);
      this.#log('info', 'listing', 'FRAME_DISCOVERY_OK', `Found ${this.frames.length} recent frames for ${siteId}`, { site: siteId, frameCount: this.frames.length, elapsedMs: this.now() - started });
      return this.frames;
    } catch (error) {
      if (token === this.selectionToken) {
        this.frameDiscoveryError = error;
        this.#log('warn', 'listing', error?.code ?? 'FRAME_DISCOVERY_FAILED', `Frame discovery failed for ${siteId}`, { site: siteId, elapsedMs: this.now() - started, sourceId: error?.sourceId ?? '' }, error);
      }
      return [];
    }
  }

  #applyFrames(entries, { preserveHistorical = false } = {}) {
    if (!this.site) return;
    const oldIndex = this.currentIndex;
    const oldTime = this.frames[oldIndex]?.scanStartMs ?? null;
    const next = normalizeFrames(entries, this.site.id);
    this.frames = next;
    if (!next.length) {
      this.currentIndex = 0;
      this.ui.timeline([], 0, { live: this.followLive, syncing: true });
      return;
    }

    if (preserveHistorical && oldTime != null) {
      const match = next.findIndex((frame) => frame.scanStartMs === oldTime);
      this.currentIndex = match >= 0 ? match : Math.min(oldIndex, next.length - 1);
      this.followLive = false;
    } else if (this.followLive) {
      this.currentIndex = next.length - 1;
    } else {
      this.currentIndex = Math.min(oldIndex, next.length - 1);
    }
    this.ui.timeline(next, this.currentIndex, { live: this.followLive && this.currentIndex === next.length - 1 });
  }

  async #loadCurrentLevel2(token, viewToken = this.viewToken) {
    if (!this.frames.length && !this.frameDiscoveryAttempted) await this.#discoverFrames(token);
    if (token !== this.selectionToken || viewToken !== this.viewToken) return null;
    const startIndex = this.frames.length
      ? Math.max(0, Math.min(this.frames.length - 1, this.followLive ? this.frames.length - 1 : this.currentIndex))
      : -1;
    if (startIndex < 0) {
      const error = this.frameDiscoveryError ?? Object.assign(new Error(`No recent Level II frame metadata for ${this.site?.id ?? 'radar'}`), { code: 'E_NO_RECENT_DATA', stage: 'listing' });
      this.ui.error?.(error);
      throw error;
    }

    const candidates = [];
    for (let index = startIndex; index >= 0 && candidates.length < 3; index--) {
      candidates.push({ index, descriptor: this.frames[index] });
    }

    let lastError = null;
    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const { index, descriptor } = candidates[attempt];
      try {
        if (attempt > 0) {
          this.#log('warn', 'level2', 'LEVEL2_FALLBACK_TRY', `Trying previous completed Level II scan for ${this.site?.id ?? 'radar'}`, {
            site: this.site?.id ?? '',
            attempt: attempt + 1,
            objectKey: descriptor.objectKey,
            scanStartMs: descriptor.scanStartMs,
          });
        }
        const frame = await this.#loadLevel2Descriptor(descriptor, token, { reportError: false, viewToken });
        if (frame && token === this.selectionToken && viewToken === this.viewToken) {
          this.currentIndex = index;
          this.ui.timeline(this.frames, this.currentIndex, { live: this.followLive && this.currentIndex === this.frames.length - 1 });
          if (attempt > 0) {
            this.#log('info', 'level2', 'LEVEL2_FALLBACK_READY', `Recovered with an earlier completed Level II scan for ${this.site?.id ?? 'radar'}`, {
              site: this.site?.id ?? '',
              attempt: attempt + 1,
              objectKey: descriptor.objectKey,
              scanStartMs: descriptor.scanStartMs,
            });
          }
        }
        return frame;
      } catch (error) {
        lastError = error;
        if (token !== this.selectionToken || viewToken !== this.viewToken) return null;
      }
    }

    const error = lastError ?? Object.assign(new Error(`No usable recent Level II frames for ${this.site?.id ?? 'radar'}`), { code: 'E_NO_USABLE_FRAME', stage: 'level2' });
    this.#log('error', error?.stage ?? 'level2', 'LEVEL2_FALLBACK_EXHAUSTED', `All recent Level II fallback scans failed for ${this.site?.id ?? 'radar'}`, {
      site: this.site?.id ?? '',
      attempts: candidates.length,
      sourceId: error?.sourceId ?? '',
    }, error);
    this.ui.error?.(error);
    throw error;
  }

  async #loadLevel2Descriptor(descriptor, token, { reportError = true, viewToken = this.viewToken } = {}) {
    if (!descriptor || !this.site) return null;
    const started = this.now();
    this.#log('info', 'level2', 'LEVEL2_FRAME_START', `Loading Level II frame for ${this.site.id}`, { site: this.site.id, objectKey: descriptor.objectKey, scanStartMs: descriptor.scanStartMs, productId: this.productId, elevationNumber: this.elevationNumber });
    const session = await this.#ensureLevel2Session();
    if (token !== this.selectionToken || viewToken !== this.viewToken) return null;
    this.ui.busy(true);
    try {
      const frame = await session.priority.request('LOAD_FRAME', {
        site: this.site.id,
        objectKey: descriptor.objectKey,
        scanStartMs: descriptor.scanStartMs,
        elevationNumber: this.elevationNumber,
        productId: this.productId,
      });
      if (token !== this.selectionToken || viewToken !== this.viewToken) return null;
      this.manifest = frame.manifest;
      this.elevationNumber = frame.elevationNumber;
      this.productId = frame.productId;
      this.level2Renderer.setFrame(frame.buffer, this.site, frame);
      this.level2Renderer.setVisible?.(true);
      this.fastRenderer.hide?.();
      this.preparedVisible = false;
      this.ui.manifest?.(frame.manifest, frame.elevationNumber, frame.productId);
      this.ui.timeline(this.frames, this.currentIndex, { live: this.followLive && this.currentIndex === this.frames.length - 1 });
      this.#log('info', 'level2', 'LEVEL2_FRAME_READY', `Level II frame ready for ${this.site.id}`, { site: this.site.id, objectKey: descriptor.objectKey, scanStartMs: descriptor.scanStartMs, productId: frame.productId, elevationNumber: frame.elevationNumber, elapsedMs: this.now() - started, byteLength: frame.buffer?.byteLength ?? 0 });
      session.startHistory?.({
        site: this.site.id,
        frames: this.frames,
        productId: this.productId,
        elevationNumber: this.elevationNumber,
      });
      return frame;
    } catch (error) {
      if (token !== this.selectionToken || viewToken !== this.viewToken) {
        this.#log('debug', 'level2', 'LEVEL2_STALE_RESULT', 'Ignoring obsolete Level II failure after the requested view changed', { objectKey: descriptor.objectKey, scanStartMs: descriptor.scanStartMs });
        return null;
      }
      this.#log('error', error?.stage ?? 'level2', error?.code ?? 'LEVEL2_FRAME_FAILED', `Level II frame failed for ${this.site.id}`, { site: this.site.id, objectKey: descriptor.objectKey, scanStartMs: descriptor.scanStartMs, productId: this.productId, elevationNumber: this.elevationNumber, elapsedMs: this.now() - started, sourceId: error?.sourceId ?? '' }, error);
      if (error?.code === 'E_WORKER_TIMEOUT' || error?.code === 'E_WORKER' || error?.stage === 'worker') {
        await this.#invalidateLevel2Session(error);
      }
      if (reportError) this.ui.error?.(error);
      throw error;
    } finally {
      if (token === this.selectionToken && viewToken === this.viewToken) this.ui.busy(false);
    }
  }

  async #invalidateLevel2Session(error = null) {
    const current = this.level2SessionPromise;
    this.level2SessionPromise = null;
    if (!current) return;
    this.#log('warn', 'worker', 'LEVEL2_SESSION_RESET', 'Resetting Level II decoder session after worker failure', {
      site: this.site?.id ?? '', code: error?.code ?? '', sourceId: error?.sourceId ?? '',
    }, error);
    try {
      const session = await current;
      try {
        await Promise.resolve(session?.dispose?.());
      } catch (disposeError) {
        this.#log('warn', 'worker', 'LEVEL2_SESSION_DISPOSE_FAILED', 'Level II decoder session dispose failed during reset', {
          site: this.site?.id ?? '', code: disposeError?.code ?? '', sourceId: disposeError?.sourceId ?? '',
        }, disposeError);
      }
    } catch (resetError) {
      this.#log('warn', 'worker', 'LEVEL2_SESSION_RESET_FAILED', 'Level II decoder session could not be resolved during reset', {
        site: this.site?.id ?? '', code: resetError?.code ?? '', sourceId: resetError?.sourceId ?? '',
      }, resetError);
    }
  }

  #ensureLevel2Session() {
    if (!this.level2SessionPromise) {
      const started = this.now();
      this.#log('info', 'wasm', 'LEVEL2_SESSION_START', 'Initializing lazy Level II decoder session', { site: this.site?.id ?? '', productId: this.productId });
      this.level2SessionPromise = Promise.resolve(this.createLevel2Session()).then((session) => {
        this.#log('info', 'wasm', 'LEVEL2_SESSION_READY', 'Level II decoder session ready', { site: this.site?.id ?? '', elapsedMs: this.now() - started });
        return session;
      }).catch((error) => {
        this.#log('error', error?.stage ?? 'wasm', error?.code ?? 'LEVEL2_SESSION_FAILED', 'Level II decoder session failed', { site: this.site?.id ?? '', elapsedMs: this.now() - started, sourceId: error?.sourceId ?? '' }, error);
        this.level2SessionPromise = null;
        throw error;
      });
    }
    return this.level2SessionPromise;
  }

  #scheduleHistoryWarm(token) {
    if (!(this.warmHistoryDelayMs > 0)) return;
    try {
      this.warmTimer = Reflect.apply(this.setTimeoutImpl, globalThis, [async () => {
        this.warmTimer = null;
        if (token !== this.selectionToken || !this.site || !this.frames.length) return;
        try {
          const session = await this.#ensureLevel2Session();
          if (token !== this.selectionToken) return;
          session.startHistory?.({
            site: this.site.id,
            frames: this.frames,
            productId: this.productId,
            elevationNumber: this.elevationNumber,
          });
        } catch (error) {
          this.#log('warn', error?.stage ?? 'history', error?.code ?? 'HISTORY_WARM_FAILED', `Background history warm-up failed for ${this.site?.id ?? 'radar'}`, {
            site: this.site?.id ?? '',
            productId: this.productId,
            elevationNumber: this.elevationNumber,
          }, error);
        }
      }, this.warmHistoryDelayMs]);
      this.#log('debug', 'history', 'HISTORY_TIMER_ARMED', `History warm-up scheduled in ${this.warmHistoryDelayMs} ms`, {
        site: this.site?.id ?? '',
        delayMs: this.warmHistoryDelayMs,
      });
    } catch (error) {
      this.warmTimer = null;
      this.#log('warn', 'history', 'HISTORY_TIMER_FAILED', 'Could not schedule background history warm-up', {
        site: this.site?.id ?? '',
        delayMs: this.warmHistoryDelayMs,
      }, error);
    }
  }

  #startLiveTimer() {
    if (!(this.pollMs > 0) || this.pollTimer) return false;
    try {
      this.pollTimer = Reflect.apply(this.setIntervalImpl, globalThis, [() => {
        this.refreshLive().catch((error) => {
          this.#log('warn', error?.stage ?? 'live', 'LIVE_REFRESH_UNHANDLED', `Automatic live refresh failed for ${this.site?.id ?? 'radar'}`, {
            site: this.site?.id ?? '',
            productId: this.productId,
            elevationNumber: this.elevationNumber,
            sourceId: error?.sourceId ?? '',
          }, error);
        });
      }, this.pollMs]);
      this.#log('debug', 'live', 'LIVE_TIMER_ARMED', `Live radar refresh scheduled every ${this.pollMs} ms`, {
        site: this.site?.id ?? '',
        pollMs: this.pollMs,
      });
      return true;
    } catch (error) {
      this.pollTimer = null;
      this.#log('warn', 'live', 'LIVE_TIMER_FAILED', 'Could not schedule automatic live radar refresh; current radar remains visible', {
        site: this.site?.id ?? '',
        pollMs: this.pollMs,
      }, error);
      return false;
    }
  }

  #stopTimers() {
    if (this.pollTimer) {
      try { Reflect.apply(this.clearIntervalImpl, globalThis, [this.pollTimer]); }
      catch (error) { this.#log('warn', 'live', 'LIVE_TIMER_CLEAR_FAILED', 'Could not clear live radar refresh timer', { site: this.site?.id ?? '' }, error); }
    }
    if (this.warmTimer) {
      try { Reflect.apply(this.clearTimeoutImpl, globalThis, [this.warmTimer]); }
      catch (error) { this.#log('warn', 'history', 'HISTORY_TIMER_CLEAR_FAILED', 'Could not clear history warm-up timer', { site: this.site?.id ?? '' }, error); }
    }
    this.pollTimer = null;
    this.warmTimer = null;
  }
}
