import fs from 'node:fs/promises';
import {
  MIN_EXPECTED_WSR88D_SITES,
  NWS_RADAR_SITES_WFS,
  stationsFromNwsWfsResponse,
} from '../src/radar/site-catalog.js';

const response = await fetch(NWS_RADAR_SITES_WFS, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`NWS radar-sites WFS HTTP ${response.status}`);

const payload = await response.json();
const rawCount = Array.isArray(payload?.features) ? payload.features.length : 0;
const sites = stationsFromNwsWfsResponse(payload);
if (sites.length < MIN_EXPECTED_WSR88D_SITES) {
  throw new Error(`catalog unexpectedly small: ${sites.length} WSR-88D sites from ${rawCount} WFS features`);
}

await fs.mkdir('src/data', { recursive: true });
await fs.writeFile('src/data/nexrad-sites.json', `${JSON.stringify(sites, null, 2)}\n`);
console.log(`wrote ${sites.length} current WSR-88D sites from ${rawCount} NWS radar-site features`);
