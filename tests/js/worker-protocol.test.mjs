import test from 'node:test';import assert from 'node:assert/strict';import {COMMANDS,EVENTS,validateCommand} from '../../src/radar/worker-protocol.js';
test('protocol command/event names are frozen',()=>{assert.equal(COMMANDS.LOAD_FRAME,'LOAD_FRAME');assert.equal(EVENTS.DIAGNOSTIC,'DIAGNOSTIC');});
test('LOAD_FRAME validates required fields while allowing automatic elevation choice',()=>{assert.throws(()=>validateCommand({type:'LOAD_FRAME',payload:{}}),/site/);assert.throws(()=>validateCommand({type:'LOAD_FRAME',payload:{site:'KDOX',scanStartMs:1,productId:1}}),/objectKey/);assert.doesNotThrow(()=>validateCommand({type:'LOAD_FRAME',payload:{site:'KDOX',objectKey:'key',scanStartMs:1,elevationNumber:null,productId:1}}));});
test('worker protocol only advertises implemented commands and includes history cancellation',()=>{
  assert.equal(COMMANDS.CANCEL_HISTORY,'CANCEL_HISTORY');
  assert.equal(COMMANDS.START_LIVE,undefined);
  assert.equal(COMMANDS.STOP_SITE,undefined);
  assert.equal(COMMANDS.SET_PRODUCT_ELEVATION,undefined);
});

test('priority worker protocol does not advertise the obsolete duplicate SELECT_SITE listing path', () => {
  assert.equal(COMMANDS.SELECT_SITE, undefined);
});
