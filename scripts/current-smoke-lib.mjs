const VOLUME_KEY = /\/[A-Z0-9]{4}\d{8}_\d{6}_V\d+(?:\.gz)?$/;
const pad = (n) => String(n).padStart(2, '0');

export function volumePrefix(site, date) {
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${site}/`;
}

export function parseVolumeKeys(xml) {
  return [...String(xml).matchAll(/<Key>([^<]+)<\/Key>/g)]
    .map((m) => m[1].replaceAll('&amp;', '&'))
    .filter((key) => VOLUME_KEY.test(key));
}

export function volumeKeyTimeMs(key) {
  const m = String(key).match(/\/([A-Z0-9]{4})(\d{8})_(\d{6})_V\d+(?:\.gz)?$/);
  if (!m) return NaN;
  const date = m[2];
  const time = m[3];
  return Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`);
}

export function newestVolumeKey(keys) {
  return [...keys].sort().at(-1) ?? null;
}


async function fetchTextWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { controller?.abort(); } catch { /* best effort */ }
      reject(Object.assign(new Error(`smoke listing timed out after ${timeoutMs} ms`), {
        code: 'E_SMOKE_TIMEOUT', sourceId: String(url),
      }));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      Promise.resolve(fetchImpl(url, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) })),
      timeout,
    ]);
    if (!response?.ok) return null;
    return await Promise.race([Promise.resolve(response.text()), timeout]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

export async function findCurrentVolume({
  sites,
  now = new Date(),
  lookbackDays = 2,
  archiveBase = 'https://unidata-nexrad-level2.s3.amazonaws.com',
  fetchImpl = fetch,
  maxAgeMs = 2 * 60 * 60 * 1000,
  requestTimeoutMs = 8_000,
}) {
  for (let dayOffset = 0; dayOffset <= lookbackDays; dayOffset += 1) {
    const day = new Date(now.getTime() - dayOffset * 86400000);
    for (const site of sites) {
      const prefix = volumePrefix(site, day);
      const url = new URL(`${archiveBase}/`);
      url.searchParams.set('list-type', '2');
      url.searchParams.set('prefix', prefix);
      let xml;
      try {
        xml = await fetchTextWithTimeout(fetchImpl, url, requestTimeoutMs);
      } catch {
        continue;
      }
      if (xml == null) continue;
      const keys = parseVolumeKeys(xml);
      const fresh = keys.filter((key) => {
        const t = volumeKeyTimeMs(key);
        return Number.isFinite(t) && t <= now.getTime() && now.getTime() - t <= maxAgeMs;
      });
      const key = newestVolumeKey(fresh);
      if (key) return { site, key, url: `${archiveBase}/${key}` };
    }
  }
  return null;
}
