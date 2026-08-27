export async function runUiAction(action, fn, { diagnostics = null, ui = null, context = {} } = {}) {
  try {
    return await fn();
  } catch (error) {
    const stage = error?.stage ?? 'interaction';
    const code = error?.code ?? 'E_UI_ACTION';
    const sourceId = error?.sourceId ?? '';
    try {
      diagnostics?.record?.('error', stage, code, `${action} failed: ${error?.message ?? error ?? 'unknown error'}`, {
        ...context,
        action,
        sourceId,
      }, error);
    } catch {}
    try { ui?.error?.(error); } catch {}
    return null;
  }
}
