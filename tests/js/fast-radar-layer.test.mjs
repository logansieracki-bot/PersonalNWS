import test from 'node:test';
import assert from 'node:assert/strict';
import { FastRadarLayer } from '../../src/render/fast-radar-layer.js';

class FakeMap {
  constructor() {
    this.sources = new Map();
    this.layers = new Map();
    this.listeners = new Map();
    this.loadedSources = new Set();
    this.ops = [];
  }
  addSource(id, def) { this.sources.set(id, def); this.ops.push(['addSource', id]); }
  addLayer(def, before) { this.layers.set(def.id, structuredClone(def)); this.ops.push(['addLayer', def.id, before]); }
  getSource(id) { return this.sources.get(id); }
  getLayer(id) { return this.layers.get(id); }
  removeLayer(id) { this.layers.delete(id); this.ops.push(['removeLayer', id]); }
  removeSource(id) { this.sources.delete(id); this.loadedSources.delete(id); this.ops.push(['removeSource', id]); }
  setPaintProperty(id, prop, value) { this.layers.get(id).paint[prop] = value; this.ops.push(['paint', id, prop, value]); }
  on(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  off(type, fn) { this.listeners.get(type)?.delete(fn); }
  isSourceLoaded(id) { return this.loadedSources.has(id); }
  markLoaded(id) {
    this.loadedSources.add(id);
    for (const fn of this.listeners.get('sourcedata') ?? []) fn({ sourceId: id, isSourceLoaded: true, sourceDataType: 'content' });
  }
  markTileActivity(id) {
    for (const fn of this.listeners.get('sourcedata') ?? []) fn({ sourceId: id, isSourceLoaded: false, sourceDataType: 'content', tile: { tileID: 'test' } });
  }
  emitTileError(id) {
    for (const fn of this.listeners.get('error') ?? []) fn({ sourceId: id, tile: { tileID: 'bad' }, error: new Error('one tile failed') });
  }
}

test('first fast radar layer becomes visible immediately below map labels', async () => {
  const map = new FakeMap();
  const fast = new FastRadarLayer(map, { beforeLayerId: 'labels', loadTimeoutMs: 100 });
  const shown = fast.show({ site: { id: 'KDIX' }, productId: 1, cacheToken: 1 });
  const [sourceId] = map.sources.keys();
  const [layerId] = map.layers.keys();
  assert.ok(sourceId);
  assert.equal(map.layers.get(layerId).paint['raster-opacity'], 0.78);
  assert.equal(map.ops.find((op) => op[0] === 'addLayer')[2], 'labels');
  map.markLoaded(sourceId);
  assert.equal(await shown, true);
  assert.equal(fast.activeLayerId, layerId);
});


test('first usable raster tile activity marks radar ready without waiting for the entire source', async () => {
  const map = new FakeMap();
  const fast = new FastRadarLayer(map, { loadTimeoutMs: 100 });
  const shown = fast.show({ site: { id: 'KDIX' }, productId: 1, cacheToken: 1 });
  const [sourceId] = map.sources.keys();
  map.markTileActivity(sourceId);
  assert.equal(await shown, true);
  assert.equal(map.isSourceLoaded(sourceId), false, 'whole source is intentionally still loading');
  assert.ok(fast.activeLayerId, 'radar becomes active on first usable tile activity');
});


test('one failed raster tile does not kill the whole radar when another tile becomes usable', async () => {
  const map = new FakeMap();
  const fast = new FastRadarLayer(map, { loadTimeoutMs: 100 });
  const shown = fast.show({ site: { id: 'KDIX' }, productId: 1, cacheToken: 1 });
  const [sourceId] = map.sources.keys();
  map.emitTileError(sourceId);
  map.markTileActivity(sourceId);
  assert.equal(await shown, true);
  assert.ok(fast.activeLayerId);
});

test('refresh keeps old radar visible until replacement source is fully loaded', async () => {
  const map = new FakeMap();
  const fast = new FastRadarLayer(map, { loadTimeoutMs: 100 });
  let pending = fast.show({ site: { id: 'KDOX' }, productId: 1, cacheToken: 1 });
  const firstSource = [...map.sources.keys()][0];
  map.markLoaded(firstSource);
  await pending;
  const firstLayer = fast.activeLayerId;

  pending = fast.refresh(2);
  const stagingSource = [...map.sources.keys()].find((id) => id !== firstSource);
  const stagingLayer = [...map.layers.keys()].find((id) => id !== firstLayer);
  assert.ok(map.getLayer(firstLayer), 'old radar must remain during refresh');
  assert.equal(map.getLayer(stagingLayer).paint['raster-opacity'], 0, 'replacement starts hidden');

  map.markLoaded(stagingSource);
  assert.equal(await pending, true);
  assert.equal(map.getLayer(firstLayer), undefined, 'old layer removed only after replacement loads');
  assert.equal(map.getSource(firstSource), undefined, 'old source removed only after replacement loads');
  assert.equal(map.getLayer(stagingLayer).paint['raster-opacity'], 0.78);
  assert.equal(fast.activeLayerId, stagingLayer);
});

test('failed staging refresh preserves the existing visible radar', async () => {
  const map = new FakeMap();
  const fast = new FastRadarLayer(map, { loadTimeoutMs: 5 });
  let pending = fast.show({ site: { id: 'KTLX' }, productId: 2, cacheToken: 1 });
  const firstSource = [...map.sources.keys()][0];
  map.markLoaded(firstSource);
  await pending;
  const firstLayer = fast.activeLayerId;

  const ok = await fast.refresh(2);
  assert.equal(ok, false);
  assert.ok(map.getLayer(firstLayer));
  assert.equal(fast.activeLayerId, firstLayer);
  assert.equal(map.layers.size, 1);
  assert.equal(map.sources.size, 1);
});

test('failed first fast load does not claim a blank radar as active', async () => {
  const map = new FakeMap();
  const fast = new FastRadarLayer(map, { loadTimeoutMs: 5 });
  const ok = await fast.show({ site: { id: 'KDIX' }, productId: 1, cacheToken: 1 });
  assert.equal(ok, false);
  assert.equal(fast.activeLayerId, null);
  assert.equal(map.layers.size, 0);
  assert.equal(map.sources.size, 0);
});

test('fast radar timeout preserves a structured failure with station/source timing', async () => {
  const map = new FakeMap();
  const events = [];
  const diagnostics = { record(level, stage, code, message, context = {}) { events.push({ level, stage, code, message, context }); } };
  let now = 100;
  const fast = new FastRadarLayer(map, { loadTimeoutMs: 5, diagnostics, now: () => now += 10 });
  const ok = await fast.show({ site: { id: 'KDIX' }, productId: 1, cacheToken: 1 });
  assert.equal(ok, false);
  assert.equal(fast.lastFailure?.code, 'E_FAST_TIMEOUT');
  assert.equal(fast.lastFailure?.stage, 'fast-radar');
  assert.equal(fast.lastFailure?.context?.site, 'KDIX');
  assert.ok(events.some((event) => event.code === 'E_FAST_TIMEOUT' && event.context.site === 'KDIX'));
});
