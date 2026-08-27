import { LEVEL2_ARCHIVE_BASE } from '../config.js';

const pad = (n) => String(n).padStart(2, '0');
const XML_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });

function decodeXml(value = '') {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const n = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? _;
  });
}

function tagText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1].trim()) : '';
}

export function archivePrefix(site, date) {
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${site}/`;
}

export function parseS3List(xml) {
  const keys = [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/gi)].map((m) => decodeXml(m[1].trim()));
  return keys.flatMap((key) => {
    const m = key.match(/\/([A-Z0-9]{4})(\d{8})_(\d{6})(?:_V\d+)?(?:\.gz)?$/);
    if (!m) return [];
    const date = m[2], time = m[3];
    const scanStartMs = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`);
    return Number.isFinite(scanStartMs) ? [{ key, scanStartMs }] : [];
  });
}

function pageInfo(xml) {
  return {
    truncated: tagText(xml, 'IsTruncated').toLowerCase() === 'true',
    nextToken: tagText(xml, 'NextContinuationToken'),
  };
}

async function fetchListPage(url, { fetchImpl = fetch, timeoutMs = 5_000 } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { controller?.abort(); } catch {}
      reject(Object.assign(new Error(`S3 list timed out after ${timeoutMs} ms`), {
        code: 'E_S3_LIST_TIMEOUT', stage: 'listing', sourceId: url.href,
      }));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      Promise.resolve(fetchImpl(url, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) })),
      timeout,
    ]);
    const xml = await Promise.race([Promise.resolve(response.text()), timeout]);
    return { response, xml };
  } finally {
    clearTimeout(timer);
  }
}

async function list(base, prefix, fetchImpl = fetch, timeoutMs = 5_000) {
  const out = [];
  let continuationToken = '';
  for (let page = 0; page < 100; page++) {
    const u = new URL(`${base}/`);
    u.searchParams.set('list-type', '2');
    u.searchParams.set('prefix', prefix);
    if (continuationToken) u.searchParams.set('continuation-token', continuationToken);
    const { response: r, xml } = await fetchListPage(u, { fetchImpl, timeoutMs });
    if (!r.ok) {
      const error = new Error(`S3 list HTTP ${r.status}`);
      error.code = 'E_S3_LIST'; error.stage = 'listing'; error.sourceId = u.href;
      throw error;
    }
    out.push(...parseS3List(xml));
    const info = pageInfo(xml);
    if (!info.truncated) return out;
    if (!info.nextToken || info.nextToken === continuationToken) {
      const error = new Error('S3 list was truncated without a usable continuation token');
      error.code = 'E_S3_PAGINATION'; error.stage = 'listing'; error.sourceId = u.href;
      throw error;
    }
    continuationToken = info.nextToken;
  }
  throw Object.assign(new Error('S3 listing exceeded 100 pages'), { code: 'E_S3_PAGINATION', stage: 'listing', sourceId: prefix });
}

export async function listCompletedVolumes(site, startMs, endMs, { fetchImpl = fetch, timeoutMs = 5_000 } = {}) {
  const days = new Set();
  const firstDay = Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth(), new Date(startMs).getUTCDate());
  const lastDay = Date.UTC(new Date(endMs).getUTCFullYear(), new Date(endMs).getUTCMonth(), new Date(endMs).getUTCDate());
  for (let t = firstDay; t <= lastDay; t += 86_400_000) days.add(archivePrefix(site, new Date(t)));

  const settled = await Promise.allSettled([...days].map((prefix) => list(LEVEL2_ARCHIVE_BASE, prefix, fetchImpl, timeoutMs)));
  const successful = settled.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  if (!successful.length && settled.some((r) => r.status === 'rejected')) {
    throw settled.find((r) => r.status === 'rejected').reason;
  }
  const deduped = new Map(successful.map((entry) => [entry.key, entry]));
  return [...deduped.values()].sort((a, b) => a.scanStartMs - b.scanStartMs).filter((x) => x.scanStartMs >= startMs && x.scanStartMs <= endMs);
}

export function archiveObjectUrl(key) { return `${LEVEL2_ARCHIVE_BASE}/${key}`; }
