import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from '../../src/app-controller.js';

test('selectSite requests a real latest frame and sends it to renderer/UI', async()=>{
  const calls=[];
  const frame={buffer:new ArrayBuffer(10),manifest:{site:'KTLX',vcp:212,elevations:[{number:1,angle:.5,products:[1]}]},elevationNumber:1,productId:1,scanStartMs:123};
  const priority={request:async(type,payload)=>{calls.push(['request',type,payload]);return {frames:[{site:'KTLX',objectKey:'k',scanStartMs:123}],frame};}};
  const ui={busy:(s)=>calls.push(['busy',s]),site:(s)=>calls.push(['site',s.id]),manifest:(m,e,p)=>calls.push(['manifest',m.site,e,p]),timeline:(frames,index)=>calls.push(['timeline',frames.length,index]),error:e=>calls.push(['error',e])};
  const renderer={setFrame:(buffer,site)=>calls.push(['render',buffer.byteLength,site.id])};
  const app=new AppController({priority,ui,renderer,productId:1});
  await app.selectSite({id:'KTLX',lat:35.33,lon:-97.27,name:'Oklahoma City'});
  assert.equal(calls.find(x=>x[0]==='request')[1],'SELECT_SITE');
  assert.ok(calls.some(x=>x[0]==='render'&&x[1]===10));
  assert.ok(calls.some(x=>x[0]==='manifest'&&x[1]==='KTLX'));
  assert.equal(app.frames.length,1);
  assert.equal(app.currentIndex,0);
});

test('loadIndex requests the exact cached/archive descriptor and selected cut/product', async()=>{
  const calls=[];
  const frame={buffer:new ArrayBuffer(4),manifest:{site:'KTLX',elevations:[{number:2,angle:.9,products:[2]}]},elevationNumber:2,productId:2};
  const priority={request:async(type,payload)=>{calls.push([type,payload]);return frame;}};
  const app=new AppController({priority,ui:{busy(){},site(){},manifest(){},timeline(){},error(){}},renderer:{setFrame(){}}});
  app.site={id:'KTLX',lat:1,lon:2}; app.frames=[{site:'KTLX',objectKey:'obj',scanStartMs:55}]; app.productId=2; app.elevationNumber=2;
  await app.loadIndex(0);
  assert.deepEqual(calls[0],['LOAD_FRAME',{site:'KTLX',objectKey:'obj',scanStartMs:55,elevationNumber:2,productId:2}]);
});


test('selectSite starts background history after latest frame is visible', async()=>{
  const historyCalls=[];
  const frame={buffer:new ArrayBuffer(2),manifest:{site:'KTLX',elevations:[{number:1,angle:.5,products:[1]}]},elevationNumber:1,productId:1};
  const priority={request:async()=>({frames:[{site:'KTLX',objectKey:'a',scanStartMs:1}],frame})};
  const history={request:async(type,payload)=>{historyCalls.push([type,payload]);return {done:1,total:1};}};
  const app=new AppController({priority,history,ui:{busy(){},site(){},manifest(){},timeline(){},error(){}},renderer:{setFrame(){}}});
  await app.selectSite({id:'KTLX',lat:1,lon:2,name:'x'});
  await new Promise(r=>setTimeout(r,0));
  assert.equal(historyCalls[0][0],'START_HISTORY');
  assert.equal(historyCalls[0][1].site,'KTLX');
});

test('first visible frame can trigger lazy history initialization without delaying render', async()=>{
  const order=[];
  let release;
  const gate=new Promise(r=>{release=r;});
  const frame={buffer:new ArrayBuffer(2),manifest:{site:'KTLX',elevations:[{number:1,angle:.5,products:[1]}]},elevationNumber:1,productId:1};
  const priority={request:async()=>({frames:[{site:'KTLX',objectKey:'a',scanStartMs:1}],frame})};
  const app=new AppController({
    priority,
    ui:{busy(){},site(){},manifest(){},timeline(){},error(){}},
    renderer:{setFrame(){order.push('render');}},
    onFirstFrame:async()=>{order.push('history-init');await gate;},
  });
  await app.selectSite({id:'KTLX',lat:1,lon:2,name:'x'});
  assert.deepEqual(order,['render','history-init']);
  release();
});
