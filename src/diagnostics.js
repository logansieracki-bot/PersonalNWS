function normalizeError(error) {
  if (!error) return null;
  return {
    name: String(error.name ?? 'Error'),
    message: String(error.message ?? error),
    stack: typeof error.stack === 'string' ? error.stack : '',
  };
}

export function createDiagnostics({ now = Date.now, maxEntries = 250 } = {}) {
  const items = [];

  function write(level, stage, code, message, context = {}, error = null) {
    const entry = {
      timestamp: now(),
      level,
      stage: String(stage || 'app'),
      code: String(code || 'EVENT'),
      message: String(message || ''),
      context: context && typeof context === 'object' ? { ...context } : {},
      error: normalizeError(error),
    };
    items.push(entry);
    if (items.length > maxEntries) items.splice(0, items.length - maxEntries);
    return entry;
  }

  return Object.freeze({
    info: (stage, code, message, context) => write('info', stage, code, message, context),
    warn: (stage, code, message, context, error) => write('warn', stage, code, message, context, error),
    error: (stage, code, message, context, error) => write('error', stage, code, message, context, error),
    entries: ({ limit } = {}) => {
      const copy = items.map((entry) => ({ ...entry, context: { ...entry.context }, error: entry.error ? { ...entry.error } : null }));
      return Number.isFinite(limit) ? copy.slice(-Math.max(0, Number(limit))) : copy;
    },
    clear: () => { items.length = 0; },
    report: (extra = {}) => ({ generatedAt: now(), ...extra, entries: items.map((entry) => ({ ...entry, context: { ...entry.context }, error: entry.error ? { ...entry.error } : null })) }),
  });
}
