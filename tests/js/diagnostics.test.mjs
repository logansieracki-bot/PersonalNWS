import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics } from '../../src/diagnostics.js';

test('diagnostics records structured entries and exports a report', () => {
  let now = 1000;
  const log = createDiagnostics({ now: () => ++now, maxEntries: 3 });
  log.info('boot', 'BOOT_START', 'starting', { buildId: 'abc' });
  log.warn('map', 'MAP_SLOW', 'slow map');
  log.error('ui', 'UI_FAIL', 'bad click', { action: 'play' }, new Error('boom'));
  const report = log.report({ app: { release: 'Alpha' } });
  assert.equal(report.entries.length, 3);
  assert.equal(report.entries[2].code, 'UI_FAIL');
  assert.equal(report.entries[2].context.action, 'play');
  assert.equal(report.app.release, 'Alpha');
});

test('diagnostics caps old entries', () => {
  const log = createDiagnostics({ now: () => 1, maxEntries: 2 });
  log.info('a', 'A', 'a');
  log.info('b', 'B', 'b');
  log.info('c', 'C', 'c');
  assert.deepEqual(log.entries().map((e) => e.code), ['B', 'C']);
});
