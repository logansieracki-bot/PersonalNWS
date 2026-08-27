import test from 'node:test';
import assert from 'node:assert/strict';
import { readSweepBlob } from '../../src/radar/blob-reader.js';

function fixture(wordBytes = 1) {
  const radialCount = 2, gateCount = 3, header = 96;
  const azOff = header, timeOff = 104, elevOff = 120, gateOff = 128;
  const buf = new ArrayBuffer(gateOff + radialCount * gateCount * wordBytes);
  const d = new DataView(buf);
  for (const [i,c] of [...'PSWP'].entries()) d.setUint8(i,c.charCodeAt(0));
  d.setUint16(4,1,true); d.setUint16(6,96,true); d.setUint16(8,1,true);
  d.setUint8(10,1); d.setUint8(11,wordBytes); d.setUint32(16,radialCount,true); d.setUint32(20,gateCount,true);
  d.setFloat64(24,0.0,true); d.setFloat64(32,0.25,true); d.setFloat64(40,0.75,true);
  d.setFloat32(48,2,true); d.setFloat32(52,66,true); d.setFloat32(56,0.5,true);
  d.setFloat64(64,1000,true); d.setFloat64(72,2000,true);
  d.setUint32(80,azOff,true); d.setUint32(84,timeOff,true); d.setUint32(88,elevOff,true); d.setUint32(92,gateOff,true);
  new Float32Array(buf,azOff,2).set([0,180]); new Float64Array(buf,timeOff,2).set([1000,2000]); new Float32Array(buf,elevOff,2).set([.5,.5]);
  if(wordBytes===1) new Uint8Array(buf,gateOff,6).set([0,1,100,2,3,4]);
  else new Uint16Array(buf,gateOff,6).set([0,1,500,2,3,4]);
  return buf;
}

test('reads PSWP v1 zero-copy views',()=>{
  const s=readSweepBlob(fixture(1));
  assert.equal(s.magic,'PSWP'); assert.equal(s.version,1); assert.equal(s.radialCount,2); assert.equal(s.gateCount,3);
  assert.ok(s.azimuths instanceof Float32Array); assert.ok(s.radialTimes instanceof Float64Array); assert.ok(s.gates instanceof Uint8Array);
  assert.equal(s.gates[2],100);
});

test('reads 16-bit gates',()=>{ assert.ok(readSweepBlob(fixture(2)).gates instanceof Uint16Array); });
test('rejects truncation',()=>{ assert.throws(()=>readSweepBlob(fixture(1).slice(0,100)),/bounds|truncated/i); });
