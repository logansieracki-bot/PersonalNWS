import test from 'node:test';
import assert from 'node:assert/strict';
import { createSingleFlight } from '../../src/ui/single-flight.js';

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('single-flight refuses an overlapping async action and reopens after completion', async () => {
  const gate = createSingleFlight();
  const first = deferred();
  let calls = 0;

  const run1 = gate.run(async () => { calls += 1; await first.promise; return 'done'; });
  const run2 = gate.run(async () => { calls += 1; return 'overlap'; });

  assert.equal(await run2, null);
  assert.equal(calls, 1);
  assert.equal(gate.busy, true);

  first.resolve();
  assert.equal(await run1, 'done');
  assert.equal(gate.busy, false);

  assert.equal(await gate.run(async () => { calls += 1; return 'next'; }), 'next');
  assert.equal(calls, 2);
});
