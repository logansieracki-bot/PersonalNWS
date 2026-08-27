import { readSweepBlob } from '../radar/blob-reader.js';
import { buildAzimuthLut, mercatorXY } from './radar-math.js';

const VS = `#version 300 es
precision highp float;
in vec2 a_pos;
uniform mat4 u_matrix;
out vec2 v_merc;
void main(){v_merc=a_pos;gl_Position=u_matrix*vec4(a_pos,0.0,1.0);}`;

const FS = `#version 300 es
precision highp float;
precision highp usampler2D;
in vec2 v_merc;
out vec4 fragColor;
uniform usampler2D u_gates;
uniform usampler2D u_azlut;
uniform float u_site_lat;
uniform float u_site_lon;
uniform float u_first_gate;
uniform float u_gate_interval;
uniform float u_max_range;
uniform float u_mean_elev;
uniform float u_scale;
uniform float u_offset;
uniform int u_gate_count;
uniform int u_product;
const float PI=3.141592653589793;
const float DEG=57.29577951308232;
const float EARTH_KM=6371.0088;

float invMercLat(float y){return atan(sinh(PI*(1.0-2.0*y)));}
float invMercLon(float x){return (x*360.0-180.0)/DEG;}

vec4 refColor(float v){
  if(v<5.0)return vec4(0.0);
  if(v<15.0)return vec4(0.05,0.55,0.95,.62);
  if(v<25.0)return vec4(0.05,0.80,0.40,.68);
  if(v<35.0)return vec4(0.18,0.95,0.12,.72);
  if(v<45.0)return vec4(0.95,0.90,0.05,.76);
  if(v<55.0)return vec4(1.0,0.45,0.03,.82);
  if(v<65.0)return vec4(0.95,0.03,0.08,.86);
  if(v<75.0)return vec4(0.72,0.05,0.80,.90);
  return vec4(1.0,0.80,1.0,.94);
}
vec4 velocityColor(float v){float t=clamp(abs(v)/45.0,0.0,1.0);if(v<0.0)return vec4(0.10,0.95*t,0.35+0.4*t,.82);return vec4(0.95*t,0.12,0.20+0.3*t,.82);}
vec4 colorFor(float v){
  if(u_product==1)return refColor(v);
  if(u_product==2)return velocityColor(v);
  if(u_product==3){float t=clamp(v/20.0,0.0,1.0);return vec4(.25+.65*t,.18+.2*t,.8,.78);}
  if(u_product==4){float t=clamp((v+2.0)/8.0,0.0,1.0);return vec4(t,1.0-t,.85,.80);}
  if(u_product==5){float t=clamp((v-.65)/.35,0.0,1.0);return vec4(1.0-t,.2+.75*t,.9*t,.80);}
  float t=fract(v/360.0);return vec4(.5+.5*cos(6.28318*(t+0.0)),.5+.5*cos(6.28318*(t+.33)),.5+.5*cos(6.28318*(t+.66)),.78);
}
void main(){
  float lat=invMercLat(v_merc.y), lon=invMercLon(v_merc.x);
  float dlat=lat-u_site_lat, dlon=lon-u_site_lon;
  float a=sin(dlat*.5)*sin(dlat*.5)+cos(u_site_lat)*cos(lat)*sin(dlon*.5)*sin(dlon*.5);
  float ground=EARTH_KM*2.0*atan(sqrt(max(a,0.0)),sqrt(max(1.0-a,0.0)));
  float cosElev=max(cos(u_mean_elev),0.2);
  float slant=ground/cosElev;
  if(slant<u_first_gate||slant>=u_max_range)discard;
  float yy=sin(dlon)*cos(lat);
  float xx=cos(u_site_lat)*sin(lat)-sin(u_site_lat)*cos(lat)*cos(dlon);
  float bearing=atan(yy,xx)*DEG;if(bearing<0.0)bearing+=360.0;
  int lutIndex=int(floor(bearing*10.0+.5))%3600;
  int radial=int(texelFetch(u_azlut,ivec2(lutIndex,0),0).r);
  int gate=int(floor((slant-u_first_gate)/u_gate_interval));
  if(gate<0||gate>=u_gate_count)discard;
  uint raw=texelFetch(u_gates,ivec2(gate,radial),0).r;
  if(raw<=1u)discard;
  float physical=(float(raw)-u_offset)/u_scale;
  fragColor=colorFor(physical);
}`;

function shader(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const log=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(`radar shader compile failed: ${log}`);}return s;}
function program(gl){const p=gl.createProgram(),v=shader(gl,gl.VERTEX_SHADER,VS),f=shader(gl,gl.FRAGMENT_SHADER,FS);gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const log=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error(`radar program link failed: ${log}`);}return p;}
function bbox(site,km){const latDelta=km/110.574;const lonDelta=km/(111.320*Math.max(.15,Math.cos(site.lat*Math.PI/180)));const south=Math.max(-85,site.lat-latDelta),north=Math.min(85,site.lat+latDelta);const west=site.lon-lonDelta,east=site.lon+lonDelta;const [xw,yn]=mercatorXY(west,north),[xe,ys]=mercatorXY(east,south);return new Float32Array([xw,yn,xe,yn,xw,ys,xe,ys]);}

export class RadarLayer {
  constructor(){this.id='personalnws-radar';this.type='custom';this.renderingMode='2d';this.pending=null;this.sweep=null;this.site=null;this.gl=null;this.map=null;this.renderCount=0;this.lastGlError=0;this.visible=true;}
  setVisible(visible){this.visible=Boolean(visible);this.map?.triggerRepaint();}
  onAdd(map,gl){if(typeof WebGL2RenderingContext!=='undefined'&&!(gl instanceof WebGL2RenderingContext))throw new Error('PersonalNWS radar requires WebGL2');this.map=map;this.gl=gl;this.program=program(gl);this.buffer=gl.createBuffer();this.gateTexture=gl.createTexture();this.lutTexture=gl.createTexture();this.aPos=gl.getAttribLocation(this.program,'a_pos');this.uniforms=Object.fromEntries(['u_matrix','u_gates','u_azlut','u_site_lat','u_site_lon','u_first_gate','u_gate_interval','u_max_range','u_mean_elev','u_scale','u_offset','u_gate_count','u_product'].map(n=>[n,gl.getUniformLocation(this.program,n)]));if(this.pending)this.#upload();}
  setFrame(buffer,site){const sweep=readSweepBlob(buffer);this.pending={sweep,site};if(this.gl)this.#upload();this.map?.triggerRepaint();return sweep;}
  #upload(){const gl=this.gl,{sweep,site}=this.pending;this.pending=null;this.sweep=sweep;this.site=site;const verts=bbox(site,sweep.maxRangeKm);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,verts,gl.DYNAMIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D,this.gateTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    if(sweep.wordBytes===1)gl.texImage2D(gl.TEXTURE_2D,0,gl.R8UI,sweep.gateCount,sweep.radialCount,0,gl.RED_INTEGER,gl.UNSIGNED_BYTE,sweep.gates);else gl.texImage2D(gl.TEXTURE_2D,0,gl.R16UI,sweep.gateCount,sweep.radialCount,0,gl.RED_INTEGER,gl.UNSIGNED_SHORT,sweep.gates);
    const lut=buildAzimuthLut(sweep.azimuths,10);gl.bindTexture(gl.TEXTURE_2D,this.lutTexture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.R16UI,3600,1,0,gl.RED_INTEGER,gl.UNSIGNED_SHORT,lut);
  }
  render(gl,args){if(!this.visible||!this.sweep||!this.site)return;const matrix=args?.defaultProjectionData?.mainMatrix??args?.modelViewProjectionMatrix;if(!matrix)return;const s=this.sweep;gl.useProgram(this.program);gl.uniformMatrix4fv(this.uniforms.u_matrix,false,matrix);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.enableVertexAttribArray(this.aPos);gl.vertexAttribPointer(this.aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.gateTexture);gl.uniform1i(this.uniforms.u_gates,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.lutTexture);gl.uniform1i(this.uniforms.u_azlut,1);
    gl.uniform1f(this.uniforms.u_site_lat,this.site.lat*Math.PI/180);gl.uniform1f(this.uniforms.u_site_lon,this.site.lon*Math.PI/180);gl.uniform1f(this.uniforms.u_first_gate,s.firstGateKm);gl.uniform1f(this.uniforms.u_gate_interval,s.gateIntervalKm);gl.uniform1f(this.uniforms.u_max_range,s.maxRangeKm);gl.uniform1f(this.uniforms.u_mean_elev,s.meanElevation*Math.PI/180);gl.uniform1f(this.uniforms.u_scale,s.scale);gl.uniform1f(this.uniforms.u_offset,s.offset);gl.uniform1i(this.uniforms.u_gate_count,s.gateCount);gl.uniform1i(this.uniforms.u_product,s.productId);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);this.renderCount++;this.lastGlError=gl.getError();
  }
  onRemove(_map,gl){for(const x of [this.buffer,this.gateTexture,this.lutTexture,this.program])if(x){if(x===this.buffer)gl.deleteBuffer(x);else if(x===this.program)gl.deleteProgram(x);else gl.deleteTexture(x);}}
}
