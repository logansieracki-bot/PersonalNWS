import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDecoderBase } from '../../src/radar/wasm-loader.js';

test('decoder base is repository-path safe', () => {
  assert.equal(resolveDecoderBase('https://x.github.io/PersonalNWS/'), 'https://x.github.io/PersonalNWS/decoder/');
});

test('WASM initializer uses wasm-bindgen module_or_path input', async () => {
  const { initRadarWasm } = await import('../../src/radar/wasm-loader.js');
  let received;
  const mod = { default: async (value) => { received = value; } };
  await initRadarWasm(mod, 'https://x.github.io/PersonalNWS/decoder/personalnws_decoder_bg.wasm');
  assert.deepEqual(received, { module_or_path: 'https://x.github.io/PersonalNWS/decoder/personalnws_decoder_bg.wasm' });
});

test('decoder asset cache token includes the deployed build id, not only the constant Alpha semver', async () => {
  const { decoderAssetUrls } = await import('../../src/radar/wasm-loader.js');
  const urls = decoderAssetUrls('https://x.github.io/PersonalNWS/decoder/', '0.0.0-alpha', 'b4fe301deadbeef');
  assert.match(urls.jsUrl, /v=0\.0\.0-alpha-b4fe301deadbeef/);
  assert.match(urls.wasmUrl, /v=0\.0\.0-alpha-b4fe301deadbeef/);
});

test('decoder loader wraps glue-module import failures with E_WASM_IMPORT', async () => {
  const { loadRadarDecoder } = await import('../../src/radar/wasm-loader.js');
  await assert.rejects(
    loadRadarDecoder('https://example.invalid/decoder/', {
      importModule: async () => { throw new TypeError('failed to fetch dynamically imported module'); },
    }),
    (error) => error?.code === 'E_WASM_IMPORT' && error?.stage === 'wasm' && /personalnws_decoder\.js/.test(error?.sourceId ?? ''),
  );
});

test('decoder loader wraps wasm-bindgen init failures with E_WASM_INIT', async () => {
  const { loadRadarDecoder } = await import('../../src/radar/wasm-loader.js');
  const mod = { default: async () => { throw new Error('bad wasm bytes'); }, RadarEngine: class {} };
  await assert.rejects(
    loadRadarDecoder('https://example.test/decoder/', { importModule: async () => mod }),
    (error) => error?.code === 'E_WASM_INIT' && error?.stage === 'wasm' && /personalnws_decoder_bg\.wasm/.test(error?.sourceId ?? ''),
  );
});
