import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFastRadarTileUrl,
  fastRadarLayerName,
  supportsFastRadar,
} from '../../src/radar/fast-radar-source.js';

test('fast radar supports latest lowest-cut reflectivity and velocity only', () => {
  assert.equal(supportsFastRadar(1, null), true);
  assert.equal(supportsFastRadar(2, 0), true);
  assert.equal(supportsFastRadar(1, 1), false);
  assert.equal(supportsFastRadar(3, null), false);
});

test('fast radar product mapping uses NWS RIDGE2 layer names', () => {
  assert.equal(fastRadarLayerName(1), 'SR_BREF');
  assert.equal(fastRadarLayerName(2), 'SR_BVEL');
  assert.equal(fastRadarLayerName(6), null);
});

test('WMS tile URL is generic for arbitrary WSR-88D IDs and cache-busted', () => {
  const url = buildFastRadarTileUrl('KDIX', 1, 1234567890);
  assert.match(url, /^https:\/\/opengeo\.ncep\.noaa\.gov\/geoserver\/kdix\/kdix_sr_bref\/ows\?/);
  assert.match(url, /layers=kdix_sr_bref/);
  assert.match(url, /bbox=\{bbox-epsg-3857\}/);
  assert.match(url, /srs=EPSG%3A3857/);
  assert.match(url, /format=image%2Fpng/);
  assert.match(url, /transparent=true/);
  assert.match(url, /_pnws=1234567890/);

  const alaska = buildFastRadarTileUrl('PAHG', 2, 'live-2');
  assert.match(alaska, /\/geoserver\/pahg\/pahg_sr_bvel\/ows\?/);
  assert.match(alaska, /layers=pahg_sr_bvel/);
  assert.match(alaska, /_pnws=live-2/);
});

test('invalid station IDs and unsupported products are rejected', () => {
  assert.throws(() => buildFastRadarTileUrl('KDIX!!!', 1, 1), /invalid WSR-88D/i);
  assert.throws(() => buildFastRadarTileUrl('KDIX', 4, 1), /not available/i);
});
