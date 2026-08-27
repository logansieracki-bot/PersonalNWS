import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_RELEASE_LABEL, APP_VERSION, BUILD_ID } from '../../src/config.js';

const html = fs.readFileSync('index.html', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');
const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/pages.yml', 'utf8');
const cargo = fs.readFileSync('decoder/Cargo.toml', 'utf8');
const repairNotes = fs.readFileSync('REPAIR_NOTES.md', 'utf8');
const mainSource = fs.readFileSync('src/main.js', 'utf8');

const releaseName = `PersonalNWS ${APP_RELEASE_LABEL}`;

test('browser title identifies the current Alpha release', () => {
  assert.match(html, new RegExp(`<title>${releaseName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}</title>`));
});

test('README documents the current Alpha architecture and live/debug behavior', () => {
  assert.match(readme, new RegExp(`PersonalNWS ${APP_RELEASE_LABEL}`));
  assert.match(readme, /Alpha/i);
  assert.doesNotMatch(html, /V2\.0\.0|2\.0\.0/i);
  assert.match(readme, /prepared radar/i);
  assert.match(readme, /Level II/i);
  assert.doesNotMatch(readme, /fast lane|slow lane|fast mode|slow mode/i);
  assert.match(readme, /live refresh/i);
  assert.match(readme, /__PERSONALNWS__/);
  assert.match(readme, /150|156/);
});

test('PWA manifest, package version, and Pages workflow stay release-synchronized', () => {
  assert.equal(manifest.name, releaseName);
  assert.equal(pkg.version, APP_VERSION);
  assert.match(workflow, new RegExp(`PersonalNWS ${APP_RELEASE_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(cargo, new RegExp(`version = \"${APP_VERSION.replaceAll('.', '\\.') }\"`));
  assert.match(repairNotes, /PersonalNWS Alpha/);
});


test('runtime keeps the visible version label as Alpha instead of exposing technical semver', () => {
  assert.match(mainSource, /APP_RELEASE_LABEL/);
  assert.match(mainSource, /document\.title\s*=\s*`PersonalNWS \${APP_RELEASE_LABEL}`/);
  assert.doesNotMatch(mainSource, /data-app-version[^\n]*APP_VERSION|textContent = `V\$\{APP_VERSION\}`/);
});


test('runtime diagnostics expose the deployed build id instead of making us guess which commit is live', () => {
  assert.equal(typeof BUILD_ID, 'string');
  assert.match(mainSource, /buildId:\s*BUILD_ID/);
  assert.match(workflow, /VITE_BUILD_ID:\s*\$\{\{ github\.sha \}\}/);
});
