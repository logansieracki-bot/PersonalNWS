import test from 'node:test';
import assert from 'node:assert/strict';
import { createUIBindings } from '../../src/ui-bindings.js';

function fakeDoc() {
  const ids = ['dot','site','detail','history','stream','fatal','fatalText','fatalCode','fatalCopy','coords','value','timeline','timeLeft','timeNow','timeRight','cacheProgress','tracks'];
  const nodes = Object.fromEntries(ids.map((id) => [id, {
    id, textContent:'', style:{}, classList:{ values:new Set(), add(v){this.values.add(v)}, remove(v){this.values.delete(v)}, toggle(v){ if(this.values.has(v)){this.values.delete(v);return false;}this.values.add(v);return true;} },
    addEventListener(type, fn){ this[`on${type}`]=fn; },
    setAttribute(){},
  }]));
  nodes.timeline.value='0'; nodes.timeline.min='0'; nodes.timeline.max='0';
  nodes.cacheProgress.firstElementChild = { style:{} };
  return { getElementById: (id) => nodes[id] ?? null, nodes };
}

test('UI bindings update status and timeline without radar knowledge', () => {
  const doc = fakeDoc();
  const ui = createUIBindings(doc);
  ui.setStatus({ site:'KDIX', detail:'ready', stream:'· frontend', live:true });
  ui.setTimeline({ index:2, count:5, left:'7:00', now:'7:04', right:'LIVE', progress:0.5 });
  assert.equal(doc.nodes.site.textContent, 'KDIX');
  assert.equal(doc.nodes.timeline.max, '4');
  assert.equal(doc.nodes.timeline.value, '2');
  assert.equal(doc.nodes.timeNow.textContent, '7:04');
  assert.equal(doc.nodes.cacheProgress.firstElementChild.style.width, '50%');
  assert.equal(doc.nodes.dot.classList.values.has('live'), true);
});

test('fatal panel can show and clear structured errors', () => {
  const doc = fakeDoc();
  const ui = createUIBindings(doc);
  ui.showFatal({ message:'Map exploded', code:'E_MAP', stage:'map' });
  assert.equal(doc.nodes.fatal.style.display, 'block');
  assert.match(doc.nodes.fatalCode.textContent, /E_MAP/);
  ui.clearFatal();
  assert.equal(doc.nodes.fatal.style.display, 'none');
});
