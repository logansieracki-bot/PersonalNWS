import test from 'node:test';
import assert from 'node:assert/strict';
import { decorateFrameTime } from '../../src/ui/ui-adapter.js';

test('current frame time is clearly marked live without changing the clock text itself', () => {
  assert.equal(decorateFrameTime('10:42 PM', { live: true }), 'LIVE · 10:42 PM');
  assert.equal(decorateFrameTime('10:42 PM', { live: false }), '10:42 PM');
  assert.equal(decorateFrameTime('—', { live: true, syncing: true }), 'LIVE · syncing…');
});
