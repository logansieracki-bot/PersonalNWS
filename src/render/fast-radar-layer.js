import { buildFastRadarTileUrl } from '../radar/fast-radar-source.js';

const DEFAULT_OPACITY = 0.78;

function radarBounds(site, rangeKm = 500) {
  const lat = Number(site?.lat), lon = Number(site?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const latDelta = rangeKm / 110.574;
  const lonDelta = rangeKm / (111.320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return [
    Math.max(-180, lon - lonDelta),
    Math.max(-85, lat - latDelta),
    Math.min(180, lon + lonDelta),
    Math.min(85, lat + latDelta),
  ];
}

function makeFastError(code, message, context = {}, detail = '') {
  const error = new Error(message);
  error.code = code;
  error.stage = 'fast-radar';
  error.sourceId = context.sourceId ?? '';
  error.context = context;
  error.detail = detail || message;
  return error;
}

export class FastRadarLayer {
  constructor(map, {
    beforeLayerId = undefined,
    opacity = DEFAULT_OPACITY,
    loadTimeoutMs = 3500,
    diagnostics = null,
    now = () => Date.now(),
  } = {}) {
    this.map = map;
    this.beforeLayerId = beforeLayerId;
    this.opacity = opacity;
    this.loadTimeoutMs = loadTimeoutMs;
    this.diagnostics = diagnostics;
    this.now = now;
    this.sequence = 0;
    this.activeLayerId = null;
    this.activeSourceId = null;
    this.lastRequest = null;
    this.lastFailure = null;
  }

  #log(level, stage, code, message, context = {}, error = null) {
    try { this.diagnostics?.record?.(level, stage, code, message, context, error); } catch {}
  }

  async show({ site, productId, cacheToken = Date.now() }) {
    const started = this.now();
    const request = { site, productId: Number(productId), cacheToken };
    const first = !this.activeLayerId;
    const slot = ++this.sequence;
    const sourceId = `personalnws-fast-radar-source-${slot}`;
    const layerId = `personalnws-fast-radar-layer-${slot}`;
    const tileUrl = buildFastRadarTileUrl(site.id, productId, cacheToken);
    const tiles = [tileUrl];
    this.lastFailure = null;
    this.#log('debug', 'fast-radar', 'FAST_SOURCE_START', `Creating fast radar source for ${site.id}`, {
      site: site.id,
      productId: Number(productId),
      sourceId,
      tileUrl,
      firstLoad: first,
    });

    const bounds = radarBounds(site);
    this.map.addSource(sourceId, {
      type: 'raster',
      tiles,
      tileSize: 256,
      ...(bounds ? { bounds } : {}),
      attribution: 'NOAA / NWS',
    });
    this.map.addLayer({
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': first ? this.opacity : 0,
        'raster-fade-duration': 0,
      },
    }, this.beforeLayerId);

    const result = await this.#waitForSource(sourceId, { site: site.id, productId: Number(productId), tileUrl, started });
    if (slot !== this.sequence) {
      this.#remove(layerId, sourceId);
      this.#log('debug', 'fast-radar', 'FAST_SOURCE_STALE', `Ignoring stale prepared radar source for ${site.id}`, {
        site: site.id, productId: Number(productId), sourceId, elapsedMs: this.now() - started,
      });
      return false;
    }
    if (!result.ok) {
      this.lastFailure = result.error;
      this.#log('warn', 'fast-radar', result.error.code, result.error.message, result.error.context, result.error);
      this.#remove(layerId, sourceId);
      return false;
    }

    const oldLayer = this.activeLayerId;
    const oldSource = this.activeSourceId;
    if (!first) this.map.setPaintProperty(layerId, 'raster-opacity', this.opacity);
    this.activeLayerId = layerId;
    this.activeSourceId = sourceId;
    this.lastRequest = request;
    if (oldLayer && oldLayer !== layerId) this.#remove(oldLayer, oldSource);
    this.#log('info', 'fast-radar', 'FAST_SOURCE_READY', `Fast radar source ready for ${site.id}`, {
      site: site.id,
      productId: Number(productId),
      sourceId,
      elapsedMs: this.now() - started,
    });
    return true;
  }

  refresh(cacheToken = Date.now()) {
    if (!this.lastRequest) return Promise.resolve(false);
    return this.show({ ...this.lastRequest, cacheToken });
  }

  hide() {
    if (this.activeLayerId && this.map.getLayer?.(this.activeLayerId)) {
      this.map.setPaintProperty(this.activeLayerId, 'raster-opacity', 0);
    }
  }

  reveal() {
    if (this.activeLayerId && this.map.getLayer?.(this.activeLayerId)) {
      this.map.setPaintProperty(this.activeLayerId, 'raster-opacity', this.opacity);
    }
  }

  destroy() {
    this.#remove(this.activeLayerId, this.activeSourceId);
    this.activeLayerId = null;
    this.activeSourceId = null;
    this.lastRequest = null;
    this.lastFailure = null;
  }

  #remove(layerId, sourceId) {
    if (layerId && this.map.getLayer?.(layerId)) this.map.removeLayer(layerId);
    if (sourceId && this.map.getSource?.(sourceId)) this.map.removeSource(sourceId);
  }

  #waitForSource(sourceId, context) {
    if (this.map.isSourceLoaded?.(sourceId)) return Promise.resolve({ ok: true });
    return new Promise((resolve) => {
      let settled = false;
      let lastTileError = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.map.off?.('sourcedata', onData);
        this.map.off?.('error', onError);
        resolve(result);
      };
      const onData = (event) => {
        if (event?.sourceId !== sourceId) return;
        const usableTileActivity = event?.sourceDataType === 'content' || Boolean(event?.tile);
        if (usableTileActivity || event?.isSourceLoaded || this.map.isSourceLoaded?.(sourceId)) finish({ ok: true });
      };
      const onError = (event) => {
        if (event?.sourceId !== sourceId) return;
        const upstream = event?.error ?? event;
        const error = makeFastError('E_FAST_SOURCE', `Prepared radar source error for ${context.site}`, {
          ...context,
          sourceId,
          elapsedMs: this.now() - context.started,
        }, String(upstream?.stack ?? upstream?.message ?? upstream ?? 'MapLibre source error'));
        // Raster sources request several viewport tiles at once. One tile may be
        // outside coverage or transiently fail while neighboring tiles are fine.
        // Keep waiting for usable tile activity instead of blanking the radar.
        if (event?.tile || event?.coord) {
          lastTileError = error;
          this.#log('warn', 'prepared-radar', 'PREPARED_TILE_FAILED', `One prepared radar tile failed for ${context.site}`, error.context, error);
          return;
        }
        finish({ ok: false, error });
      };
      const timer = setTimeout(() => finish({
        ok: false,
        error: makeFastError('E_FAST_TIMEOUT', `Prepared radar source timed out after ${this.loadTimeoutMs} ms`, {
          ...context,
          sourceId,
          elapsedMs: this.now() - context.started,
          lastTileError: lastTileError?.detail ?? null,
        }, lastTileError?.detail ?? ''),
      }), this.loadTimeoutMs);
      this.map.on?.('sourcedata', onData);
      this.map.on?.('error', onError);
    });
  }
}
