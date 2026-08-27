import { openRadarCache } from './cache.js';
import { loadRadarDecoder } from './wasm-loader.js';
import { FramePipeline } from './frame-pipeline.js';
import { HistoryBackfill } from './history-backfill.js';
import { fetchArrayBufferWithRetry } from './network.js';
import { COMMANDS } from './worker-protocol.js';

let engine, cache, pipeline, backfill;
function post(msg, transfer = []) { self.postMessage(msg, transfer); }
function metric(level, stage, code, message, context = {}, error = null) {
  post({ type: 'METRICS', payload: {
    level, stage, code, message, context,
    ...(error ? { error: { code: error?.code, stage: error?.stage, sourceId: error?.sourceId, message: error?.message, detail: error?.detail ?? error?.stack } } : {}),
  } });
}
const diagnostics = { record: metric };
function err(e) { return { code: e?.code ?? 'E_HISTORY', stage: e?.stage ?? 'history', sourceId: e?.sourceId ?? '', message: String(e?.message ?? e), detail: String(e?.detail ?? e?.stack ?? e), context: e?.context ?? {} }; }
async function fetchArrayBuffer(url) { return fetchArrayBufferWithRetry(url); }

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === COMMANDS.INIT) {
      const started = Date.now();
      metric('info', 'history', 'HISTORY_INIT_START', 'Initializing history worker', { decoderBase: m.payload.decoderBase });
      const { RadarEngine } = await loadRadarDecoder(m.payload.decoderBase);
      engine = new RadarEngine();
      cache = await openRadarCache({ onFallback: (error) => metric('warn', 'cache', 'CACHE_MEMORY_FALLBACK', 'IndexedDB unavailable; using memory cache', {}, error) });
      pipeline = new FramePipeline({ cache, engine, fetchArrayBuffer, diagnostics });
      backfill = new HistoryBackfill({ pipeline, post });
      metric('info', 'history', 'HISTORY_INIT_READY', 'History worker ready', { elapsedMs: Date.now() - started });
      post({ replyTo: m.id, ok: true, payload: { role: 'history', decoder: 'ready' } });
      return;
    }
    if (!backfill) throw Object.assign(new Error('history worker received a command before INIT'), { code: 'E_WORKER_NOT_READY', stage: 'history' });
    if (m.type === COMMANDS.CANCEL_HISTORY) {
      backfill.cancel();
      metric('debug', 'history', 'HISTORY_CANCEL', 'Cancelled obsolete history backfill', {});
      post({ replyTo: m.id, ok: true, payload: { cancelled: true } });
      return;
    }
    if (m.type === COMMANDS.START_HISTORY) {
      const { frames = [], site, productId = 1, elevationNumber = null } = m.payload;
      const started = Date.now();
      metric('info', 'history', 'HISTORY_START', `Backfilling ${frames.length} frames for ${site}`, { site, productId, elevationNumber, total: frames.length });
      const result = await backfill.run({ frames, site, productId, elevationNumber });
      metric(result.cancelled ? 'debug' : 'info', 'history', result.cancelled ? 'HISTORY_CANCELLED' : 'HISTORY_DONE', result.cancelled ? `History backfill cancelled for ${site}` : `History backfill complete for ${site}`, { site, ...result, elapsedMs: Date.now() - started });
      post({ replyTo: m.id, ok: true, payload: result });
      return;
    }
    throw Object.assign(new Error(`unsupported history command ${m.type}`), { code: 'E_PROTOCOL', stage: 'history' });
  } catch (e) {
    metric('error', e?.stage ?? 'history', e?.code ?? 'E_HISTORY', e?.message ?? 'History worker command failed', { command: m?.type ?? '', sourceId: e?.sourceId ?? '' }, e);
    post({ replyTo: m?.id, ok: false, error: err(e) });
  }
};
