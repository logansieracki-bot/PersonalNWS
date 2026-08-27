export const COMMANDS = Object.freeze({
  INIT: 'INIT',
  LOAD_FRAME: 'LOAD_FRAME',
  START_HISTORY: 'START_HISTORY',
  CANCEL_HISTORY: 'CANCEL_HISTORY',
  PING: 'PING',
});

export const EVENTS = Object.freeze({
  CACHE_PROGRESS: 'CACHE_PROGRESS',
  DIAGNOSTIC: 'DIAGNOSTIC',
  METRICS: 'METRICS',
});

export function validateCommand(msg) {
  if (!msg || typeof msg.type !== 'string') throw new Error('worker command missing type');
  if (!Object.values(COMMANDS).includes(msg.type)) throw new Error(`unknown worker command ${msg.type}`);
  if (msg.type === COMMANDS.LOAD_FRAME) {
    const p = msg.payload ?? {};
    for (const k of ['site', 'objectKey', 'scanStartMs', 'productId']) {
      if (p[k] === undefined || p[k] === null || p[k] === '') throw new Error(`LOAD_FRAME missing ${k}`);
    }
  }
  if (msg.type === COMMANDS.START_HISTORY) {
    const p = msg.payload ?? {};
    if (!p.site) throw new Error('START_HISTORY missing site');
    if (!Array.isArray(p.frames)) throw new Error('START_HISTORY missing frames');
  }
  return msg;
}
