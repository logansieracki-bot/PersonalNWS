import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerRuntime } from '../../src/radar/worker-runtime.js';

test('worker runtime returns SELECT_SITE frame with transferable buffer', async()=>{
  const sent=[];
  const frame={buffer:new ArrayBuffer(12),manifest:{},elevationNumber:1,productId:1};
  const runtime=createWorkerRuntime({core:{selectSite:async()=>({frames:[],frame})},post:(msg,transfer=[])=>sent.push({msg,transfer})});
  await runtime({id:'a',type:'SELECT_SITE',payload:{site:'KTLX',productId:1}});
  assert.equal(sent.length,1);
  assert.equal(sent[0].msg.replyTo,'a');
  assert.equal(sent[0].msg.ok,true);
  assert.equal(sent[0].msg.payload.frame.buffer.byteLength,12);
  assert.equal(sent[0].transfer[0],frame.buffer);
});

test('worker runtime preserves structured error details', async()=>{
  const sent=[];
  const error=Object.assign(new Error('bad archive'),{code:'E_RADAR_DECODE',stage:'archive',sourceId:'KTLX|x',detail:'record 4'});
  const runtime=createWorkerRuntime({core:{selectSite:async()=>{throw error}},post:(msg)=>sent.push(msg)});
  await runtime({id:'b',type:'SELECT_SITE',payload:{site:'KTLX'}});
  assert.equal(sent[0].ok,false);
  assert.equal(sent[0].error.code,'E_RADAR_DECODE');
  assert.equal(sent[0].error.detail,'record 4');
});

test('worker runtime transfers direct LOAD_FRAME buffers instead of cloning them', async()=>{
  const sent=[];
  const buffer=new ArrayBuffer(16);
  const runtime=createWorkerRuntime({core:{loadFrame:async()=>({buffer})},post:(msg,transfer=[])=>sent.push({msg,transfer})});
  await runtime({id:'c',type:'LOAD_FRAME',payload:{site:'KTLX',scanStartMs:1,elevationNumber:1,productId:1}});
  assert.equal(sent[0].transfer[0],buffer);
});
