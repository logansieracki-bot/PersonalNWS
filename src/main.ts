import 'maplibre-gl/dist/maplibre-gl.css';
import { addBoundaryOverlays } from './map/boundaries';
import { addRadarStations, type SelectedStation } from './map/stations';
import { cleanBaseStyle, createPersonalNwsMap, loadPrefs, savePrefs, type PersonalNwsPrefs } from './map/create-map';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
};

const prefs: PersonalNwsPrefs = loadPrefs();
let selectedSite: SelectedStation | null = null;
let toastTimer = 0;

function toast(message: string, ms = 2200): void {
  window.clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').style.display = 'flex';
  toastTimer = window.setTimeout(() => { $('toast').style.display = 'none'; }, ms);
}

const map = createPersonalNwsMap(prefs);

function persist(): void {
  savePrefs({
    center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom(), site: selectedSite?.id || prefs.site || null,
    product: (document.getElementById('product') as HTMLSelectElement).value,
    speed: (document.getElementById('speed') as HTMLSelectElement).value,
    tracks: $('tracks').classList.contains('active'), cwa: $('cwa').classList.contains('active')
  });
}

map.on('moveend', persist);
map.on('zoomend', persist);
map.on('load', async () => {
  cleanBaseStyle(map);
  addBoundaryOverlays(map, prefs.cwa === true);
  await addRadarStations(map, {
    rememberedSite: prefs.site,
    onSelect(station) {
      selectedSite = station;
      $('dot').className = 'live'; $('site').textContent = station.id; $('detail').textContent = station.name;
      $('history').textContent = ''; $('stream').textContent = '';
      persist();
    }
  });
});

map.on('mousemove', event => {
  $('coords').textContent = `${event.lngLat.lat.toFixed(3)}, ${event.lngLat.lng.toFixed(3)}`;
  $('value').textContent = '—';
});

const product = document.getElementById('product') as HTMLSelectElement;
const speed = document.getElementById('speed') as HTMLSelectElement;
product.value = prefs.product || 'REF';
speed.value = prefs.speed || '1';
$('tracks').classList.toggle('active', prefs.tracks !== false);
$('cwa').classList.toggle('active', prefs.cwa === true);

product.addEventListener('change', persist);
speed.addEventListener('change', persist);
(document.getElementById('tilt') as HTMLSelectElement).addEventListener('change', persist);
$('tracks').addEventListener('click', () => { $('tracks').classList.toggle('active'); persist(); toast('Tracks toggled.'); });
$('cwa').addEventListener('click', () => {
  const active = $('cwa').classList.toggle('active');
  if (map.getLayer('cwa-boundaries-ui')) map.setLayoutProperty('cwa-boundaries-ui','visibility',active?'visible':'none');
  persist(); toast(`CWA boundaries ${active ? 'on' : 'off'}.`);
});
$('play').addEventListener('click', () => toast('Playback begins in Stage 2.'));
window.addEventListener('beforeunload', persist);
