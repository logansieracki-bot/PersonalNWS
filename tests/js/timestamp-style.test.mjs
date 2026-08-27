import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('src/ui/styles.css', 'utf8');

test('current frame timestamp is more prominent without becoming a banner', () => {
  const rule = css.match(/#timeNow\{([^}]*)\}/)?.[1] ?? '';
  const size = Number(rule.match(/font-size:([\d.]+)px/)?.[1]);
  const weight = Number(rule.match(/font-weight:(\d+)/)?.[1]);
  assert.ok(size >= 16 && size <= 17, `expected 16-17px current timestamp, got ${size}`);
  assert.ok(weight >= 800, `expected current timestamp weight >= 800, got ${weight}`);
});
