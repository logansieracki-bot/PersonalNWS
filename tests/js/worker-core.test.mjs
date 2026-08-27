import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerCore } from '../../src/radar/worker-core.js';

test('WorkerCore has one responsibility: forward LOAD_FRAME to the frame pipeline', async()=>{
  const calls=[];
  const pipeline={load:async req=>{calls.push(req);return {buffer:new ArrayBuffer(8),productId:req.productId};}};
  const core=new WorkerCore({role:'priority',pipeline});
  const request={site:'KDIX',objectKey:'x',scanStartMs:1,elevationNumber:null,productId:1};
  const frame=await core.loadFrame(request);
  assert.deepEqual(calls,[request]);
  assert.equal(frame.productId,1);
});
