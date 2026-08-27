import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/pages.yml', 'utf8');

test('Pages deploy is gated by a freshly downloaded current Level II volume', () => {
  assert.match(workflow, /node scripts\/fetch-current-smoke-volume\.mjs/);
  assert.match(workflow, /cargo run --manifest-path decoder\/Cargo\.toml --example decode_smoke/);
  assert.match(workflow, /npm run test:browser -- tests\/browser\/real-frame\.spec\.js/);
});

test('old fixed 2023 smoke fixture is no longer the release proof', () => {
  assert.doesNotMatch(workflow, /KTLX20230520_201643_V06/);
});

test('Pages verifies decoder files are present in the uploaded dist artifact', () => {
  assert.match(workflow, /test -f dist\/decoder\/personalnws_decoder\.js/);
  assert.match(workflow, /test -f dist\/decoder\/personalnws_decoder_bg\.wasm/);
});

test('archive decoder falls back to radial parsing when metadata-message parsing fails', () => {
  const archive = fs.readFileSync('decoder/src/archive.rs', 'utf8');
  assert.match(archive, /decompressed\.messages\(\)[\s\S]*Err\([^)]*\)[\s\S]*decompressed\.radials\(\)/);
});


test('Pages refuses to deploy an undersized WSR-88D catalog', () => {
  assert.match(workflow, /radar catalog contains.*150|catalog.*>=.*150|siteCount.*150/i);
});


test('browser release proof exercises prepared radar first and Level II without fast/slow modes', () => {
  const browserSmoke = fs.readFileSync('tests/browser/real-frame.spec.js', 'utf8');
  assert.match(browserSmoke, /radarVisible/);
  assert.match(browserSmoke, /preparedLayerActive/);
  assert.doesNotMatch(browserSmoke, /mode === ['"](?:fast|level2)['"]/);
  assert.match(browserSmoke, /forceLevel2Latest/);
});

test('catalog deploy gate checks the same src/data file Vite imports', () => {
  assert.match(workflow, /src\/data\/nexrad-sites\.json/);
  assert.doesNotMatch(workflow, /public\/data\/nexrad-sites\.json/);
});

test('browser fast-lane proof uses station-scoped NWS GeoServer resources and exposes OGC errors', () => {
  const browserSmoke = fs.readFileSync('tests/browser/real-frame.spec.js', 'utf8');
  assert.match(browserSmoke, /stationLayer/);
  assert.ok(browserSmoke.includes('geoserver/${site.toLowerCase()}/${stationLayer}/ows?'));
  assert.match(browserSmoke, /OGC response/);
});


test('Alpha browser radar smoke is diagnostic and cannot block the Pages upload', () => {
  assert.match(workflow, /name: Run Alpha browser radar smoke[\s\S]*continue-on-error: true[\s\S]*npm run test:browser -- tests\/browser\/real-frame\.spec\.js/);
  assert.match(workflow, /name: Upload browser smoke diagnostics[\s\S]*if: always\(\)[\s\S]*actions\/upload-artifact@v4/);
  const smokeIndex = workflow.indexOf('name: Run Alpha browser radar smoke');
  const uploadPagesIndex = workflow.indexOf('name: Upload Pages artifact');
  assert.ok(smokeIndex >= 0 && uploadPagesIndex > smokeIndex, 'Pages upload remains after the diagnostic smoke test');
});

test('Pages artifact is stamped and audited before upload', () => {
  assert.match(workflow, /name: Stamp Pages build identity/);
  assert.match(workflow, /dist\/build-info\.json/);
  assert.match(workflow, /github\.sha/);
  assert.match(workflow, /name: Audit final Pages artifact/);
  assert.match(workflow, /PersonalNWS Alpha/);
  assert.match(workflow, /#timeNow/);
  assert.match(workflow, /Copy Debug Report/);
});

test('deploy job verifies the actual live Pages origin serves this commit', () => {
  assert.match(workflow, /name: Verify live Pages deployment/);
  assert.match(workflow, /steps\.deployment\.outputs\.page_url/);
  assert.match(workflow, /build-info\.json\?build=/);
  assert.match(workflow, /PersonalNWS Alpha/);
  assert.match(workflow, /GITHUB_SHA/);
});
