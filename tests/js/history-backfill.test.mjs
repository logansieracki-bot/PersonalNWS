import test from 'node:test';
import assert from 'node:assert/strict';

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test('history backfill cancellation stops obsolete station work after the current frame', async () => {
  const { HistoryBackfill } = await import('../../src/radar/history-backfill.js');
  const gate = deferred();
  const loads = [];
  const runner = new HistoryBackfill({
    pipeline: { async load(payload) { loads.push(payload); if (loads.length === 1) await gate.promise; } },
    post() {},
    delay: async () => {},
  });
  const run = runner.run({ site: 'KDOX', productId: 1, elevationNumber: 1, frames: [
    { objectKey: 'a', scanStartMs: 1 }, { objectKey: 'b', scanStartMs: 2 }, { objectKey: 'c', scanStartMs: 3 },
  ] });
  await Promise.resolve();
  runner.cancel();
  gate.resolve();
  const result = await run;
  assert.equal(result.cancelled, true);
  assert.equal(loads.length, 1, 'obsolete history must not continue downloading old station frames');
});

test('history backfill reports a bad frame but continues to cache later frames', async () => {
  const { HistoryBackfill } = await import('../../src/radar/history-backfill.js');
  const loads = [];
  const events = [];
  const runner = new HistoryBackfill({
    pipeline: { async load(payload) { loads.push(payload.scanStartMs); if (payload.scanStartMs === 2) throw Object.assign(new Error('bad volume'), { code: 'E_NO_RADIALS', stage: 'archive' }); } },
    post(message) { events.push(message); },
    delay: async () => {},
  });
  const result = await runner.run({ site: 'KDIX', productId: 1, frames: [
    { objectKey: 'a', scanStartMs: 1 }, { objectKey: 'b', scanStartMs: 2 }, { objectKey: 'c', scanStartMs: 3 },
  ] });
  assert.equal(result.cancelled, false);
  assert.equal(result.done, 3);
  assert.deepEqual(loads, [3, 2, 1]);
  assert.ok(events.some((event) => event.type === 'DIAGNOSTIC' && event.payload.code === 'E_NO_RADIALS'));
});
