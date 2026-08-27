import test from 'node:test'; import assert from 'node:assert/strict';
import { normalizeStation, isActiveStation, parseStationDateMs } from '../../src/radar/site-catalog.js';
import { archivePrefix, parseS3List } from '../../src/radar/nexrad-source.js';
for (const id of ['KDOX','KTLX','PAHG','PHKI','TJUA','PGUA']) test(`normalizes ${id}`,()=>{ const s=normalizeStation({STATION_ID:id,STATION_NAME:id,LATITUDE:39,LONGITUDE:-76,BEGIN_DATE:0,END_DATE:null}); assert.equal(s.id,id); });
test('normalizes NOAA namespaced NEXRAD station ids',()=>{ const s=normalizeStation({STATION_ID:'NEXRAD:KGGW',STATION_NAME:'Glasgow',LATITUDE:48.2,LONGITUDE:-106.6,BEGIN_DATE:19950101,END_DATE:99991231}); assert.equal(s.id,'KGGW'); });
test('archive prefix is generic',()=>assert.equal(archivePrefix('KDOX',new Date('2026-08-23T00:00:00Z')),'2026/08/23/KDOX/'));
test('S3 list parser keeps volume keys',()=>{const xml='<ListBucketResult><Contents><Key>2026/08/23/KDOX/KDOX20260823_010203_V06</Key></Contents><Contents><Key>2026/08/23/KDOX/MDM</Key></Contents></ListBucketResult>'; assert.deepEqual(parseS3List(xml).map(x=>x.key),['2026/08/23/KDOX/KDOX20260823_010203_V06']);});


test('parses NCEI compact YYYYMMDD dates instead of treating them as epoch milliseconds',()=>{
  assert.equal(parseStationDateMs(99991231), Date.UTC(9999,11,31,23,59,59,999));
  assert.equal(parseStationDateMs('20260823'), Date.UTC(2026,7,23,23,59,59,999));
});

test('keeps a compact-date station active through its END_DATE day',()=>{
  const station=normalizeStation({STATION_ID:'KDOX',STATION_NAME:'Dover',LATITUDE:38.8,LONGITUDE:-75.4,BEGIN_DATE:19920617,END_DATE:99991231});
  assert.equal(isActiveStation(station, Date.UTC(2026,7,23,12)), true);
});

test('marks a compact-date station inactive after a real historical END_DATE',()=>{
  const station=normalizeStation({STATION_ID:'ZZZZ',STATION_NAME:'Old',LATITUDE:35,LONGITUDE:-97,BEGIN_DATE:19900101,END_DATE:20200115});
  assert.equal(isActiveStation(station, Date.UTC(2026,7,23)), false);
});

test('S3 volume entries expose scanStartMs for timeline/frame requests',()=>{
  const xml='<ListBucketResult><Contents><Key>2026/08/23/KDOX/KDOX20260823_220102_V06</Key></Contents></ListBucketResult>';
  const [entry]=parseS3List(xml);
  assert.equal(entry.scanStartMs,Date.parse('2026-08-23T22:01:02Z'));
});

test('completed-volume listing follows S3 continuation tokens and uses no-store', async () => {
  const { listCompletedVolumes } = await import('../../src/radar/nexrad-source.js');
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    calls.push({ token: u.searchParams.get('continuation-token'), cache: options.cache });
    if (!u.searchParams.get('continuation-token')) {
      return { ok: true, text: async () => '<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>abc%2B123</NextContinuationToken><Contents><Key>2026/08/26/KDOX/KDOX20260826_200000_V06</Key></Contents></ListBucketResult>' };
    }
    return { ok: true, text: async () => '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>2026/08/26/KDOX/KDOX20260826_201000_V06</Key></Contents></ListBucketResult>' };
  };
  const frames = await listCompletedVolumes('KDOX', Date.parse('2026-08-26T19:59:00Z'), Date.parse('2026-08-26T20:11:00Z'), { fetchImpl });
  assert.equal(frames.length, 2);
  assert.deepEqual(calls, [{ token: null, cache: 'no-store' }, { token: 'abc%2B123', cache: 'no-store' }]);
});

test('completed-volume listing keeps successful days when another day listing fails', async () => {
  const { listCompletedVolumes } = await import('../../src/radar/nexrad-source.js');
  const fetchImpl = async (url) => {
    const prefix = new URL(url).searchParams.get('prefix');
    if (prefix.includes('/25/')) return { ok: false, status: 503, text: async () => '' };
    return { ok: true, text: async () => '<ListBucketResult><Contents><Key>2026/08/26/KDOX/KDOX20260826_000500_V06</Key></Contents></ListBucketResult>' };
  };
  const frames = await listCompletedVolumes('KDOX', Date.parse('2026-08-25T23:55:00Z'), Date.parse('2026-08-26T00:10:00Z'), { fetchImpl });
  assert.equal(frames.length, 1);
  assert.match(frames[0].key, /KDOX20260826_000500/);
});

test('bundled radar catalog is returned immediately without waiting on NOAA ArcGIS', async () => {
  const { loadRadarSites } = await import('../../src/radar/site-catalog.js');
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) {
      return { json: async () => [{ id: 'KDOX', name: 'Dover', lat: 38.825, lon: -75.44, endDate: null }] };
    }
    return new Promise(() => {});
  };
  const timed = Promise.race([
    loadRadarSites({ fetchImpl, fallbackUrl: 'local-catalog.json', minBundledSites: 1 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('catalog startup blocked on remote NOAA')), 25)),
  ]);
  const sites = await timed;
  assert.equal(sites[0].id, 'KDOX');
  assert.equal(calls, 1);
});

test('completed-volume listing times out and aborts instead of hanging the visible radar path', async () => {
  const { listCompletedVolumes } = await import('../../src/radar/nexrad-source.js');
  let signal;
  const fetchImpl = (_url, options = {}) => {
    signal = options.signal;
    return new Promise(() => {});
  };
  await assert.rejects(
    listCompletedVolumes('KDOX', Date.parse('2026-08-26T20:00:00Z'), Date.parse('2026-08-26T20:10:00Z'), { fetchImpl, timeoutMs: 10 }),
    (error) => error?.code === 'E_S3_LIST_TIMEOUT' && error?.stage === 'listing',
  );
  assert.equal(signal?.aborted, true);
});

test('official WSR-88D service catalog contains the full current network, not a six-site subset', async () => {
  const { WSR88D_IDS } = await import('../../src/radar/wsr88d-ids.js');
  assert.ok(WSR88D_IDS.length >= 150, `expected >=150 current WSR-88D IDs, got ${WSR88D_IDS.length}`);
  assert.equal(new Set(WSR88D_IDS).size, WSR88D_IDS.length);
  for (const id of ['KDIX', 'KDOX', 'KTLX', 'PAHG', 'PHKI', 'PGUA', 'TJUA']) assert.ok(WSR88D_IDS.includes(id), id);
});

test('NWS radar-sites WFS response is filtered to current WSR-88D services', async () => {
  const { stationsFromNwsWfsResponse } = await import('../../src/radar/site-catalog.js');
  const payload = {
    features: [
      { properties: { rda_id: 'KDIX', name: 'Philadelphia', lat: 39.947, lon: -74.411 } },
      { properties: { rda_id: 'PAHG', name: 'Kenai', lat: 60.7259, lon: -151.3515 } },
      { properties: { rda_id: 'TADW', name: 'Andrews TDWR', lat: 38.695, lon: -76.845 } },
      { properties: { rda_id: 'LPLA', name: 'Lajes', lat: 38.73, lon: -27.32 } },
    ],
  };
  const sites = stationsFromNwsWfsResponse(payload);
  assert.deepEqual(sites.map((s) => s.id), ['KDIX', 'PAHG']);
  assert.equal(sites[0].name, 'Philadelphia');
});

test('undersized bundled catalog falls through to NWS WFS instead of shipping only a few radars', async () => {
  const { loadRadarSites } = await import('../../src/radar/site-catalog.js');
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return { ok: true, json: async () => [{ id: 'KDIX', name: 'Only one', lat: 39.9, lon: -74.4 }] };
    return {
      ok: true,
      json: async () => ({ features: [
        { properties: { rda_id: 'KDIX', name: 'Philadelphia', lat: 39.947, lon: -74.411 } },
        { properties: { rda_id: 'KDOX', name: 'Dover', lat: 38.825, lon: -75.44 } },
      ] }),
    };
  };
  const sites = await loadRadarSites({ fetchImpl, fallbackUrl: 'tiny.json', minBundledSites: 2 });
  assert.deepEqual(sites.map((s) => s.id), ['KDIX', 'KDOX']);
  assert.equal(calls, 2);
});
