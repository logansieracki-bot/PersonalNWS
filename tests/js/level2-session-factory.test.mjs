import test from 'node:test';
import assert from 'node:assert/strict';
import { createLazyLevel2SessionFactory } from '../../src/radar/level2-session-factory.js';

class FakeWorker {
  static instances = [];
  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    this.terminated = false;
    FakeWorker.instances.push(this);
  }
  terminate() { this.terminated = true; }
}

class FakeClient {
  constructor(worker, options) { this.worker = worker; this.options = options; this.handlers = new Map(); }
  on(type, handler) { this.handlers.set(type, handler); return () => this.handlers.delete(type); }
  request() { return Promise.resolve({ ok: true }); }
}

function diagnostics() {
  return { entries: [], record(...args) { this.entries.push(args); }, warn(...args) { this.entries.push(['warn', ...args]); }, error(...args) { this.entries.push(['error', ...args]); } };
}

test('disposing a Level II session invalidates the cached factory session so retry gets fresh workers', async () => {
  FakeWorker.instances = [];
  const log = diagnostics();
  const factory = createLazyLevel2SessionFactory({
    decoderBase: new URL('https://example.test/decoder/'),
    ui: { cacheProgress() {} },
    diagnostics: log,
    WorkerImpl: FakeWorker,
    WorkerClientImpl: FakeClient,
    initializeWorkers: async () => {},
  });

  const first = await factory();
  const again = await factory();
  assert.equal(again, first, 'healthy session is reused');
  assert.equal(FakeWorker.instances.length, 1);

  first.dispose();
  assert.equal(FakeWorker.instances[0].terminated, true);

  const second = await factory();
  assert.notEqual(second, first, 'disposed session must never be returned again');
  assert.equal(FakeWorker.instances.length, 2, 'retry creates a fresh priority worker');
  assert.equal(FakeWorker.instances[1].terminated, false);
});

test('failed priority initialization terminates the worker and allows a clean retry', async () => {
  FakeWorker.instances = [];
  let attempts = 0;
  const factory = createLazyLevel2SessionFactory({
    decoderBase: new URL('https://example.test/decoder/'),
    ui: { cacheProgress() {} },
    diagnostics: diagnostics(),
    WorkerImpl: FakeWorker,
    WorkerClientImpl: FakeClient,
    initializeWorkers: async () => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('bad wasm init'), { code: 'E_WASM_INIT', stage: 'wasm' });
    },
  });

  await assert.rejects(factory(), /bad wasm init/);
  assert.equal(FakeWorker.instances[0].terminated, true, 'failed worker is not leaked');

  const recovered = await factory();
  assert.ok(recovered);
  assert.equal(attempts, 2);
  assert.equal(FakeWorker.instances.length, 2);
});

test('history worker timeout is discarded so the next backfill gets a fresh history worker', async () => {
  FakeWorker.instances = [];
  let historyFailures = 0;
  class HistoryTimeoutClient extends FakeClient {
    request(type) {
      if (this.worker.options?.name === 'personalnws-history' && type === 'START_HISTORY' && historyFailures === 0) {
        historyFailures += 1;
        return Promise.reject(Object.assign(new Error('history timed out'), { code: 'E_WORKER_TIMEOUT', stage: 'worker' }));
      }
      return Promise.resolve({ ok: true });
    }
  }

  const factory = createLazyLevel2SessionFactory({
    decoderBase: new URL('https://example.test/decoder/'),
    ui: { cacheProgress() {} },
    diagnostics: diagnostics(),
    WorkerImpl: FakeWorker,
    WorkerClientImpl: HistoryTimeoutClient,
    initializeWorkers: async () => {},
  });
  const session = await factory();
  const payload = { site: 'KDIX', frames: [{ scanStartMs: 1, objectKey: 'one' }], productId: 1, elevationNumber: 1 };

  await session.startHistory(payload);
  const firstHistory = FakeWorker.instances.find((worker) => worker.options?.name === 'personalnws-history');
  assert.ok(firstHistory);
  assert.equal(firstHistory.terminated, true, 'timed-out history worker must be terminated');

  await session.startHistory(payload);
  const historyWorkers = FakeWorker.instances.filter((worker) => worker.options?.name === 'personalnws-history');
  assert.equal(historyWorkers.length, 2, 'next backfill must create a fresh history worker');
  assert.equal(historyWorkers[1].terminated, false);
});
