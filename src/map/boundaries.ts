import type maplibregl from 'maplibre-gl';

const CWA_URL = 'https://mapservices.weather.noaa.gov/static/rest/services/nws_reference_maps/nws_reference_map/FeatureServer/1/query?where=1%3D1&outFields=cwa%2Cwfo%2Ccitystate&returnGeometry=true&outSR=4326&geometryPrecision=4&f=geojson';

function firstSymbolLayerId(map: maplibregl.Map): string | undefined {
  return (map.getStyle().layers || []).find(layer => layer.type === 'symbol')?.id;
}

function boundaryVectorSource(map: maplibregl.Map): string | null {
  const layer = (map.getStyle().layers || []).find(layer => {
    const candidate = layer as typeof layer & { 'source-layer'?: string; source?: string };
    return layer.type === 'line' && candidate['source-layer'] === 'boundary' && candidate.source;
  }) as (maplibregl.LayerSpecification & { source?: string }) | undefined;
  return typeof layer?.source === 'string' ? layer.source : null;
}

export function addBoundaryOverlays(map: maplibregl.Map, cwaEnabled: boolean): void {
  const boundarySource = boundaryVectorSource(map);
  const beforeId = firstSymbolLayerId(map);

  if (boundarySource) {
    map.addLayer({
      id: 'county-boundaries-ui', type: 'line', source: boundarySource, 'source-layer': 'boundary', minzoom: 3,
      filter: ['all', ['==', 'admin_level', 6], ['==', 'maritime', 0]],
      paint: {
        'line-color': '#686874', 'line-opacity': 0.9,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.72, 4.5, 0.82, 7, 1.02, 10, 1.35]
      }
    }, beforeId);
    map.addLayer({
      id: 'state-boundaries-ui', type: 'line', source: boundarySource, 'source-layer': 'boundary', minzoom: 2.5,
      filter: ['all', ['==', 'admin_level', 4], ['==', 'maritime', 0]],
      paint: {
        'line-color': '#b8b8c2', 'line-opacity': 0.96,
        'line-width': ['interpolate', ['linear'], ['zoom'], 2.5, 1.2, 6, 1.7, 10, 2.2]
      }
    }, beforeId);
  } else {
    console.warn('[PNWS:MAP] Base-map administrative boundary source was not found.');
  }

  map.addSource('nws-cwa', { type: 'geojson', data: CWA_URL });
  map.addLayer({
    id: 'cwa-boundaries-ui', type: 'line', source: 'nws-cwa', minzoom: 2.5,
    layout: { visibility: cwaEnabled ? 'visible' : 'none' },
    paint: {
      'line-color': '#3b82f6', 'line-opacity': 0.95,
      'line-width': ['interpolate', ['linear'], ['zoom'], 2.5, 1.15, 6, 1.55, 10, 1.95]
    }
  }, beforeId);
}
