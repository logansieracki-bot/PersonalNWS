import { archiveObjectUrl } from './nexrad-source.js';

function ownArrayBuffer(view) {
  if (view instanceof ArrayBuffer) return view;
  if (!ArrayBuffer.isView(view)) throw new TypeError('decoder blob must be a Uint8Array/ArrayBuffer');
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function frameError(error, { site, objectKey, byteLength }) {
  const wrapped = new Error(String(error?.message ?? error ?? 'Radar decode failed'));
  wrapped.code = error?.code ?? 'E_RADAR_DECODE';
  wrapped.stage = error?.stage ?? 'archive';
  wrapped.sourceId = objectKey;
  const upstream = String(error?.detail ?? error?.stack ?? error?.message ?? error ?? 'Unknown decoder error');
  wrapped.detail = `${upstream}\nSite: ${site}\nObject: ${objectKey}\nDownloaded: ${byteLength} bytes`;
  wrapped.context = { ...(error?.context ?? {}), site, objectKey, byteLength };
  return wrapped;
}

function chooseElevation(manifest, requestedElevation, productId) {
  const elevations = manifest?.elevations ?? [];
  if (requestedElevation != null) {
    const exact = elevations.find((e) => Number(e.number) === Number(requestedElevation));
    if (exact?.products?.includes(productId)) return exact;
  }
  return elevations.find((e) => e.products?.includes(productId)) ?? null;
}

export class FramePipeline {
  constructor({ cache, engine, fetchArrayBuffer, diagnostics = null, now = () => Date.now() }) {
    this.cache = cache;
    this.engine = engine;
    this.fetchArrayBuffer = fetchArrayBuffer;
    this.diagnostics = diagnostics;
    this.now = now;
    this.active = null;
    this.loadGeneration = 0;
  }

  #log(level, stage, code, message, context = {}, error = null) {
    try { this.diagnostics?.record?.(level, stage, code, message, context, error); } catch {}
  }


  async #cache(method, args, fallback = undefined) {
    try {
      return await this.cache?.[method]?.(...args);
    } catch (error) {
      const write = method.startsWith('put');
      this.#log('warn', 'cache', write ? 'CACHE_WRITE_FAILED' : 'CACHE_READ_FAILED', `${method} failed; continuing without persistent cache`, {
        method, site: args?.[0] ?? '', scanStartMs: args?.[1] ?? null,
      }, error);
      return fallback;
    }
  }

  #releaseActive() {
    if (!this.active) return;
    try { this.engine.release_source(this.active.sourceId); } catch { /* source may already be gone */ }
    this.#log('debug', 'wasm', 'SOURCE_RELEASE', `Released decoded source for ${this.active.site}`, {
      site: this.active.site,
      objectKey: this.active.objectKey,
      sourceId: this.active.sourceId,
    });
    this.active = null;
  }

  dispose() {
    this.loadGeneration += 1;
    this.#releaseActive();
  }

  #assertCurrent(generation, { site, objectKey, scanStartMs }) {
    if (generation === this.loadGeneration) return;
    const error = Object.assign(new Error(`Obsolete Level II load was superseded for ${site}`), {
      code: 'E_STALE_LOAD',
      stage: 'pipeline',
      sourceId: objectKey,
      context: { site, objectKey, scanStartMs, generation, currentGeneration: this.loadGeneration },
    });
    this.#log('debug', 'pipeline', 'STALE_LOAD_IGNORED', error.message, error.context);
    throw error;
  }

  async load({ site, objectKey, scanStartMs, elevationNumber = null, productId = 1 }) {
    const generation = ++this.loadGeneration;
    const identity = { site, objectKey, scanStartMs };
    const loadStarted = this.now();
    let manifest = await this.#cache('getScan', [site, scanStartMs]);
    this.#assertCurrent(generation, identity);
    if (manifest) {
      const elevation = chooseElevation(manifest, elevationNumber, productId);
      if (elevation) {
        const cached = await this.#cache('getSweep', [site, scanStartMs, elevation.number, productId]);
        this.#assertCurrent(generation, identity);
        if (cached) {
          this.#log('info', 'cache', 'SWEEP_CACHE_HIT', `Using cached sweep for ${site}`, {
            site, objectKey, scanStartMs, productId, elevationNumber: elevation.number,
            byteLength: cached.byteLength, elapsedMs: this.now() - loadStarted,
          });
          return { site, objectKey, scanStartMs, manifest, elevationNumber: elevation.number, productId, buffer: cached, cacheHit: true };
        }
      }
    }

    const activeMatches = this.active?.site === site
      && this.active?.objectKey === objectKey
      && this.active?.scanStartMs === scanStartMs;

    let sourceId;
    let byteLength = 0;
    if (activeMatches) {
      sourceId = this.active.sourceId;
      manifest = this.active.manifest;
      this.#log('debug', 'wasm', 'SOURCE_REUSE', `Reusing decoded Level II source for ${site}`, { site, objectKey, scanStartMs, sourceId });
    } else {
      const url = archiveObjectUrl(objectKey);
      const fetchStarted = this.now();
      this.#log('info', 'fetch', 'ARCHIVE_FETCH_START', `Fetching Level II archive for ${site}`, { site, objectKey, scanStartMs, sourceId: url });
      let bytes;
      try {
        bytes = await this.fetchArrayBuffer(url);
        this.#assertCurrent(generation, identity);
      } catch (error) {
        this.#log('error', error?.stage ?? 'fetch', error?.code ?? 'ARCHIVE_FETCH_FAILED', `Level II archive fetch failed for ${site}`, {
          site, objectKey, scanStartMs, sourceId: url, elapsedMs: this.now() - fetchStarted,
        }, error);
        throw error;
      }
      byteLength = bytes.byteLength;
      this.#log('info', 'fetch', 'ARCHIVE_FETCH_OK', `Fetched Level II archive for ${site}`, {
        site, objectKey, scanStartMs, sourceId: url, byteLength, elapsedMs: this.now() - fetchStarted,
      });
      // Keep the currently decoded volume usable while the network request is in flight.
      // Swap sources only once the replacement bytes are actually available. This also
      // releases a source that may have become active while this request was downloading.
      this.#releaseActive();
      sourceId = `${site}|${scanStartMs}|${objectKey}`;
      const decodeStarted = this.now();
      this.#log('info', 'archive', 'ARCHIVE_DECODE_START', `Decoding Level II archive for ${site}`, { site, objectKey, scanStartMs, sourceId, byteLength });
      try {
        manifest = this.engine.ingest_archive(sourceId, site, new Uint8Array(bytes));
        if (!manifest?.elevations?.length) throw new Error(`decoded ${site} volume has no elevations`);
        this.active = { sourceId, site, objectKey, scanStartMs, manifest };
        void this.#cache('putScan', [site, scanStartMs, manifest]);
        this.#log('info', 'archive', 'ARCHIVE_DECODE_OK', `Decoded Level II archive for ${site}`, {
          site, objectKey, scanStartMs, sourceId, byteLength,
          elevationCount: manifest.elevations.length, vcp: manifest.vcp ?? null,
          elapsedMs: this.now() - decodeStarted,
        });
      } catch (error) {
        try { this.engine.release_source(sourceId); } catch { /* ingest may not have registered */ }
        const wrapped = frameError(error, { site, objectKey, byteLength });
        this.#log('error', wrapped.stage, wrapped.code, wrapped.message, {
          site, objectKey, scanStartMs, sourceId, byteLength, elapsedMs: this.now() - decodeStarted,
        }, wrapped);
        throw wrapped;
      }
    }

    const sweepStarted = this.now();
    try {
      const elevation = chooseElevation(manifest, elevationNumber, productId);
      if (!elevation) throw Object.assign(new Error(`product ${productId} is unavailable in decoded ${site} volume`), { code: 'E_PRODUCT_UNAVAILABLE', stage: 'sweep' });
      this.#log('debug', 'sweep', 'SWEEP_BUILD_START', `Building sweep ${productId}/${elevation.number} for ${site}`, {
        site, objectKey, scanStartMs, productId, elevationNumber: elevation.number, sourceId,
      });
      const blobView = this.engine.build_sweep_blob(sourceId, elevation.number, productId);
      const buffer = ownArrayBuffer(blobView);
      void this.#cache('putSweep', [site, scanStartMs, elevation.number, productId, buffer]);
      this.#log('info', 'sweep', 'SWEEP_READY', `Sweep ready for ${site}`, {
        site, objectKey, scanStartMs, productId, elevationNumber: elevation.number,
        sourceId, byteLength: buffer.byteLength, elapsedMs: this.now() - sweepStarted,
        totalElapsedMs: this.now() - loadStarted,
      });
      return { site, objectKey, scanStartMs, manifest, elevationNumber: elevation.number, productId, buffer, cacheHit: false };
    } catch (error) {
      const wrapped = frameError(error, { site, objectKey, byteLength });
      this.#log('error', wrapped.stage, wrapped.code, wrapped.message, {
        site, objectKey, scanStartMs, productId, elevationNumber, sourceId,
        byteLength, elapsedMs: this.now() - sweepStarted,
      }, wrapped);
      throw wrapped;
    }
  }
}
