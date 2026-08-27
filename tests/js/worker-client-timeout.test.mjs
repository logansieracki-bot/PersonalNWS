import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerClient } from '../../src/radar/worker-client.js';

class FakeWorker {
  constructor() { this.listeners = new Map(); this.posts = 0; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  postMessage() { this.posts += 1; }
}

test('worker requests time out instead of hanging forever', async () => {
  const client = new WorkerClient(new FakeWorker(), { timeoutMs: 15 });
  await assert.rejects(client.request('PING'), (error) => error?.code === 'E_WORKER_TIMEOUT' && error?.stage === 'worker');
});

test('worker timeout is emitted as a structured diagnostic event', async () => {
  const events = [];
  const diagnostics = { record(level, stage, code, message, context = {}) { events.push({ level, stage, code, message, context }); } };
  const client = new WorkerClient(new FakeWorker(), { timeoutMs: 5, diagnostics, role: 'priority' });
  await assert.rejects(client.request('PING'));
  const timeout = events.find((event) => event.code === 'E_WORKER_TIMEOUT');
  assert.ok(timeout);
  assert.equal(timeout.stage, 'worker');
  assert.equal(timeout.context.command, 'PING');
  assert.equal(timeout.context.role, 'priority');
});

test('worker crash rejects pending requests with structured E_WORKER so the decoder session can be reset', async () => {
  const worker = new FakeWorker();
  const client = new WorkerClient(worker, { timeoutMs: 5_000, role: 'priority' });
  const pending = client.request('PING');
  const crash = new Error('worker exploded');
  worker.listeners.get('error')?.({ error: crash, message: crash.message });
  await assert.rejects(pending, (error) => error?.code === 'E_WORKER' && error?.stage === 'worker' && /worker exploded/.test(error?.message ?? ''));
});


test('worker crash while idle is remembered so the next request fails immediately instead of waiting for timeout', async () => {
  const worker = new FakeWorker();
  const client = new WorkerClient(worker, { timeoutMs: 5_000, role: 'priority' });
  const crash = new Error('idle worker exploded');
  worker.listeners.get('error')?.({ error: crash, message: crash.message });

  await assert.rejects(
    client.request('PING'),
    (error) => error?.code === 'E_WORKER' && error?.stage === 'worker' && /idle worker exploded/.test(error?.message ?? ''),
  );
  assert.equal(worker.posts, 0, 'dead worker must not receive new requests');
});
