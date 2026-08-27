import { APP_VERSION } from '../config.js';

export function resolveDecoderBase(base = document.baseURI) {
  return new URL('decoder/', base).href;
}

export function decoderAssetUrls(decoderBase = resolveDecoderBase(), version = APP_VERSION) {
  const js = new URL('personalnws_decoder.js', decoderBase);
  const wasm = new URL('personalnws_decoder_bg.wasm', decoderBase);
  if (version) {
    js.searchParams.set('v', version);
    wasm.searchParams.set('v', version);
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

export async function loadRadarDecoder(decoderBase = resolveDecoderBase()) {
  const { jsUrl, wasmUrl } = decoderAssetUrls(decoderBase);
  const mod = await import(/* @vite-ignore */ jsUrl);
  await initRadarWasm(mod, wasmUrl);
  if (typeof mod.RadarEngine !== 'function') {
    throw Object.assign(new Error('decoder WASM loaded but RadarEngine export is missing'), {
      code: 'E_WASM_EXPORT', stage: 'wasm', sourceId: jsUrl,
    });
  }
  return { RadarEngine: mod.RadarEngine };
}
