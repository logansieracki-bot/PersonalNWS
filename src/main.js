import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './ui/styles.css';
import { APP_RELEASE_LABEL, APP_VERSION, BUILD_ID } from './config.js';
import { createDiagnostics } from './diagnostics.js';
import { createMapShell } from './map-shell.js';
import { createRadarSlot } from './radar-slot.js';
import { createUIBindings } from './ui-bindings.js';

document.documentElement.dataset.personalNwsVersion = APP_VERSION;
document.title = `PersonalNWS ${APP_RELEASE_LABEL}`;
for (const node of document.querySelectorAll('[data-app-version]')) node.textContent = APP_RELEASE_LABEL;

const diagnostics = createDiagnostics();
const ui = createUIBindings(document);
let map = null;
let radarSlot = null;
let ready = false;

function debugState() {
  return {
    release: APP_RELEASE_LABEL,
    version: APP_VERSION,
    buildId: BUILD_ID,
    ready,
    mapReady: Boolean(map),
    radar: radarSlot?.debug?.() ?? { attached: false, controllerReady: false },
  };
}

function debugReport() {
  return diagnostics.report({ app: debugState() });
}

window.PersonalNWS = Object.freeze({
  debug: debugState,
  logs: (limit = 100) => diagnostics.entries({ limit }),
  debugReport,
  async copyDebugReport() {
    const text = JSON.stringify(debugReport(), null, 2);
    if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
    return text;
  },
  async attachRadar(adapter) {
    if (!radarSlot) throw Object.assign(new Error('Frontend is not ready yet'), { code: 'E_FRONTEND_NOT_READY', stage: 'boot' });
    return radarSlot.attach(adapter);
  },
  async detachRadar() { return radarSlot?.detach?.(); },
});

ui.onCopyDebug(async () => {
  try { await window.PersonalNWS.copyDebugReport(); }
  catch (error) { diagnostics.warn('diagnostics', 'COPY_REPORT_FAILED', error?.message ?? 'Could not copy debug report', {}, error); }
});

window.addEventListener('error', (event) => {
  diagnostics.error('browser', 'E_WINDOW_ERROR', event?.message ?? 'Window error', { source: event?.filename ?? '', line: event?.lineno ?? null }, event?.error);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  diagnostics.error(reason?.stage ?? 'browser', reason?.code ?? 'E_UNHANDLED_REJECTION', reason?.message ?? String(reason ?? 'Unhandled promise rejection'), {}, reason);
});

async function boot() {
  const startedAt = Date.now();
  diagnostics.info('boot', 'BOOT_START', `Starting PersonalNWS ${APP_RELEASE_LABEL}`, { version: APP_VERSION, buildId: BUILD_ID });
  ui.setStatus({ stream: '· starting' });

  const shell = createMapShell({ maplibregl, diagnostics });
  map = shell.map;
  map.on('mousemove', (event) => ui.setCoordinates(`${event.lngLat.lat.toFixed(3)}, ${event.lngLat.lng.toFixed(3)}`));
  await shell.ready;

  radarSlot = createRadarSlot({ map, ui, diagnostics });
  document.getElementById('tracks')?.addEventListener('click', () => ui.toggleTracks());

  ready = true;
  ui.clearFatal();
  ui.setStatus({ stream: '· frontend ready', live: true });
  ui.setTimeline({ index: 0, count: 0, left: '—', now: '—', right: '—', progress: 0 });
  diagnostics.info('boot', 'BOOT_READY', 'Clean frontend ready for Stage 2 radar attachment', { elapsedMs: Date.now() - startedAt });
}

boot().catch((error) => {
  ready = false;
  diagnostics.error(error?.stage ?? 'boot', error?.code ?? 'E_BOOT', error?.message ?? 'Application boot failed', {}, error);
  ui.setStatus({ stream: '· frontend error', bad: true });
  ui.showFatal(error);
});
