import maplibregl, { type Map, type MapGeoJSONFeature } from 'maplibre-gl';

const STATIONS_URL = 'https://www.coast.noaa.gov/arcgis/rest/services/Hosted/WeatherRadarStations/FeatureServer/0/query?where=1%3D1&outFields=siteidentifier%2Csitename%2Cantennaelevation&returnGeometry=true&outSR=4326&f=geojson';

const FALLBACK_DATA = [
  ['KDOX',-75.4401,38.8258,'Dover AFB'],['KLWX',-77.4875,38.9754,'Sterling'],['KDIX',-74.4107,39.9469,'Philadelphia'],
  ['KCCX',-78.0037,40.9231,'State College'],['KAKQ',-77.0074,36.9839,'Wakefield'],['KFCX',-80.2742,37.0244,'Blacksburg'],
  ['KBGM',-75.9847,42.1997,'Binghamton'],['KBUF',-78.7369,42.9488,'Buffalo'],['KBOX',-71.1369,41.9558,'Boston'],
  ['KOKX',-72.8640,40.8650,'New York'],['KTLX',-97.2778,35.3331,'Oklahoma City'],['KFWS',-97.3031,32.5731,'Fort Worth'],
  ['KHGX',-95.0789,29.4719,'Houston'],['KLOT',-88.0848,41.6044,'Chicago'],['KFFC',-84.5659,33.3636,'Atlanta'],
  ['KTBW',-82.4018,27.7055,'Tampa'],['KAMX',-80.4130,25.6110,'Miami'],['KJAX',-81.7019,30.4846,'Jacksonville'],
  ['KDAX',-121.6778,38.5011,'Sacramento'],['KMUX',-121.8978,37.1552,'San Francisco'],['KVTX',-119.1786,34.4117,'Los Angeles'],
  ['KATX',-122.4957,48.1946,'Seattle']
] as const;

function fallbackCollection(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: FALLBACK_DATA.map(([id, lon, lat, name]) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { siteidentifier: id, sitename: name }
    }))
  };
}

async function fetchStations(): Promise<GeoJSON.FeatureCollection<GeoJSON.Point>> {
  try {
    const response = await fetch(STATIONS_URL, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`station catalog ${response.status}`);
    const data = await response.json() as GeoJSON.FeatureCollection<GeoJSON.Point>;
    const features = (data.features || []).filter(feature => {
      const id = String(feature.properties?.siteidentifier || '').toUpperCase();
      return id.length === 4 && feature.geometry?.type === 'Point';
    }).map(feature => ({
      ...feature,
      properties: { ...feature.properties, siteidentifier: String(feature.properties?.siteidentifier || '').toUpperCase() }
    }));
    if (features.length) return { type: 'FeatureCollection', features };
  } catch (error) {
    console.warn('[PNWS:STATIONS] Station catalog unavailable; using built-in fallback stations.', error);
  }
  return fallbackCollection();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[ch] ?? ch);
}

export interface SelectedStation { id: string; lon: number; lat: number; name: string; }
export interface RadarStationCallbacks {
  onSelect(station: SelectedStation): void;
  rememberedSite?: string | null;
}

export async function addRadarStations(map: Map, callbacks: RadarStationCallbacks): Promise<void> {
  const stations = await fetchStations();
  map.addSource('radars', { type: 'geojson', data: stations });
  map.addLayer({ id:'radar-sites', type:'circle', source:'radars', paint:{ 'circle-radius':4,'circle-color':'#08080a','circle-stroke-color':'#eeeef2','circle-stroke-width':1,'circle-opacity':0.95 } });
  map.addLayer({ id:'radar-active', type:'circle', source:'radars', filter:['==',['get','siteidentifier'],''], paint:{ 'circle-radius':6,'circle-color':'#8b5cf6','circle-stroke-color':'#ffffff','circle-stroke-width':1.2 } });
  map.addLayer({ id:'radar-site-labels', type:'symbol', source:'radars', minzoom:6, layout:{ 'text-field':['get','siteidentifier'],'text-size':9,'text-offset':[0,1.1],'text-anchor':'top','text-allow-overlap':false }, paint:{ 'text-color':'#ededf2','text-halo-color':'#050506','text-halo-width':1 } });

  const selectFeature = (feature: GeoJSON.Feature<GeoJSON.Point> | MapGeoJSONFeature, fly: boolean): void => {
    const id = String(feature.properties?.siteidentifier || '').toUpperCase();
    const coords = feature.geometry.type === 'Point' ? feature.geometry.coordinates : [];
    if (!id || coords.length < 2) return;
    const selected: SelectedStation = { id, lon:Number(coords[0]), lat:Number(coords[1]), name:String(feature.properties?.sitename || id) };
    if (map.getLayer('radar-active')) map.setFilter('radar-active', ['==',['get','siteidentifier'],id]);
    if (fly) {
      const currentZoom = map.getZoom();
      const targetZoom = currentZoom < 6.25 ? Math.min(6.25, currentZoom + 1.75) : currentZoom;
      map.easeTo({ center:[selected.lon,selected.lat], zoom:targetZoom, duration:500 });
    }
    new maplibregl.Popup({ closeButton:false, offset:8 }).setLngLat([selected.lon,selected.lat])
      .setHTML(`<div class="radar-popup"><strong>${escapeHtml(id)}</strong><br>${escapeHtml(selected.name)}</div>`).addTo(map);
    callbacks.onSelect(selected);
  };

  map.on('mouseenter','radar-sites',() => { map.getCanvas().style.cursor='pointer'; });
  map.on('mouseleave','radar-sites',() => { map.getCanvas().style.cursor=''; });
  map.on('click','radar-sites',event => { const f=event.features?.[0]; if (f) selectFeature(f, true); });

  if (callbacks.rememberedSite) {
    const remembered = stations.features.find(f => String(f.properties?.siteidentifier || '').toUpperCase() === callbacks.rememberedSite?.toUpperCase());
    if (remembered) selectFeature(remembered, false);
  }
}
