function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function withTimeout(promise, timeoutMs, makeError, onTimeout = null) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* best effort */ }
      reject(makeError());
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function fetchArrayBufferWithRetry(url, {
  fetchImpl = fetch,
  retries = 2,
  timeoutMs = 20_000,
  retryDelayMs = 250,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    try {
      const response = await withTimeout(
        fetchImpl(url, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) }),
        timeoutMs,
        () => Object.assign(new Error(`Level II fetch timed out after ${timeoutMs} ms`), {
          code: 'E_ARCHIVE_TIMEOUT', stage: 'fetch', sourceId: url,
        }),
        () => controller?.abort(),
      );
      if (!response.ok) {
        const error = Object.assign(new Error(`Level II object HTTP ${response.status}`), {
          code: 'E_ARCHIVE_FETCH', stage: 'fetch', sourceId: url,
        });
        if (response.status < 500 || attempt === retries) throw error;
        lastError = error;
      } else {
        return await withTimeout(
          response.arrayBuffer(),
          timeoutMs,
          () => Object.assign(new Error(`Level II body timed out after ${timeoutMs} ms`), {
            code: 'E_ARCHIVE_TIMEOUT', stage: 'fetch', sourceId: url,
          }),
          () => controller?.abort(),
        );
      }
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
    }
    await sleep(retryDelayMs * (attempt + 1));
  }
  throw lastError;
}
