import { WorkerClient } from './worker-client.js';
import { EVENTS } from './worker-protocol.js';
import { initializeRadarWorkers } from './startup.js';

export function createLazyLevel2SessionFactory({
  decoderBase,
  ui,
  diagnostics,
  WorkerImpl = Worker,
  WorkerClientImpl = WorkerClient,
  initializeWorkers = initializeRadarWorkers,
}) {
  let sessionPromise = null;

  return () => {
    if (sessionPromise) return sessionPromise;

    let priorityWorker = null;
    const promise = (async () => {
      priorityWorker = new WorkerImpl(new URL('./priority-worker.js', import.meta.url), { type: 'module', name: 'personalnws-priority' });
      const priority = new WorkerClientImpl(priorityWorker, { timeoutMs: 45_000, diagnostics, role: 'priority' });
      priority.on?.(EVENTS.METRICS, (entry) => diagnostics?.record?.(entry?.level ?? 'debug', entry?.stage ?? 'worker', entry?.code ?? 'WORKER_METRIC', entry?.message ?? 'Worker metric', entry?.context ?? {}, entry?.error ?? null));
      priority.on?.(EVENTS.DIAGNOSTIC, (error) => diagnostics?.error?.(error?.stage ?? 'worker', error?.code ?? 'E_WORKER', error?.message ?? 'Priority worker diagnostic', { ...(error?.context ?? {}), sourceId: error?.sourceId ?? '', role: 'priority' }, error));

      try {
        await initializeWorkers({ priority, decoderBase });
      } catch (error) {
        try { priorityWorker.terminate(); } catch {}
        throw error;
      }

      let historyWorker = null;
      let history = null;
      let historyReady = null;
      let historyRun = null;
      let historyKey = '';
      let historyGeneration = 0;
      let disposed = false;

      const resetHistoryWorker = (error = null) => {
        ++historyGeneration;
        historyRun = null;
        historyKey = '';
        historyReady = null;
        try { historyWorker?.terminate(); } catch {}
        historyWorker = null;
        history = null;
        if (error) diagnostics?.warn?.(error?.stage ?? 'history', 'HISTORY_WORKER_RESET', 'Resetting failed history worker', { code: error?.code ?? '', sourceId: error?.sourceId ?? '' }, error);
      };

      const ensureHistory = () => {
        if (disposed) return Promise.reject(Object.assign(new Error('Level II session was disposed'), { code: 'E_WORKER_DISPOSED', stage: 'worker' }));
        if (historyReady) return historyReady;
        historyReady = (async () => {
          historyWorker = new WorkerImpl(new URL('./history-worker.js', import.meta.url), { type: 'module', name: 'personalnws-history' });
          history = new WorkerClientImpl(historyWorker, { timeoutMs: 120_000, diagnostics, role: 'history' });
          history.on?.(EVENTS.CACHE_PROGRESS, ({ done, total }) => ui?.cacheProgress?.(done, total));
          history.on?.(EVENTS.METRICS, (entry) => diagnostics?.record?.(entry?.level ?? 'debug', entry?.stage ?? 'history', entry?.code ?? 'WORKER_METRIC', entry?.message ?? 'History worker metric', entry?.context ?? {}, entry?.error ?? null));
          history.on?.(EVENTS.DIAGNOSTIC, (error) => diagnostics?.warn?.(error?.stage ?? 'history', error?.code ?? 'E_HISTORY', error?.message ?? 'History worker diagnostic', { ...(error?.context ?? {}), sourceId: error?.sourceId ?? '', role: 'history' }, error));
          try {
            await initializeWorkers({ priority: history, decoderBase });
          } catch (error) {
            try { historyWorker?.terminate(); } catch {}
            historyWorker = null;
            history = null;
            throw error;
          }
          return history;
        })().catch((error) => {
          diagnostics?.warn?.(error?.stage ?? 'history', error?.code ?? 'HISTORY_INIT_FAILED', 'History worker initialization failed', { sourceId: error?.sourceId ?? '' }, error);
          historyReady = null;
          throw error;
        });
        return historyReady;
      };

      const startHistory = (payload) => {
        if (disposed || !payload?.frames?.length) return Promise.resolve(null);
        const latest = payload.frames.at(-1)?.scanStartMs ?? 0;
        const key = `${payload.site}|${payload.productId}|${payload.elevationNumber ?? 'auto'}|${payload.frames.length}|${latest}`;
        if (historyRun && historyKey === key) return historyRun;
        const generation = ++historyGeneration;
        const replacing = Boolean(historyRun);
        historyKey = key;
        const run = ensureHistory()
          .then(async (client) => {
            if (disposed || generation !== historyGeneration) return null;
            if (replacing) {
              try { await client.request('CANCEL_HISTORY'); }
              catch (error) { diagnostics?.warn?.('history', 'HISTORY_CANCEL_FAILED', 'Could not cancel obsolete history backfill', { site: payload.site }, error); }
            }
            if (disposed || generation !== historyGeneration) return null;
            return client.request('START_HISTORY', payload);
          })
          .catch((error) => {
            diagnostics?.warn?.(error?.stage ?? 'history', error?.code ?? 'HISTORY_BACKFILL_FAILED', 'History backfill failed', { site: payload.site, productId: payload.productId }, error);
            if (error?.code === 'E_WORKER_TIMEOUT' || error?.code === 'E_WORKER' || error?.stage === 'worker') resetHistoryWorker(error);
            return null;
          })
          .finally(() => { if (generation === historyGeneration) historyRun = null; });
        historyRun = run;
        return run;
      };

      return {
        priority,
        startHistory,
        dispose() {
          if (disposed) return;
          disposed = true;
          ++historyGeneration;
          historyRun = null;
          historyKey = '';
          historyReady = null;
          try { priorityWorker?.terminate(); } catch {}
          try { historyWorker?.terminate(); } catch {}
          if (sessionPromise === promise) sessionPromise = null;
        },
      };
    })().catch((error) => {
      try { priorityWorker?.terminate(); } catch {}
      if (sessionPromise === promise) sessionPromise = null;
      throw error;
    });

    sessionPromise = promise;
    return promise;
  };
}
