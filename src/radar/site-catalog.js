import { WSR88D_ID_SET } from './wsr88d-ids.js';

export const NWS_RADAR_SITES_WFS =
  'https://opengeo.ncep.noaa.gov/geoserver/nws/ows?request=GetFeature&service=WFS&typeName=nws%3Aradar_sites&version=1.0.0&outputFormat=application%2Fjson';

export const MIN_EXPECTED_WSR88D_SITES = 150;

const ID = /^[A-Z0-9]{4}$/;
export function normalizeStation(a) {
  const rawId = String(a.STATION_ID ?? a.rda_id ?? a.id ?? '').trim().toUpperCase();
  const id = rawId.startsWith('NEXRAD:') ? rawId.slice('NEXRAD:'.length) : rawId;
  if (!ID.test(id)) throw new Error(`invalid NEXRAD station id ${id}`);

  const lat = Number(a.LATITUDE ?? a.lat);
  const lon = Number(a.LONGITUDE ?? a.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error(`invalid coordinates for ${id}`);
  }

  return {
    id,
    name: String(a.STATION_NAME ?? a.name ?? id).trim(),
    state: a.STATE ?? a.state ?? '',
    country: a.COUNTRY ?? a.country ?? '',
    lat,
    lon,
    beginDate: a.BEGIN_DATE ?? a.beginDate ?? null,
    endDate: a.END_DATE ?? a.endDate ?? null,
    wfo: a.wfo_id ?? a.wfo ?? '',
  };
}

export function stationsFromNwsWfsResponse(payload, allowedIds = WSR88D_ID_SET) {
  if (!Array.isArray(payload?.features)) throw new Error('NWS radar-sites WFS response did not contain a features array');
  const byId = new Map();
  for (const feature of payload.features) {
    const props = feature?.properties ?? feature ?? {};
    const id = String(props.rda_id ?? props.STATION_ID ?? '').trim().toUpperCase();
    if (!allowedIds.has(id)) continue;
    try {
      const station = normalizeStation(props);
      byId.set(station.id, station);
    } catch {
      // One malformed feature must not erase the rest of the national catalog.
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function catalogError(message, code, sourceId, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.stage = 'catalog';
  error.sourceId = String(sourceId ?? '');
  return error;
}

async function fetchJsonWithTimeout(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  let timer = null;
  let timedOut = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(catalogError(`Radar catalog request timed out after ${timeoutMs} ms`, 'E_CATALOG_TIMEOUT', url));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      Promise.resolve(fetchImpl(url, { cache: 'no-store', signal: controller.signal })),
      timeout,
    ]);
    if (!response?.ok && response?.ok !== undefined) {
      throw catalogError(`Radar catalog HTTP ${response.status}`, 'E_CATALOG_HTTP', url);
    }
    return await Promise.race([
      Promise.resolve(response.json()),
      timeout,
    ]);
  } catch (error) {
    if (timedOut || error?.code === 'E_CATALOG_TIMEOUT') {
      throw catalogError(`Radar catalog request timed out after ${timeoutMs} ms`, 'E_CATALOG_TIMEOUT', url, error);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loadRadarSites({
  fetchImpl = fetch,
  fallbackUrl = new URL('../data/nexrad-sites.json', import.meta.url),
  minBundledSites = MIN_EXPECTED_WSR88D_SITES,
  timeoutMs = 5_000,
  diagnostics = null,
} = {}) {
  let fallback = [];
  const log = (level, code, message, context = {}, error = null) => {
    try { diagnostics?.record?.(level, 'catalog', code, message, context, error); } catch {}
  };

  try {
    const payload = await fetchJsonWithTimeout(fallbackUrl, { fetchImpl, timeoutMs });
    const bundledEntries = Array.isArray(payload) ? payload : [];
    let skippedBundled = 0;
    fallback = [];
    for (const entry of bundledEntries) {
      try {
        const station = normalizeStation(entry);
        if (WSR88D_ID_SET.has(station.id)) fallback.push(station);
      } catch {
        skippedBundled += 1;
      }
    }
    fallback.sort((a, b) => a.id.localeCompare(b.id));
    if (skippedBundled) {
      log('warn', 'CATALOG_BUNDLED_MALFORMED', `Skipped ${skippedBundled} malformed bundled radar site${skippedBundled === 1 ? '' : 's'}`, {
        skippedSiteCount: skippedBundled,
        acceptedSiteCount: fallback.length,
      });
    }
    if (fallback.length >= minBundledSites) {
      log('info', 'CATALOG_BUNDLED_READY', `Loaded ${fallback.length} bundled WSR-88D sites`, { siteCount: fallback.length });
      return fallback;
    }
    log('warn', 'CATALOG_BUNDLED_SMALL', `Bundled radar catalog has only ${fallback.length} sites; refreshing from NWS`, { siteCount: fallback.length, expectedMinimum: minBundledSites });
  } catch (error) {
    log('warn', 'CATALOG_BUNDLED_FAILED', 'Bundled radar catalog could not be loaded; refreshing from NWS', { sourceId: String(fallbackUrl) }, error);
  }

  try {
    const payload = await fetchJsonWithTimeout(NWS_RADAR_SITES_WFS, { fetchImpl, timeoutMs });
    const sites = stationsFromNwsWfsResponse(payload);
    if (!sites.length) throw catalogError('NWS radar-sites WFS returned no current WSR-88D sites', 'E_CATALOG_EMPTY', NWS_RADAR_SITES_WFS);
    log('info', 'CATALOG_REMOTE_READY', `Loaded ${sites.length} current WSR-88D sites from NWS`, { siteCount: sites.length });
    return sites;
  } catch (error) {
    const code = error?.code === 'E_CATALOG_TIMEOUT' ? 'CATALOG_REMOTE_TIMEOUT' : 'CATALOG_REMOTE_FAILED';
    log('error', code, error?.message ?? 'NWS radar catalog refresh failed', { sourceId: NWS_RADAR_SITES_WFS }, error);
    if (fallback.length) {
      log('warn', 'CATALOG_DEGRADED', `Using ${fallback.length} bundled radar sites because the live NWS catalog is unavailable`, { siteCount: fallback.length, expectedMinimum: minBundledSites }, error);
      return fallback;
    }
    throw error;
  }
}
