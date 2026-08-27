export const COMMANDS=Object.freeze({INIT:'INIT',SELECT_SITE:'SELECT_SITE',LOAD_FRAME:'LOAD_FRAME',SET_PRODUCT_ELEVATION:'SET_PRODUCT_ELEVATION',START_HISTORY:'START_HISTORY',START_LIVE:'START_LIVE',STOP_SITE:'STOP_SITE',PING:'PING'});
export const EVENTS=Object.freeze({READY:'READY',SITE_READY:'SITE_READY',FRAME_READY:'FRAME_READY',TIMELINE_UPDATE:'TIMELINE_UPDATE',CACHE_PROGRESS:'CACHE_PROGRESS',LIVE_DELTA:'LIVE_DELTA',DIAGNOSTIC:'DIAGNOSTIC',METRICS:'METRICS',PONG:'PONG'});
export function validateCommand(msg){
  if(!msg||typeof msg.type!=='string')throw new Error('worker command missing type');
  if(!Object.values(COMMANDS).includes(msg.type))throw new Error(`unknown worker command ${msg.type}`);
  if(msg.type===COMMANDS.LOAD_FRAME){
    const p=msg.payload??{};
    for(const k of ['site','objectKey','scanStartMs','productId'])if(p[k]===undefined||p[k]===null||p[k]==='')throw new Error(`LOAD_FRAME missing ${k}`);
    // elevationNumber is intentionally optional/null: FramePipeline can choose
    // the first cut that actually contains the requested product.
  }
  return msg;
}
