import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createDiagnosticLogger,
  normalizeDiagnostic,
  formatDiagnosticTrail,
} from '../../src/diagnostics.js';

test('diagnostic logger records structured stage/code/context and bounds memory', () => {
  let now = 1000;
  const emitted = [];
  const logger = createDiagnosticLogger({
    capacity: 3,
    now: () => ++now,
    consoleImpl: { debug() {}, info() {}, warn() {}, error(...args) { emitted.push(args); } },
  });

  logger.info('boot', 'BOOT_START', 'starting');
  logger.info('catalog', 'CATALOG_OK', 'loaded catalog', { siteCount: 156 });
  logger.warn('fast-radar', 'FAST_TIMEOUT', 'fast source slow', { site: 'KDIX', elapsedMs: 3512 });
  logger.error('level2', 'E_RADAR_DECODE', 'decode failed', { site: 'KDIX', objectKey: 'x', productId: 1 });

  const entries = logger.entries();
  assert.equal(entries.length, 3, 'oldest entries are evicted');
  assert.equal(entries.at(-1).level, 'error');
  assert.equal(entries.at(-1).stage, 'level2');
  assert.equal(entries.at(-1).code, 'E_RADAR_DECODE');
  assert.equal(entries.at(-1).context.site, 'KDIX');
  assert.equal(entries.at(-1).context.productId, 1);
  assert.ok(entries.at(-1).id.startsWith('D'));
  assert.equal(emitted.length, 1);
});

test('normalizeDiagnostic preserves structured worker errors and adds context', () => {
  const normalized = normalizeDiagnostic({
    code: 'E_ARCHIVE_FETCH',
    stage: 'fetch',
    sourceId: 's3://frame',
    message: 'HTTP 503',
    detail: 'upstream unavailable',
  }, { site: 'KDOX', elapsedMs: 987 });

  assert.equal(normalized.code, 'E_ARCHIVE_FETCH');
  assert.equal(normalized.stage, 'fetch');
  assert.equal(normalized.sourceId, 's3://frame');
  assert.equal(normalized.context.site, 'KDOX');
  assert.equal(normalized.context.elapsedMs, 987);
});

test('diagnostic trail is compact but includes the stages needed to debug a failed load', () => {
  const logger = createDiagnosticLogger({ capacity: 20, now: () => 1234, consoleImpl: { debug() {}, info() {}, warn() {}, error() {} } });
  logger.info('selection', 'SITE_SELECT', 'selecting radar', { site: 'KDIX' });
  logger.info('fast-radar', 'FAST_START', 'loading fast radar', { site: 'KDIX' });
  logger.warn('fast-radar', 'FAST_FAILED', 'fast source failed', { site: 'KDIX', elapsedMs: 3500 });
  logger.error('listing', 'E_S3_LIST_TIMEOUT', 'S3 listing timed out', { site: 'KDIX', elapsedMs: 3500 });

  const text = formatDiagnosticTrail(logger.entries(), { limit: 10 });
  assert.match(text, /SITE_SELECT/);
  assert.match(text, /FAST_FAILED/);
  assert.match(text, /E_S3_LIST_TIMEOUT/);
  assert.match(text, /KDIX/);
  assert.match(text, /3500ms/);
});


test('fatal diagnostics provide a copyable report and identify the running build', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const source = fs.readFileSync('src/diagnostics.js', 'utf8');
  assert.match(html, /id="fatalCopy"/);
  assert.match(source, /fatalCopy/);
  assert.match(source, /clipboard/);
  assert.match(source, /buildId/);
});
