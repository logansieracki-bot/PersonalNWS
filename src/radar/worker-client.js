import { validateCommand, EVENTS } from './worker-protocol.js';

export class WorkerClient {
  constructor(worker, { timeoutMs = 45_000, diagnostics = null, role = 'worker', now = () => Date.now() } = {}) {
    this.worker = worker;
    this.timeoutMs = timeoutMs;
    this.diagnostics = diagnostics;
    this.role = role;
    this.now = now;
    this.pending = new Map();
    this.listeners = new Map();
    worker.addEventListener('message', (e) => this.#on(e.data));
    worker.addEventListener('error', (e) => this.#failAll(e.error ?? new Error(e.message || 'worker error')));
    worker.addEventListener?.('messageerror', (e) => this.#failAll(new Error(e?.message || 'worker message error')));
  }

  #log(level, stage, code, message, context = {}, error = null) {
    try { this.diagnostics?.record?.(level, stage, code, message, context, error); } catch {}
  }

  on(type, fn) {
    const a = this.listeners.get(type) ?? [];
    a.push(fn);
    this.listeners.set(type, a);
    return () => this.listeners.set(type, (this.listeners.get(type) ?? []).filter((x) => x !== fn));
  }

  request(type, payload = {}, transfer = []) {
    const msg = validateCommand({ id: crypto.randomUUID(), type, payload });
    const started = this.now();
    this.#log('debug', 'worker', 'WORKER_REQUEST', `${this.role} worker ${type}`, { role: this.role, command: type, requestId: msg.id });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(msg.id)) return;
        const error = Object.assign(new Error(`${type} timed out after ${this.timeoutMs} ms`), {
          code: 'E_WORKER_TIMEOUT', stage: 'worker', sourceId: type,
          context: { role: this.role, command: type, requestId: msg.id, elapsedMs: this.now() - started },
        });
        this.#log('error', 'worker', 'E_WORKER_TIMEOUT', error.message, error.context, error);
        reject(error);
      }, this.timeoutMs);
      this.pending.set(msg.id, { resolve, reject, timer, type, started });
      try {
        this.worker.postMessage(msg, transfer);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(msg.id);
        this.#log('error', 'worker', error?.code ?? 'E_WORKER_POST', `Failed to post ${type} to ${this.role} worker`, { role: this.role, command: type, requestId: msg.id, elapsedMs: this.now() - started }, error);
        reject(error);
      }
    });
  }

  post(type, payload = {}, transfer = []) {
    const msg = validateCommand({ type, payload });
    this.worker.postMessage(msg, transfer);
  }

  #on(msg) {
    if (msg?.replyTo && this.pending.has(msg.replyTo)) {
      const p = this.pending.get(msg.replyTo);
      this.pending.delete(msg.replyTo);
      clearTimeout(p.timer);
      const context = { role: this.role, command: p.type, requestId: msg.replyTo, elapsedMs: this.now() - p.started };
      if (msg.ok === false) {
        const error = msg.error ?? { code: 'E_WORKER_REPLY', stage: 'worker', message: `${p.type} failed` };
        this.#log('error', error?.stage ?? 'worker', error?.code ?? 'E_WORKER_REPLY', error?.message ?? `${p.type} failed`, { ...context, sourceId: error?.sourceId ?? '' }, error);
        p.reject(error);
      } else {
        this.#log('debug', 'worker', 'WORKER_REPLY', `${this.role} worker ${p.type} completed`, context);
        p.resolve(msg.payload);
      }
      return;
    }
    for (const fn of this.listeners.get(msg?.type) ?? []) fn(msg.payload, msg);
  }

  #failAll(err) {
    this.#log('error', 'worker', err?.code ?? 'E_WORKER', `${this.role} worker crashed`, { role: this.role, pendingCount: this.pending.size }, err);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    for (const fn of this.listeners.get(EVENTS.DIAGNOSTIC) ?? []) {
      fn({ code: 'E_WORKER', stage: 'worker', message: String(err?.message || err), detail: String(err?.stack || err), context: { role: this.role } });
    }
  }
}
