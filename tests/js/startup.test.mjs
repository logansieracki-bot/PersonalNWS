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

test('map readiness rejects with a structured timeout instead of hanging forever', async () => {
  const { waitForMapReady } = await import('../../src/radar/startup.js');
  const listeners = new Map();
  const map = {
    loaded: () => false,
    once(type, fn) { listeners.set(type, fn); },
    off(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
  };
  let timerFn = null;
  const promise = waitForMapReady(map, {
    timeoutMs: 2500,
    setTimeoutImpl(fn, delay) { assert.equal(delay, 2500); timerFn = fn; return 91; },
    clearTimeoutImpl() {},
  });
  assert.equal(typeof timerFn, 'function');
  timerFn();
  await assert.rejects(promise, (error) => error?.code === 'E_MAP_LOAD_TIMEOUT' && error?.stage === 'map');
});

test('map readiness resolves on load and cancels its timeout', async () => {
  const { waitForMapReady } = await import('../../src/radar/startup.js');
  const listeners = new Map();
  let cleared = null;
  const map = {
    loaded: () => false,
    once(type, fn) { listeners.set(type, fn); },
    off(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
  };
  const promise = waitForMapReady(map, {
    timeoutMs: 2500,
    setTimeoutImpl() { return 92; },
    clearTimeoutImpl(id) { cleared = id; },
  });
  listeners.get('load')();
  await promise;
  assert.equal(cleared, 92);
});
