function mapError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.stage = 'map';
  return error;
}

export function createMapShell({
  maplibregl,
  diagnostics,
  container = 'map',
  style = 'https://tiles.openfreemap.org/styles/liberty',
  center = [-97.5, 38.5],
  zoom = 4,
  timeoutMs = 15_000,
  setTimeoutImpl = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutImpl = (id) => globalThis.clearTimeout(id),
} = {}) {
  if (!maplibregl?.Map) throw mapError('E_MAP_LIBRARY', 'MapLibre is unavailable');

  let map;
  try {
    map = new maplibregl.Map({
      container,
      style,
      center,
      zoom,
      attributionControl: true,
      keyboard: false,
      canvasContextAttributes: { antialias: false },
    });
  } catch (cause) {
    throw mapError('E_MAP_CREATE', 'MapLibre could not create the map', cause);
  }

  map.on?.('error', (event) => {
    diagnostics?.warn?.('map', 'MAP_SOURCE_ERROR', event?.error?.message ?? 'Map source error', {}, event?.error);
  });

  const ready = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeoutImpl(timer);
      fn(value);
    };
    const timer = setTimeoutImpl(() => finish(reject, mapError('E_MAP_TIMEOUT', `Map did not become ready within ${timeoutMs} ms`)), timeoutMs);
    if (map.loaded?.()) finish(resolve, map);
    else map.once?.('load', () => finish(resolve, map));
  });

  return Object.freeze({ map, ready });
}
