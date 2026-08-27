import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const file of ['decoder/src/source.rs', 'decoder/src/archive.rs', 'decoder/src/live.rs', 'decoder/src/blob.rs']) {
  test(`${file} production decoder path has no panic-style unwrap/expect`, () => {
    const source = fs.readFileSync(file, 'utf8').split('#[cfg(test)]')[0];
    assert.doesNotMatch(source, /\.unwrap\s*\(/, `${file} contains production unwrap()`);
    assert.doesNotMatch(source, /\.expect\s*\(/, `${file} contains production expect()`);
  });
}

test('Rust blob serializer rejects non-finite or impossible sweep geometry before allocation', () => {
  const source = fs.readFileSync('decoder/src/blob.rs', 'utf8').split('#[cfg(test)]')[0];
  assert.match(source, /first_gate\.is_finite\(\)/);
  assert.match(source, /gate_interval\.is_finite\(\)/);
  assert.match(source, /gate_interval\s*<=\s*0\.0/);
  assert.match(source, /scale\.is_finite\(\)/);
  assert.match(source, /scale\s*==\s*0\.0/);
  assert.match(source, /gate_count\s*==\s*0/);
});

test('Rust blob serializer uses checked layout arithmetic and checked u32 offset conversion', () => {
  const source = fs.readFileSync('decoder/src/blob.rs', 'utf8').split('#[cfg(test)]')[0];
  assert.match(source, /checked_(?:add|mul)/, 'blob layout must use checked arithmetic');
  assert.match(source, /u32::try_from\(radial_count\)/, 'radial_count must not truncate to u32');
  assert.match(source, /u32::try_from\(gate_count\)/, 'gate_count must not truncate to u32');
  assert.match(source, /u32::try_from\(gate_data_offset\)/, 'blob offsets must not truncate to u32');
  assert.doesNotMatch(source, /let total = gate_data_offset \+ gate_bytes;/, 'total blob size must not use unchecked addition');
});
