import maplibregl from 'maplibre-gl';

export interface PersonalNwsPrefs {
  center?: [number, number];
  zoom?: number;
  site?: string | null;
  product?: string;
  speed?: string;
  tracks?: boolean;
  cwa?: boolean;
}

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const MAP_FALLBACK_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export function loadPrefs(): PersonalNwsPrefs {
  try {
    return JSON.parse(localStorage.getItem('personalNwsAlphaUi') || '{}') as PersonalNwsPrefs;
  } catch {
    return {};
  }
}

export function savePrefs(prefs: PersonalNwsPrefs): void {
  try {
    localStorage.setItem('personalNwsAlphaUi', JSON.stringify(prefs));
  } catch {}
}

export function createPersonalNwsMap(prefs = loadPrefs()): maplibregl.Map {
  const map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLE,
    center: Array.isArray(prefs.center) ? prefs.center : [-77.3, 39.1],
    zoom: Number.isFinite(Number(prefs.zoom)) ? Number(prefs.zoom) : 6.5,
    dragRotate: false,
    pitchWithRotate: false
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.keyboard.disable();

  let loaded = false;
  let fallbackTried = false;
  map.on('load', () => { loaded = true; });
  map.on('error', event => {
    const message = String((event as unknown as { error?: Error }).error?.message || 'Map error');
    console.warn('[PNWS:MAP]', message);
    if (!loaded && !fallbackTried) {
      fallbackTried = true;
      try { map.setStyle(MAP_FALLBACK_STYLE); } catch {}
    }
  });
  window.setTimeout(() => {
    if (!loaded && !fallbackTried) {
      fallbackTried = true;
      try { map.setStyle(MAP_FALLBACK_STYLE); } catch {}
    }
  }, 6500);

  return map;
}

export function cleanBaseStyle(map: maplibregl.Map): void {
  for (const layer of map.getStyle().layers || []) {
    const id = layer.id.toLowerCase();
    if (id.includes('poi') || id.includes('housenumber') || id.includes('building') || id.includes('transit')) {
      try { map.setLayoutProperty(layer.id, 'visibility', 'none'); } catch {}
    }
  }
}
