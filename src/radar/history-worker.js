import { openRadarCache } from './cache.js';
import { loadRadarDecoder } from './wasm-loader.js';
import { FramePipeline } from './frame-pipeline.js';
import { fetchArrayBufferWithRetry } from './network.js';

let engine, cache, pipeline;
function post(msg, transfer=[]){self.postMessage(msg,transfer);}
function metric(level, stage, code, message, context = {}, error = null) {
  post({ type: 'METRICS', payload: {
    level, stage, code, message, context,
    ...(error ? { error: { code: error?.code, stage: error?.stage, sourceId: error?.sourceId, message: error?.message, detail: error?.detail ?? error?.stack } } : {}),
  } });
}
const diagnostics={record:metric};
function err(e){return {code:e?.code??'E_HISTORY',stage:e?.stage??'history',sourceId:e?.sourceId??'',message:String(e?.message??e),detail:String(e?.detail??e?.stack??e),context:e?.context??{}};}
async function fetchArrayBuffer(url){return fetchArrayBufferWithRetry(url);}
self.onmessage=async({data:m})=>{try{
  if(m.type==='INIT'){
    const started=Date.now();metric('info','history','HISTORY_INIT_START','Initializing history worker',{decoderBase:m.payload.decoderBase});
    const {RadarEngine}=await loadRadarDecoder(m.payload.decoderBase);engine=new RadarEngine();cache=await openRadarCache({ onFallback: (error) => metric('warn','cache','CACHE_MEMORY_FALLBACK','IndexedDB unavailable; using memory cache',{},error) });pipeline=new FramePipeline({cache,engine,fetchArrayBuffer,diagnostics});metric('info','history','HISTORY_INIT_READY','History worker ready',{elapsedMs:Date.now()-started});post({replyTo:m.id,ok:true,payload:{role:'history',decoder:'ready'}});return;
  }
  if(m.type==='START_HISTORY'){
    const {frames=[],site,productId=1,elevationNumber=null}=m.payload;let done=0;const started=Date.now();metric('info','history','HISTORY_START',`Backfilling ${frames.length} frames for ${site}`,{site,productId,elevationNumber,total:frames.length});
    for(let i=frames.length-1;i>=0;i--){const f=frames[i];try{await pipeline.load({site,objectKey:f.objectKey,scanStartMs:f.scanStartMs,elevationNumber,productId});}catch(e){post({type:'DIAGNOSTIC',payload:err(e)});}done++;post({type:'CACHE_PROGRESS',payload:{done,total:frames.length}});await new Promise(r=>setTimeout(r,0));}
    metric('info','history','HISTORY_DONE',`History backfill complete for ${site}`,{site,done,total:frames.length,elapsedMs:Date.now()-started});post({replyTo:m.id,ok:true,payload:{done,total:frames.length}});return;
  }
  throw Object.assign(new Error(`unsupported history command ${m.type}`),{code:'E_PROTOCOL',stage:'history'});
}catch(e){metric('error',e?.stage??'history',e?.code??'E_HISTORY',e?.message??'History worker command failed',{command:m?.type??'',sourceId:e?.sourceId??''},e);post({replyTo:m?.id,ok:false,error:err(e)});}};
