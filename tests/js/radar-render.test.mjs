import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAzimuthLut, decodeRawValue, mercatorXY } from '../../src/render/radar-math.js';
import { RadarLayer } from '../../src/render/radar-layer.js';

test('azimuth LUT maps each tenth-degree bearing to nearest native radial',()=>{
  const az=new Float32Array([0,90,180,270]);
  const lut=buildAzimuthLut(az,10);
  assert.equal(lut[0],0);
  assert.equal(lut[900],1);
  assert.equal(lut[1800],2);
  assert.equal(lut[2700],3);
  assert.equal(lut[3500],0);
});

test('raw radar codes preserve sentinel states and convert using scale/offset',()=>{
  assert.deepEqual(decodeRawValue(0,2,66),{kind:'missing'});
  assert.deepEqual(decodeRawValue(1,2,66),{kind:'range-folded'});
  assert.deepEqual(decodeRawValue(100,2,66),{kind:'value',value:17});
});

test('mercator conversion places zero lat/lon at map center',()=>{
  const [x,y]=mercatorXY(0,0);
  assert.ok(Math.abs(x-.5)<1e-12);
  assert.ok(Math.abs(y-.5)<1e-12);
});


test('setFrame returns the parsed sweep after immediate GPU upload',()=>{
  const buffer=new ArrayBuffer(120);
  const bytes=new Uint8Array(buffer); bytes.set([80,83,87,80],0); // PSWP
  const d=new DataView(buffer);
  d.setUint16(4,1,true); d.setUint16(6,96,true); d.setUint16(8,1,true);
  d.setUint8(10,1); d.setUint8(11,1);
  d.setUint32(16,1,true); d.setUint32(20,1,true);
  d.setFloat64(24,0,true); d.setFloat64(32,.25,true); d.setFloat64(40,.25,true);
  d.setFloat32(48,2,true); d.setFloat32(52,66,true); d.setFloat32(56,.5,true);
  d.setUint32(80,96,true); d.setUint32(84,104,true); d.setUint32(88,112,true); d.setUint32(92,116,true);
  new Float32Array(buffer,96,1)[0]=0;
  new Float64Array(buffer,104,1)[0]=1;
  new Float32Array(buffer,112,1)[0]=.5;
  new Uint8Array(buffer,116,1)[0]=100;

  const gl={
    ARRAY_BUFFER:1,DYNAMIC_DRAW:2,TEXTURE_2D:3,TEXTURE_MIN_FILTER:4,TEXTURE_MAG_FILTER:5,
    TEXTURE_WRAP_S:6,TEXTURE_WRAP_T:7,NEAREST:8,CLAMP_TO_EDGE:9,UNPACK_ALIGNMENT:10,
    R8UI:11,RED_INTEGER:12,UNSIGNED_BYTE:13,R16UI:14,UNSIGNED_SHORT:15,
    bindBuffer(){},bufferData(){},bindTexture(){},texParameteri(){},pixelStorei(){},texImage2D(){},
  };
  const layer=new RadarLayer();
  layer.gl=gl; layer.buffer={}; layer.gateTexture={}; layer.lutTexture={};
  layer.map={triggerRepaint(){}};

  const sweep=layer.setFrame(buffer,{id:'KTLX',lat:35.3331,lon:-97.2775});
  assert.equal(sweep.productId,1);
  assert.equal(layer.sweep,sweep);
  assert.equal(layer.pending,null);
});

test('Level II radar layer can be hidden without discarding the decoded sweep',()=>{
  const layer=new RadarLayer();
  layer.sweep={radialCount:1};
  layer.site={id:'KDIX'};
  layer.setVisible(false);
  assert.equal(layer.visible,false);
  assert.equal(layer.sweep.radialCount,1);
  layer.setVisible(true);
  assert.equal(layer.visible,true);
});

function validSingleGateSweepBuffer() {
  const buffer = new ArrayBuffer(120);
  const bytes = new Uint8Array(buffer); bytes.set([80,83,87,80],0);
  const d = new DataView(buffer);
  d.setUint16(4,1,true); d.setUint16(6,96,true); d.setUint16(8,1,true);
  d.setUint8(10,1); d.setUint8(11,1);
  d.setUint32(16,1,true); d.setUint32(20,1,true);
  d.setFloat64(24,0,true); d.setFloat64(32,.25,true); d.setFloat64(40,.25,true);
  d.setFloat32(48,2,true); d.setFloat32(52,66,true); d.setFloat32(56,.5,true);
  d.setUint32(80,96,true); d.setUint32(84,104,true); d.setUint32(88,112,true); d.setUint32(92,116,true);
  new Float32Array(buffer,96,1)[0]=0;
  new Float64Array(buffer,104,1)[0]=1;
  new Float32Array(buffer,112,1)[0]=.5;
  new Uint8Array(buffer,116,1)[0]=100;
  return buffer;
}

test('GPU upload errors become structured radar diagnostics instead of silent glError state', () => {
  const events = [];
  const diagnostics = { record(level, stage, code, message, context = {}) { events.push({ level, stage, code, message, context }); } };
  const gl={
    ARRAY_BUFFER:1,DYNAMIC_DRAW:2,TEXTURE_2D:3,TEXTURE_MIN_FILTER:4,TEXTURE_MAG_FILTER:5,
    TEXTURE_WRAP_S:6,TEXTURE_WRAP_T:7,NEAREST:8,CLAMP_TO_EDGE:9,UNPACK_ALIGNMENT:10,
    R8UI:11,RED_INTEGER:12,UNSIGNED_BYTE:13,R16UI:14,UNSIGNED_SHORT:15,NO_ERROR:0,
    bindBuffer(){},bufferData(){},bindTexture(){},texParameteri(){},pixelStorei(){},texImage2D(){},
    getError(){ return 1285; },
  };
  const layer=new RadarLayer({ diagnostics });
  layer.gl=gl; layer.buffer={}; layer.gateTexture={}; layer.lutTexture={}; layer.map={triggerRepaint(){}};
  assert.throws(
    () => layer.setFrame(validSingleGateSweepBuffer(), {id:'KDIX',lat:39.95,lon:-74.41}, {productId:1,elevationNumber:1}),
    (error) => error?.code === 'E_GL_UPLOAD' && error?.stage === 'render' && error?.sourceId === 'KDIX',
  );
  assert.ok(events.some((event) => event.code === 'E_GL_UPLOAD' && event.context.site === 'KDIX'));
});

test('draw-time WebGL errors are logged with radar context without crashing MapLibre render loop', () => {
  const events = [];
  const diagnostics = { record(level, stage, code, message, context = {}) { events.push({ level, stage, code, message, context }); } };
  const layer = new RadarLayer({ diagnostics });
  layer.sweep = { firstGateKm: 0, gateIntervalKm: .25, maxRangeKm: 100, meanElevation: .5, scale: 2, offset: 66, gateCount: 100, productId: 1, elevationNumber: 1 };
  layer.site = { id: 'KDIX', lat: 39.95, lon: -74.41 };
  layer.program = {}; layer.buffer = {}; layer.gateTexture = {}; layer.lutTexture = {}; layer.aPos = 0;
  layer.uniforms = Object.fromEntries(['u_matrix','u_gates','u_azlut','u_site_lat','u_site_lon','u_first_gate','u_gate_interval','u_max_range','u_mean_elev','u_scale','u_offset','u_gate_count','u_product'].map((key) => [key, key]));
  const gl = {
    ARRAY_BUFFER:1,FLOAT:2,TEXTURE0:3,TEXTURE1:4,TEXTURE_2D:5,BLEND:6,SRC_ALPHA:7,ONE_MINUS_SRC_ALPHA:8,TRIANGLE_STRIP:9,
    useProgram(){},uniformMatrix4fv(){},bindBuffer(){},enableVertexAttribArray(){},vertexAttribPointer(){},activeTexture(){},bindTexture(){},uniform1i(){},uniform1f(){},enable(){},blendFunc(){},drawArrays(){},
    getError(){ return 1282; },
  };
  assert.doesNotThrow(() => layer.render(gl, { modelViewProjectionMatrix: new Float32Array(16) }));
  assert.equal(layer.lastGlError, 1282);
  assert.ok(events.some((event) => event.code === 'E_GL_RENDER' && event.context.site === 'KDIX' && event.context.glError === 1282));
});

test('shader compile failures are structured and recorded instead of generic WebGL errors', () => {
  const events = [];
  const diagnostics = { record(level, stage, code, message, context = {}) { events.push({ level, stage, code, message, context }); } };
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3,
    createProgram(){ return {}; }, createShader(){ return {}; }, shaderSource(){}, compileShader(){},
    getShaderParameter(){ return false; }, getShaderInfoLog(){ return 'bad shader'; }, deleteShader(){},
  };
  const layer = new RadarLayer({ diagnostics });
  assert.throws(
    () => layer.onAdd({}, gl),
    (error) => error?.code === 'E_GL_SHADER' && error?.stage === 'render' && error?.context?.shaderType === 'vertex',
  );
  assert.ok(events.some((event) => event.code === 'E_GL_SHADER' && event.context.shaderType === 'vertex'));
});

test('program link failures are structured and recorded instead of generic WebGL errors', () => {
  const events = [];
  const diagnostics = { record(level, stage, code, message, context = {}) { events.push({ level, stage, code, message, context }); } };
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader(type){ return { type }; }, shaderSource(){}, compileShader(){},
    getShaderParameter(){ return true; }, getShaderInfoLog(){ return ''; }, deleteShader(){},
    createProgram(){ return {}; }, attachShader(){}, linkProgram(){},
    getProgramParameter(){ return false; }, getProgramInfoLog(){ return 'bad link'; }, deleteProgram(){},
  };
  const layer = new RadarLayer({ diagnostics });
  assert.throws(
    () => layer.onAdd({}, gl),
    (error) => error?.code === 'E_GL_PROGRAM' && error?.stage === 'render',
  );
  assert.ok(events.some((event) => event.code === 'E_GL_PROGRAM'));
});
