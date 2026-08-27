import { PRODUCT_LABELS } from '../config.js';
import { clearDiagnostic, showDiagnostic } from '../diagnostics.js';

export function decorateFrameTime(label, { live = false, syncing = false } = {}) {
  if (live && syncing) return 'LIVE · syncing…';
  return live ? `LIVE · ${label}` : label;
}

export function createUI(doc=document){
  const $=id=>doc.getElementById(id);
  const clearError=()=>{$('dot')?.classList.remove('bad');clearDiagnostic();};
  return {
    clearError,
    busy(on){$('dot')?.classList.toggle('live',!on);if(on&&$('detail')){$('detail').textContent='loading radar…';}},
    site(site){if($('site'))$('site').textContent=`${site.id} · ${site.name}`;},
    preparedRadar(productId){
      clearError();
      const tilt=$('tilt');
      if(tilt){
        tilt.innerHTML='';
        const o=doc.createElement('option');
        o.value='0';o.textContent='0.5° · live';o.selected=true;tilt.appendChild(o);
      }
      const product=$('product');
      if(product){for(const o of product.options)o.disabled=false;product.value=String(productId);}
      const detail=$('detail');
      if(detail)detail.textContent=`NWS live · 0.5° · ${PRODUCT_LABELS[productId]??productId}`;
      $('dot')?.classList.add('live');
    },
    manifest(manifest,elevationNumber,productId){
      clearError();
      const tilt=$('tilt');
      if(tilt){
        tilt.innerHTML='';
        const counts=new Map();for(const e of manifest?.elevations??[]){const k=Number(e.angle).toFixed(1);counts.set(k,(counts.get(k)||0)+1);}
        const seen=new Map();
        for(const e of manifest?.elevations??[]){const k=Number(e.angle).toFixed(1);const n=(seen.get(k)||0)+1;seen.set(k,n);const o=doc.createElement('option');o.value=String(e.number);o.textContent=counts.get(k)>1?`${k}° · cut ${n}`:`${k}°`;o.selected=Number(e.number)===Number(elevationNumber);tilt.appendChild(o);}
      }
      const selected=(manifest?.elevations??[]).find(e=>Number(e.number)===Number(elevationNumber));
      const product=$('product');
      if(product){for(const o of product.options)o.disabled=!(selected?.products??[]).includes(Number(o.value));product.value=String(productId);}
      const vcp=manifest?.vcp?`VCP ${manifest.vcp}`:'Level II';
      const detail=$('detail');if(detail)detail.textContent=`${vcp} · ${selected?.angle?.toFixed?.(2)??'—'}° · ${selected?.radialCount??0} radials · ${PRODUCT_LABELS[productId]??productId}`;
      $('dot')?.classList.add('live');
    },
    timeline(frames,index,options={}){
      const slider=$('timeline');if(slider){slider.max=String(Math.max(0,frames.length-1));slider.value=String(index);}
      const fmt=ms=>Number.isFinite(ms)?new Date(ms).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'—';
      if($('timeLeft'))$('timeLeft').textContent=frames.length?fmt(frames[0].scanStartMs):'—';
      const current=frames[index]?fmt(frames[index].scanStartMs):'—';
      if($('timeNow'))$('timeNow').textContent=decorateFrameTime(current,{live:Boolean(options.live),syncing:Boolean(options.syncing)&&!frames[index]});
      if($('timeRight'))$('timeRight').textContent=frames.length?fmt(frames[frames.length-1].scanStartMs):'—';
      if($('history'))$('history').textContent=frames.length?`· ${frames.length} frames`:'';
    },
    cacheProgress(done,total){const bar=$('cacheProgress')?.firstElementChild;if(bar)bar.style.width=total?`${Math.round(done/total*100)}%`:'0%';},
    error(error){$('dot')?.classList.add('bad');showDiagnostic(error);},
    setStream(text){if($('stream'))$('stream').textContent=text;},
  };
}
