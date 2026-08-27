const HEADER_SIZE = 96;
function ascii4(view){return String.fromCharCode(view.getUint8(0),view.getUint8(1),view.getUint8(2),view.getUint8(3));}
function need(ok,msg){if(!ok) throw new Error(`PSWP ${msg}`);}
function finite(value,name){need(Number.isFinite(value),`${name} must be finite`);return value;}
export function readSweepBlob(buffer){
  need(buffer instanceof ArrayBuffer,'requires ArrayBuffer'); need(buffer.byteLength>=HEADER_SIZE,'truncated header');
  const d=new DataView(buffer); const magic=ascii4(d); need(magic==='PSWP','bad magic');
  const version=d.getUint16(4,true), headerSize=d.getUint16(6,true); need(version===1,`unsupported version ${version}`); need(headerSize===HEADER_SIZE,`header size ${headerSize}`);
  const productId=d.getUint16(8,true), elevationNumber=d.getUint8(10), wordBytes=d.getUint8(11), flags=d.getUint32(12,true), radialCount=d.getUint32(16,true), gateCount=d.getUint32(20,true);
  need(wordBytes===1||wordBytes===2,`word size ${wordBytes}`);
  need(radialCount>0,`radial count must be positive (got ${radialCount})`);
  need(gateCount>0,`gate count must be positive (got ${gateCount})`);
  const firstGateKm=finite(d.getFloat64(24,true),'first gate'), gateIntervalKm=finite(d.getFloat64(32,true),'gate interval'), maxRangeKm=finite(d.getFloat64(40,true),'max range'), scale=finite(d.getFloat32(48,true),'scale'), offset=finite(d.getFloat32(52,true),'offset'), meanElevation=finite(d.getFloat32(56,true),'mean elevation'), nominalAzimuthSpacing=finite(d.getFloat32(60,true),'azimuth spacing'), sweepStartMs=finite(d.getFloat64(64,true),'sweep start'), sweepEndMs=finite(d.getFloat64(72,true),'sweep end');
  need(firstGateKm>=0,`first gate must be non-negative (got ${firstGateKm})`);
  need(gateIntervalKm>0,`gate interval must be positive (got ${gateIntervalKm})`);
  need(maxRangeKm>firstGateKm,`max range must exceed first gate (got ${maxRangeKm})`);
  need(scale!==0,`scale must be non-zero`);
  const azimuthOffset=d.getUint32(80,true), radialTimeOffset=d.getUint32(84,true), radialElevationOffset=d.getUint32(88,true), gateDataOffset=d.getUint32(92,true);
  const gateCells=radialCount*gateCount, gateBytes=gateCells*wordBytes;
  need(Number.isSafeInteger(gateCells)&&Number.isSafeInteger(gateBytes),'array size overflow');
  const azEnd=azimuthOffset+radialCount*4, tEnd=radialTimeOffset+radialCount*8, eEnd=radialElevationOffset+radialCount*4, gEnd=gateDataOffset+gateBytes;
  need([azEnd,tEnd,eEnd,gEnd].every(Number.isSafeInteger),'array offset overflow');
  need(azimuthOffset>=HEADER_SIZE,'azimuth array overlaps header');
  need(radialTimeOffset>=azEnd,'radial time array overlaps azimuth array');
  need(radialElevationOffset>=tEnd,'radial elevation array overlaps time array');
  need(gateDataOffset>=eEnd,'gate array overlaps elevation array');
  need(azimuthOffset%4===0&&radialTimeOffset%8===0&&radialElevationOffset%4===0&&gateDataOffset%wordBytes===0,'misaligned offsets');
  need(Math.max(azEnd,tEnd,eEnd,gEnd)<=buffer.byteLength,'array bounds exceed buffer / truncated blob');
  const azimuths=new Float32Array(buffer,azimuthOffset,radialCount), radialTimes=new Float64Array(buffer,radialTimeOffset,radialCount), radialElevations=new Float32Array(buffer,radialElevationOffset,radialCount);
  const gates=wordBytes===1?new Uint8Array(buffer,gateDataOffset,gateCells):new Uint16Array(buffer,gateDataOffset,gateCells);
  return {buffer,magic,version,productId,elevationNumber,wordBytes,flags,radialCount,gateCount,firstGateKm,gateIntervalKm,maxRangeKm,scale,offset,meanElevation,nominalAzimuthSpacing,sweepStartMs,sweepEndMs,azimuths,radialTimes,radialElevations,gates};
}
