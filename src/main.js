import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './ui/styles.css';
import { APP_RELEASE_LABEL, APP_VERSION, BUILD_ID } from './config.js';
import { loadRadarSites } from './radar/site-catalog.js';
import { discoverRecentFrames } from './radar/frame-catalog.js';
import { resolveDecoderBase } from './radar/wasm-loader.js';
import { waitForMapReady } from './radar/startup.js';
import { RadarEngineV2 } from './radar/radar-engine-v2.js';
import { createLazyLevel2SessionFactory } from './radar/level2-session-factory.js';
import { RadarLayer } from './render/radar-layer.js';
import { FastRadarLayer } from './render/fast-radar-layer.js';
import { createUI } from './ui/ui-adapter.js';
import { runUiAction } from './ui/action-runner.js';
import { createSingleFlight } from './ui/single-flight.js';
import { installRadarMarkers } from './ui/radar-markers.js';
import { diagnosticLog, buildDiagnosticReport, showDiagnostic } from './diagnostics.js';

// Radar Engine V2 boot rule: the map and fast NWS radar path do not wait for
// Rust/WASM. Level II workers are constructed lazily after radar is visible.
document.documentElement.dataset.personalNwsVersion = APP_VERSION;
document.title = `PersonalNWS ${APP_RELEASE_LABEL}`;
for (const node of document.querySelectorAll('[data-app-version]')) node.textContent = APP_RELEASE_LABEL;

const ui = createUI(document);
let app = null, sites = [], map = null, radarLayer = null, fastRadarLayer = null;

const debugApi = {
  ready: false,
  async selectSiteById(id) {
    const site = sites.find((s) => s.id === String(id).toUpperCase());
    if (!site) throw new Error(`radar ${id} is not in the active catalog`);
    map?.flyTo({ center: [site.lon, site.lat], zoom: Math.max(map.getZoom(), 6), duration: 450 });
    return app.selectSite(site);
  },
  focusSiteById(id) {
    const site = sites.find((s) => s.id === String(id).toUpperCase());
    if (!site) throw new Error(`radar ${id} is not in the active catalog`);
    map?.jumpTo({ center: [site.lon, site.lat], zoom: Math.max(map.getZoom(), 6) });
    return true;
  },
  screenPointForSite(id) {
    const site = sites.find((s) => s.id === String(id).toUpperCase());
    if (!site) throw new Error(`radar ${id} is not in the active catalog`);
    const point = map?.project?.([site.lon, site.lat]);
    return point ? { x: point.x, y: point.y } : null;
  },
  async forceLevel2Latest() {
    if (!app?.site) throw new Error('select a radar first');
    app.elevationNumber = 1; // bypass fast 0.5° lane; decoder chooses a valid cut if #1 differs
    return app.loadIndex(Math.max(0, app.frames.length - 1));
  },
  logs(limit = 100) { return diagnosticLog.entries({ limit }); },
  clearLogs() { diagnosticLog.clear(); return true; },
  debugReport() { return buildDiagnosticReport({ state: this.debug() }); },
  async copyDebugReport() {
    const text = JSON.stringify(this.debugReport(), null, 2);
    if (!navigator?.clipboard?.writeText) return text;
    await navigator.clipboard.writeText(text);
    return text;
  },
  debug() {
    return {
      version: APP_VERSION,
      buildId: BUILD_ID,
      site: app?.site?.id ?? null,
      siteCount: sites.length,
      followLive: app?.followLive ?? false,
      frameCount: app?.frames?.length ?? 0,
      currentIndex: app?.currentIndex ?? 0,
      currentFrameTime: app?.frames?.[app?.currentIndex ?? 0]?.scanStartMs ?? null,
      radarVisible: Boolean((app?.preparedVisible && fastRadarLayer?.activeLayerId) || (radarLayer?.visible && radarLayer?.sweep)),
      preparedLayerActive: Boolean(app?.preparedVisible && fastRadarLayer?.activeLayerId),
      level2SweepReady: Boolean(radarLayer?.visible && radarLayer?.sweep),
      rendererHasSweep: Boolean(radarLayer?.sweep),
      radialCount: radarLayer?.sweep?.radialCount ?? 0,
      gateCount: radarLayer?.sweep?.gateCount ?? 0,
      productId: radarLayer?.sweep?.productId ?? app?.productId ?? null,
      elevationNumber: radarLayer?.sweep?.elevationNumber ?? app?.elevationNumber ?? null,
      renderCount: radarLayer?.renderCount ?? 0,
      glError: radarLayer?.lastGlError ?? 0,
    };
  },
};
window.__PERSONALNWS__ = debugApi;

window.addEventListener('error', (event) => {
  diagnosticLog.error('browser', 'E_WINDOW_ERROR', String(event?.message ?? 'Window error'), { sourceId: event?.filename ?? '', line: event?.lineno ?? null, column: event?.colno ?? null }, event?.error ?? event);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  diagnosticLog.error(reason?.stage ?? 'browser', reason?.code ?? 'E_UNHANDLED_REJECTION', String(reason?.message ?? reason ?? 'Unhandled promise rejection'), { sourceId: reason?.sourceId ?? '' }, reason);
});

function performUiAction(action, fn, context = {}) {
  return runUiAction(action, fn, { diagnostics: diagnosticLog, ui, context });
}

async function boot() {
  const bootStarted = Date.now();
  diagnosticLog.info('boot', 'BOOT_START', `Starting PersonalNWS ${APP_RELEASE_LABEL}`, { version: APP_VERSION, release: APP_RELEASE_LABEL, buildId: BUILD_ID });
  ui.setStream('· starting');
  const sitesPromise = loadRadarSites({ diagnostics: diagnosticLog, timeoutMs: 5_000 });

  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [-97.5, 38.5],
    zoom: 4.0,
    attributionControl: true,
    keyboard: false,
    canvasContextAttributes: { antialias: false },
  });
  await waitForMapReady(map, { timeoutMs: 10_000 });
  diagnosticLog.info('map', 'MAP_READY', 'MapLibre base map ready', { elapsedMs: Date.now() - bootStarted });

  const firstSymbol = map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id;
  radarLayer = new RadarLayer({ diagnostics: diagnosticLog });
  radarLayer.setVisible(false);
  map.addLayer(radarLayer, firstSymbol);
  fastRadarLayer = new FastRadarLayer(map, { beforeLayerId: firstSymbol, loadTimeoutMs: 3_500, diagnostics: diagnosticLog });

  const decoderBase = resolveDecoderBase(document.baseURI);
  const createLevel2Session = createLazyLevel2SessionFactory({ decoderBase, ui, diagnostics: diagnosticLog });
  const listFrames = (siteId) => discoverRecentFrames(siteId, { nowMs: Date.now(), timeoutMs: 3_500 });

  app = new RadarEngineV2({
    ui,
    diagnostics: diagnosticLog,
    fastRenderer: fastRadarLayer,
    level2Renderer: radarLayer,
    listFrames,
    createLevel2Session,
    productId: Number(document.getElementById('product')?.value ?? 1),
    pollMs: 20_000,
    warmHistoryDelayMs: 3_000,
  });

  sites = await sitesPromise;
  diagnosticLog.info('catalog', 'CATALOG_READY', `Loaded ${sites.length} radar sites`, { siteCount: sites.length, elapsedMs: Date.now() - bootStarted });
  installRadarMarkers(map, sites, (site) => {
    map.flyTo({ center: [site.lon, site.lat], zoom: Math.max(map.getZoom(), 6), duration: 450 });
    void performUiAction('marker-select', () => app.selectSite(site), { site: site.id });
  });

  const timeline = document.getElementById('timeline');
  timeline?.addEventListener('change', () => { void performUiAction('timeline-change', () => app.loadIndex(Number(timeline.value)), { index: Number(timeline.value), site: app?.site?.id ?? '' }); });
  document.getElementById('product')?.addEventListener('change', (event) => { const productId = Number(event.target.value); void performUiAction('product-change', () => app.setProduct(productId), { productId, site: app?.site?.id ?? '' }); });
  document.getElementById('tilt')?.addEventListener('change', (event) => { const elevationNumber = Number(event.target.value); void performUiAction('tilt-change', () => app.setElevation(elevationNumber), { elevationNumber, site: app?.site?.id ?? '' }); });

  document.addEventListener('keydown', (event) => {
    if (!app?.frames?.length) return;
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); void performUiAction('keyboard-previous', () => app.loadIndex(app.currentIndex - 1), { site: app?.site?.id ?? '' }); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); void performUiAction('keyboard-next', () => app.loadIndex(app.currentIndex + 1), { site: app?.site?.id ?? '' }); }
    else if (event.code === 'Space') { event.preventDefault(); document.getElementById('play')?.click(); }
  }, { passive: false });

  let playTimer = null;
  const playbackFlight = createSingleFlight();
  const playButton = document.getElementById('play');
  playButton?.addEventListener('click', () => {
    if (playTimer) { clearInterval(playTimer); playTimer = null; playButton.textContent = 'Play'; return; }
    playButton.textContent = 'Pause';
    const speed = () => Number(document.getElementById('speed')?.value ?? 1);
    playTimer = setInterval(() => {
      if (!app.frames.length) return;
      const next = app.currentIndex >= app.frames.length - 1 ? 0 : app.currentIndex + 1;
      void playbackFlight.run(() => performUiAction('playback-step', () => app.loadIndex(next), { index: next, site: app?.site?.id ?? '' }));
    }, Math.max(100, 900 / speed()));
  });

  const tracks = document.getElementById('tracks');
  tracks?.addEventListener('click', () => tracks.classList.toggle('active'));

  map.on('mousemove', (event) => {
    const coords = document.getElementById('coords');
    if (coords) coords.textContent = `${event.lngLat.lat.toFixed(3)}, ${event.lngLat.lng.toFixed(3)}`;
  });

  window.addEventListener('beforeunload', () => app?.dispose(), { once: true });
  debugApi.ready = true;
  diagnosticLog.info('boot', 'BOOT_READY', `PersonalNWS ready with ${sites.length} radars`, { siteCount: sites.length, elapsedMs: Date.now() - bootStarted });
  ui.setStream(`· ready · ${sites.length} radars`);
}

boot().catch((error) => {
  debugApi.ready = false;
  diagnosticLog.error(error?.stage ?? 'boot', error?.code ?? 'E_BOOT', error?.message ?? 'Application boot failed', { sourceId: error?.sourceId ?? '' }, error);
  showDiagnostic(error, { stage: error?.stage ?? 'boot' });
});
