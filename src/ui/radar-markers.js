const SOURCE='personalnws-radars',LAYER='personalnws-radar-markers';
export function installRadarMarkers(map,sites,onSelect){
  const data={type:'FeatureCollection',features:sites.map(s=>({type:'Feature',geometry:{type:'Point',coordinates:[s.lon,s.lat]},properties:{id:s.id,name:s.name}}))};
  if(map.getLayer(LAYER))map.removeLayer(LAYER);if(map.getSource(SOURCE))map.removeSource(SOURCE);
  map.addSource(SOURCE,{type:'geojson',data});
  map.addLayer({id:LAYER,type:'circle',source:SOURCE,paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,3,7,5,10,7],'circle-color':'#9d6eff','circle-stroke-color':'#08080b','circle-stroke-width':1.2,'circle-opacity':.86}});
  map.on('mouseenter',LAYER,()=>map.getCanvas().style.cursor='pointer');
  map.on('mouseleave',LAYER,()=>map.getCanvas().style.cursor='');
  map.on('click',LAYER,e=>{const id=e.features?.[0]?.properties?.id;const site=sites.find(s=>s.id===id);if(site)onSelect(site);});
}
