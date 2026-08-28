# PersonalNWS Alpha Stage 1 NEXRAD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one fully working historical KDOX radar volume in PersonalNWS Alpha with real tilts, REF/VEL/SW/RHO palettes, GPU map rendering, interrogation, and matching NST storm tracks.

**Architecture:** Preserve the current PersonalNWS map/controls while converting the project to Vite + TypeScript. Decode the fixed Archive II volume in a Web Worker through a small Rust/WASM adapter, convert selected sweeps to a stable polar-field contract, regularize azimuths in TypeScript, and render through one MapLibre custom WebGL layer using value/status textures and palette LUTs. Tracks are normalized from one matching Level III NST fixture into a stable JSON schema and drawn with ordinary MapLibre GeoJSON layers.

**Tech Stack:** Node.js 22.12+, Vite 8.2.2, TypeScript, Vitest 4.1.11, MapLibre GL JS 5.24.0, Rust stable, wasm-pack, `nexrad`/`nexrad-data`/`nexrad-model` 1.0, `nexrad-level-3-data` for fixture preparation.

**Spec:** `docs/superpowers/specs/2026-08-28-personalnws-stage1-nexrad-design.md`

## Global Constraints

- Preserve the current PersonalNWS Alpha visible layout, map styling, radar-site dots, state/county/CWA overlays, station focus behavior, and control placement.
- Keep MapLibre pinned at 5.24.0 for Stage 1; do not combine the NEXRAD work with a map-library upgrade.
- Stage 1 uses exactly one committed KDOX historical Level II volume and one matching NST fixture; no live polling or two-hour history.
- Render only REF, VEL, SW, and RHO until ZDR/PHI palettes are explicitly supplied.
- REF is transparent below 0 dBZ, fades alpha from 0–2 dBZ, and is fully palette-opaque at/above 2 dBZ.
- Missing and below-threshold gates are transparent; range-folded gates use RF color where the palette defines one.
- Decode Archive II only through Rust/WASM; do not create a second JavaScript Level II parser.
- Keep decoding off the map's main thread.
- Renderer is a MapLibre WebGL custom layer using polar textures; do not create one DOM/GeoJSON polygon per radar gate and do not pre-render Stage 1 to a PNG.
- Every task must pass its tests/build gate before the next task starts.
- Do not begin Stage 2 work until the Stage 1 acceptance sequence passes.

---

## File map locked by this plan

- `index.html` — existing markup/CSS, with the inline app script replaced by one module entrypoint.
- `src/main.ts` — application composition only.
- `src/app-state.ts` — selected product/tilt and extracted-field cache.
- `src/map/create-map.ts` — current MapLibre initialization and style fallback.
- `src/map/boundaries.ts` — current county/state/CWA layers.
- `src/map/stations.ts` — current station catalog, dots, selection, and gentle focus.
- `src/radar/types.ts` — stable TypeScript radar contracts and error codes.
- `src/radar/volume-worker.ts` — WASM initialization, fixture fetch/decode, field extraction.
- `src/radar/volume-client.ts` — typed worker RPC and transferable-buffer handling.
- `src/radar/selectors.ts` — product/tilt availability and SAILS duplicate selection.
- `src/radar/resample.ts` — raw-azimuth to 360/720-row regular field.
- `src/radar/geometry.ts` — 4/3-Earth CPU geometry used by interrogation/tests.
- `src/radar/radar-layer.ts` — MapLibre custom layer, GL resource lifecycle, texture uploads.
- `src/radar/shaders.ts` — vertex/fragment shader source.
- `src/radar/interrogation.ts` — cursor lookup/readout formatting.
- `src/palettes/parser.ts` — `.pal` parser.
- `src/palettes/lut.ts` — 2048-entry LUT generation.
- `src/palettes/catalog.ts` — product-to-palette mapping and asset loading.
- `src/tracks/types.ts` — stable `StormTrack` schema.
- `src/tracks/load-tracks.ts` — fixture JSON validation/loading.
- `src/tracks/map-layer.ts` — GeoJSON generation and toggle behavior.
- `radar-wasm/src/lib.rs` — only NOAA Archive II/model-specific adapter exposed to JS.
- `scripts/prepare-stage1-fixture.mjs` — select/download deterministic Level II + raw NST fixtures.
- `scripts/normalize-nst.mjs` — convert raw NST parser output to stable Stage 1 tracks JSON.
- `.github/workflows/deploy-pages.yml` — Rust/WASM + TypeScript tests/build + Pages deploy.

---

### Task 1: Freeze the working UI inside Vite without visual changes

**Files:**
- Modify: `index.html`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/main.ts`
- Create: `src/map/create-map.ts`
- Create: `src/map/boundaries.ts`
- Create: `src/map/stations.ts`
- Create: `tests/baseline-ui.test.ts`

**Interfaces:**
- Produces: `createPersonalNwsMap(): maplibregl.Map`
- Produces: `addBoundaryOverlays(map, cwaEnabled): void`
- Produces: `addRadarStations(map, callbacks): Promise<void>`
- Consumes later: the exact `map` instance from `createPersonalNwsMap()`.

- [ ] **Step 1: Add a baseline test that protects the current visible controls and branding.**

```ts
// tests/baseline-ui.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf8');

describe('PersonalNWS Alpha baseline UI', () => {
  it('keeps the accepted controls and branding', () => {
    expect(html).toContain('<title>PersonalNWS Alpha</title>');
    expect(html).toContain('id="product"');
    expect(html).toContain('id="tilt"');
    expect(html).toContain('id="tracks"');
    expect(html).toContain('id="cwa"');
    expect(html).toContain('id="timeline"');
    expect(html).not.toMatch(/frontend only|frontend shell/i);
  });
});
```

- [ ] **Step 2: Create the toolchain and run the test before moving the inline script.**

```json
{
  "name": "personalnws-alpha",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build:web": "vite build"
  },
  "dependencies": {
    "maplibre-gl": "5.24.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vite": "8.2.2",
    "vitest": "4.1.11"
  }
}
```

Run:

```bash
npm install
npm test -- tests/baseline-ui.test.ts
```

Expected: PASS on the untouched accepted HTML.

- [ ] **Step 3: Add Vite config without changing routing semantics.**

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/PersonalNWS/',
  build: { target: 'es2022' }
});
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

- [ ] **Step 4: Move current map logic out of the inline script with no behavioral redesign.**

`index.html` keeps its existing markup and CSS. Remove the CDN MapLibre `<script>` and replace the entire inline application script with:

```html
<script type="module" src="/src/main.ts"></script>
```

`src/map/create-map.ts` imports MapLibre and recreates the current map, including dark/liberty fallback, disabled rotation, saved center/zoom, navigation control, and the current POI/building/transit hiding.

`src/map/boundaries.ts` moves the accepted state/county/CWA layer definitions verbatim in behavior.

`src/map/stations.ts` moves station loading, fallback stations, station popup, selection filter, and the current gentle zoom logic.

- [ ] **Step 5: Compose those pieces from `src/main.ts`.**

```ts
import 'maplibre-gl/dist/maplibre-gl.css';
import { createPersonalNwsMap } from './map/create-map';
import { addBoundaryOverlays } from './map/boundaries';
import { addRadarStations } from './map/stations';

const map = createPersonalNwsMap();

map.on('load', async () => {
  addBoundaryOverlays(map, localStorage.getItem('pnws-cwa') === '1');
  await addRadarStations(map, { onSelect: () => {} });
});
```

The actual migration retains the existing shared preference object rather than introducing the temporary `pnws-cwa` key shown above; the point of this composition is to make radar integration consume one map object.

- [ ] **Step 6: Verify the baseline.**

Run:

```bash
npm test
npm run typecheck
npm run build:web
npm run dev
```

Manual gate: compare the local Vite page against the accepted HTML. State/county/CWA lines, station dots, controls, status bar, station selection, and gentle station focus must behave the same.

- [ ] **Step 7: Commit.**

```bash
git add index.html package.json package-lock.json tsconfig.json vite.config.ts src tests/baseline-ui.test.ts
git commit -m "chore: move PersonalNWS shell to Vite modules"
```

---

### Task 2: Add Rust/WASM volume decoding with a tiny stable API

**Files:**
- Create: `radar-wasm/Cargo.toml`
- Create: `radar-wasm/src/lib.rs`
- Create: `src/radar/types.ts`
- Create: `tests/radar-types.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces Rust class: `RadarVolume`
- Produces Rust class: `RadarField`
- Produces TS types: `RadarProduct`, `SweepSummary`, `TransferableRadarField`, `RadarErrorCode`.

- [ ] **Step 1: Define and test the PersonalNWS product/status contract first.**

```ts
// src/radar/types.ts
export type RadarProduct = 'REF' | 'VEL' | 'SW' | 'RHO';

export const GateStatus = {
  Missing: 0,
  Valid: 1,
  BelowThreshold: 2,
  RangeFolded: 3
} as const;

export interface SweepSummary {
  index: number;
  elevationDeg: number;
  collectionTimeMs: number;
  isSails: boolean;
  products: RadarProduct[];
}

export interface VolumeMetadata {
  stationId: string;
  latitude: number;
  longitude: number;
  elevationMeters: number;
  collectionTimeMs: number;
  vcpNumber: number;
  sweeps: SweepSummary[];
}
```

```ts
// tests/radar-types.test.ts
import { describe, expect, it } from 'vitest';
import { GateStatus } from '../src/radar/types';

describe('radar contract', () => {
  it('keeps gate status codes stable across WASM/worker/renderer', () => {
    expect(GateStatus).toEqual({ Missing: 0, Valid: 1, BelowThreshold: 2, RangeFolded: 3 });
  });
});
```

Run `npm test -- tests/radar-types.test.ts`; expected PASS.

- [ ] **Step 2: Create the WASM crate with only the required decoder/model features.**

```toml
# radar-wasm/Cargo.toml
[package]
name = "personalnws-radar-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
nexrad-data = { version = "1.0", default-features = false, features = ["decode", "nexrad-model"] }
nexrad-model = { version = "1.0", features = ["chrono"] }
```

- [ ] **Step 3: Write Rust unit tests against a deliberately invalid byte buffer before implementing the constructor.**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_archive_bytes_fail_cleanly() {
        let result = decode_scan(vec![1, 2, 3, 4]);
        assert!(result.is_err());
    }
}
```

Run:

```bash
cargo test --manifest-path radar-wasm/Cargo.toml
```

Expected: FAIL because `decode_scan` does not exist.

- [ ] **Step 4: Implement `decode_scan` at the documented `nexrad-data` boundary.**

```rust
use nexrad_data::volume::File;
use nexrad_model::data::Scan;

fn decode_scan(bytes: Vec<u8>) -> Result<Scan, String> {
    let file = File::new(bytes)
        .decompress()
        .map_err(|e| format!("archive decompression failed: {e}"))?;
    file.scan().map_err(|e| format!("volume decode failed: {e}"))
}
```

Re-run `cargo test`; expected PASS.

- [ ] **Step 5: Implement `RadarVolume` and `RadarField` as the only JS-visible decoder API.**

The wrapper stores `Scan` internally. `sweep_summaries_json()` iterates sweeps/radials to determine moment availability. `extract_field()` accepts only `REF`, `VEL`, `SW`, or `RHO`, builds a rectangular grid padded with Missing status, preserves the raw radial azimuth list, and maps `MomentValue::Value`, `BelowThreshold`, and `RangeFolded` to the fixed status codes.

JS-visible methods must match the design spec names exactly.

- [ ] **Step 6: Add package scripts and build the WASM package.**

```json
{
  "scripts": {
    "wasm:build": "wasm-pack build radar-wasm --target web --out-dir ../src/radar/wasm-pkg --dev",
    "wasm:build:release": "wasm-pack build radar-wasm --target web --out-dir ../src/radar/wasm-pkg --release"
  }
}
```

Run:

```bash
rustup target add wasm32-unknown-unknown
cargo install --locked wasm-pack
npm run wasm:build
```

Expected: `src/radar/wasm-pkg/` contains the generated JS glue and `.wasm` file.

- [ ] **Step 7: Verify all gates and commit.**

```bash
cargo test --manifest-path radar-wasm/Cargo.toml
npm test
npm run typecheck
git add radar-wasm src/radar/types.ts src/radar/wasm-pkg tests/radar-types.test.ts package.json package-lock.json
git commit -m "feat: add WASM Archive II decoder boundary"
```

---

### Task 3: Select and freeze the exact stormy KDOX Stage 1 fixtures

**Files:**
- Create: `scripts/prepare-stage1-fixture.mjs`
- Create: `public/test-data/kdox-stage1.ar2v`
- Create: `public/test-data/kdox-stage1-nst.bin`
- Create: `public/test-data/fixture.json`
- Create: `tests/fixture-contract.test.ts`

**Interfaces:**
- Produces: immutable Stage 1 Level II asset, raw NST asset, and manifest.
- Consumes: the Rust decoder created in Task 2 for candidate qualification.

- [ ] **Step 1: Add a manifest contract test before downloading anything.**

```ts
// tests/fixture-contract.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Stage 1 fixture', () => {
  it('pins one KDOX volume and matching NST object', () => {
    expect(existsSync('public/test-data/fixture.json')).toBe(true);
    const f = JSON.parse(readFileSync('public/test-data/fixture.json', 'utf8'));
    expect(f.station).toBe('KDOX');
    expect(Date.parse(f.volumeTime)).toBeGreaterThanOrEqual(Date.parse('2024-07-17T02:45:00Z'));
    expect(Date.parse(f.volumeTime)).toBeLessThanOrEqual(Date.parse('2024-07-17T04:00:00Z'));
    expect(f.minimumSweeps).toBeGreaterThanOrEqual(5);
    expect(f.requiredProducts).toEqual(['REF', 'VEL', 'SW', 'RHO']);
    expect(f.level2Sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(f.nstSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

Run `npm test -- tests/fixture-contract.test.ts`; expected FAIL because the fixture does not exist.

- [ ] **Step 2: Implement S3 XML listing and deterministic time filtering in the preparation script.**

Use public HTTPS S3 list requests, not AWS credentials. Constants are fixed:

```js
const SITE = 'KDOX';
const WINDOW_START = Date.parse('2024-07-17T02:45:00Z');
const WINDOW_END = Date.parse('2024-07-17T04:00:00Z');
const LEVEL2_BUCKET = 'https://unidata-nexrad-level2.s3.amazonaws.com';
const LEVEL3_BUCKET = 'https://unidata-nexrad-level3.s3.amazonaws.com';
```

List Level II prefix `2024/07/17/KDOX/`, parse object timestamps from keys, sort ascending, and consider only the fixed window.

- [ ] **Step 3: Add a native Rust fixture-inspection CLI entrypoint to the WASM crate package.**

Create `radar-wasm/src/bin/inspect_fixture.rs` that reads a candidate file, calls the same `decode_scan` logic, and prints one JSON object containing station, VCP, sweep count, and product availability. This prevents the fixture selector from using a different parser than the browser.

Run:

```bash
cargo run --manifest-path radar-wasm/Cargo.toml --bin inspect_fixture -- candidate.ar2v
```

Expected: valid JSON for a good volume and non-zero exit code for an invalid volume.

- [ ] **Step 4: Make the preparation script download candidates in chronological order and accept the first one meeting the fixed requirements.**

Requirements:

```js
const QUALIFY = {
  minimumSweeps: 5,
  minimumLowestReflectivityRadials: 300,
  requiredProducts: ['REF', 'VEL', 'SW', 'RHO']
};
```

For each candidate, save to a temporary file, invoke `cargo run ... inspect_fixture`, parse its JSON, and reject the candidate if any requirement fails.

- [ ] **Step 5: Find the nearest raw DOX NST Level III object within ±7 minutes.**

List Level III objects with prefix `DOX_NST_2024_07_17_`, parse the timestamp from `DOX_NST_YYYY_MM_DD_HH_MM_SS`, choose smallest absolute time difference to the accepted Level II volume, and fail if the difference exceeds 420 seconds.

- [ ] **Step 6: Hash and write immutable outputs.**

Write exactly:

```text
public/test-data/kdox-stage1.ar2v
public/test-data/kdox-stage1-nst.bin
public/test-data/fixture.json
```

`fixture.json` schema:

```json
{
  "station": "KDOX",
  "volumeKey": "<selected S3 key>",
  "volumeTime": "<ISO timestamp>",
  "level2Sha256": "<64 lowercase hex>",
  "nstKey": "<selected S3 key>",
  "nstTime": "<ISO timestamp>",
  "nstSha256": "<64 lowercase hex>",
  "minimumSweeps": 5,
  "minimumLowestReflectivityRadials": 300,
  "requiredProducts": ["REF", "VEL", "SW", "RHO"]
}
```

The angle-bracket strings above are generated values from the script, not hand-edited fields; the script refuses to leave any key/hash blank.

- [ ] **Step 7: Run the fixture and contract gates.**

```bash
node scripts/prepare-stage1-fixture.mjs
npm test -- tests/fixture-contract.test.ts
cargo run --manifest-path radar-wasm/Cargo.toml --bin inspect_fixture -- public/test-data/kdox-stage1.ar2v
```

Expected: contract PASS; inspector reports KDOX, ≥5 sweeps, all four required products.

- [ ] **Step 8: Commit the exact fixture.**

```bash
git add scripts/prepare-stage1-fixture.mjs public/test-data tests/fixture-contract.test.ts radar-wasm/src/bin/inspect_fixture.rs
git commit -m "test: freeze stormy KDOX Stage 1 fixture"
```

---

### Task 4: Decode in a Web Worker and expose typed worker RPC

**Files:**
- Create: `src/radar/volume-worker.ts`
- Create: `src/radar/volume-client.ts`
- Modify: `src/radar/types.ts`
- Create: `tests/volume-client.test.ts`

**Interfaces:**
- Produces: `VolumeClient.load(url): Promise<VolumeMetadata>`
- Produces: `VolumeClient.extract(sweepIndex, product): Promise<TransferableRadarField>`
- Consumes: WASM `RadarVolume`/`RadarField`.

- [ ] **Step 1: Write RPC behavior tests with a fake Worker.**

Tests must prove request IDs resolve the correct promise, worker errors reject with the supplied stable error code, and `field` messages preserve transferred typed arrays.

- [ ] **Step 2: Implement the worker message types exactly.**

```ts
export type WorkerRequest =
  | { type: 'load'; url: string }
  | { type: 'extract'; requestId: number; sweepIndex: number; product: RadarProduct };

export type WorkerResponse =
  | { type: 'ready'; metadata: VolumeMetadata }
  | { type: 'field'; requestId: number; field: TransferableRadarField }
  | { type: 'error'; requestId?: number; code: RadarErrorCode; message: string };
```

- [ ] **Step 3: Implement worker load.**

The worker:

1. initializes WASM once;
2. fetches `/test-data/kdox-stage1.ar2v` relative to `import.meta.env.BASE_URL`;
3. creates one `RadarVolume` and retains it;
4. converts sweep summary JSON to `VolumeMetadata`;
5. posts `ready`.

- [ ] **Step 4: Implement field extraction with transferable buffers.**

Convert `RadarField` getters to TypeScript typed arrays, then post:

```ts
postMessage(
  { type: 'field', requestId, field },
  [field.azimuths.buffer, field.values.buffer, field.status.buffer]
);
```

- [ ] **Step 5: Add `VolumeClient` and run gates.**

```bash
npm test -- tests/volume-client.test.ts
npm run typecheck
npm run wasm:build
npm run build:web
```

- [ ] **Step 6: Commit.**

```bash
git add src/radar tests/volume-client.test.ts
git commit -m "feat: decode Stage 1 volume in radar worker"
```

---

### Task 5: Implement product/tilt selection and repeated-elevation rules

**Files:**
- Create: `src/radar/selectors.ts`
- Create: `tests/selectors.test.ts`
- Create: `src/app-state.ts`

**Interfaces:**
- Produces: `tiltsForProduct(sweeps, product): TiltOption[]`
- Produces: `chooseClosestTilt(options, requestedElevation): TiltOption`
- Produces: `AppState` holding `product`, `tilt`, `volumeMetadata`, and field cache.

- [ ] **Step 1: Write tests for product filtering, SAILS duplicates, and closest-tilt fallback.**

Use synthetic sweep metadata including three 0.5° REF sweeps at different times. Assert the newest one is selected while the menu shows one `0.5°` entry.

- [ ] **Step 2: Implement stable elevation grouping.**

```ts
const SAME_ELEVATION_TOLERANCE_DEG = 0.05;
```

Sort by elevation; group within tolerance; for each group keep the newest `collectionTimeMs` sweep that contains the selected product.

- [ ] **Step 3: Implement product change behavior.**

When product changes, retain current elevation if a group exists within 0.05°. Otherwise choose the closest elevation; on exact distance ties choose the lower elevation.

- [ ] **Step 4: Run and commit.**

```bash
npm test -- tests/selectors.test.ts
npm run typecheck
git add src/radar/selectors.ts src/app-state.ts tests/selectors.test.ts
git commit -m "feat: select real radar products and tilts"
```

---

### Task 6: Parse the four supplied palettes and generate deterministic LUTs

**Files:**
- Create: `public/palettes/BR.pal`
- Create: `public/palettes/BV.pal`
- Create: `public/palettes/SW.pal`
- Create: `public/palettes/KK.pal`
- Create: `src/palettes/parser.ts`
- Create: `src/palettes/lut.ts`
- Create: `src/palettes/catalog.ts`
- Create: `tests/palette.test.ts`

**Interfaces:**
- Produces: `parsePalette(text): RadarPalette`
- Produces: `buildPaletteLut(palette, size = 2048): PaletteLut`
- Produces: `loadPalette(product): Promise<PaletteLut>`

- [ ] **Step 1: Copy the exact user-supplied palette files into `public/palettes/` without modifying their color stops.**

Map names exactly:

```text
Apocs_BR_Expert.pal -> BR.pal
ALPHA-Velo.pal      -> BV.pal
Ben's SW.pal        -> SW.pal
kk.pal              -> KK.pal
```

- [ ] **Step 2: Write parser tests using real lines from all four files.**

Tests must prove:

- directives are case-insensitive;
- semicolon comments are removed;
- `benjamin was here` is ignored rather than fatal;
- BV/SW Scale is `1.9426`;
- SW RF is `[117,0,117,255]`;
- descending CC stops are sorted ascending;
- BR `Color: -2 21 53 86 31 154 180` keeps both endpoint colors.

- [ ] **Step 3: Implement `parsePalette`.**

```ts
export interface PaletteStop {
  value: number;
  start: [number, number, number, number];
  end: [number, number, number, number];
}

export interface RadarPalette {
  product?: string;
  units?: string;
  scale: number;
  offset: number;
  step?: number;
  rf?: [number, number, number, number];
  stops: PaletteStop[];
}
```

Unknown lines are ignored. A recognized directive with malformed numeric fields throws `PALETTE_INVALID`.

- [ ] **Step 4: Write LUT interpolation tests before implementing the LUT.**

For a stop interval `[v0, v1]`, interpolate from stop0.start to stop0.end across the interval when stop0 has two colors. If stop0 had one color, use that color as its start/end, yielding a continuous transition only where the table explicitly describes one.

- [ ] **Step 5: Implement the 2048-entry LUT and product conversion metadata.**

```ts
const PRODUCT_PALETTES = {
  REF: 'BR.pal',
  VEL: 'BV.pal',
  SW: 'SW.pal',
  RHO: 'KK.pal'
} as const;
```

`PaletteLut` stores min/max palette-domain values, `scale`, `offset`, RGBA bytes, and optional RF color.

- [ ] **Step 6: Verify the REF alpha helper separately.**

```ts
export function reflectivityAlpha(dbz: number): number {
  if (dbz <= 0) return 0;
  if (dbz >= 2) return 1;
  return dbz / 2;
}
```

Test exact values at -1, 0, 0.5, 1, 2, and 10 dBZ.

- [ ] **Step 7: Run and commit.**

```bash
npm test -- tests/palette.test.ts
npm run typecheck
git add public/palettes src/palettes tests/palette.test.ts
git commit -m "feat: parse PersonalNWS radar palettes"
```

---

### Task 7: Regularize polar fields and implement shared radar geometry

**Files:**
- Create: `src/radar/resample.ts`
- Create: `src/radar/geometry.ts`
- Create: `tests/resample.test.ts`
- Create: `tests/geometry.test.ts`

**Interfaces:**
- Produces: `regularizeField(raw): RegularPolarField`
- Produces: `groundToSlantRangeMeters(groundMeters, elevationDeg): number`
- Produces: `bearingAndDistance(radarLat, radarLon, lat, lon)`.

- [ ] **Step 1: Write azimuth-resampling tests.**

Synthetic cases must cover 1° data -> 360 rows, 0.5° data -> 720 rows, circular wrap near 359.8°/0.1°, duplicate raw radials choosing the smaller angular error, and unfilled bins remaining Missing.

- [ ] **Step 2: Implement regularization.**

Determine median positive circular azimuth spacing. Use 720 bins if median < 0.75°, else 360. Copy an entire radial's values/status into its winning target row; do not average competing raw radials.

- [ ] **Step 3: Write geometry tests before implementation.**

Required invariants:

```text
groundToSlantRangeMeters(0, any elevation) = 0
higher elevation -> larger slant range for same nonzero ground range
bearing north ~= 0°
bearing east ~= 90°
round-trip point at 100 km returns approximately 100 km
```

- [ ] **Step 4: Implement constants/formula exactly once.**

```ts
export const EARTH_RADIUS_M = 6_371_000;
export const EFFECTIVE_EARTH_RADIUS_M = EARTH_RADIUS_M * 4 / 3;

export function groundToSlantRangeMeters(groundMeters: number, elevationDeg: number): number {
  const R = EFFECTIVE_EARTH_RADIUS_M;
  const alpha = groundMeters / R;
  const elevation = elevationDeg * Math.PI / 180;
  return R * Math.sin(alpha) / Math.cos(elevation + alpha);
}
```

Use haversine distance and initial bearing for the CPU path.

- [ ] **Step 5: Run and commit.**

```bash
npm test -- tests/resample.test.ts tests/geometry.test.ts
npm run typecheck
git add src/radar/resample.ts src/radar/geometry.ts tests/resample.test.ts tests/geometry.test.ts
git commit -m "feat: normalize polar radar geometry"
```

---

### Task 8: Render a debug REF sweep with one MapLibre custom WebGL layer

**Files:**
- Create: `src/radar/shaders.ts`
- Create: `src/radar/radar-layer.ts`
- Create: `tests/radar-layer-contract.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `RadarLayer implements maplibregl.CustomLayerInterface`
- Produces: `RadarLayer.setField(field, palette): void`
- Produces: `RadarLayer.clear(): void`

- [ ] **Step 1: Test renderer contracts without requiring a real GPU.**

Tests assert the layer has `id = 'pnws-radar'`, `type = 'custom'`, `renderingMode = '2d'`, and that `setField` rejects mismatched `values/status` lengths before touching GL.

- [ ] **Step 2: Implement GL resource lifecycle first.**

`onAdd` compiles/link shaders, creates one quad VBO, value texture, status texture, and palette texture. `onRemove` deletes all created GL resources. Shader compile/link failures throw stable Stage 1 error codes.

- [ ] **Step 3: Implement the vertex shader as a Mercator quad.**

The layer computes a geographic bounding box around KDOX using the field's maximum range. Four quad vertices carry Mercator X/Y and pass Mercator coordinates to the fragment shader. The map-provided matrix positions the quad.

- [ ] **Step 4: Implement a debug fragment shader before palette coloring.**

The fragment shader must:

1. inverse-Mercator the fragment coordinate to lon/lat;
2. compute great-circle ground distance and bearing from KDOX;
3. compute slant range with the same 4/3-Earth equation;
4. compute polar texture coordinates;
5. read status/value;
6. draw valid REF as grayscale and everything else transparent.

This debug gate intentionally ignores the palette. It proves decoding + geometry + GPU sampling independently.

- [ ] **Step 5: Integrate only the lowest REF sweep.**

`src/main.ts` loads the Stage 1 volume after map load, selects the lowest REF tilt, extracts/regularizes it, adds `RadarLayer` below PersonalNWS boundaries/labels, and uploads the field.

- [ ] **Step 6: Verify the first visual proof.**

Run:

```bash
npm test
npm run typecheck
npm run wasm:build
npm run dev
```

Manual gate: a recognizable grayscale radar pattern appears around KDOX and remains fixed to geography while pan/zooming. If blank, do not start Task 9; inspect `[PNWS:*]` logs until the failing boundary is identified.

- [ ] **Step 7: Commit only after the grayscale proof works.**

```bash
git add src/radar src/main.ts tests/radar-layer-contract.test.ts
git commit -m "feat: render decoded KDOX reflectivity on map"
```

---

### Task 9: Add full palette rendering and status-aware spatial interpolation

**Files:**
- Modify: `src/radar/shaders.ts`
- Modify: `src/radar/radar-layer.ts`
- Create: `tests/render-policy.test.ts`

**Interfaces:**
- Consumes: `RegularPolarField`, `PaletteLut`.
- Produces: same `RadarLayer.setField()` with final Stage 1 color behavior.

- [ ] **Step 1: Write CPU policy tests mirroring shader decisions.**

Create pure helpers for tests that assert:

- Missing/BelowThreshold -> transparent;
- RF -> RF color if defined;
- REF alpha fade exactly matches the spec;
- VEL/SW use `value * 1.9426` before LUT lookup;
- RHO uses scale 1;
- invalid neighbors are excluded from numeric interpolation.

- [ ] **Step 2: Upload palette as a 2048×1 RGBA8 texture and status as an integer/nearest texture.**

The value texture stores physical `Float32` values. The shader applies palette scale/offset, then maps palette-domain value into the LUT range.

- [ ] **Step 3: Implement valid-only bilinear sampling.**

Sample the 2×2 neighborhood in azimuth/range. If all four status values are Valid, bilinear-interpolate numeric values. Otherwise choose the nearest Valid gate in that neighborhood. If nearest non-missing gate is RangeFolded, use RF color. If none is usable, output transparent.

- [ ] **Step 4: Use premultiplied alpha as MapLibre expects.**

Before output, multiply RGB by final alpha. REF applies the 0–2 dBZ fade after numeric interpolation and before premultiplication.

- [ ] **Step 5: Verify all four palettes manually and commit.**

Manual gate: REF resembles the supplied Apocs palette with smooth gradients; BV and SW show knots-based color placement; KK/CC covers its 0–1.05 domain; no large rectangle appears around the radar where data is missing.

```bash
npm test
npm run typecheck
npm run build:web
git add src/radar tests/render-policy.test.ts
git commit -m "feat: apply Stage 1 radar palettes in WebGL"
```

---

### Task 10: Wire real product and tilt controls with field caching

**Files:**
- Modify: `src/main.ts`
- Modify: `src/app-state.ts`
- Create: `src/radar/control-binding.ts`
- Create: `tests/control-binding.test.ts`

**Interfaces:**
- Produces: `bindRadarControls(options): () => void`
- Consumes: `VolumeClient`, selectors, palette catalog, `RadarLayer`.

- [ ] **Step 1: Test control population and fallback behavior with a fake volume.**

Assert REF/VEL/SW/RHO are enabled, ZDR/PHI remain disabled/unavailable, tilt options reflect real sweep metadata, and product change keeps/chooses elevation according to Task 5 rules.

- [ ] **Step 2: Implement a field cache key.**

```ts
export function fieldCacheKey(sweepIndex: number, product: RadarProduct): string {
  return `${sweepIndex}:${product}`;
}
```

Cache `RegularPolarField` after first extraction. Product/tilt switching never re-fetches the Archive II file.

- [ ] **Step 3: Replace `Tilt: —` with real elevations only after volume metadata is ready.**

Before decode, tilt remains `—`. After decode, select REF and the lowest available elevation unless saved UI state points to a valid Stage 1 choice.

- [ ] **Step 4: Make control changes transactional.**

Disable product/tilt controls while a new uncached field is extracting, keep the currently rendered field visible, then atomically upload the completed new field and re-enable controls. On failure, keep the previous field and show a specific error.

- [ ] **Step 5: Update the status/timestamp.**

The status bar shows `KDOX`, its decoded site name/fixture status, and the fixed volume time. It never claims the historical Stage 1 volume is live.

- [ ] **Step 6: Verify and commit.**

```bash
npm test -- tests/control-binding.test.ts tests/selectors.test.ts
npm run typecheck
npm run build:web
git add src/main.ts src/app-state.ts src/radar/control-binding.ts tests/control-binding.test.ts
git commit -m "feat: connect radar products and tilts"
```

---

### Task 11: Add cursor radar interrogation using the same geometry contract

**Files:**
- Create: `src/radar/interrogation.ts`
- Create: `tests/interrogation.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `interrogate(field, palette, radarSite, lat, lon): RadarReadout`
- Produces: `formatRadarReadout(readout): string`.

- [ ] **Step 1: Write deterministic nearest-gate tests.**

Synthetic field cases cover valid REF, valid VEL, valid SW, valid RHO, RF, missing, and outside-range positions.

- [ ] **Step 2: Implement lookup with Task 7 geometry.**

Use bearing to select the nearest regularized azimuth row and slant range to select nearest gate. This is intentionally nearest-gate interrogation even though display coloring is bilinear.

- [ ] **Step 3: Format values.**

```text
REF -> 47.3 dBZ
VEL -> -38 kt
SW  -> 12 kt
RHO -> 0.94
RF  -> RF
none -> —
```

VEL/SW readout applies the palette scale/offset before formatting.

- [ ] **Step 4: Wire the existing `#value` readout and commit.**

```bash
npm test -- tests/interrogation.test.ts tests/geometry.test.ts
npm run typecheck
git add src/radar/interrogation.ts src/main.ts tests/interrogation.test.ts
git commit -m "feat: interrogate radar values under cursor"
```

---

### Task 12: Normalize the matching NST fixture and make Tracks real

**Files:**
- Modify: `package.json`
- Create: `scripts/normalize-nst.mjs`
- Create: `public/test-data/kdox-stage1-tracks.json`
- Create: `src/tracks/types.ts`
- Create: `src/tracks/load-tracks.ts`
- Create: `src/tracks/map-layer.ts`
- Create: `tests/tracks.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `loadStage1Tracks(): Promise<StormTrack[]>`
- Produces: `addTrackLayers(map, tracks): TrackLayerController`
- `TrackLayerController.setVisible(boolean): void`.

- [ ] **Step 1: Add the Level III parser as a development dependency only.**

```bash
npm install -D nexrad-level-3-data
```

Do not import it from browser code.

- [ ] **Step 2: Parse the frozen raw NST fixture and assert product 58 before normalizing.**

`scripts/normalize-nst.mjs` reads `kdox-stage1-nst.bin`, calls `nexrad-level-3-data`, verifies the decoded product code is 58/NST, then extracts current-cell positions and linked past/forecast vectors from the parser's symbology packets. Conversion from radar-relative positions to lat/lon uses KDOX coordinates from `fixture.json`/decoded metadata.

The script fails with non-zero exit if zero usable storm tracks are produced.

- [ ] **Step 3: Write only the stable schema to browser assets.**

```ts
export interface StormTrack {
  id: string;
  current: [number, number];
  past: Array<[number, number]>;
  forecast: Array<[number, number]>;
  movementDeg?: number;
  movementKt?: number;
}
```

`kdox-stage1-tracks.json` contains an array of these objects plus fixture timestamp metadata; no raw external-parser object is shipped as application state.

- [ ] **Step 4: Write browser-side track validation tests.**

Reject non-finite coordinates, missing IDs, malformed coordinate pairs, or an empty Stage 1 track list.

- [ ] **Step 5: Implement one GeoJSON source and three layers.**

Create:

- past line layer: subdued violet/gray;
- forecast line layer: brighter violet;
- current-cell point + small cell-ID symbol.

All track layers sit above state/CWA/county/radar and below/alongside station/place labels as defined by the spec.

- [ ] **Step 6: Wire the existing Tracks button.**

The button's existing active state controls layer visibility immediately. Remove the old placeholder toast that says no track data is connected.

- [ ] **Step 7: Verify and commit.**

```bash
node scripts/normalize-nst.mjs
npm test -- tests/tracks.test.ts
npm run typecheck
npm run build:web
git add package.json package-lock.json scripts/normalize-nst.mjs public/test-data/kdox-stage1-tracks.json src/tracks src/main.ts tests/tracks.test.ts
git commit -m "feat: display Stage 1 NEXRAD storm tracks"
```

---

### Task 13: Add diagnostics, exact Stage 1 error states, and final integration tests

**Files:**
- Create: `src/diagnostics.ts`
- Modify: `src/radar/types.ts`
- Modify: `src/main.ts`
- Create: `tests/error-contract.test.ts`
- Create: `tests/stage1-contract.test.ts`

**Interfaces:**
- Produces: `pnwsLog(scope, message, data?)`
- Produces fixed `RadarErrorCode` union matching the spec.

- [ ] **Step 1: Lock the error-code union in a test.**

Expected exact set:

```text
WASM_INIT_FAILED
FIXTURE_FETCH_FAILED
FIXTURE_HASH_MISMATCH
VOLUME_DECODE_FAILED
NO_SWEEPS
PRODUCT_UNAVAILABLE
FIELD_EXTRACTION_FAILED
PALETTE_FETCH_FAILED
PALETTE_INVALID
WEBGL_UNSUPPORTED
SHADER_COMPILE_FAILED
SHADER_LINK_FAILED
TRACKS_LOAD_FAILED
TRACKS_INVALID
```

- [ ] **Step 2: Add development diagnostics.**

Successful boot logs station, volume time, VCP, sweep count, product availability, selected sweep index/elevation, raw radial/gate dimensions, regularized texture dimensions, palette domain, and track count under the fixed `[PNWS:*]` prefixes.

- [ ] **Step 3: Verify the fixture SHA-256 in the worker before decode.**

Load `fixture.json`, hash downloaded Level II bytes with `crypto.subtle.digest('SHA-256', bytes)`, compare to `level2Sha256`, and fail with `FIXTURE_HASH_MISMATCH` before constructing `RadarVolume` if they differ.

- [ ] **Step 4: Add a Stage 1 static contract test.**

The test asserts:

- no live Level II chunk URL exists in source;
- no two-hour/history polling code exists;
- exactly four product-to-palette mappings exist;
- the renderer ID is `pnws-radar`;
- Stage 1 asset paths exist;
- ZDR/PHI are not mapped to invented palettes.

- [ ] **Step 5: Run the entire automated gate.**

```bash
cargo test --manifest-path radar-wasm/Cargo.toml
npm test
npm run typecheck
npm run wasm:build:release
npm run build:web
```

All commands must exit 0 before proceeding.

- [ ] **Step 6: Commit.**

```bash
git add src tests
git commit -m "test: lock PersonalNWS Stage 1 radar contract"
```

---

### Task 14: Build and deploy Stage 1 through GitHub Actions, then freeze it

**Files:**
- Create: `.github/workflows/deploy-pages.yml`
- Modify: `package.json`
- Modify: `README.md` if the repository has one.

**Interfaces:**
- Produces: repeatable `npm run build` and GitHub Pages `dist/` deployment.

- [ ] **Step 1: Make one local command represent the production build.**

```json
{
  "scripts": {
    "build": "npm run wasm:build:release && npm run typecheck && npm test && vite build"
  }
}
```

Run `npm run build`; expected exit 0.

- [ ] **Step 2: Add the Pages workflow.**

```yaml
name: Deploy PersonalNWS Alpha

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.12'
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - run: cargo install --locked wasm-pack
      - run: npm ci
      - run: cargo test --manifest-path radar-wasm/Cargo.toml
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Push and require the GitHub Actions build/deploy jobs to be green.**

Do not debug a failed production build by bypassing the workflow or manually uploading `dist/`.

- [ ] **Step 4: Perform the complete manual Stage 1 acceptance sequence from the spec on the deployed GitHub Pages URL.**

Required checks:

```text
hard refresh
map + existing overlays intact
KDOX fixture timestamp shown
REF lowest tilt renders
pan/zoom alignment
CWA toggle
REF/VEL/SW/RHO switching
3+ tilts per product where available
REF 0–2 dBZ fade
cursor interrogation
Tracks off/on
station-dot selection does not pretend fixed KDOX data changed
zero uncaught console errors
zero failed Stage 1 local assets
zero shader compile/link errors
```

- [ ] **Step 5: Tag the Stage 1 freeze only after every automated and manual check passes.**

```bash
git tag personalnws-alpha-stage1

git push origin personalnws-alpha-stage1
```

This tag is the rollback point before Stage 2 begins.

- [ ] **Step 6: Commit workflow/docs before tagging if they changed.**

```bash
git add .github/workflows/deploy-pages.yml package.json package-lock.json README.md
git commit -m "ci: deploy verified Stage 1 radar build"
```

---

## Execution order and hard stop rules

```text
Task 1  Vite baseline
  ↓
Task 2  WASM decoder
  ↓
Task 3  frozen KDOX/NST fixture
  ↓
Task 4  worker decode
  ↓
Task 5  product/tilt selectors
  ↓
Task 6  palette engine
  ↓
Task 7  polar normalization + geometry
  ↓
Task 8  GRAYSCALE REF ON MAP  ← first giant proof gate
  ↓
Task 9  final colors/interpolation
  ↓
Task 10 product + tilt UI
  ↓
Task 11 cursor interrogation
  ↓
Task 12 real NST Tracks
  ↓
Task 13 diagnostics/contracts
  ↓
Task 14 GitHub Pages acceptance + Stage 1 tag
```

If Task 8 does not produce a recognizable geographically aligned grayscale REF sweep, **stop there**. Do not add palettes, products, tilts, tracks, timeline code, or live data while the core render is unproven.

If any implementation task requires changing the stable WASM/field contract, update the spec first and explicitly re-check every downstream task that consumes that contract.

## Stage 2 handoff contract

Stage 2 is allowed to add:

- current KDOX volume discovery/download;
- two-hour volume index;
- timeline values;
- frame stepping/playback;
- caching/prefetching;
- continuous update logic.

Stage 2 should **not** replace the Stage 1 decoder, palette parser, regular polar-field format, shader geometry, product/tilt selectors, interrogation format, or normalized `StormTrack` schema unless profiling/tests prove a specific limitation.
