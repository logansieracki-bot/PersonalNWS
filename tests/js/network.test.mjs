import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchArrayBufferWithRetry } from '../../src/radar/network.js';

test('archive fetch retries a transient HTTP failure', async () => {
  let attempts = 0;
  const bytes = new Uint8Array([1,2,3]).buffer;
  const fetchImpl = async () => {
    attempts++;
    if (attempts === 1) return { ok: false, status: 503 };
    return { ok: true, arrayBuffer: async () => bytes };
  };
  const result = await fetchArrayBufferWithRetry('https://example.test/radar', { fetchImpl, retries: 1, timeoutMs: 100 });
  assert.equal(attempts, 2);
  assert.equal(result.byteLength, 3);
});

test('archive fetch times out instead of hanging forever', async () => {
  const fetchImpl = () => new Promise(() => {});
  await assert.rejects(
    fetchArrayBufferWithRetry('https://example.test/radar', { fetchImpl, retries: 0, timeoutMs: 10 }),
    (error) => error?.code === 'E_ARCHIVE_TIMEOUT' && error?.stage === 'fetch',
  );
});

test('timed out archive fetch is actively aborted so a fallback scan is not bandwidth-starved', async () => {
  let signal;
  const fetchImpl = (_url, options = {}) => {
    signal = options.signal;
    return new Promise(() => {});
  };
  await assert.rejects(
    fetchArrayBufferWithRetry('https://example.test/radar', { fetchImpl, retries: 0, timeoutMs: 10 }),
    (error) => error?.code === 'E_ARCHIVE_TIMEOUT',
  );
  assert.ok(signal, 'fetch should receive an AbortSignal');
  assert.equal(signal.aborted, true);
});
