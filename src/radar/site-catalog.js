import { WSR88D_ID_SET } from './wsr88d-ids.js';

export const NOAA_NEXRAD_QUERY =
  'https://gis.ncdc.noaa.gov/arcgis/rest/services/cdo/nexrad/MapServer/0/query?where=1%3D1&outFields=STATION_ID%2CSTATION_NAME%2CSTATE%2CCOUNTRY%2CLATITUDE%2CLONGITUDE%2CBEGIN_DATE%2CEND_DATE&returnGeometry=false&f=json';

export const NWS_RADAR_SITES_WFS =
  'https://opengeo.ncep.noaa.gov/geoserver/nws/ows?request=GetFeature&service=WFS&typeName=nws%3Aradar_sites&version=1.0.0&outputFormat=application%2Fjson';

export const MIN_EXPECTED_WSR88D_SITES = 150;

const ID = /^[A-Z0-9]{4}$/;
const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/;

export function parseStationDateMs(value) {
  if (value == null || value === '') return Number.NaN;

  const compact = String(value).trim().match(COMPACT_DATE);
  if (compact) {
    const year = Number(compact[1]);
    const month = Number(compact[2]);
    const day = Number(compact[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return Number.NaN;
    const ms = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
    const check = new Date(ms);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) return Number.NaN;
    return ms;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Math.abs(value) >= 100_000_000_000) return value;
    if (Math.abs(value) >= 1_000_000_000) return value * 1000;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

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

export function isActiveStation(station, now = Date.now()) {
  if (station.endDate == null || station.endDate === '') return true;
  const end = parseStationDateMs(station.endDate);
  return !Number.isFinite(end) || end >= now;
}

export function stationsFromArcGisResponse(payload, now = Date.now()) {
  if (payload?.error) {
    const code = payload.error.code ?? 'unknown';
    const message = payload.error.message ?? 'ArcGIS query failed';
    throw new Error(`NOAA catalog ArcGIS error ${code}: ${message}`);
  }
  if (!Array.isArray(payload?.features)) throw new Error('NOAA catalog response did not contain a features array');
  return payload.features
    .map((feature) => normalizeStation(feature.attributes ?? feature))
    .filter((station) => isActiveStation(station, now))
    .sort((a, b) => a.id.localeCompare(b.id));
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

export async function loadRadarSites({
  fetchImpl = fetch,
  fallbackUrl = new URL('../data/nexrad-sites.json', import.meta.url),
  minBundledSites = MIN_EXPECTED_WSR88D_SITES,
} = {}) {
  try {
    const response = await fetchImpl(fallbackUrl, { cache: 'no-store' });
    const fallback = (await response.json())
      .map(normalizeStation)
      .filter((station) => WSR88D_ID_SET.has(station.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (fallback.length >= minBundledSites) return fallback;
  } catch {}

  const response = await fetchImpl(NWS_RADAR_SITES_WFS, { cache: 'no-store' });
  if (!response.ok) throw new Error(`NWS radar-sites WFS HTTP ${response.status}`);
  const sites = stationsFromNwsWfsResponse(await response.json());
  if (!sites.length) throw new Error('NWS radar-sites WFS returned no current WSR-88D sites');
  return sites;
}
