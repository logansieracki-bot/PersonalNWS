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
  const urls = decoderAssetUrls('https://x.github.io/PersonalNWS/decoder/', '0.0.0-alpha', 'test-build');
  assert.equal(new URL(urls.jsUrl).searchParams.get('v'), '0.0.0-alpha-test-build');
  assert.equal(new URL(urls.wasmUrl).searchParams.get('v'), '0.0.0-alpha-test-build');
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

test('radar cache abandons a hung IndexedDB open quickly and continues in memory', async () => {
  const result = await Promise.race([
    openRadarCache({ openPersistent: () => new Promise(() => {}), timeoutMs: 5 }),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 30)),
  ]);
  assert.ok(result instanceof MemoryRadarCache, 'hung persistent cache must not block decoder startup');
});

test('memory sweep cache owns its buffer so worker transfer cannot detach the cached copy', async () => {
  const { MemoryRadarCache } = await import('../../src/radar/cache.js');
  const cache = new MemoryRadarCache();
  const original = new Uint8Array([80, 83, 87, 80]).buffer;
  await cache.putSweep('KDIX', 1000, 1, 1, original);
  structuredClone(original, { transfer: [original] });
  assert.equal(original.byteLength, 0, 'test must detach the worker-owned original');
  const cached = await cache.getSweep('KDIX', 1000, 1, 1);
  assert.equal(cached.byteLength, 4);
  assert.deepEqual([...new Uint8Array(cached)], [80, 83, 87, 80]);
  structuredClone(cached, { transfer: [cached] });
  const cachedAgain = await cache.getSweep('KDIX', 1000, 1, 1);
  assert.equal(cachedAgain.byteLength, 4, 'transferring a cache hit must not detach the stored memory-cache copy');
});
