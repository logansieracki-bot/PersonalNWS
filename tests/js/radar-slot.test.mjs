import test from 'node:test';
import assert from 'node:assert/strict';
import { createRadarSlot } from '../../src/radar-slot.js';

test('radar slot attaches and detaches a Stage 2 adapter', async () => {
  const calls = [];
  const slot = createRadarSlot({ map:{id:'map'}, ui:{id:'ui'}, diagnostics:{ info(...x){calls.push(x)}, error(){} } });
  const adapter = {
    async start(ctx){ assert.equal(ctx.map.id, 'map'); calls.push(['start']); return { ready:true }; },
    async stop(){ calls.push(['stop']); },
  };
  const result = await slot.attach(adapter);
  assert.equal(result.ready, true);
  assert.equal(slot.debug().attached, true);
  await slot.detach();
  assert.equal(slot.debug().attached, false);
  assert.equal(calls.some((x) => x[0] === 'stop'), true);
});

test('attaching a replacement stops the previous adapter first', async () => {
  const order = [];
  const diagnostics = { info(){}, error(){} };
  const slot = createRadarSlot({ map:{}, ui:{}, diagnostics });
  await slot.attach({ async start(){order.push('start1')}, async stop(){order.push('stop1')} });
  await slot.attach({ async start(){order.push('start2')}, async stop(){order.push('stop2')} });
  assert.deepEqual(order, ['start1','stop1','start2']);
});

test('invalid adapters fail with E_RADAR_ADAPTER', async () => {
  const slot = createRadarSlot({ map:{}, ui:{}, diagnostics:{ info(){}, error(){} } });
  await assert.rejects(() => slot.attach({}), (error) => error.code === 'E_RADAR_ADAPTER' && error.stage === 'radar-slot');
});
