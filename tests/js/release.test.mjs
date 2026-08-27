import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('current-frame timestamp is visibly stronger without moving the timeline', () => {
  const css = fs.readFileSync('src/ui/styles.css', 'utf8');
  assert.match(css, /#timeNow\{[^}]*font-size:17px[^}]*font-weight:850/);
});

test('production radar catalog has no deprecated NOAA ArcGIS implementation beside the NWS WFS path', () => {
  const source = fs.readFileSync('src/radar/site-catalog.js', 'utf8');
  assert.doesNotMatch(source, /NOAA_NEXRAD_QUERY|stationsFromArcGisResponse|gis\.ncdc\.noaa\.gov\/arcgis/);
});

test('radar engine routes runtime failures through structured diagnostics instead of direct console warnings', () => {
  const source = fs.readFileSync('src/radar/radar-engine-v2.js', 'utf8');
  assert.doesNotMatch(source, /console\.warn\(/);
});

test('catalog refresh script has a bounded NWS network deadline', () => {
  const source = fs.readFileSync('scripts/refresh-radar-catalog.mjs', 'utf8');
  assert.match(source, /AbortSignal\.timeout\(/);
});
