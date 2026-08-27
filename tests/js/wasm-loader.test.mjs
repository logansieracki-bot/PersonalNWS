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
