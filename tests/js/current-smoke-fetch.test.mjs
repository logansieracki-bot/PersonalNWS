import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVolumeKeys, volumePrefix, newestVolumeKey } from '../../scripts/current-smoke-lib.mjs';

test('current smoke parser ignores MDM and keeps completed NEXRAD volumes', () => {
  const xml = '<ListBucketResult>' +
    '<Contents><Key>2026/08/23/KDOX/MDM</Key></Contents>' +
    '<Contents><Key>2026/08/23/KDOX/KDOX20260823_220102_V06</Key></Contents>' +
    '<Contents><Key>2026/08/23/KDOX/KDOX20260823_220602_V06</Key></Contents>' +
    '</ListBucketResult>';
  assert.deepEqual(parseVolumeKeys(xml), [
    '2026/08/23/KDOX/KDOX20260823_220102_V06',
    '2026/08/23/KDOX/KDOX20260823_220602_V06',
  ]);
  assert.equal(newestVolumeKey(parseVolumeKeys(xml)), '2026/08/23/KDOX/KDOX20260823_220602_V06');
});

test('current smoke prefix is UTC date/site based', () => {
  assert.equal(volumePrefix('KTLX', new Date('2026-08-23T23:59:59Z')), '2026/08/23/KTLX/');
});

test('current smoke search rejects stale volumes outside the live app window', async () => {
  const now = new Date('2026-08-24T02:40:00Z');
  const staleXml = '<ListBucketResult>' +
    '<Contents><Key>2026/08/24/KDOX/KDOX20260824_000000_V06</Key></Contents>' +
    '</ListBucketResult>';
  const freshXml = '<ListBucketResult>' +
    '<Contents><Key>2026/08/24/KTLX/KTLX20260824_020500_V06</Key></Contents>' +
    '</ListBucketResult>';
  const fetchImpl = async (url) => ({
    ok: true,
    async text() {
      const prefix = new URL(url).searchParams.get('prefix');
      if (prefix === '2026/08/24/KTLX/') return freshXml;
      if (prefix === '2026/08/24/KDOX/') return staleXml;
      return '<ListBucketResult></ListBucketResult>';
    },
  });

  const { findCurrentVolume } = await import('../../scripts/current-smoke-lib.mjs');
  const found = await findCurrentVolume({
    sites: ['KDOX', 'KTLX'],
    now,
    lookbackDays: 1,
    maxAgeMs: 2 * 60 * 60 * 1000,
    fetchImpl,
  });
  assert.equal(found.site, 'KTLX');
  assert.equal(found.key, '2026/08/24/KTLX/KTLX20260824_020500_V06');
});

test('current smoke search skips a hung station listing within a bounded timeout', async () => {
  const now = new Date('2026-08-24T02:40:00Z');
  const freshXml = '<ListBucketResult><Contents><Key>2026/08/24/KTLX/KTLX20260824_020500_V06</Key></Contents></ListBucketResult>';
  const fetchImpl = async (url) => {
    const prefix = new URL(url).searchParams.get('prefix');
    if (prefix === '2026/08/24/KDIX/') return new Promise(() => {});
    return { ok: true, text: async () => freshXml };
  };
  const { findCurrentVolume } = await import('../../scripts/current-smoke-lib.mjs');
  const started = Date.now();
  const found = await findCurrentVolume({
    sites: ['KDIX', 'KTLX'], now, lookbackDays: 0, fetchImpl, requestTimeoutMs: 10,
  });
  assert.equal(found.site, 'KTLX');
  assert.ok(Date.now() - started < 250, 'a hung smoke station must not stall the Actions job');
});

test('current smoke volume download uses the bounded retrying archive downloader', () => {
  const source = fs.readFileSync('scripts/fetch-current-smoke-volume.mjs', 'utf8');
  assert.match(source, /fetchArrayBufferWithRetry/);
  assert.doesNotMatch(source, /await fetch\(found\.url/);
});
