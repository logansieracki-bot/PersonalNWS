import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('preserves the PersonalNWS visual shell IDs', () => {
  const html = read('index.html');
  for (const id of ['map','status','site','detail','controls','product','tilt','speed','play','tracks','readout','timelineWrap','cacheProgress','timeline','times','timeLeft','timeNow','timeRight','fatal','fatalCopy']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
});

test('keeps the emphasized current-frame timestamp styling', () => {
  const css = read('src/ui/styles.css');
  assert.match(css, /#timeNow\{[^}]*font-size:17px;[^}]*font-weight:850/);
});

test('stage 1 ships no legacy radar, render, decoder, worker, or NEXRAD runtime', () => {
  for (const p of ['decoder', 'src/radar', 'src/render']) {
    assert.equal(fs.existsSync(path.join(root, p)), false, `${p} must not exist in Stage 1`);
  }
  const main = read('src/main.js');
  for (const forbidden of ['RadarEngineV2', 'wasm', 'worker', 'nexrad', 'frame-catalog', 'RadarLayer', 'FastRadarLayer']) {
    assert.equal(main.toLowerCase().includes(forbidden.toLowerCase()), false, `main.js still contains ${forbidden}`);
  }
});

test('stage 1 has a tiny explicit Stage 2 radar attachment boundary', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/radar-slot.js')), true);
  const main = read('src/main.js');
  assert.match(main, /attachRadar/);
  assert.match(main, /window\.PersonalNWS/);
});
