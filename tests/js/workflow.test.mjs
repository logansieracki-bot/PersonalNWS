import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/pages.yml','utf8');

test('GitHub Pages workflow is frontend-only in Stage 1', () => {
  for (const forbidden of ['rust-toolchain','cargo ','wasm-pack','build:decoder','Level II','NEXRAD station catalog']) {
    assert.equal(workflow.toLowerCase().includes(forbidden.toLowerCase()), false, `workflow still contains ${forbidden}`);
  }
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /actions\/deploy-pages/);
  assert.match(workflow, /build-info\.json/);
});
