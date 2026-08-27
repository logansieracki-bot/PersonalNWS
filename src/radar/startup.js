export async function initializeRadarWorkers({ priority, history = null, decoderBase }) {
  const priorityReady = await priority.request('INIT', { decoderBase });
  const historyState = { ready: false, error: null };

  if (!history) {
    return { priorityReady, historyReady: false, historyState, historyInit: Promise.resolve(null) };
  }

  const historyInit = Promise.resolve()
    .then(() => history.request('INIT', { decoderBase }))
    .then((value) => {
      historyState.ready = true;
      return value;
    })
    .catch((error) => {
      historyState.error = error;
      return null;
    });

  return { priorityReady, historyReady: false, historyState, historyInit };
}


export function waitForMapReady(map, {
  timeoutMs = 10_000,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  if (map?.loaded?.()) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const cleanup = () => {
      try { map?.off?.('load', onLoad); } catch {}
      try { map?.off?.('error', onError); } catch {}
      if (timer != null) {
        try { Reflect.apply(clearTimeoutImpl, globalThis, [timer]); } catch {}
        timer = null;
      }
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onLoad = () => finish(resolve, true);
    const onError = (event) => {
      const cause = event?.error ?? event;
      const error = Object.assign(new Error(`Map failed to load: ${cause?.message ?? cause ?? 'unknown map error'}`), {
        code: 'E_MAP_LOAD',
        stage: 'map',
        cause,
      });
      finish(reject, error);
    };
    map?.once?.('load', onLoad);
    map?.once?.('error', onError);
    if (timeoutMs > 0) {
      try {
        timer = Reflect.apply(setTimeoutImpl, globalThis, [() => {
          const error = Object.assign(new Error(`Map did not become ready within ${timeoutMs} ms`), {
            code: 'E_MAP_LOAD_TIMEOUT',
            stage: 'map',
            context: { timeoutMs },
          });
          finish(reject, error);
        }, timeoutMs]);
      } catch (cause) {
        const error = Object.assign(new Error(`Could not arm map startup timeout: ${cause?.message ?? cause}`), {
          code: 'E_MAP_TIMER',
          stage: 'map',
          cause,
        });
        finish(reject, error);
      }
    }
  });
}
