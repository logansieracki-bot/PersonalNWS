import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarEngineV2 } from '../../src/radar/radar-engine-v2.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeUi() {
  return {
    calls: [],
    busy(v) { this.calls.push(['busy', v]); },
    site(v) { this.calls.push(['site', v.id]); },
    timeline(frames, index, options) { this.calls.push(['timeline', frames.map((f) => f.scanStartMs), index, options]); },
    preparedRadar(productId) { this.calls.push(['preparedRadar', productId]); },
    manifest(manifest, elevation, product) { this.calls.push(['manifest', elevation, product, manifest]); },
    error(error) { this.calls.push(['error', error?.code ?? error?.message]); },
    setStream(value) { this.calls.push(['stream', value]); },
  };
}

function frames(...times) {
  return times.map((scanStartMs, i) => ({ objectKey: `key-${i}-${scanStartMs}`, scanStartMs }));
}

test('site selection renders fast radar without creating or waiting for Level II', async () => {
  const ui = fakeUi();
  const metadata = deferred();
  const fastCalls = [];
  let level2Creates = 0;
  const engine = new RadarEngineV2({
    ui,
    fastRenderer: {
      show: async (request) => { fastCalls.push(request); return true; },
      refresh: async () => true,
      hide() {}, reveal() {},
    },
    level2Renderer: { setVisible() {}, setFrame() {} },
    listFrames: async () => metadata.promise,
    createLevel2Session: async () => { level2Creates++; throw new Error('must stay lazy'); },
    pollMs: 0,
    warmHistoryDelayMs: 0,
    now: () => 1000,
  });

  const result = await engine.selectSite({ id: 'KDIX', name: 'Philadelphia', lat: 39.9, lon: -74.4 });
  assert.equal(result, true);
  assert.equal('mode' in engine, false, 'engine must not carry a fast/slow mode switch');
  assert.equal(fastCalls.length, 1);
  assert.equal(fastCalls[0].site.id, 'KDIX');
  assert.equal(level2Creates, 0);

  metadata.resolve(frames(800, 900));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(engine.frames.map((f) => f.scanStartMs), [800, 900]);
  assert.equal(engine.currentIndex, 1);
});

test('live refresh advances a user following latest but does not yank historical selection forward', async () => {
  const ui = fakeUi();
  let current = frames(100, 200);
  const refreshes = [];
  const engine = new RadarEngineV2({
    ui,
    fastRenderer: {
      show: async () => true,
      refresh: async (token) => { refreshes.push(token); return true; },
      hide() {}, reveal() {},
    },
    level2Renderer: { setVisible() {}, setFrame() {} },
    listFrames: async () => current,
    createLevel2Session: async () => ({ priority: { request: async (_type, payload) => ({ manifest: { elevations: [{ number: 1, angle: 0.5, radialCount: 720, products: [1, 2] }] }, elevationNumber: 1, productId: 1, buffer: new ArrayBuffer(8), ...payload }) } }),
    pollMs: 0,
    warmHistoryDelayMs: 0,
    now: (() => { let t = 1000; return () => ++t; })(),
  });
  await engine.selectSite({ id: 'KDOX', name: 'Dover', lat: 38.8, lon: -75.4 });
  await engine.refreshLive();
  assert.equal(engine.currentIndex, 1);

  current = frames(100, 200, 300);
  await engine.refreshLive();
  assert.equal(engine.currentIndex, 2, 'live-follow advances to new latest');

  await engine.loadIndex(0);
  assert.equal(engine.followLive, false);
  current = frames(100, 200, 300, 400);
  await engine.refreshLive();
  assert.equal(engine.currentIndex, 0, 'historical selection remains stable');
  assert.ok(refreshes.length >= 2);
});

test('advanced product initializes Level II only on demand and swaps after a frame is ready', async () => {
  const ui = fakeUi();
  const visible = [];
  const fast = { show: async () => true, refresh: async () => true, hide: () => visible.push('fast-hide'), reveal() {} };
  const level2Renderer = {
    setVisible(value) { visible.push(`level2-${value}`); },
    setFrame(buffer, site) { visible.push(`frame-${site.id}-${buffer.byteLength}`); },
  };
  let creates = 0;
  const priority = {
    async request(type, payload) {
      assert.equal(type, 'LOAD_FRAME');
      assert.equal(payload.productId, 4);
      return {
        site: 'KTLX', objectKey: payload.objectKey, scanStartMs: payload.scanStartMs,
        manifest: { elevations: [{ number: 2, angle: 0.5, radialCount: 720, products: [1, 2, 4] }] },
        elevationNumber: 2, productId: 4, buffer: new ArrayBuffer(16),
      };
    },
  };
  const engine = new RadarEngineV2({
    ui,
    fastRenderer: fast,
    level2Renderer,
    listFrames: async () => frames(100, 200),
    createLevel2Session: async () => { creates++; return { priority, startHistory: () => {} }; },
    pollMs: 0,
    warmHistoryDelayMs: 0,
  });
  await engine.selectSite({ id: 'KTLX', name: 'Twin Lakes', lat: 35.3, lon: -97.2 });
  await engine.refreshLive();
  assert.equal(creates, 0);

  await engine.setProduct(4);
  assert.equal(creates, 1);
  assert.deepEqual(visible.slice(-3), ['frame-KTLX-16', 'level2-true', 'fast-hide']);
  assert.equal('mode' in engine, false, 'advanced rendering must not introduce a slow mode');
});

test('blank fast-radar result falls back to Level II instead of reporting fast success', async () => {
  const calls = [];
  const ui = fakeUi(calls);
  const fastRenderer = {
    async show() { calls.push(['fast-show-failed']); return false; },
    hide() {}, reveal() {}, destroy() {},
  };
  const level2Renderer = {
    setVisible(value) { calls.push(['level2-visible', value]); },
    setFrame() { calls.push(['level2-frame']); },
  };
  const frames = [{ objectKey: '2026/08/26/KDIX/KDIX20260826_220000_V06', scanStartMs: 1000 }];
  let level2Created = 0;
  const engine = new RadarEngineV2({
    ui,
    fastRenderer,
    level2Renderer,
    listFrames: async () => frames,
    createLevel2Session: async () => {
      level2Created++;
      return {
        priority: { request: async (_type, payload) => ({
          manifest: { elevations: [{ number: 1, angle: 0.5, products: [1] }] },
          elevationNumber: 1,
          productId: 1,
          buffer: new ArrayBuffer(8),
          ...payload,
        }) },
      };
    },
    pollMs: 0,
    warmHistoryDelayMs: 0,
  });

  const result = await engine.selectSite({ id: 'KDIX', lat: 39.95, lon: -74.41 });
  assert.equal(result, true);
  assert.equal('mode' in engine, false);
  assert.equal(level2Created, 1);
  assert.ok(calls.some((entry) => entry[0] === 'level2-frame'));
});

test('Radar Engine V2 emits stage-specific diagnostic events through fast failure and Level II fallback', async () => {
  const events = [];
  const diagnostics = { record(level, stage, code, message, context = {}) { events.push({ level, stage, code, message, context }); } };
  const ui = fakeUi();
  const engine = new RadarEngineV2({
    ui,
    diagnostics,
    fastRenderer: { show: async () => false, hide() {}, reveal() {}, destroy() {} },
    level2Renderer: { setVisible() {}, setFrame() {} },
    listFrames: async () => frames(1000),
    createLevel2Session: async () => ({ priority: { request: async (_type, payload) => ({
      ...payload,
      manifest: { elevations: [{ number: 1, angle: 0.5, products: [1] }] },
      elevationNumber: 1,
      productId: 1,
      buffer: new ArrayBuffer(8),
    }) } }),
    pollMs: 0,
    warmHistoryDelayMs: 0,
    now: (() => { let value = 10_000; return () => value += 25; })(),
  });

  const result = await engine.selectSite({ id: 'KDIX', name: 'Philadelphia', lat: 39.9, lon: -74.4 });
  assert.equal(result, true);
  assert.equal('mode' in engine, false);
  assert.ok(events.some((event) => event.code === 'SITE_SELECT' && event.context.site === 'KDIX'));
  assert.ok(events.some((event) => event.code === 'FAST_FAILED' && event.stage === 'fast-radar'));
  assert.ok(events.some((event) => event.code === 'LEVEL2_FRAME_READY' && event.context.site === 'KDIX'));
});

test('live polling emits refresh diagnostics so stale radar can be traced', async () => {
  const events=[];
  const diagnostics={record(level,stage,code,message,context={}){events.push({level,stage,code,message,context});}};
  let current=frames(100,200);
  const engine=new RadarEngineV2({
    ui:fakeUi(),diagnostics,
    fastRenderer:{show:async()=>true,refresh:async()=>true,hide(){},reveal(){}},
    level2Renderer:{setVisible(){},setFrame(){}},
    listFrames:async()=>current,
    createLevel2Session:async()=>({priority:{request:async()=>{throw new Error('not used')}}}),
    pollMs:0,warmHistoryDelayMs:0,
    now:(()=>{let t=1000;return()=>++t;})(),
  });
  await engine.selectSite({id:'KDOX',name:'Dover',lat:38.8,lon:-75.4});
  current=frames(100,200,300);
  await engine.refreshLive();
  assert.ok(events.some(e=>e.code==='LIVE_REFRESH_START'&&e.context.site==='KDOX'));
  assert.ok(events.some(e=>e.code==='LIVE_REFRESH_OK'&&e.context.frameCount===3));
});

test('fast product changes do not wait for Level II frame discovery', async () => {
  const ui = fakeUi();
  const metadata = deferred();
  const fastCalls = [];
  const engine = new RadarEngineV2({
    ui,
    fastRenderer: {
      show: async (request) => { fastCalls.push(request); return true; },
      refresh: async () => true,
      hide() {}, reveal() {},
    },
    level2Renderer: { setVisible() {}, setFrame() {} },
    listFrames: async () => metadata.promise,
    createLevel2Session: async () => { throw new Error('Level II must remain lazy'); },
    pollMs: 0,
    warmHistoryDelayMs: 0,
    now: (() => { let t = 1000; return () => ++t; })(),
  });

  await engine.selectSite({ id: 'KDIX', name: 'Philadelphia', lat: 39.9, lon: -74.4 });
  const productChange = engine.setProduct(2);
  const winner = await Promise.race([
    productChange.then(() => 'changed'),
    new Promise((resolve) => setTimeout(() => resolve('blocked'), 20)),
  ]);

  assert.equal(winner, 'changed');
  assert.equal(fastCalls.at(-1).productId, 2);
  assert.equal('mode' in engine, false);

  metadata.resolve(frames(800, 900));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('fast first frame does not lose history warm-up when metadata arrives later', async () => {
  const ui = fakeUi();
  const metadata = deferred();
  let historyStarts = 0;
  let level2Creates = 0;
  const scheduled = [];
  const engine = new RadarEngineV2({
    ui,
    fastRenderer: { show: async () => true, refresh: async () => true, hide() {}, reveal() {} },
    level2Renderer: { setVisible() {}, setFrame() {} },
    listFrames: async () => metadata.promise,
    createLevel2Session: async () => {
      level2Creates++;
      return {
        priority: { request: async () => { throw new Error('not used'); } },
        startHistory() { historyStarts++; },
      };
    },
    pollMs: 0,
    warmHistoryDelayMs: 3000,
    setTimeoutImpl(fn) { scheduled.push(fn); return scheduled.length; },
    clearTimeoutImpl() {},
  });

  const selected = await engine.selectSite({ id: 'KDOX', name: 'Dover', lat: 38.8, lon: -75.4 });
  assert.equal(selected, true);
  assert.equal('mode' in engine, false);
  assert.equal(level2Creates, 0, 'fast first frame does not initialize Level II');
  assert.equal(scheduled.length, 0, 'history timer is not armed before metadata exists');

  metadata.resolve(frames(100, 200));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scheduled.length, 1, 'history warm timer is armed after metadata arrives');

  await scheduled[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(level2Creates, 1);
  assert.equal(historyStarts, 1);
});

test('Level II fallback tries previous completed scans before showing a fatal error', async () => {
  const ui = fakeUi();
  const attempts = [];
  const listed = frames(100, 200, 300);
  const engine = new RadarEngineV2({
    ui,
    fastRenderer: { show: async () => false, hide() {}, reveal() {}, destroy() {} },
    level2Renderer: { setVisible() {}, setFrame() {} },
    listFrames: async () => listed,
    createLevel2Session: async () => ({
      priority: {
        async request(_type, payload) {
          attempts.push(payload.scanStartMs);
          if (payload.scanStartMs === 300) {
            const error = new Error('newest scan is malformed');
            error.code = 'E_NO_RADIALS';
            error.stage = 'decode';
            throw error;
          }
          return {
            ...payload,
            manifest: { elevations: [{ number: 1, angle: 0.5, products: [1] }] },
            elevationNumber: 1,
            productId: 1,
            buffer: new ArrayBuffer(8),
          };
        },
      },
      startHistory() {},
    }),
    pollMs: 0,
    warmHistoryDelayMs: 0,
  });

  const result = await engine.selectSite({ id: 'KDIX', name: 'Philadelphia', lat: 39.9, lon: -74.4 });
  assert.equal(result, true);
  assert.equal('mode' in engine, false);
  assert.deepEqual(attempts, [300, 200]);
  assert.equal(engine.currentIndex, 1);
  assert.equal(ui.calls.filter((call) => call[0] === 'error').length, 0, 'successful fallback must not show fatal error');
});

test('browser timer hooks are invoked with the global receiver instead of RadarEngineV2', async () => {
  const ui = fakeUi();
  let intervalCallback = null;
  let clearedInterval = null;
  const nativeLikeSetInterval = function(callback, delay) {
    assert.equal(this, globalThis, 'setInterval must receive the browser global as its receiver');
    assert.equal(delay, 20_000);
    intervalCallback = callback;
    return 77;
  };
  const nativeLikeClearInterval = function(id) {
    assert.equal(this, globalThis, 'clearInterval must receive the browser global as its receiver');
    clearedInterval = id;
  };

  const engine = new RadarEngineV2({
    ui,
    fastRenderer: { show: async () => true, refresh: async () => true, hide() {}, reveal() {}, destroy() {} },
    level2Renderer: { setVisible() {}, setFrame() {} },
    listFrames: async () => [],
    createLevel2Session: async () => { throw new Error('not used'); },
    pollMs: 20_000,
    warmHistoryDelayMs: 0,
    setIntervalImpl: nativeLikeSetInterval,
    clearIntervalImpl: nativeLikeClearInterval,
  });

  await engine.selectSite({ id: 'KDIX', name: 'Philadelphia', lat: 39.9, lon: -74.4 });
  assert.equal(typeof intervalCallback, 'function');
  engine.dispose();
  assert.equal(clearedInterval, 77);
});

test('history timer hooks are invoked with the global receiver instead of RadarEngineV2', async () => {
  const ui = fakeUi();
  let timeoutCallback = null;
  let clearedTimeout = null;
  const nativeLikeSetTimeout = function(callback, delay) {
    assert.equal(this, globalThis, 'setTimeout must receive the browser global as its receiver');
    assert.equal(delay, 3_000);
    timeoutCallback = callback;
    return 88;
  };
  const nativeLikeClearTimeout = function(id) {
    assert.equal(this, globalThis, 'clearTimeout must receive the browser global as its receiver');
    clearedTimeout = id;
  };

  const engine = new RadarEngineV2({
    ui,
    fastRenderer: { show: async () => true, refresh: async () => true, hide() {}, reveal() {}, destroy() {} },
    level2Renderer: { setVisible() {}, setFrame() {} },
    listFrames: async () => frames(100, 200),
    createLevel2Session: async () => ({ priority: { request: async () => { throw new Error('not used'); } }, startHistory() {} }),
    pollMs: 0,
    warmHistoryDelayMs: 3_000,
    setTimeoutImpl: nativeLikeSetTimeout,
    clearTimeoutImpl: nativeLikeClearTimeout,
  });

  await engine.selectSite({ id: 'KDIX', name: 'Philadelphia', lat: 39.9, lon: -74.4 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(typeof timeoutCallback, 'function');
  engine.dispose();
  assert.equal(clearedTimeout, 88);
});

test('a live timer setup failure is logged but never turns a visible radar into a site-selection failure', async () => {
  const events = [];
  const diagnostics = { record(level, stage, code, message, context = {}) { events.push({ level, stage, code, message, context }); } };
  const engine = new RadarEngineV2({
    ui: fakeUi(),
    diagnostics,
    fastRenderer: { show: async () => true, refresh: async () => true, hide() {}, reveal() {}, destroy() {} },
    level2Renderer: { setVisible() {}, setFrame() {} },
    listFrames: async () => [],
    createLevel2Session: async () => { throw new Error('Level II must not be used just because polling failed'); },
    pollMs: 20_000,
    warmHistoryDelayMs: 0,
    setIntervalImpl() { throw Object.assign(new TypeError('Illegal invocation'), { code: 'E_TIMER_BINDING' }); },
  });

  const result = await engine.selectSite({ id: 'KDIX', name: 'Philadelphia', lat: 39.9, lon: -74.4 });
  assert.equal(result, true);
  assert.equal(engine.preparedVisible, true);
  assert.ok(events.some((event) => event.code === 'LIVE_TIMER_FAILED' && event.stage === 'live'));
});
