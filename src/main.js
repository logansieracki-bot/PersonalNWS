import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './ui/styles.css';
import { APP_RELEASE_LABEL, APP_VERSION, BUILD_ID } from './config.js';
import { loadRadarSites } from './radar/site-catalog.js';
import { discoverRecentFrames } from './radar/frame-catalog.js';
import { WorkerClient } from './radar/worker-client.js';
import { EVENTS } from './radar/worker-protocol.js';
import { resolveDecoderBase } from './radar/wasm-loader.js';
import { initializeRadarWorkers } from './radar/startup.js';
import { RadarEngineV2 } from './radar/radar-engine-v2.js';
import { RadarLayer } from './render/radar-layer.js';
import { FastRadarLayer } from './render/fast-radar-layer.js';
import { createUI } from './ui/ui-adapter.js';
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

function onceMapLoad(instance) {
  return new Promise((resolve) => {
    if (instance.loaded()) return resolve();
    instance.once('load', resolve);
  });
}

function createLazyLevel2SessionFactory(decoderBase) {
  let sessionPromise = null;
  return () => {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      const priorityWorker = new Worker(new URL('./radar/priority-worker.js', import.meta.url), { type: 'module', name: 'personalnws-priority' });
      const priority = new WorkerClient(priorityWorker, { timeoutMs: 45_000, diagnostics: diagnosticLog, role: 'priority' });
      priority.on(EVENTS.METRICS, (entry) => diagnosticLog.record(entry?.level ?? 'debug', entry?.stage ?? 'worker', entry?.code ?? 'WORKER_METRIC', entry?.message ?? 'Worker metric', entry?.context ?? {}, entry?.error ?? null));
      priority.on(EVENTS.DIAGNOSTIC, (error) => diagnosticLog.error(error?.stage ?? 'worker', error?.code ?? 'E_WORKER', error?.message ?? 'Priority worker diagnostic', { ...(error?.context ?? {}), sourceId: error?.sourceId ?? '', role: 'priority' }, error));
      await initializeRadarWorkers({ priority, decoderBase });

      let historyWorker = null;
      let history = null;
      let historyReady = null;
      let historyRun = null;
      let historyKey = '';

      const ensureHistory = () => {
        if (historyReady) return historyReady;
        historyReady = (async () => {
          historyWorker = new Worker(new URL('./radar/history-worker.js', import.meta.url), { type: 'module', name: 'personalnws-history' });
          history = new WorkerClient(historyWorker, { timeoutMs: 120_000, diagnostics: diagnosticLog, role: 'history' });
          history.on(EVENTS.CACHE_PROGRESS, ({ done, total }) => ui.cacheProgress(done, total));
          history.on(EVENTS.METRICS, (entry) => diagnosticLog.record(entry?.level ?? 'debug', entry?.stage ?? 'history', entry?.code ?? 'WORKER_METRIC', entry?.message ?? 'History worker metric', entry?.context ?? {}, entry?.error ?? null));
          history.on(EVENTS.DIAGNOSTIC, (error) => { diagnosticLog.warn(error?.stage ?? 'history', error?.code ?? 'E_HISTORY', error?.message ?? 'History worker diagnostic', { ...(error?.context ?? {}), sourceId: error?.sourceId ?? '', role: 'history' }, error); console.warn('[PersonalNWS history]', error); });
          await initializeRadarWorkers({ priority: history, decoderBase });
          return history;
        })().catch((error) => {
          console.warn('[PersonalNWS history init]', error);
          historyReady = null;
          throw error;
        });
        return historyReady;
      };

      const startHistory = (payload) => {
        if (!payload?.frames?.length) return Promise.resolve(null);
        const latest = payload.frames.at(-1)?.scanStartMs ?? 0;
        const key = `${payload.site}|${payload.productId}|${payload.elevationNumber ?? 'auto'}|${payload.frames.length}|${latest}`;
        if (historyRun && historyKey === key) return historyRun;
        if (historyRun) return historyRun; // don't launch overlapping volume backfills
        historyKey = key;
        historyRun = ensureHistory()
          .then((client) => client.request('START_HISTORY', payload))
          .catch((error) => console.warn('[PersonalNWS history backfill]', error))
          .finally(() => { historyRun = null; });
        return historyRun;
      };

      return {
        priority,
        startHistory,
        dispose() {
          try { priorityWorker.terminate(); } catch {}
          try { historyWorker?.terminate(); } catch {}
        },
      };
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
    return sessionPromise;
  };
}

async function boot() {
  const bootStarted = Date.now();
  diagnosticLog.info('boot', 'BOOT_START', `Starting PersonalNWS ${APP_RELEASE_LABEL}`, { version: APP_VERSION, release: APP_RELEASE_LABEL, buildId: BUILD_ID });
  ui.setStream('· starting');
  const sitesPromise = loadRadarSites();

  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [-97.5, 38.5],
    zoom: 4.0,
    attributionControl: true,
    keyboard: false,
    canvasContextAttributes: { antialias: false },
  });
  await onceMapLoad(map);
  diagnosticLog.info('map', 'MAP_READY', 'MapLibre base map ready', { elapsedMs: Date.now() - bootStarted });

  const firstSymbol = map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id;
  radarLayer = new RadarLayer();
  radarLayer.setVisible(false);
  map.addLayer(radarLayer, firstSymbol);
  fastRadarLayer = new FastRadarLayer(map, { beforeLayerId: firstSymbol, loadTimeoutMs: 3_500, diagnostics: diagnosticLog });

  const decoderBase = resolveDecoderBase(document.baseURI);
  const createLevel2Session = createLazyLevel2SessionFactory(decoderBase);
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
    app.selectSite(site).catch(() => {});
  });

  const timeline = document.getElementById('timeline');
  timeline?.addEventListener('change', () => app.loadIndex(Number(timeline.value)).catch(() => {}));
  document.getElementById('product')?.addEventListener('change', (event) => app.setProduct(Number(event.target.value)).catch(() => {}));
  document.getElementById('tilt')?.addEventListener('change', (event) => app.setElevation(Number(event.target.value)).catch(() => {}));

  document.addEventListener('keydown', (event) => {
    if (!app?.frames?.length) return;
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); app.loadIndex(app.currentIndex - 1).catch(() => {}); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); app.loadIndex(app.currentIndex + 1).catch(() => {}); }
    else if (event.code === 'Space') { event.preventDefault(); document.getElementById('play')?.click(); }
  }, { passive: false });

  let playTimer = null;
  const playButton = document.getElementById('play');
  playButton?.addEventListener('click', () => {
    if (playTimer) { clearInterval(playTimer); playTimer = null; playButton.textContent = 'Play'; return; }
    playButton.textContent = 'Pause';
    const speed = () => Number(document.getElementById('speed')?.value ?? 1);
    playTimer = setInterval(() => {
      if (!app.frames.length) return;
      const next = app.currentIndex >= app.frames.length - 1 ? 0 : app.currentIndex + 1;
      app.loadIndex(next).catch(() => {});
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
