import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerCore } from '../../src/radar/worker-core.js';

function manifest(){return {site:'KTLX',scanStartMs:2000,elevations:[{number:1,angle:.5,products:[1,2]}]};}

test('SELECT_SITE discovers recent volumes and returns a decoded latest frame', async()=>{
  const calls=[];
  const frame={site:'KTLX',objectKey:'new',scanStartMs:2000,manifest:manifest(),elevationNumber:1,productId:1,buffer:new ArrayBuffer(8)};
  const core=new WorkerCore({
    role:'priority',
    now:()=>3000,
    listVolumes:async()=>[{key:'old',scanStartMs:1000},{key:'new',scanStartMs:2000}],
    pipeline:{load:async req=>{calls.push(req);return frame;}},
  });
  const out=await core.selectSite({site:'KTLX',productId:1});
  assert.deepEqual(out.frames.map(x=>x.objectKey),['old','new']);
  assert.equal(out.frame.objectKey,'new');
  assert.equal(calls[0].objectKey,'new');
});

test('SELECT_SITE reports no recent data precisely', async()=>{
  const core=new WorkerCore({role:'priority',now:()=>3000,listVolumes:async()=>[],pipeline:{load:async()=>{throw new Error('should not run')}}});
  await assert.rejects(()=>core.selectSite({site:'KTLX',productId:1}),err=>err.code==='E_NO_RECENT_DATA'&&err.stage==='listing');
});

test('SELECT_SITE falls back to an earlier completed volume when newest decode fails', async()=>{
  const attempted=[];
  const core=new WorkerCore({
    role:'priority',
    now:()=>4000,
    listVolumes:async()=>[
      {key:'old',scanStartMs:1000},
      {key:'middle',scanStartMs:2000},
      {key:'new',scanStartMs:3000},
    ],
    pipeline:{load:async req=>{
      attempted.push(req.objectKey);
      if(req.objectKey==='new') throw Object.assign(new Error('bad newest scan'),{code:'E_NO_RADIALS',stage:'archive'});
      return {site:'KTLX',objectKey:req.objectKey,scanStartMs:req.scanStartMs,manifest:manifest(),elevationNumber:1,productId:1,buffer:new ArrayBuffer(8)};
    }},
  });
  const out=await core.selectSite({site:'KTLX',productId:1});
  assert.deepEqual(attempted,['new','middle']);
  assert.equal(out.frame.objectKey,'middle');
});

test('SELECT_SITE only probes a small number of newest volumes on failure', async()=>{
  const attempted=[];
  const core=new WorkerCore({
    role:'priority',now:()=>6000,
    listVolumes:async()=>[1,2,3,4,5].map(n=>({key:`f${n}`,scanStartMs:n*1000})),
    pipeline:{load:async req=>{attempted.push(req.objectKey);throw Object.assign(new Error('decode failed'),{code:'E_NO_RADIALS',stage:'archive'});}},
  });
  await assert.rejects(()=>core.selectSite({site:'KTLX',productId:1}), /decode failed/);
  assert.deepEqual(attempted,['f5','f4','f3']);
});
