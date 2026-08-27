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
