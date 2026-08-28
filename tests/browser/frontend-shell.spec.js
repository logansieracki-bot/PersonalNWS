import { test, expect } from '@playwright/test';

test('Stage 1 serves the preserved PersonalNWS shell with a working map and no radar engine', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/styles/liberty', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 8, sources: {}, layers: [{ id:'background', type:'background', paint:{ 'background-color':'#050506' } }] }),
    });
  });
  await page.goto('/');
  await expect(page).toHaveTitle('PersonalNWS Alpha');
  await expect(page.locator('#controls')).toBeVisible();
  await expect(page.locator('#timelineWrap')).toBeVisible();
  await expect(page.locator('#timeNow')).toHaveCSS('font-size', '17px');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await page.waitForFunction(() => window.PersonalNWS?.debug?.().ready === true);
  const state = await page.evaluate(() => window.PersonalNWS.debug());
  expect(state.radar.attached).toBe(false);
  expect(state.mapReady).toBe(true);
});
