import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('visible release remains PersonalNWS Alpha', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.match(html, /<title>PersonalNWS Alpha<\/title>/);
  assert.match(html, /data-app-version>Alpha</);
  assert.equal(manifest.name, 'PersonalNWS Alpha');
});
