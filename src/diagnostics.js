import { APP_RELEASE_LABEL, APP_VERSION, BUILD_ID } from './config.js';
const DEFAULT_CAPACITY = 300;
const KNOWN_DIAGNOSTIC_KEYS = new Set(['code', 'stage', 'sourceId', 'message', 'detail', 'context', 'level', 'id', 'timestampMs', 'iso']);

function safeValue(value, depth = 0) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength} bytes]`;
  if (ArrayBuffer.isView(value)) return `[${value.constructor?.name ?? 'TypedArray'} ${value.byteLength} bytes]`;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (depth >= 3) return `[${Array.isArray(value) ? 'Array' : 'Object'}]`;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) out[key] = safeValue(item, depth + 1);
    return out;
  }
  return String(value);
}

function contextFromExtra(extra = {}) {
  const context = { ...(extra.context ?? {}) };
  for (const [key, value] of Object.entries(extra)) {
    if (!KNOWN_DIAGNOSTIC_KEYS.has(key)) context[key] = value;
  }
  return safeValue(context);
}

export function normalizeDiagnostic(error, extra = {}) {
  const source = error && typeof error === 'object' ? error : {};
  const inheritedContext = source.context && typeof source.context === 'object' ? source.context : {};
  return {
    code: extra.code ?? source.code ?? 'E_INTERNAL',
    stage: extra.stage ?? source.stage ?? 'app',
    sourceId: extra.sourceId ?? source.sourceId ?? '',
    message: String(extra.message ?? source.message ?? error ?? 'Unknown error'),
    detail: String(extra.detail ?? source.detail ?? source.stack ?? source.message ?? error ?? 'Unknown error'),
    context: safeValue({ ...inheritedContext, ...contextFromExtra(extra) }),
  };
}

function makeId(timestampMs, sequence) {
  return `D${Math.trunc(timestampMs).toString(36).toUpperCase()}-${String(sequence).padStart(3, '0')}`;
}

export function createDiagnosticLogger({
  capacity = DEFAULT_CAPACITY,
  now = () => Date.now(),
  consoleImpl = console,
} = {}) {
  const buffer = [];
  let sequence = 0;

  const record = (level, stage, code, message, context = {}, error = null) => {
    const timestampMs = Number(now());
    const normalized = error
      ? normalizeDiagnostic(error, { stage, code, message, ...context })
      : normalizeDiagnostic({ code, stage, message, detail: context?.detail ?? '' }, context);
    const entry = Object.freeze({
      id: makeId(Number.isFinite(timestampMs) ? timestampMs : Date.now(), ++sequence),
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : Date.now(),
      iso: new Date(Number.isFinite(timestampMs) ? timestampMs : Date.now()).toISOString(),
      level: String(level || 'info'),
      stage: normalized.stage,
      code: normalized.code,
      message: normalized.message,
      sourceId: normalized.sourceId,
      detail: normalized.detail,
      context: normalized.context,
    });
    buffer.push(entry);
    while (buffer.length > Math.max(1, capacity)) buffer.shift();

    const method = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : entry.level === 'debug' ? 'debug' : 'info';
    try { consoleImpl?.[method]?.(`[PersonalNWS][${entry.id}][${entry.stage}][${entry.code}] ${entry.message}`, entry); } catch {}
    return entry;
  };

  return {
    record,
    debug: (stage, code, message, context = {}, error = null) => record('debug', stage, code, message, context, error),
    info: (stage, code, message, context = {}, error = null) => record('info', stage, code, message, context, error),
    warn: (stage, code, message, context = {}, error = null) => record('warn', stage, code, message, context, error),
    error: (stage, code, message, context = {}, error = null) => record('error', stage, code, message, context, error),
    entries({ limit = capacity } = {}) { return buffer.slice(-Math.max(0, Number(limit) || 0)); },
    clear() { buffer.length = 0; },
  };
}

export const diagnosticLog = createDiagnosticLogger();

function compactContext(context = {}) {
  const parts = [];
  for (const key of ['site', 'productId', 'elevationNumber', 'objectKey', 'sourceId', 'status', 'siteCount']) {
    const value = context?.[key];
    if (value !== undefined && value !== null && value !== '') parts.push(`${key}=${String(value)}`);
  }
  if (Number.isFinite(Number(context?.elapsedMs))) parts.push(`${Math.round(Number(context.elapsedMs))}ms`);
  if (Number.isFinite(Number(context?.byteLength))) parts.push(`${Number(context.byteLength)}B`);
  return parts.join(' ');
}

export function formatDiagnosticTrail(entries = [], { limit = 12 } = {}) {
  return entries.slice(-Math.max(0, Number(limit) || 0)).map((entry) => {
    const when = Number.isFinite(entry?.timestampMs)
      ? new Date(entry.timestampMs).toISOString().slice(11, 23)
      : '--:--:--.---';
    const context = compactContext(entry?.context);
    return `${when} ${String(entry?.level ?? 'info').toUpperCase().padEnd(5)} ${entry?.stage ?? 'app'} ${entry?.code ?? 'E_INTERNAL'}${context ? ` · ${context}` : ''} · ${entry?.message ?? ''}`;
  }).join('\n');
}

export function buildDiagnosticReport({ state = {}, error = null, entries = diagnosticLog.entries() } = {}) {
  const normalizedError = error ? normalizeDiagnostic(error) : null;
  return {
    generatedAt: new Date().toISOString(),
    release: APP_RELEASE_LABEL,
    version: APP_VERSION,
    buildId: BUILD_ID,
    page: typeof location !== 'undefined' ? location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    state: safeValue(state),
    error: normalizedError,
    diagnostics: entries.map((entry) => safeValue(entry)),
  };
}

export function clearDiagnostic() {
  if (typeof document === 'undefined') return false;
  const box = document.getElementById('fatal');
  const text = document.getElementById('fatalText');
  const code = document.getElementById('fatalCode');
  const copy = document.getElementById('fatalCopy');
  if (box) box.style.display = 'none';
  if (text) text.textContent = '';
  if (code) code.textContent = '';
  if (copy) {
    copy.textContent = 'Copy Debug Report';
    copy.onclick = null;
  }
  return Boolean(box || text || code || copy);
}

export function showDiagnostic(error, extra = {}) {
  const d = normalizeDiagnostic(error, extra);
  const entry = diagnosticLog.error(d.stage, d.code, d.message, {
    ...d.context,
    sourceId: d.sourceId,
    detail: d.detail,
  }, error);
  const box = typeof document !== 'undefined' ? document.getElementById('fatal') : null;
  if (box) {
    box.style.display = 'block';
    const text = document.getElementById('fatalText');
    const code = document.getElementById('fatalCode');
    const trail = formatDiagnosticTrail(diagnosticLog.entries({ limit: 10 }), { limit: 10 });
    if (text) text.textContent = `${d.stage}: ${d.message}\n${d.detail ?? ''}\n\nRecent radar pipeline:\n${trail}`;
    if (code) code.textContent = `${d.code}${d.sourceId ? ` · ${d.sourceId}` : ''} · ${entry.id} · build ${BUILD_ID.slice(0, 12)}`;
    const copy = document.getElementById('fatalCopy');
    if (copy) {
      copy.onclick = async () => {
        let state = {};
        try { state = window.__PERSONALNWS__?.debug?.() ?? {}; } catch {}
        const textReport = JSON.stringify(buildDiagnosticReport({ state, error: d }), null, 2);
        try {
          if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(textReport);
            copy.textContent = 'Copied';
            setTimeout(() => { copy.textContent = 'Copy Debug Report'; }, 1200);
          } else {
            console.error('[PersonalNWS debug report]', textReport);
            copy.textContent = 'Printed to Console';
          }
        } catch (copyError) {
          console.error('[PersonalNWS debug report]', textReport, copyError);
          copy.textContent = 'Printed to Console';
        }
      };
    }
  }
  return { ...d, id: entry.id };
}
