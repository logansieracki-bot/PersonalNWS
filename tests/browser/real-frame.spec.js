import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const fixturePath = 'tests/fixtures/current-smoke-volume';
const metadataPath = 'tests/fixtures/current-smoke.json';

test('CURRENT radar proves prepared NWS imagery first, then Level II WASM and renderer', async ({ page }) => {
  await fs.access(fixturePath); // native Rust smoke uses the exact object first
  const meta = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  const { site, key } = meta;

  await page.route('https://tiles.openfreemap.org/styles/liberty', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        name: 'smoke',
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#050506' } }],
      }),
    }),
  );

  // Normal CI refreshes the bundled 150+ site catalog before Vite builds.
  // This route is only a fallback so the browser proof still has a real station
  // if the test is run directly against an unrefreshed local checkout.
  await page.route(/opengeo\.ncep\.noaa\.gov\/geoserver\/nws\/ows\?/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {
            rda_id: site,
            name: `Current smoke ${site}`,
            lat: 35.3331,
            lon: -97.2775,
            wfo_id: 'TST',
          },
          geometry: { type: 'Point', coordinates: [-97.2775, 35.3331] },
        }],
      }),
    }),
  );

  const keyPrefix = key.slice(0, key.lastIndexOf('/') + 1);
  await page.route(/unidata-nexrad-level2\.s3\.amazonaws\.com\/\?.*list-type=2/, async (route) => {
    const url = new URL(route.request().url());
    const prefix = url.searchParams.get('prefix');
    if (prefix !== keyPrefix) {
      return route.fulfill({ contentType: 'application/xml', body: '<ListBucketResult></ListBucketResult>' });
    }
    return route.fulfill({
      contentType: 'application/xml',
      body: `<ListBucketResult><Contents><Key>${key}</Key></Contents></ListBucketResult>`,
    });
  });

  // Deliberately do NOT mock the NWS WMS fast-radar tile or the Level II archive
  // object. Both public data paths must work cross-origin like the deployed site.
  await page.goto('/');
  await page.waitForFunction(() => window.__PERSONALNWS__?.ready === true);

  const stationLayer = `${site.toLowerCase()}_sr_bref`;
  const fastTileResponse = page.waitForResponse((response) => {
    const url = response.url();
    return url.includes(`opengeo.ncep.noaa.gov/geoserver/${site.toLowerCase()}/${stationLayer}/ows?`)
      && url.includes(`layers=${stationLayer}`)
      && response.status() === 200;
  }, { timeout: 20_000 });

  await page.evaluate((id) => window.__PERSONALNWS__.focusSiteById(id), site);
  const markerPoint = await page.evaluate((id) => window.__PERSONALNWS__.screenPointForSite(id), site);
  if (!markerPoint) throw new Error(`Could not project radar marker for ${site}`);
  await page.mouse.click(markerPoint.x, markerPoint.y);
  const fastResponse = await fastTileResponse;
  const fastContentType = fastResponse.headers()['content-type'] ?? '';
  if (!/image\/png/i.test(fastContentType)) {
    const exceptionBody = await fastResponse.text().catch(() => '<response body unavailable>');
    throw new Error([
      `Fast NWS WMS returned ${fastContentType || '<missing content-type>'} instead of image/png.`,
      `URL: ${fastResponse.url()}`,
      `OGC response: ${exceptionBody.slice(0, 4000)}`,
    ].join('\n'));
  }
  await page.waitForFunction(() => {
    const d = window.__PERSONALNWS__?.debug();
    return d?.radarVisible === true && d?.preparedLayerActive === true;
  }, null, { timeout: 15_000 });

  // Frame metadata is intentionally lightweight and may finish just after the
  // first WMS pixels. Wait for one descriptor, then explicitly prove the
  // advanced Level II path using the exact current S3 object from this run.
  await page.waitForFunction(() => window.__PERSONALNWS__?.debug()?.frameCount > 0, null, { timeout: 15_000 });
  await page.evaluate(() => window.__PERSONALNWS__.forceLevel2Latest());
  await page.waitForFunction(() => {
    const d = window.__PERSONALNWS__?.debug();
    return d?.level2SweepReady === true
      && d?.rendererHasSweep === true
      && d?.renderCount > 0
      && d?.glError === 0;
  }, null, { timeout: 90_000 });

  const debug = await page.evaluate(() => window.__PERSONALNWS__.debug());
  expect(debug.site).toBe(site);
  expect(debug.siteCount).toBeGreaterThanOrEqual(150);
  expect(debug.radialCount).toBeGreaterThan(100);
  expect(debug.gateCount).toBeGreaterThan(100);
  expect(debug.frameCount).toBeGreaterThan(0);
  expect(debug.renderCount).toBeGreaterThan(0);
  expect(debug.glError).toBe(0);
  expect(await page.locator('#detail').textContent()).toMatch(/frame|VCP|Level II|radials/i);
});
