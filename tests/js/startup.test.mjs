import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeRadarWorkers } from '../../src/radar/startup.js';

function client(result) { return { request: async () => result }; }

test('app startup waits for priority decoder but not history decoder', async () => {
  let resolveHistory;
  const history = { request: () => new Promise((resolve) => { resolveHistory = resolve; }) };
  const startup = await initializeRadarWorkers({ priority: client({ decoder: 'ready' }), history, decoderBase: '/decoder/' });
  assert.equal(startup.priorityReady.decoder, 'ready');
  assert.equal(startup.historyReady, false);
  resolveHistory({ decoder: 'ready' });
  await startup.historyInit;
});

test('history decoder failure cannot fail priority startup', async () => {
  const historyError = Object.assign(new Error('history wasm failed'), { code: 'E_WASM' });
  const startup = await initializeRadarWorkers({
    priority: client({ decoder: 'ready' }),
    history: { request: async () => { throw historyError; } },
    decoderBase: '/decoder/',
  });
  assert.equal(startup.priorityReady.decoder, 'ready');
  assert.equal(await startup.historyInit, null);
  assert.equal(startup.historyState.error, historyError);
});
