import { ENGINE_API_VERSION, PSWP_VERSION } from '../config.js';
export const scanKey=(site,scanStartMs)=>`${site}|${scanStartMs}`;
export const sweepKey=(site,scanStartMs,elevationNumber,productId)=>`${site}|${scanStartMs}|${elevationNumber}|${productId}`;
const DB='personalnws-radar',VER=1;
function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}

export class MemoryRadarCache {
  constructor(){this.scans=new Map();this.sweeps=new Map();}
  async ensureVersion(){}
  async putScan(site,start,manifest){this.scans.set(scanKey(site,start),manifest);}
  async getScan(site,start){return this.scans.get(scanKey(site,start));}
  async putSweep(site,start,elev,product,buffer){this.sweeps.set(sweepKey(site,start,elev,product),buffer instanceof ArrayBuffer?buffer.slice(0):buffer);}
  async getSweep(site,start,elev,product){const buffer=this.sweeps.get(sweepKey(site,start,elev,product));return buffer instanceof ArrayBuffer?buffer.slice(0):buffer;}
}

export class RadarCache{
  constructor(db){this.db=db;}
  static async open(){
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable');
    const open=indexedDB.open(DB,VER);
    open.onupgradeneeded=()=>{const db=open.result;for(const n of ['scans','sweeps','meta'])if(!db.objectStoreNames.contains(n))db.createObjectStore(n);};
    const db=await req(open);const c=new RadarCache(db);await c.ensureVersion();return c;
  }
  store(name,mode='readonly'){return this.db.transaction(name,mode).objectStore(name);}
  async ensureVersion(){const meta=this.store('meta');const v=await req(meta.get('format'));if(!v||v.pswpVersion!==PSWP_VERSION||v.engineApiVersion!==ENGINE_API_VERSION){const tx=this.db.transaction(['scans','sweeps','meta'],'readwrite');tx.objectStore('scans').clear();tx.objectStore('sweeps').clear();tx.objectStore('meta').put({pswpVersion:PSWP_VERSION,engineApiVersion:ENGINE_API_VERSION},'format');await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}}
  async putScan(site,start,manifest){return req(this.store('scans','readwrite').put(manifest,scanKey(site,start)));}
  async getScan(site,start){return req(this.store('scans').get(scanKey(site,start)));}
  async putSweep(site,start,elev,product,buffer){return req(this.store('sweeps','readwrite').put(buffer,sweepKey(site,start,elev,product)));}
  async getSweep(site,start,elev,product){return req(this.store('sweeps').get(sweepKey(site,start,elev,product)));}
}

export async function openRadarCache({
  openPersistent = () => RadarCache.open(),
  onFallback = null,
  timeoutMs = 2_500,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  let timer = null;
  try {
    const persistent = Promise.resolve().then(() => openPersistent());
    if (!(timeoutMs > 0)) return await persistent;
    const timeout = new Promise((_, reject) => {
      timer = Reflect.apply(setTimeoutImpl, globalThis, [() => reject(Object.assign(
        new Error(`IndexedDB radar cache did not open within ${timeoutMs} ms`),
        { code: 'E_CACHE_OPEN_TIMEOUT', stage: 'cache', context: { timeoutMs } },
      )), timeoutMs]);
    });
    return await Promise.race([persistent, timeout]);
  } catch (error) {
    onFallback?.(error);
    return new MemoryRadarCache();
  } finally {
    if (timer != null) {
      try { Reflect.apply(clearTimeoutImpl, globalThis, [timer]); } catch {}
    }
  }
}
