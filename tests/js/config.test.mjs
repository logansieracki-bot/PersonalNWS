import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_RELEASE_LABEL, APP_VERSION, PRODUCTS } from '../../src/config.js';

test('Alpha release branding is frozen', () => {
  assert.equal(APP_VERSION, '0.0.0-alpha');
  assert.equal(APP_RELEASE_LABEL, 'Alpha');
});

test('native product IDs are stable', () => {
  assert.deepEqual(PRODUCTS, {
    REF: 1, VEL: 2, SW: 3, ZDR: 4, RHO: 5, PHI: 6,
  });
});

test('decoder/cache generation is bumped for repaired engine behavior', async () => {
  const { ENGINE_API_VERSION } = await import('../../src/config.js');
  assert.equal(ENGINE_API_VERSION, 4);
});
