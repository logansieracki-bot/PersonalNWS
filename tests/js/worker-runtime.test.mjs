import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerRuntime } from '../../src/radar/worker-runtime.js';

test('worker runtime transfers direct LOAD_FRAME buffers instead of cloning them', async()=>{
  const sent=[];
  const buffer=new ArrayBuffer(16);
  const runtime=createWorkerRuntime({core:{loadFrame:async()=>({buffer})},post:(msg,transfer=[])=>sent.push({msg,transfer})});
  await runtime({id:'c',type:'LOAD_FRAME',payload:{site:'KTLX',objectKey:'x',scanStartMs:1,elevationNumber:1,productId:1}});
  assert.equal(sent[0].transfer[0],buffer);
});

test('worker runtime preserves structured LOAD_FRAME error details', async()=>{
  const sent=[];
  const error=Object.assign(new Error('bad archive'),{code:'E_RADAR_DECODE',stage:'archive',sourceId:'KTLX|x',detail:'record 4'});
  const runtime=createWorkerRuntime({core:{loadFrame:async()=>{throw error}},post:(msg)=>sent.push(msg)});
  await runtime({id:'b',type:'LOAD_FRAME',payload:{site:'KTLX',objectKey:'x',scanStartMs:1,productId:1}});
  assert.equal(sent[0].ok,false);
  assert.equal(sent[0].error.code,'E_RADAR_DECODE');
  assert.equal(sent[0].error.detail,'record 4');
});

test('worker runtime preserves structured error context for debug reports', async () => {
  const sent = [];
  const error = Object.assign(new Error('no radials'), {
    code: 'E_NO_RADIALS', stage: 'archive', sourceId: 'KDIX|scan', detail: 'records=71',
    context: { site: 'KDIX', objectKey: '2026/x', records: 71, radialFailures: 68 },
  });
  const runtime = createWorkerRuntime({ core: { loadFrame: async () => { throw error; } }, post: (msg) => sent.push(msg) });
  await runtime({ id: 'ctx', type: 'LOAD_FRAME', payload: { site: 'KDIX', objectKey:'2026/x', scanStartMs:1, productId:1 } });
  assert.deepEqual(sent[0].error.context, error.context);
});
