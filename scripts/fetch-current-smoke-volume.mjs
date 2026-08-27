import fs from 'node:fs/promises';
import { findCurrentVolume } from './current-smoke-lib.mjs';

const sites = (process.env.PERSONALNWS_SMOKE_SITES || 'KTLX,KDOX,KATX,PAHG,PHKI,TJUA')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const found = await findCurrentVolume({ sites, lookbackDays: 2 });
if (!found) {
  throw new Error(`no current Level II volume found for smoke sites: ${sites.join(', ')}`);
}

const response = await fetch(found.url, { cache: 'no-store' });
if (!response.ok) throw new Error(`current Level II object HTTP ${response.status}: ${found.url}`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.byteLength < 100_000) {
  throw new Error(`current Level II smoke object is unexpectedly small (${bytes.byteLength} bytes): ${found.key}`);
}

await fs.mkdir('tests/fixtures', { recursive: true });
await fs.writeFile('tests/fixtures/current-smoke-volume', bytes);
await fs.writeFile(
  'tests/fixtures/current-smoke.json',
  `${JSON.stringify({ site: found.site, key: found.key, bytes: bytes.byteLength }, null, 2)}\n`,
);
console.log(`downloaded current ${found.site} volume ${found.key} (${bytes.byteLength} bytes)`);
