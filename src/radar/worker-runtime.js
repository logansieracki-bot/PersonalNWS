function structured(error) {
  return {
    code: error?.code ?? 'E_INTERNAL',
    stage: error?.stage ?? 'worker',
    sourceId: error?.sourceId ?? '',
    message: String(error?.message ?? error ?? 'Unknown worker error'),
    detail: String(error?.detail ?? error?.stack ?? error?.message ?? error ?? 'Unknown worker error'),
    context: error?.context ?? {},
  };
}

function transfersFor(payload) {
  const out = [];
  const nested = payload?.frame?.buffer;
  const direct = payload?.buffer;
  if (nested instanceof ArrayBuffer) out.push(nested);
  if (direct instanceof ArrayBuffer && direct !== nested) out.push(direct);
  return out;
}

export function createWorkerRuntime({ core, post }) {
  return async function handle(message) {
    const { id, type, payload = {} } = message ?? {};
    if (!id) return;
    try {
      let result;
      if (type === 'LOAD_FRAME') result = await core.loadFrame(payload);
      else if (type === 'PING') result = { pong: true };
      else throw Object.assign(new Error(`unsupported worker command ${type}`), { code: 'E_PROTOCOL', stage: 'worker' });
      post({ replyTo: id, ok: true, payload: result }, transfersFor(result));
    } catch (error) {
      post({ replyTo: id, ok: false, error: structured(error) });
    }
  };
}
