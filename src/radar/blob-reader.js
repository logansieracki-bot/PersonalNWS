const HEADER_SIZE = 96;
function ascii4(view){return String.fromCharCode(view.getUint8(0),view.getUint8(1),view.getUint8(2),view.getUint8(3));}
function need(ok,msg){if(!ok) throw new Error(`PSWP ${msg}`);}
export function readSweepBlob(buffer){
  need(buffer instanceof ArrayBuffer,'requires ArrayBuffer'); need(buffer.byteLength>=HEADER_SIZE,'truncated header');
  const d=new DataView(buffer); const magic=ascii4(d); need(magic==='PSWP','bad magic');
  const version=d.getUint16(4,true), headerSize=d.getUint16(6,true); need(version===1,`unsupported version ${version}`); need(headerSize===HEADER_SIZE,`header size ${headerSize}`);
  const productId=d.getUint16(8,true), elevationNumber=d.getUint8(10), wordBytes=d.getUint8(11), flags=d.getUint32(12,true), radialCount=d.getUint32(16,true), gateCount=d.getUint32(20,true);
  need(wordBytes===1||wordBytes===2,`word size ${wordBytes}`);
  const firstGateKm=d.getFloat64(24,true), gateIntervalKm=d.getFloat64(32,true), maxRangeKm=d.getFloat64(40,true), scale=d.getFloat32(48,true), offset=d.getFloat32(52,true), meanElevation=d.getFloat32(56,true), nominalAzimuthSpacing=d.getFloat32(60,true), sweepStartMs=d.getFloat64(64,true), sweepEndMs=d.getFloat64(72,true);
  const azimuthOffset=d.getUint32(80,true), radialTimeOffset=d.getUint32(84,true), radialElevationOffset=d.getUint32(88,true), gateDataOffset=d.getUint32(92,true);
  const azEnd=azimuthOffset+radialCount*4, tEnd=radialTimeOffset+radialCount*8, eEnd=radialElevationOffset+radialCount*4, gEnd=gateDataOffset+radialCount*gateCount*wordBytes;
  need(azimuthOffset%4===0&&radialTimeOffset%8===0&&radialElevationOffset%4===0&&gateDataOffset%wordBytes===0,'misaligned offsets');
  need(Math.max(azEnd,tEnd,eEnd,gEnd)<=buffer.byteLength,'array bounds exceed buffer / truncated blob');
  const azimuths=new Float32Array(buffer,azimuthOffset,radialCount), radialTimes=new Float64Array(buffer,radialTimeOffset,radialCount), radialElevations=new Float32Array(buffer,radialElevationOffset,radialCount);
  const gates=wordBytes===1?new Uint8Array(buffer,gateDataOffset,radialCount*gateCount):new Uint16Array(buffer,gateDataOffset,radialCount*gateCount);
  return {buffer,magic,version,productId,elevationNumber,wordBytes,flags,radialCount,gateCount,firstGateKm,gateIntervalKm,maxRangeKm,scale,offset,meanElevation,nominalAzimuthSpacing,sweepStartMs,sweepEndMs,azimuths,radialTimes,radialElevations,gates};
}
