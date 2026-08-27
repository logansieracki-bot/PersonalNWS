import test from 'node:test';
import assert from 'node:assert/strict';
import { decorateFrameTime } from '../../src/ui/ui-adapter.js';

test('current frame time is clearly marked live without changing the clock text itself', () => {
  assert.equal(decorateFrameTime('10:42 PM', { live: true }), 'LIVE · 10:42 PM');
  assert.equal(decorateFrameTime('10:42 PM', { live: false }), '10:42 PM');
  assert.equal(decorateFrameTime('—', { live: true, syncing: true }), 'LIVE · syncing…');
});

test('successful radar UI clears stale bad state and fatal diagnostics', async () => {
  const { createUI } = await import('../../src/ui/ui-adapter.js');
  const classes = new Set(['bad']);
  const dot = { classList: { add(v){ classes.add(v); }, remove(v){ classes.delete(v); }, toggle(v,on){ on ? classes.add(v) : classes.delete(v); } } };
  const fatal = { style: { display: 'block' } };
  const nodes = {
    dot,
    fatal,
    fatalText: { textContent: 'old' },
    fatalCode: { textContent: 'E_OLD' },
    fatalCopy: { textContent: 'Copied', onclick: () => {} },
    tilt: { innerHTML: '', appendChild() {}, },
    product: { options: [], value: '1' },
    detail: { textContent: '' },
  };
  const doc = {
    getElementById(id) { return nodes[id] ?? null; },
    createElement() { return {}; },
  };
  const previousDocument = globalThis.document;
  globalThis.document = doc;
  try {
    const ui = createUI(doc);
    ui.clearError();
    assert.equal(classes.has('bad'), false);
    assert.equal(fatal.style.display, 'none');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('runUiAction surfaces a rejected real user action instead of swallowing it', async () => {
  const { runUiAction } = await import('../../src/ui/action-runner.js');
  const logs = [];
  const shown = [];
  const error = Object.assign(new Error('archive decoder exploded'), { code: 'E_RADAR_DECODE', stage: 'decode' });
  const result = await runUiAction('marker-select', async () => { throw error; }, {
    diagnostics: { record(...args) { logs.push(args); } },
    ui: { error(value) { shown.push(value); } },
    context: { site: 'KDIX' },
  });
  assert.equal(result, null);
  assert.equal(shown[0], error);
  assert.ok(logs.some((entry) => entry[2] === 'E_RADAR_DECODE'));
});

test('main user interactions go through the diagnostic action boundary instead of empty catch handlers', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync('src/main.js', 'utf8');
  assert.match(source, /runUiAction/);
  assert.doesNotMatch(source, /app\.(?:selectSite|loadIndex|setProduct|setElevation)\([^\n]*\.catch\(\(\) => \{\}\)/);
});
