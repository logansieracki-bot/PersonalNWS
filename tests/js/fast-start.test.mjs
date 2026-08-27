import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeRadarWorkers } from '../../src/radar/startup.js';
import { decoderAssetUrls } from '../../src/radar/wasm-loader.js';
import { openRadarCache, MemoryRadarCache } from '../../src/radar/cache.js';

test('priority decoder initializes before history decoder is started', async () => {
  const order = [];
  const priority = { request: async () => { order.push('priority'); return { decoder: 'ready' }; } };
  const history = { request: async () => { order.push('history'); return { decoder: 'ready' }; } };
  const startup = await initializeRadarWorkers({ priority, history, decoderBase: '/decoder/' });
  await startup.historyInit;
  assert.deepEqual(order, ['priority', 'history']);
});

test('decoder assets are versioned so Pages cannot reuse stale JS/WASM', () => {
  const urls = decoderAssetUrls('https://x.github.io/PersonalNWS/decoder/', '0.0.0-alpha');
  assert.equal(new URL(urls.jsUrl).searchParams.get('v'), '0.0.0-alpha');
  assert.equal(new URL(urls.wasmUrl).searchParams.get('v'), '0.0.0-alpha');
});

test('radar cache falls back to memory when IndexedDB cannot open', async () => {
  const cache = await openRadarCache({ openPersistent: async () => { throw new Error('IndexedDB blocked'); } });
  assert.ok(cache instanceof MemoryRadarCache);
  await cache.putScan('KTLX', 123, { elevations: [{ number: 1 }] });
  assert.deepEqual(await cache.getScan('KTLX', 123), { elevations: [{ number: 1 }] });
  const sweep = new Uint8Array([1, 2, 3]).buffer;
  await cache.putSweep('KTLX', 123, 1, 1, sweep);
  assert.equal((await cache.getSweep('KTLX', 123, 1, 1)).byteLength, 3);
});
