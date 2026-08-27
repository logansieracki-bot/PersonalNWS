import test from 'node:test';
import assert from 'node:assert/strict';
import { FramePipeline } from '../../src/radar/frame-pipeline.js';

const pswp = () => {
  const b = new ArrayBuffer(96 + 4 + 8 + 4 + 4);
  const u = new Uint8Array(b); u.set([80,83,87,80],0);
  const d = new DataView(b); d.setUint16(4,1,true); d.setUint16(6,96,true); d.setUint16(8,1,true);
  d.setUint8(10,1); d.setUint8(11,1); d.setUint32(16,1,true); d.setUint32(20,4,true);
  d.setFloat64(24,2,true); d.setFloat64(32,.25,true); d.setFloat64(40,3,true); d.setFloat32(48,2,true); d.setFloat32(52,66,true);
  d.setUint32(80,96,true); d.setUint32(84,104,true); d.setUint32(88,112,true); d.setUint32(92,116,true);
  return b;
};

test('latest frame performs real archive ingest then builds and caches a sweep blob', async () => {
  const calls=[];
  const cache={
    async getScan(){return undefined}, async getSweep(){return undefined},
    async putScan(site,start,m){calls.push(['putScan',site,start,m])},
    async putSweep(site,start,e,p,b){calls.push(['putSweep',site,start,e,p,b.byteLength])},
  };
  const engine={
    ingest_archive(id,site,bytes){calls.push(['ingest',id,site,bytes.length]); return {site,scanStartMs:1000,scanEndMs:2000,vcp:212,complete:true,elevations:[{number:1,angle:.5,products:[1,2]}]};},
    build_sweep_blob(id,e,p){calls.push(['blob',id,e,p]); return new Uint8Array(pswp());},
    release_source(id){calls.push(['release',id]);},
  };
  const pipeline=new FramePipeline({cache,engine,fetchArrayBuffer:async url=>{calls.push(['fetch',url]);return new Uint8Array([1,2,3]).buffer;}});
  const frame=await pipeline.load({site:'KTLX',objectKey:'2026/08/23/KTLX/KTLX20260823_220000_V06',scanStartMs:1000,elevationNumber:null,productId:1});
  assert.equal(frame.manifest.site,'KTLX');
  assert.equal(frame.elevationNumber,1);
  assert.equal(frame.productId,1);
  assert.equal(new Uint8Array(frame.buffer)[0],80);
  assert.ok(calls.some(x=>x[0]==='ingest'));
  assert.ok(calls.some(x=>x[0]==='blob'));
  assert.ok(calls.some(x=>x[0]==='putSweep'));
  assert.equal(calls.some(x=>x[0]==='release'),false);
  pipeline.dispose();
  assert.ok(calls.some(x=>x[0]==='release'));
});

test('cached sweep returns without fetch or Rust decode', async () => {
  const buffer=pswp(); let fetched=0,decoded=0;
  const cache={
    async getScan(){return {site:'KTLX',scanStartMs:1000,elevations:[{number:1,angle:.5,products:[1]}]}},
    async getSweep(){return buffer}, async putScan(){}, async putSweep(){},
  };
  const engine={ingest_archive(){decoded++;},build_sweep_blob(){decoded++;},release_source(){}};
  const pipeline=new FramePipeline({cache,engine,fetchArrayBuffer:async()=>{fetched++;return new ArrayBuffer(0);}});
  const frame=await pipeline.load({site:'KTLX',objectKey:'x',scanStartMs:1000,elevationNumber:1,productId:1});
  assert.equal(frame.buffer,buffer);
  assert.equal(fetched,0);
  assert.equal(decoded,0);
});

test('cache key remains the S3 frame timestamp even when decoded collection time differs', async()=>{
  const puts=[];
  const cache={async getScan(){},async getSweep(){},async putScan(_s,t){puts.push(['scan',t])},async putSweep(_s,t){puts.push(['sweep',t])}};
  const engine={ingest_archive(){return {site:'KTLX',scanStartMs:1234,elevations:[{number:1,angle:.5,products:[1]}]}},build_sweep_blob(){return new Uint8Array(pswp())},release_source(){}};
  const pipeline=new FramePipeline({cache,engine,fetchArrayBuffer:async()=>new ArrayBuffer(1)});
  const frame=await pipeline.load({site:'KTLX',objectKey:'k',scanStartMs:1000,productId:1});
  assert.equal(frame.scanStartMs,1000);
  assert.deepEqual(puts.map(x=>x[1]),[1000,1000]);
});

test('decoder failure keeps exact S3 object and downloaded byte count in diagnostics', async () => {
  const cache={async getScan(){},async getSweep(){},async putScan(){},async putSweep(){}};
  const engine={
    ingest_archive(){throw {code:'E_NO_RADIALS',stage:'archive',sourceId:'inner',message:'archive contained no decodable radar radials',detail:'record parser miss'};},
    release_source(){},
  };
  const pipeline=new FramePipeline({cache,engine,fetchArrayBuffer:async()=>new Uint8Array(123456).buffer});
  const objectKey='2026/08/24/KDOX/KDOX20260824_020000_V06';
  await assert.rejects(
    pipeline.load({site:'KDOX',objectKey,scanStartMs:1000,productId:1}),
    (error) => {
      assert.equal(error.code,'E_NO_RADIALS');
      assert.equal(error.sourceId,objectKey);
      assert.match(error.detail,/123456 bytes/);
      assert.match(error.detail,/record parser miss/);
      return true;
    },
  );
});

test('same volume reuses the decoded Rust source when switching products', async () => {
  let fetches=0, ingests=0, releases=0;
  const cache={async getScan(){},async getSweep(){},async putScan(){},async putSweep(){}};
  const manifest={site:'KTLX',elevations:[{number:1,angle:.5,products:[1,2]}]};
  const engine={
    ingest_archive(){ingests++;return manifest;},
    build_sweep_blob(){return new Uint8Array(pswp());},
    release_source(){releases++;},
  };
  const pipeline=new FramePipeline({cache,engine,fetchArrayBuffer:async()=>{fetches++;return new ArrayBuffer(5);}});
  const request={site:'KTLX',objectKey:'same',scanStartMs:1000,elevationNumber:1};
  await pipeline.load({...request,productId:1});
  await pipeline.load({...request,productId:2});
  assert.equal(fetches,1);
  assert.equal(ingests,1);
  assert.equal(releases,0);
  pipeline.dispose();
  assert.equal(releases,1);
});

test('frame pipeline emits fetch/decode/sweep diagnostics with exact source metadata', async () => {
  const events=[];
  const diagnostics={record(level,stage,code,message,context={}){events.push({level,stage,code,message,context});}};
  const cache={async getScan(){},async getSweep(){},async putScan(){},async putSweep(){}};
  const engine={
    ingest_archive(){return {site:'KDIX',elevations:[{number:1,angle:.5,products:[1]}]};},
    build_sweep_blob(){return new Uint8Array(pswp());},
    release_source(){},
  };
  const pipeline=new FramePipeline({cache,engine,diagnostics,fetchArrayBuffer:async()=>new Uint8Array(2048).buffer});
  const objectKey='2026/08/26/KDIX/KDIX20260826_220000_V06';
  await pipeline.load({site:'KDIX',objectKey,scanStartMs:1000,productId:1});
  assert.ok(events.some(e=>e.code==='ARCHIVE_FETCH_OK'&&e.context.byteLength===2048&&e.context.objectKey===objectKey));
  assert.ok(events.some(e=>e.code==='ARCHIVE_DECODE_OK'&&e.context.site==='KDIX'));
  assert.ok(events.some(e=>e.code==='SWEEP_READY'&&e.context.productId===1&&e.context.elevationNumber===1));
});
