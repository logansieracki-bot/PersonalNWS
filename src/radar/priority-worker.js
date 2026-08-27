import { openRadarCache } from './cache.js';
import { listCompletedVolumes } from './nexrad-source.js';
import { loadRadarDecoder } from './wasm-loader.js';
import { FramePipeline } from './frame-pipeline.js';
import { WorkerCore } from './worker-core.js';
import { createWorkerRuntime } from './worker-runtime.js';
import { fetchArrayBufferWithRetry } from './network.js';

let runtime = null;
let initialized = false;

function post(msg, transfer = []) { self.postMessage(msg, transfer); }
function metric(level, stage, code, message, context = {}, error = null) {
  post({ type: 'METRICS', payload: {
    level, stage, code, message, context,
    ...(error ? { error: { code: error?.code, stage: error?.stage, sourceId: error?.sourceId, message: error?.message, detail: error?.detail ?? error?.stack } } : {}),
  } });
}
const diagnostics = { record: metric };
function diagnostic(error, sourceId = '') {
  return {
    code: error?.code ?? 'E_WORKER_INIT',
    stage: error?.stage ?? 'worker-init',
    sourceId: error?.sourceId ?? sourceId,
    message: String(error?.message ?? error ?? 'Worker initialization failed'),
    detail: String(error?.detail ?? error?.stack ?? error?.message ?? error ?? 'Worker initialization failed'),
    context: error?.context ?? {},
  };
}

async function fetchArrayBuffer(url) {
  return fetchArrayBufferWithRetry(url, { retries: 0, timeoutMs: 10_000 });
}

async function init(message) {
  const started = Date.now();
  const decoderBase = message?.payload?.decoderBase;
  if (!decoderBase) throw new Error('INIT missing decoderBase');
  metric('info', 'worker-init', 'PRIORITY_INIT_START', 'Initializing priority Level II worker', { decoderBase });
  const { RadarEngine } = await loadRadarDecoder(decoderBase);
  const engine = new RadarEngine();
  const cache = await openRadarCache({ onFallback: (error) => metric('warn', 'cache', 'CACHE_MEMORY_FALLBACK', 'IndexedDB unavailable; using memory cache', {}, error) });
  const pipeline = new FramePipeline({ cache, engine, fetchArrayBuffer, diagnostics });
  const core = new WorkerCore({ role: 'priority', listVolumes: listCompletedVolumes, pipeline, diagnostics });
  runtime = createWorkerRuntime({ core, post });
  initialized = true;
  metric('info', 'worker-init', 'PRIORITY_INIT_READY', 'Priority Level II worker ready', { elapsedMs: Date.now() - started });
  post({ replyTo: message.id, ok: true, payload: { role: 'priority', decoder: 'ready' } });
}

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message?.type === 'INIT') return await init(message);
    if (!initialized || !runtime) throw Object.assign(new Error('priority worker received a command before INIT'), { code: 'E_WORKER_NOT_READY', stage: 'worker' });
    await runtime(message);
  } catch (error) {
    metric('error', error?.stage ?? 'worker', error?.code ?? 'E_WORKER', error?.message ?? 'Priority worker command failed', { command: message?.type ?? '', sourceId: error?.sourceId ?? '' }, error);
    post({ replyTo: message?.id, ok: false, error: diagnostic(error) });
  }
};
