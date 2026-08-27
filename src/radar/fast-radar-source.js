const FAST_PRODUCTS = Object.freeze({
  1: 'SR_BREF',
  2: 'SR_BVEL',
});

const RADAR_ID = /^[A-Z0-9]{4}$/;
const WMS_BASE = 'https://opengeo.ncep.noaa.gov/geoserver';

export function fastRadarLayerName(productId) {
  return FAST_PRODUCTS[Number(productId)] ?? null;
}

export function supportsFastRadar(productId, elevationNumber = null) {
  const product = fastRadarLayerName(productId);
  if (!product) return false;
  return elevationNumber == null || Number(elevationNumber) === 0;
}

export function buildFastRadarTileUrl(siteId, productId, cacheToken = Date.now()) {
  const site = String(siteId ?? '').trim().toUpperCase();
  if (!RADAR_ID.test(site)) throw new Error(`invalid WSR-88D station id ${site}`);
  const layer = fastRadarLayerName(productId);
  if (!layer) throw new Error(`product ${productId} is not available in the fast radar lane`);

  const resourceLayer = `${site.toLowerCase()}_${layer.toLowerCase()}`;
  const query = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetMap',
    layers: resourceLayer,
    styles: '',
    bbox: '{bbox-epsg-3857}',
    width: '256',
    height: '256',
    srs: 'EPSG:3857',
    format: 'image/png',
    transparent: 'true',
    _pnws: String(cacheToken),
  });
  // URLSearchParams escapes the MapLibre bbox token; restore only its braces
  // so MapLibre can replace it per tile while every other parameter stays safe.
  const encoded = query.toString()
    .replace('%7Bbbox-epsg-3857%7D', '{bbox-epsg-3857}');
  return `${WMS_BASE}/${site.toLowerCase()}/${resourceLayer}/ows?${encoded}`;
}
