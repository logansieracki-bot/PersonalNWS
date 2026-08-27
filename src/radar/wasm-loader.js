import { APP_VERSION, BUILD_ID } from '../config.js';

export function resolveDecoderBase(base = document.baseURI) {
  return new URL('decoder/', base).href;
}

export function decoderAssetUrls(decoderBase = resolveDecoderBase(), version = APP_VERSION, buildId = BUILD_ID) {
  const js = new URL('personalnws_decoder.js', decoderBase);
  const wasm = new URL('personalnws_decoder_bg.wasm', decoderBase);
  const cacheToken = [version, buildId].filter(Boolean).join('-');
  if (cacheToken) {
    js.searchParams.set('v', cacheToken);
    wasm.searchParams.set('v', cacheToken);
  }
  return { jsUrl: js.href, wasmUrl: wasm.href };
}

export async function initRadarWasm(mod, wasmUrl) {
  try {
    return await mod.default({ module_or_path: wasmUrl });
  } catch (error) {
    // wasm-bindgen < 0.2.100 accepted the URL directly. Keep a compatibility
    // fallback so an older generated glue file cannot brick a Pages deploy.
    if (error instanceof TypeError || /module_or_path|RequestInfo|URL/i.test(String(error?.message ?? error))) {
      return mod.default(wasmUrl);
    }
    throw error;
  }
}

export async function loadRadarDecoder(decoderBase = resolveDecoderBase(), {
  importModule = (url) => import(/* @vite-ignore */ url),
} = {}) {
  const { jsUrl, wasmUrl } = decoderAssetUrls(decoderBase);
  let mod;
  try {
    mod = await importModule(jsUrl);
  } catch (cause) {
    throw Object.assign(new Error(`decoder glue module could not be loaded: ${cause?.message ?? cause}`), {
      code: 'E_WASM_IMPORT', stage: 'wasm', sourceId: jsUrl, cause,
      detail: String(cause?.stack ?? cause?.message ?? cause),
    });
  }
  try {
    await initRadarWasm(mod, wasmUrl);
  } catch (cause) {
    throw Object.assign(new Error(`decoder WASM could not initialize: ${cause?.message ?? cause}`), {
      code: 'E_WASM_INIT', stage: 'wasm', sourceId: wasmUrl, cause,
      detail: String(cause?.stack ?? cause?.message ?? cause),
    });
  }
  if (typeof mod.RadarEngine !== 'function') {
    throw Object.assign(new Error('decoder WASM loaded but RadarEngine export is missing'), {
      code: 'E_WASM_EXPORT', stage: 'wasm', sourceId: jsUrl,
    });
  }
  return { RadarEngine: mod.RadarEngine };
}
