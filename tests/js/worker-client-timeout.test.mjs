import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerClient } from '../../src/radar/worker-client.js';

class FakeWorker {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  postMessage() {}
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
