# PersonalNWS V1.4.8 Rust/WASM Radar Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PersonalNWS V1.4.8 as a GitHub Pages web release that decodes real WSR-88D Level II in Rust/WASM, supports every active NEXRAD Level II site through one generic pipeline, caches native sweep blobs for decode-free playback, ingests realtime chunks, and remains smooth while history work runs in the background.

**Architecture:** Keep the main thread thin: MapLibre, controls, timeline, and the custom WebGL radar layer only. Two module workers own NEXRAD HTTP, IndexedDB, and independent Rust/WASM `RadarEngine` instances. Rust uses the pinned `danielway/nexrad` release-candidate stack to decode Archive II records and live chunks, then serializes native raw moments into the frozen 96-byte `PSWP` SweepBlob V1 format.

**Tech Stack:** Rust 2021, `wasm-bindgen`, pinned `nexrad`/`nexrad-*` RC crates, `wasm-pack`, JavaScript ES modules, Vite 7.3.6, Vitest, Playwright/Chromium, MapLibre GL JS 5.24.0, IndexedDB, Web Workers, WebGL2, GitHub Actions, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-23-personalnws-v1.4.8-rust-wasm-engine-design.md`

## Global Constraints

- Release name is exactly **PersonalNWS V1.4.8**. It is a numbered production release, not a prototype.
- Hosting remains GitHub Pages. GitHub Desktop remains the user's replace/commit/push workflow.
- Decoder baseline is pinned: `nexrad = 1.0.0-rc.4`, `nexrad-data = 1.0.0-rc.7`, `nexrad-decode = 1.0.0-rc.3`, `nexrad-model = 1.0.0-rc.2`.
- Rust/WASM is built by `wasm-pack`; Vite copies `public/decoder/` and must not transform the `.wasm` binary.
- Main thread never instantiates the radar WASM module.
- Native release products are product IDs 1-6: REF, VEL, SW, ZDR, RHO/CC, PHI, when present in the selected cut.
- Elevation number is identity; angle is display metadata. Similar/duplicate low-level angles remain distinct cuts.
- `SweepBlob V1` is `PSWP`, version 1, 96-byte little-endian header, native raw `u8`/`u16` gates, no fixed `720 x 1840` resampling.
- Completed blobs are persisted once in IndexedDB and replayed without network/decompression/Rust decode.
- Priority/live worker must not wait on history backfill worker.
- No paid weather API, usage-based billing API, server-side radar preprocessing, fake radar fallback, WASM threads, Rayon, SharedArrayBuffer, or cross-origin-isolation requirement.
- "All radars" means every active WSR-88D/NEXRAD Level II site in the current NOAA/NWS catalog that publishes through the public Unidata Level II path. No handpicked supported-site decoder allowlist.
- Runtime uses the current NOAA/NCEI NEXRAD station layer when reachable and a checked-in fallback catalog when not. TDWR remains outside V1.4.8.
- Current public Level II buckets are `unidata-nexrad-level2` for completed volumes and `unidata-nexrad-level2-chunks` for realtime chunks.
- Cached 20-frame Chromium benchmark: median request-to-render-ready <= 75 ms; p95 <= 150 ms.
- Renderer-memory frame swap benchmark: p95 <= 50 ms.
- Cached playback must cause zero main-thread Long Tasks (>50 ms) attributable to decode/cache work.
- Map pan/zoom must not increment radar fetch or decoder-call counters.
- Every ordinary failure crosses Rust/worker boundaries as a structured error; user-visible text may never collapse all failures into only "decoder failed".
- No release artifact is labeled V1.4.8 until every release gate in this plan passes.

---

## File Structure

Create or replace these focused units. Files are split by responsibility so decoder, caching, rendering, network, and UI can be tested independently.

```text
PersonalNWS/
├── index.html
├── package.json
├── vite.config.js
├── README.md
├── THIRD_PARTY.md
├── src/
│   ├── main.js                       # App bootstrap only
│   ├── app-controller.js             # UI state + worker orchestration
│   ├── config.js                     # Public URLs, version, product IDs
│   ├── diagnostics.js                # Structured visible diagnostics
│   ├── data/
│   │   └── nexrad-sites.json         # Checked-in station fallback
│   ├── radar/
│   │   ├── blob-reader.js            # PSWP header validation/views
│   │   ├── cache.js                  # IndexedDB stores + migrations
│   │   ├── nexrad-source.js          # S3 listing/object/chunk URLs
│   │   ├── site-catalog.js           # NOAA catalog + fallback merge
│   │   ├── worker-client.js          # Typed message RPC
│   │   ├── priority-worker.js        # Current/latest/live pipeline
│   │   ├── history-worker.js         # Two-hour archive backfill
│   │   ├── worker-core.js            # Shared worker logic
│   │   ├── wasm-loader.js            # Static decoder package init
│   │   └── worker-protocol.js        # Message names/schema guards
│   ├── render/
│   │   ├── radar-layer.js            # MapLibre custom WebGL layer
│   │   ├── radar-gl.js               # GL buffers/textures/shaders
│   │   ├── color-tables.js           # Product palettes/units
│   │   └── probe.js                  # raw -> physical readout
│   ├── timeline/
│   │   ├── timeline-model.js
│   │   └── playback.js
│   └── ui/
│       ├── radar-markers.js
│       ├── controls.js
│       └── styles.css
├── decoder/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   └── src/
│       ├── lib.rs                    # wasm_bindgen RadarEngine API
│       ├── archive.rs                # completed Archive II ingest
│       ├── live.rs                   # stateful realtime accumulator
│       ├── blob.rs                   # PSWP serializer
│       ├── model.rs                  # manifest/delta/product types
│       └── error.rs                  # stable error contract
├── public/
│   ├── .nojekyll
│   ├── manifest.webmanifest
│   └── decoder/                      # generated in CI, not hand-edited
├── scripts/
│   ├── refresh-radar-catalog.mjs
│   └── audit-radar-network.mjs
├── tests/
│   ├── js/
│   │   ├── blob-reader.test.js
│   │   ├── cache.test.js
│   │   ├── nexrad-source.test.js
│   │   ├── site-catalog.test.js
│   │   └── worker-protocol.test.js
│   ├── browser/
│   │   ├── radar-flow.spec.js
│   │   └── performance.spec.js
│   └── fixtures/
│       ├── fixture-index.json
│       └── pswp/
│           ├── ref-u8.pswp
│           └── phi-u16.pswp
└── .github/
    └── workflows/
        ├── pages.yml
        └── radar-network-audit.yml
```

---

### Task 1: Establish the V1.4.8 repository/test skeleton

**Files:**
- Create: `src/main.js`
- Create: `src/config.js`
- Create: `src/ui/styles.css`
- Replace: `index.html`
- Replace: `package.json`
- Replace: `vite.config.js`
- Create: `vitest.config.js`
- Create: `playwright.config.js`
- Create: `tests/js/config.test.js`

**Interfaces:**
- Consumes: approved V1.4.8 spec.
- Produces: `APP_VERSION`, product constants, Vite entry point, Vitest/Playwright commands used by every later task.

- [ ] **Step 1: Write the failing version/product ABI test**

```js
// tests/js/config.test.js
import { describe, expect, it } from "vitest";
import { APP_VERSION, PRODUCTS } from "../../src/config.js";

describe("V1.4.8 ABI", () => {
  it("uses the frozen release version", () => {
    expect(APP_VERSION).toBe("1.4.8");
  });

  it("keeps stable product IDs", () => {
    expect(PRODUCTS).toEqual({
      REF: 1, VEL: 2, SW: 3, ZDR: 4, RHO: 5, PHI: 6
    });
  });
});
```

- [ ] **Step 2: Create package/test configuration and run the failing test**

```json
{
  "name": "personalnws",
  "private": true,
  "version": "1.4.8",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "test:browser": "playwright test",
    "build": "vite build"
  },
  "dependencies": {
    "maplibre-gl": "5.24.0"
  },
  "devDependencies": {
    "@playwright/test": "1.55.0",
    "vite": "7.3.6",
    "vitest": "3.2.4"
  }
}
```

Run: `npm install --no-audit --no-fund && npm test -- tests/js/config.test.js`  
Expected: FAIL because `src/config.js` does not exist yet.

- [ ] **Step 3: Implement the frozen constants**

```js
// src/config.js
export const APP_VERSION = "1.4.8";

export const PRODUCTS = Object.freeze({
  REF: 1,
  VEL: 2,
  SW: 3,
  ZDR: 4,
  RHO: 5,
  PHI: 6,
});

export const LEVEL2_ARCHIVE_BASE = "https://unidata-nexrad-level2.s3.amazonaws.com";
export const LEVEL2_CHUNKS_BASE = "https://unidata-nexrad-level2-chunks.s3.amazonaws.com";
```

- [ ] **Step 4: Create a minimal Vite boot path that preserves the existing operational shell**

```js
// src/main.js
import "maplibre-gl/dist/maplibre-gl.css";
import "./ui/styles.css";
import { APP_VERSION } from "./config.js";

document.documentElement.dataset.personalNwsVersion = APP_VERSION;
```

`index.html` must contain the existing map, status, product, tilt, speed, play, tracks, readout, timeline, and fatal-diagnostic elements; change the module entry to `./src/main.js` and display `V1.4.8`.

- [ ] **Step 5: Run unit and production build checks**

Run: `npm test -- tests/js/config.test.js && npm run build`  
Expected: PASS and `dist/index.html` exists.

- [ ] **Step 6: Commit**

```bash
git add index.html package.json vite.config.js vitest.config.js playwright.config.js src tests/js/config.test.js
git commit -m "chore: establish PersonalNWS 1.4.8 testable shell"
```

---

### Task 2: Lock the Rust decoder dependency/API baseline

**Files:**
- Create: `decoder/Cargo.toml`
- Create: `decoder/src/lib.rs`
- Create: `decoder/src/model.rs`
- Create: `decoder/tests/dependency_api.rs`
- Generate: `decoder/Cargo.lock`

**Interfaces:**
- Consumes: exact pinned `nexrad` RC versions.
- Produces: a Rust crate that compiles both natively and for `wasm32-unknown-unknown`; compile tests prove the exact archive/record/radial APIs used by later tasks.

- [ ] **Step 1: Write compile-contract tests for archive and live record APIs**

```rust
// decoder/tests/dependency_api.rs
use nexrad_data::volume::{File, Record};

#[test]
fn archive_file_api_is_available() {
    let _ctor: fn(Vec<u8>) -> File = File::new;
}

#[test]
fn live_record_constructor_is_available() {
    let bytes = [0u8; 16];
    let _ = Record::from_slice(&bytes);
}
```

Add a second test that compiles calls to `radial.elevation_number()`, `radial.azimuth_angle_degrees()`, `radial.elevation_angle_degrees()`, `radial.collection_timestamp()`, and `radial.radial_status()` against an inferred `Radial` reference inside a helper function.

- [ ] **Step 2: Create pinned Cargo configuration**

```toml
[package]
name = "personalnws-decoder"
version = "1.4.8"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
nexrad = { version = "=1.0.0-rc.4", default-features = false, features = ["wasm"] }
nexrad-data = "=1.0.0-rc.7"
nexrad-decode = "=1.0.0-rc.3"
nexrad-model = "=1.0.0-rc.2"
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"
thiserror = "2"
wasm-bindgen = "0.2"
js-sys = "0.3"

[dev-dependencies]
serde_json = "1"
```

- [ ] **Step 3: Run the compile contract natively**

Run: `cd decoder && cargo test --test dependency_api`  
Expected: PASS. If an upstream RC exposes an accessor through a trait, import the exact trait required by the compiler and keep the public PersonalNWS API unchanged.

- [ ] **Step 4: Verify the WASM target compiles**

Run:
```bash
rustup target add wasm32-unknown-unknown
cd decoder
cargo check --target wasm32-unknown-unknown
```

Expected: PASS with the pinned dependency graph.

- [ ] **Step 5: Commit the lockfile with the crate**

```bash
git add decoder/Cargo.toml decoder/Cargo.lock decoder/src decoder/tests
git commit -m "build: pin browser-proven nexrad decoder stack"
```

---

### Task 3: Implement stable Rust products, manifests, deltas, and errors

**Files:**
- Create: `decoder/src/error.rs`
- Expand: `decoder/src/model.rs`
- Modify: `decoder/src/lib.rs`
- Create: `decoder/tests/model_contract.rs`

**Interfaces:**
- Consumes: product ABI 1-6.
- Produces: `ProductId`, `ManifestV1`, `ElevationManifestV1`, `LiveDeltaV1`, `ChangedElevationV1`, `RadarError`, `RadarErrorCode`.

- [ ] **Step 1: Write failing model/error serialization tests**

```rust
#[test]
fn product_ids_are_stable() {
    assert_eq!(ProductId::Reflectivity as u16, 1);
    assert_eq!(ProductId::Velocity as u16, 2);
    assert_eq!(ProductId::SpectrumWidth as u16, 3);
    assert_eq!(ProductId::DifferentialReflectivity as u16, 4);
    assert_eq!(ProductId::CorrelationCoefficient as u16, 5);
    assert_eq!(ProductId::DifferentialPhase as u16, 6);
}

#[test]
fn errors_keep_stage_and_source() {
    let err = RadarError::new(
        RadarErrorCode::ProductNotAvailable,
        "blob",
        "KDOX|123",
        "REF is not available"
    );
    let json = serde_json::to_value(err).unwrap();
    assert_eq!(json["code"], "E_PRODUCT_NOT_AVAILABLE");
    assert_eq!(json["stage"], "blob");
    assert_eq!(json["sourceId"], "KDOX|123");
}
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `cd decoder && cargo test --test model_contract`  
Expected: FAIL because the types do not exist.

- [ ] **Step 3: Implement explicit product conversion and stable error codes**

```rust
#[repr(u16)]
pub enum ProductId {
    Reflectivity = 1,
    Velocity = 2,
    SpectrumWidth = 3,
    DifferentialReflectivity = 4,
    CorrelationCoefficient = 5,
    DifferentialPhase = 6,
}
```

`TryFrom<u16>` must reject unsupported IDs with `E_PRODUCT_NOT_AVAILABLE`; do not silently map unknown IDs.

- [ ] **Step 4: Implement serializable manifests/deltas**

Use `#[derive(Serialize, Clone, Debug, PartialEq)]` and `#[serde(rename_all = "camelCase")]` so JavaScript receives exactly the names frozen in the spec.

- [ ] **Step 5: Run all Rust model tests**

Run: `cd decoder && cargo test`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add decoder/src decoder/tests
git commit -m "feat: define stable radar engine v1 data contracts"
```

---

### Task 4: Implement completed Archive II ingestion

**Files:**
- Create: `decoder/src/archive.rs`
- Create: `decoder/src/source.rs`
- Modify: `decoder/src/lib.rs`
- Create: `decoder/tests/archive_ingest.rs`

**Interfaces:**
- Consumes: `File::new(Vec<u8>)`, record decompression/messages/radials.
- Produces: `DecodedSource`, `ingest_archive_core(source_id, site, bytes) -> Result<(DecodedSource, ManifestV1), RadarError>`.

- [ ] **Step 1: Add one stable real Archive II integration fixture definition**

Create `tests/fixtures/fixture-index.json` with a stable public KTLX object:

```json
{
  "archiveIntegration": {
    "site": "KTLX",
    "key": "2013/04/20/KTLX/KTLX20130420_205120_V06"
  }
}
```

The fixture fetch helper stores it in `.cache/fixtures/` and does not commit the multi-megabyte radar file.

- [ ] **Step 2: Write failing archive-ingest assertions**

Test requirements:
```rust
assert_eq!(manifest.site, "KTLX");
assert!(manifest.complete);
assert!(!manifest.elevations.is_empty());
assert!(manifest.elevations.iter().any(|e| e.products.contains(&1)));
assert!(manifest.scan_end_ms >= manifest.scan_start_ms);
```

- [ ] **Step 3: Run the test against the downloaded fixture**

Run:
```bash
node scripts/fetch-test-fixtures.mjs
cd decoder
cargo test --test archive_ingest -- --nocapture
```

Expected: FAIL before `archive.rs` is implemented.

- [ ] **Step 4: Implement record-by-record decode**

Core loop:

```rust
let file = nexrad_data::volume::File::new(bytes.to_vec());
let records = file.records().map_err(...)?;

for record in records {
    let decoded = if record.compressed() {
        record.decompress().map_err(...)?
    } else {
        record
    };

    for radial in decoded.radials().map_err(...)? {
        source.push_radial(radial)?;
    }
}
```

When the exact RC types require borrowing/ownership changes, preserve this behavior: decode each record, collect owned radials into `DecodedSource`, and never expose upstream objects to JS.

- [ ] **Step 5: Build manifest by exact elevation number**

Use a `BTreeMap<u8, Vec<Radial>>` or equivalent keyed by `radial.elevation_number()`. Never group by rounded angle.

- [ ] **Step 6: Run archive tests**

Run: `cd decoder && cargo test --test archive_ingest`  
Expected: PASS with real KTLX data.

- [ ] **Step 7: Commit**

```bash
git add decoder/src decoder/tests tests/fixtures scripts/fetch-test-fixtures.mjs
git commit -m "feat: ingest completed Level II archives in Rust"
```

---

### Task 5: Implement the frozen PSWP V1 serializer

**Files:**
- Create: `decoder/src/blob.rs`
- Modify: `decoder/src/source.rs`
- Create: `decoder/tests/blob_v1.rs`

**Interfaces:**
- Consumes: one source, exact elevation number, `ProductId`.
- Produces: `build_sweep_blob_core(...) -> Result<Vec<u8>, RadarError>` with the exact 96-byte header/payload layout.

- [ ] **Step 1: Write exact header/offset tests before serializer code**

Tests must assert:
```rust
assert_eq!(&blob[0..4], b"PSWP");
assert_eq!(u16::from_le_bytes(blob[4..6].try_into().unwrap()), 1);
assert_eq!(u16::from_le_bytes(blob[6..8].try_into().unwrap()), 96);
assert_eq!(u16::from_le_bytes(blob[8..10].try_into().unwrap()), 1);
assert_eq!(blob[10], elevation_number);
```

Also assert every typed-array offset satisfies its required alignment and lies within blob length.

- [ ] **Step 2: Add synthetic u8/u16 radial fixtures**

Create deterministic moment rows where raw values include `0`, `1`, and normal codes. Verify serializer output contains the same raw codes without unit conversion.

- [ ] **Step 3: Run blob tests and confirm failure**

Run: `cd decoder && cargo test --test blob_v1`  
Expected: FAIL.

- [ ] **Step 4: Implement geometry validation**

Reject mismatched first gate, gate interval, scale, offset, or word size with:

```rust
RadarError::new(
    RadarErrorCode::GeometryMismatch,
    "blob",
    source_id,
    "incompatible moment geometry within one elevation/product"
)
```

Use maximum gate count across compatible radials and zero-fill short rows.

- [ ] **Step 5: Implement serializer with explicit little-endian writes**

Do not transmute Rust structs into bytes. Use `to_le_bytes()` for every multibyte scalar so the wire format is independent of Rust padding.

- [ ] **Step 6: Run all serializer tests including real REF and a 16-bit moment**

Run: `cd decoder && cargo test --test blob_v1`  
Expected: PASS for both `u8` and `u16`.

- [ ] **Step 7: Commit**

```bash
git add decoder/src/blob.rs decoder/src/source.rs decoder/tests/blob_v1.rs
git commit -m "feat: serialize native Level II moments as PSWP v1"
```

---

### Task 6: Implement realtime live accumulation

**Files:**
- Create: `decoder/src/live.rs`
- Modify: `decoder/src/source.rs`
- Modify: `decoder/src/model.rs`
- Create: `decoder/tests/live_ingest.rs`

**Interfaces:**
- Consumes: first live chunk as `File`, later chunks as `Record::from_slice`.
- Produces: stateful `LiveSource`, `start_live_core`, `ingest_live_record_core`, `LiveDeltaV1`.

- [ ] **Step 1: Write accumulator tests using ordered synthetic radial batches**

Verify:
- elevation #1 and #2 remain separate,
- duplicate low-angle values do not merge,
- `changed` lists only touched elevations,
- completion is driven by radial status,
- existing radials are replaced/deduplicated by stable radial identity when a repeated chunk arrives.

- [ ] **Step 2: Run and confirm failure**

Run: `cd decoder && cargo test --test live_ingest`  
Expected: FAIL.

- [ ] **Step 3: Implement `LiveSource` keyed by elevation number**

```rust
pub struct LiveSource {
    pub site: String,
    pub scan_start_ms: f64,
    pub vcp: Option<u16>,
    pub elevations: BTreeMap<u8, LiveElevation>,
}
```

`LiveElevation` owns decoded radials and a completion flag.

- [ ] **Step 4: Implement start-chunk path**

Use `File::new(start_bytes.to_vec()) -> records() -> decompress -> radials/messages`.

- [ ] **Step 5: Implement intermediate/end path**

Use `Record::from_slice(bytes)`, decompress if required, decode radials, merge only into the matching live source.

- [ ] **Step 6: Run live tests**

Run: `cd decoder && cargo test --test live_ingest`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add decoder/src/live.rs decoder/src/source.rs decoder/src/model.rs decoder/tests/live_ingest.rs
git commit -m "feat: accumulate realtime Level II records by elevation"
```

---

### Task 7: Expose only the frozen five-method WASM RadarEngine API

**Files:**
- Modify: `decoder/src/lib.rs`
- Modify: `decoder/src/error.rs`
- Create: `decoder/tests/engine_lifecycle.rs`

**Interfaces:**
- Consumes: archive/live/blob core functions.
- Produces JS-visible methods:
  - `ingest_archive(source_id, site, bytes)`
  - `start_live(source_id, site, bytes)`
  - `ingest_live_record(source_id, bytes)`
  - `build_sweep_blob(source_id, elevation_number, product_id)`
  - `release_source(source_id)`

- [ ] **Step 1: Write native lifecycle tests**

Sequence:
```rust
let mut engine = RadarEngineCore::default();
let manifest = engine.ingest_archive(...)?;
let blob = engine.build_sweep_blob(...)?;
engine.release_source(...)?;
assert!(matches!(
    engine.build_sweep_blob(...),
    Err(e) if e.code == RadarErrorCode::SourceNotFound
));
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd decoder && cargo test --test engine_lifecycle`  
Expected: FAIL.

- [ ] **Step 3: Implement `RadarEngineCore` separate from wasm-bindgen wrapper**

Keep the core native-testable. The `#[wasm_bindgen] RadarEngine` wrapper converts `ManifestV1`/`LiveDeltaV1` with `serde_wasm_bindgen` and converts `Vec<u8>` to `Uint8Array`.

- [ ] **Step 4: Convert every `RadarError` to one structured JS object**

Do not throw plain strings. Error shape must contain `code`, `stage`, `sourceId`, `message`, and `detail`.

- [ ] **Step 5: Run native and wasm checks**

Run:
```bash
cd decoder
cargo test
cargo check --target wasm32-unknown-unknown
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add decoder/src decoder/tests/engine_lifecycle.rs
git commit -m "feat: expose frozen RadarEngine API v1"
```

---

### Task 8: Build WASM separately and prove GitHub Pages-safe loading

**Files:**
- Create: `src/radar/wasm-loader.js`
- Create: `tests/js/wasm-loader.test.js`
- Create/modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: generated `public/decoder/personalnws_decoder.js` and `_bg.wasm`.
- Produces: `loadRadarDecoder(decoderBase) -> Promise<{ RadarEngine }>`.

- [ ] **Step 1: Add a decoder build script**

Add:
```json
"build:decoder": "wasm-pack build decoder --target web --release --out-dir ../public/decoder --out-name personalnws_decoder"
```

- [ ] **Step 2: Build the actual decoder package locally/CI**

Run:
```bash
cargo install wasm-pack --locked --version 0.13.1
npm run build:decoder
```

Expected files:
```text
public/decoder/personalnws_decoder.js
public/decoder/personalnws_decoder_bg.wasm
public/decoder/personalnws_decoder.d.ts
```

- [ ] **Step 3: Write loader URL tests**

```js
expect(resolveDecoderBase("https://x.github.io/Repo/"))
  .toBe("https://x.github.io/Repo/decoder/");
```

- [ ] **Step 4: Implement static dynamic import**

```js
export async function loadRadarDecoder(decoderBase) {
  const jsUrl = new URL("personalnws_decoder.js", decoderBase).href;
  const wasmUrl = new URL("personalnws_decoder_bg.wasm", decoderBase).href;
  const mod = await import(/* @vite-ignore */ jsUrl);
  await mod.default(wasmUrl);
  return { RadarEngine: mod.RadarEngine };
}
```

- [ ] **Step 5: Run unit and production build**

Run: `npm test -- tests/js/wasm-loader.test.js && npm run build`  
Expected: PASS; Vite copies decoder assets unchanged.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore src/radar/wasm-loader.js tests/js/wasm-loader.test.js
git commit -m "build: load Rust decoder as static GitHub Pages asset"
```

---

### Task 9: Implement the JavaScript PSWP reader

**Files:**
- Create: `src/radar/blob-reader.js`
- Create: `tests/js/blob-reader.test.js`
- Add: `tests/fixtures/pswp/ref-u8.pswp`
- Add: `tests/fixtures/pswp/phi-u16.pswp`

**Interfaces:**
- Consumes: PSWP `ArrayBuffer`.
- Produces: `readSweepBlob(buffer)` with validated scalar metadata and zero-copy typed-array views.

- [ ] **Step 1: Write failing parser tests for valid and truncated blobs**

Assertions include:
```js
expect(sweep.magic).toBe("PSWP");
expect(sweep.version).toBe(1);
expect(sweep.azimuths).toBeInstanceOf(Float32Array);
expect(sweep.radialTimes).toBeInstanceOf(Float64Array);
expect(sweep.gates).toBeInstanceOf(Uint8Array);
expect(() => readSweepBlob(truncated)).toThrow(/bounds/i);
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/js/blob-reader.test.js`  
Expected: FAIL.

- [ ] **Step 3: Implement strict validation before creating views**

Reject bad magic/version/header size, unsupported word size, misaligned offsets, integer overflow, and any array end beyond `buffer.byteLength`.

- [ ] **Step 4: Verify both u8 and u16 fixtures**

Run: `npm test -- tests/js/blob-reader.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/radar/blob-reader.js tests/js/blob-reader.test.js tests/fixtures/pswp
git commit -m "feat: read PSWP v1 with zero-copy typed views"
```

---

### Task 10: Implement versioned IndexedDB cache

**Files:**
- Create: `src/radar/cache.js`
- Create: `tests/js/cache.test.js`

**Interfaces:**
- Consumes: scan manifests and PSWP ArrayBuffers.
- Produces: `RadarCache.open()`, `putScan`, `getScan`, `putSweep`, `getSweep`, `deleteSiteBefore`, `clearIncompatible`.

- [ ] **Step 1: Write tests with fake-indexeddb**

Add `fake-indexeddb` as a pinned dev dependency and test key shape:

```js
expect(scanKey("KDOX", 123)).toBe("KDOX|123");
expect(sweepKey("KDOX", 123, 2, 1)).toBe("KDOX|123|2|1");
```

Test that retrieved `ArrayBuffer` bytes equal the inserted bytes.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/js/cache.test.js`  
Expected: FAIL.

- [ ] **Step 3: Implement schema version 1**

Database: `personalnws-radar`, version `1`. Stores: `scans`, `sweeps`, `meta`.

- [ ] **Step 4: Implement incompatible-format invalidation**

Persist `pswpVersion: 1` and `engineApiVersion: 1` in `meta`. On mismatch, clear only radar cache stores; do not touch unrelated browser storage.

- [ ] **Step 5: Run cache tests**

Run: `npm test -- tests/js/cache.test.js`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json src/radar/cache.js tests/js/cache.test.js
git commit -m "feat: cache completed radar sweeps in IndexedDB"
```

---

### Task 11: Implement all-site NEXRAD catalog and public S3 source logic

**Files:**
- Create: `src/radar/site-catalog.js`
- Create: `src/radar/nexrad-source.js`
- Create: `src/data/nexrad-sites.json`
- Create: `scripts/refresh-radar-catalog.mjs`
- Create: `tests/js/site-catalog.test.js`
- Create: `tests/js/nexrad-source.test.js`

**Interfaces:**
- Consumes: NOAA/NCEI NEXRAD station metadata (`STATION_ID`, name, lat/lon, begin/end dates) plus public S3 XML listing.
- Produces: generic `RadarSite[]`, `listCompletedVolumes(site, startMs, endMs)`, `listRealtimeChunks(site)`.

- [ ] **Step 1: Write site-normalization tests that include geographic edge cases**

Fixtures must include:
```text
KDOX  contiguous US
KTLX  central US
PAHG  Alaska
PHKI  Hawaii
TJUA  Puerto Rico
PGUA  Guam
```

The normalization code must accept any valid active 4-character NEXRAD site ID; none of these IDs may require special decoder branches.

- [ ] **Step 2: Write S3-key generation/listing tests**

Completed prefix must be date/site based:
```js
archivePrefix("KDOX", new Date("2026-08-23T00:00:00Z"))
// "2026/08/23/KDOX/"
```

The source parser must ignore metadata objects and return real volume keys in chronological order.

- [ ] **Step 3: Implement runtime NOAA catalog fetch plus checked-in fallback**

Fetch the NOAA/NCEI NEXRAD feature layer in GeoJSON/JSON form. Normalize `STATION_ID`, `STATION_NAME`, `LATITUDE`, `LONGITUDE`, `BEGIN_DATE`, `END_DATE`. If the request fails, use `src/data/nexrad-sites.json`.

Merge by station ID; current NOAA data wins for coordinates/name/status.

- [ ] **Step 4: Implement catalog refresh script**

`scripts/refresh-radar-catalog.mjs` fetches the current NOAA catalog, filters active NEXRAD stations, sorts by ID, and writes deterministic JSON. It exits nonzero if records have invalid IDs or coordinates.

- [ ] **Step 5: Implement public S3 listing without credentials**

Use `fetch(`${base}/?list-type=2&prefix=${encodeURIComponent(prefix)}`)` and parse XML. No AWS SDK/account is required.

- [ ] **Step 6: Run catalog/source tests**

Run:
```bash
npm test -- tests/js/site-catalog.test.js tests/js/nexrad-source.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data src/radar/site-catalog.js src/radar/nexrad-source.js scripts tests/js
git commit -m "feat: support the full active NEXRAD station catalog"
```

---

### Task 12: Define and test the worker protocol

**Files:**
- Create: `src/radar/worker-protocol.js`
- Create: `src/radar/worker-client.js`
- Create: `tests/js/worker-protocol.test.js`

**Interfaces:**
- Consumes: commands from app controller.
- Produces typed command/event names for both workers.

- [ ] **Step 1: Freeze command names in tests**

Commands:
```text
INIT
SELECT_SITE
LOAD_FRAME
SET_PRODUCT_ELEVATION
START_HISTORY
START_LIVE
STOP_SITE
PING
```

Events:
```text
READY
SITE_READY
FRAME_READY
TIMELINE_UPDATE
CACHE_PROGRESS
LIVE_DELTA
DIAGNOSTIC
METRICS
PONG
```

- [ ] **Step 2: Write validation tests for required fields**

`LOAD_FRAME` requires `site`, `scanStartMs`, `elevationNumber`, and `productId`. Unknown commands must be rejected with a protocol diagnostic rather than ignored silently.

- [ ] **Step 3: Implement request IDs and Promise resolution in `worker-client.js`**

```js
const id = crypto.randomUUID();
worker.postMessage({ id, type: "LOAD_FRAME", payload });
```

Responses with matching `id` resolve/reject only that request.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/js/worker-protocol.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/radar/worker-protocol.js src/radar/worker-client.js tests/js/worker-protocol.test.js
git commit -m "feat: define radar worker protocol"
```

---

### Task 13: Implement shared worker core and priority/history workers

**Files:**
- Create: `src/radar/worker-core.js`
- Create: `src/radar/priority-worker.js`
- Create: `src/radar/history-worker.js`
- Create: `tests/browser/radar-flow.spec.js`

**Interfaces:**
- Consumes: worker protocol, WASM loader, S3 source, cache.
- Produces: independent priority/live and history processing with one WASM instance each.

- [ ] **Step 1: Add a browser test that proves both workers initialize separately**

Expose a debug-only metric event:
```js
{ type: "METRICS", payload: { workerRole: "priority", wasmInitCount: 1 } }
```
and the same for `history`.

- [ ] **Step 2: Implement `WorkerCore` constructor**

Dependencies are injected:
```js
new WorkerCore({
  role: "priority",
  cache,
  source,
  loadDecoder,
  postMessage
});
```

This keeps worker logic unit-testable and prevents direct DOM imports.

- [ ] **Step 3: Implement cached `LOAD_FRAME` path first**

Algorithm:
1. Build sweep cache key.
2. `getSweep`.
3. If found, transfer buffer with `FRAME_READY`.
4. Increment `cacheHitCount`.
5. Do not increment fetch/decode counters.

- [ ] **Step 4: Implement cache-miss completed-volume path**

Fetch exact volume once, call `ingest_archive`, build the requested blob immediately, persist manifest/blob, and release the source after all selected release-product blobs for that volume have been persisted.

- [ ] **Step 5: Make history worker yield naturally between volumes**

After each volume, await a microtask/timer checkpoint before the next network/decode operation. The worker remains independent, so this is for cancellation/responsiveness rather than main-thread protection.

- [ ] **Step 6: Run browser worker flow test**

Run: `npm run test:browser -- tests/browser/radar-flow.spec.js`  
Expected: both workers READY; cached second request reports zero additional decode count.

- [ ] **Step 7: Commit**

```bash
git add src/radar/worker-core.js src/radar/priority-worker.js src/radar/history-worker.js tests/browser/radar-flow.spec.js
git commit -m "feat: isolate live and history radar workers"
```

---

### Task 14: Implement two-hour timeline/backfill and cache-first frame selection

**Files:**
- Create: `src/timeline/timeline-model.js`
- Create: `src/timeline/playback.js`
- Modify: `src/radar/worker-core.js`
- Create: `tests/js/timeline-model.test.js`

**Interfaces:**
- Consumes: completed volume listings/manifests.
- Produces: ordered two-hour `FrameDescriptor[]`, playback index operations, background history queue.

- [ ] **Step 1: Write timeline ordering/window tests**

Given frames spanning 3 hours, assert only the newest ~2 hours remain and duplicate scan timestamps collapse by exact object key.

- [ ] **Step 2: Implement timeline model**

`FrameDescriptor`:
```js
{
  site: "KDOX",
  scanStartMs: 123,
  objectKey: "...",
  live: false
}
```

- [ ] **Step 3: Implement keyboard-safe playback model**

`previousFrame()`, `nextFrame()`, `setIndex()`, `setPlaying()`, `setSpeed()` never touch MapLibre directly.

- [ ] **Step 4: Feed history queue newest-to-oldest**

Priority worker owns the latest frame; history worker backfills older volumes and posts `TIMELINE_UPDATE` as cache entries become ready.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/js/timeline-model.test.js`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/timeline src/radar/worker-core.js tests/js/timeline-model.test.js
git commit -m "feat: add cache-first two-hour radar timeline"
```

---

### Task 15: Implement WebGL2 rendering directly from PSWP

**Files:**
- Create: `src/render/radar-gl.js`
- Create: `src/render/radar-layer.js`
- Create: `src/render/color-tables.js`
- Create: `src/render/probe.js`
- Create: `tests/js/probe.test.js`

**Interfaces:**
- Consumes: validated `readSweepBlob(buffer)` result and site coordinates.
- Produces: MapLibre custom layer with no radar fetch/decode on pan/zoom.

- [ ] **Step 1: Write raw-to-physical probe tests**

For a meaningful raw code:
```js
expect(decodeMomentValue(100, { scale: 2, offset: 66 }))
  .toBe(17);
```

Raw sentinel codes `0` and `1` return structured missing/range-fold states, not numeric weather values.

- [ ] **Step 2: Implement product color-table functions separately from the GL layer**

Each release product exposes:
```js
{ unit, min, max, rgbaForPhysicalValue }
```
so color tables can change without changing cached blobs.

- [ ] **Step 3: Implement native-radial GPU buffers**

Upload:
- azimuth array,
- raw gate texture (`R8UI` or `R16UI` where WebGL2 support permits; otherwise an equivalent integer-safe encoding),
- scalar geometry uniforms,
- scale/offset uniforms.

Do not create a fixed 720-row resampled texture.

- [ ] **Step 4: Implement polar-to-WebMercator vertex/fragment mapping**

The shader computes position from actual radial azimuth and gate range relative to site lat/lon. Neighboring azimuth selection must use actual azimuth values, including irregular spacing.

- [ ] **Step 5: Make `render()` pure with respect to radar data acquisition**

MapLibre camera changes call only GL draw/update uniforms. No fetch, worker RPC, or decode function may be reachable from `render()`.

- [ ] **Step 6: Run probe tests and manual single-sweep render check**

Run: `npm test -- tests/js/probe.test.js`  
Then load a known KTLX REF blob and verify range rings/orientation against known station coordinates.

- [ ] **Step 7: Commit**

```bash
git add src/render tests/js/probe.test.js
git commit -m "feat: render native sweep blobs with WebGL2"
```

---

### Task 16: Reconnect the real PersonalNWS UI

**Files:**
- Create: `src/app-controller.js`
- Create: `src/ui/radar-markers.js`
- Create: `src/ui/controls.js`
- Modify: `src/main.js`
- Modify: `src/ui/styles.css`
- Modify: `index.html`

**Interfaces:**
- Consumes: site catalog, worker clients, renderer, timeline.
- Produces: retained operational UI behavior.

- [ ] **Step 1: Render every active catalog station as a map-selectable radar marker**

No site dropdown. Marker click sends `SELECT_SITE` using the generic site ID.

- [ ] **Step 2: Populate tilt options from manifest exact elevation numbers**

Option value is elevation number; text is angle. If two cuts both display `0.5°`, label them `0.5° · cut 1` and `0.5° · cut 2`.

- [ ] **Step 3: Enable only products advertised for the selected elevation**

If switching cuts makes the selected product unavailable, choose REF when present, otherwise the first available release product.

- [ ] **Step 4: Restore timeline and keyboard behavior**

Global keydown:
```js
if (event.key === "ArrowLeft") timeline.previousFrame();
if (event.key === "ArrowRight") timeline.nextFrame();
if (event.code === "Space") playback.toggle();
```

Prevent these keys from panning MapLibre while the page body/map has focus.

- [ ] **Step 5: Wire worker diagnostics to one visible structured panel**

Display `code`, `stage`, site/source, concise message, and expandable/copyable detail. Keep the complete same object in `console.error`.

- [ ] **Step 6: Keep tracks real-only**

Only compute/show tracks from genuine decoded reflectivity. If the track detector has insufficient confidence/data, draw nothing.

- [ ] **Step 7: Run browser interaction tests**

Assertions:
- marker selects site,
- tilt option IDs are elevation numbers,
- arrow key changes timeline index but not map center,
- Space toggles playback,
- unavailable product is disabled.

- [ ] **Step 8: Commit**

```bash
git add index.html src/main.js src/app-controller.js src/ui
git commit -m "feat: reconnect PersonalNWS operational radar UI"
```

---

### Task 17: Implement realtime chunk streaming and live sweep finalization

**Files:**
- Modify: `src/radar/worker-core.js`
- Modify: `src/radar/nexrad-source.js`
- Modify: `src/timeline/timeline-model.js`
- Extend: `tests/browser/radar-flow.spec.js`

**Interfaces:**
- Consumes: chunk bucket listing and frozen live WASM API.
- Produces: partial current-sweep updates and one-time persistence when an elevation completes.

- [ ] **Step 1: Write a browser integration test with mocked chunk sequence**

Test sequence:
1. start chunk,
2. intermediate chunk,
3. another intermediate chunk,
4. elevation-complete delta.

Assert partial `FRAME_READY` events are not written to IndexedDB on every chunk; final completed product blobs are written exactly once.

- [ ] **Step 2: Implement chunk cursor/deduplication**

Track exact chunk keys already ingested for current stream. Never ingest the same chunk twice after a poll refresh.

- [ ] **Step 3: Start a new live source when volume identity changes**

Release the prior live source only after its completed blobs have been persisted.

- [ ] **Step 4: Build only the currently displayed partial blob on each changed delta**

Do not serialize all six products every few seconds while the sweep is incomplete.

- [ ] **Step 5: Finalize all available release products when the elevation reports complete**

Persist each final PSWP once, update scan manifest, and notify timeline/cache state.

- [ ] **Step 6: Run live integration tests**

Run: `npm run test:browser -- tests/browser/radar-flow.spec.js`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/radar src/timeline tests/browser/radar-flow.spec.js
git commit -m "feat: stream realtime Level II sweeps chunk by chunk"
```

---

### Task 18: Add measurable smoothness instrumentation and release gates

**Files:**
- Create: `src/radar/metrics.js`
- Create: `tests/browser/performance.spec.js`
- Modify: `src/radar/worker-core.js`
- Modify: `src/app-controller.js`

**Interfaces:**
- Consumes: cache/fetch/decode/frame-render events.
- Produces: counters/timing marks used by automated and manual release checks.

- [ ] **Step 1: Add counters that make architectural regressions testable**

Metrics:
```js
{
  archiveFetchCount: 0,
  chunkFetchCount: 0,
  rustDecodeCount: 0,
  cacheHitCount: 0,
  frameReadyMs: [],
  residentFrameReadyMs: []
}
```

Counters are exposed only in test/debug builds.

- [ ] **Step 2: Write cached-playback performance test**

Preload at least 20 PSWP fixtures/cache entries, then execute 20 timeline changes. Assert:
```js
expect(metrics.archiveFetchCount).toBe(0);
expect(metrics.rustDecodeCount).toBe(0);
expect(median(metrics.frameReadyMs)).toBeLessThanOrEqual(75);
expect(p95(metrics.frameReadyMs)).toBeLessThanOrEqual(150);
```

- [ ] **Step 3: Write renderer-resident swap benchmark**

Swap between already parsed/resident sweep buffers and assert p95 <= 50 ms.

- [ ] **Step 4: Observe main-thread long tasks during cached playback**

Use `PerformanceObserver({ type: "longtask" })` where supported. The test fails if radar-caused decode/cache work creates a Long Task >50 ms. If Chromium does not expose the entry type in CI, assert the equivalent through Playwright tracing plus the architectural counters and retain the Long Task check in manual release testing.

- [ ] **Step 5: Prove map pan/zoom is data-path inert**

Record fetch/decode counters, programmatically pan/zoom the map, wait for render completion, then assert counters are unchanged.

- [ ] **Step 6: Run performance suite three times**

Run:
```bash
npm run test:browser -- tests/browser/performance.spec.js --repeat-each=3
```

Expected: all timing/architectural gates pass all repetitions.

- [ ] **Step 7: Commit**

```bash
git add src/radar/metrics.js src/radar/worker-core.js src/app-controller.js tests/browser/performance.spec.js
git commit -m "test: enforce smooth cached radar interaction"
```

---

### Task 19: Add full-network radar coverage audit

**Files:**
- Create: `scripts/audit-radar-network.mjs`
- Create: `decoder/src/bin/audit_file.rs`
- Create: `.github/workflows/radar-network-audit.yml`
- Create: `tests/js/network-audit.test.js`

**Interfaces:**
- Consumes: current NOAA active-site catalog and public Level II bucket.
- Produces: per-site audit result: `PASS`, `NO_RECENT_UPSTREAM_DATA`, `FETCH_ERROR`, or `DECODE_ERROR`.

- [ ] **Step 1: Write classification tests**

A station with no object in the search horizon yields `NO_RECENT_UPSTREAM_DATA`, not `DECODE_ERROR`. A downloaded object that fails Rust ingest yields `DECODE_ERROR`.

- [ ] **Step 2: Implement generic latest-volume discovery for every active site**

For each current active site:
1. query today's prefix,
2. if empty, query previous day,
3. continue up to 72 hours,
4. select newest completed volume object,
5. record absence separately from code failure.

No site-specific object rules are allowed.

- [ ] **Step 3: Implement native audit binary using the same Rust core**

`audit_file.rs` reads a downloaded file, invokes `RadarEngineCore::ingest_archive`, requires at least one elevation and one REF blob when REF is present, prints JSON, and exits nonzero only for code/decode failures.

- [ ] **Step 4: Implement bounded-concurrency network audit**

The Node script processes stations with concurrency 6 so it does not hammer public storage. Temporary files are deleted after each site. It writes `radar-network-audit.json`.

- [ ] **Step 5: Add manual/scheduled workflow**

Workflow triggers:
```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: "17 9 * * 1"
```

It refreshes the NOAA catalog, builds the native audit binary, runs the full active-site audit, uploads the JSON report, and fails if any site is `DECODE_ERROR` or `FETCH_ERROR`. `NO_RECENT_UPSTREAM_DATA` is reported but does not falsely blame the decoder.

- [ ] **Step 6: Require a clean full-network report before tagging V1.4.8**

The release checklist records the audit run URL/artifact and the count of active sites discovered at that run. Do not hardcode 155 as a forever count.

- [ ] **Step 7: Commit**

```bash
git add scripts/audit-radar-network.mjs decoder/src/bin/audit_file.rs .github/workflows/radar-network-audit.yml tests/js/network-audit.test.js
git commit -m "test: audit every active NEXRAD Level II site"
```

---

### Task 20: Add representative geographic/product decoder matrix

**Files:**
- Extend: `tests/fixtures/fixture-index.json`
- Create: `decoder/tests/geographic_matrix.rs`
- Modify: `scripts/fetch-test-fixtures.mjs`

**Interfaces:**
- Consumes: fixed historical Level II objects from geographically distinct sites.
- Produces: deterministic decode checks that do not depend on current station uptime.

- [ ] **Step 1: Add fixed fixtures for six coverage classes**

The fixture index must contain at least one stable historical completed volume from:
- CONUS East (`KDOX` or equivalent),
- CONUS Central (`KTLX`),
- CONUS West (`KATX` or equivalent),
- Alaska (`PAHG` or equivalent),
- Hawaii (`PHKI` or equivalent),
- Caribbean/Pacific territory (`TJUA` and/or `PGUA`).

The implementation task must resolve each entry to an exact immutable S3 key and record its SHA-256 in `fixture-index.json`; the fetch script rejects a checksum mismatch.

- [ ] **Step 2: Write matrix assertions**

For every fixture:
```rust
assert_eq!(manifest.site, expected_site);
assert!(!manifest.elevations.is_empty());
assert!(manifest.elevations.iter().any(|e| e.products.contains(&1)));
```

For dual-pol fixtures require at least one of product IDs 4-6 and successfully build that blob.

- [ ] **Step 3: Test duplicated/similar elevation angles using a known VCP fixture**

Assert the manifest count is based on elevation number and no two distinct elevation-number cuts are collapsed even if rounded display angles match.

- [ ] **Step 4: Run matrix**

Run: `cd decoder && cargo test --test geographic_matrix -- --nocapture`  
Expected: PASS for all fixed fixtures.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/fixture-index.json scripts/fetch-test-fixtures.mjs decoder/tests/geographic_matrix.rs
git commit -m "test: verify Level II decoding across NEXRAD regions"
```

---

### Task 21: Build the final GitHub Actions Pages release gate

**Files:**
- Replace: `.github/workflows/pages.yml`
- Modify: `README.md`
- Modify: `THIRD_PARTY.md`

**Interfaces:**
- Consumes: all Rust/JS/browser tests and decoder build.
- Produces: deployable `dist/` only when every mandatory gate passes.

- [ ] **Step 1: Create ordered CI jobs**

Required order:
```text
checkout
Node 24
Rust toolchain + wasm32 target
install npm deps
fetch deterministic test fixtures
cargo fmt --check
cargo clippy -- -D warnings
cargo test
wasm-pack build
npm test
npm run build
Playwright install Chromium
npm run test:browser
configure Pages
upload dist
deploy
```

- [ ] **Step 2: Ensure Vite receives decoder files built before the site build**

The workflow must verify:
```bash
test -f public/decoder/personalnws_decoder.js
test -f public/decoder/personalnws_decoder_bg.wasm
```
before `npm run build`.

- [ ] **Step 3: Verify repo-name independence**

Run the production site under a non-root Playwright base path (for example `/PersonalNWSTEsT/`) and assert the worker successfully resolves `decoder/personalnws_decoder_bg.wasm`.

- [ ] **Step 4: Document NOAA/public-data attribution and licenses**

`THIRD_PARTY.md` lists pinned Rust crates, MapLibre, wasm-bindgen/wasm-pack, and NOAA/Unidata data attribution without implying NOAA endorsement.

- [ ] **Step 5: Run the same gate locally where possible**

Run:
```bash
cd decoder && cargo fmt --check && cargo clippy -- -D warnings && cargo test
cd ..
npm run build:decoder
npm test
npm run build
npm run test:browser
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/pages.yml README.md THIRD_PARTY.md
git commit -m "ci: gate PersonalNWS 1.4.8 Pages deployment"
```

---

### Task 22: Final release verification and V1.4.8 packaging

**Files:**
- Modify: `README.md`
- Modify: `public/manifest.webmanifest`
- Verify: all release files
- Create at handoff: `personalnws-v1.4.8-github.zip`

**Interfaces:**
- Consumes: deployed GitHub Pages candidate.
- Produces: the numbered V1.4.8 release package.

- [ ] **Step 1: Verify version strings**

Search:
```bash
grep -R "1.4.7" -n index.html src public package.json decoder/Cargo.toml README.md
```

Expected: no stale UI/package version references.

- [ ] **Step 2: Run release functional matrix on the deployed Pages URL**

Verify:
1. radar markers load from the full catalog,
2. one CONUS, one Alaska/Hawaii, and one territory radar can be selected,
3. latest completed Level II manifest appears,
4. REF renders,
5. VEL/SW/ZDR/RHO/PHI render where available,
6. duplicate elevation-number cuts remain distinct,
7. left/right cached frame changes do not decode,
8. Space playback works,
9. map pan/zoom does not fetch/decode radar,
10. live chunks update the current sweep,
11. history continues while live/current controls remain responsive,
12. structured diagnostics identify any forced error precisely.

- [ ] **Step 3: Run the smoothness release check with history backfill active**

In current desktop Chrome:
- start two-hour backfill,
- pan/zoom continuously for 10 seconds,
- scrub at least 20 cached frames,
- run playback at the intended default speed,
- confirm no radar-decoder main-thread stalls,
- record performance metrics from the built-in debug panel/test output.

- [ ] **Step 4: Run/inspect the latest full-network audit**

Release is blocked by any `DECODE_ERROR` attributable to PersonalNWS. Stations with confirmed upstream outage/no recent data remain selectable but show a precise availability state.

- [ ] **Step 5: Produce a clean full ZIP**

Exclude:
```text
node_modules/
target/
dist/
.cache/
.git/
```

Include source, Cargo lockfile, workflows, public assets, tests, and documentation. The normal GitHub workflow rebuilds generated decoder assets; optionally include the generated `public/decoder/` in the handoff ZIP only if it matches the source commit exactly.

- [ ] **Step 6: Final verification before claiming completion**

Run:
```bash
git status --short
cd decoder && cargo test
cd ..
npm test
npm run build:decoder
npm run build
npm run test:browser
```

Expected: clean intended tree and every test/build passes. Do not claim V1.4.8 is complete from code inspection alone.

- [ ] **Step 7: Commit release metadata**

```bash
git add README.md public/manifest.webmanifest
git commit -m "release: PersonalNWS 1.4.8"
```

---

## Plan Self-Review

### Spec coverage

- Rust/WASM migration: Tasks 2-8.
- Five-method RadarEngine API: Task 7.
- Completed Archive II path: Task 4.
- Realtime chunk path: Tasks 6 and 17.
- PSWP V1/native gates: Tasks 5 and 9.
- IndexedDB/decode-free cache: Tasks 10, 13, 14.
- Priority/history isolation: Task 13.
- Native WebGL rendering: Task 15.
- Existing PersonalNWS UI/timeline/keyboard: Task 16.
- All active NEXRAD sites: Tasks 11, 19, 20.
- Smooth interaction requirements: Task 18 plus Task 22 manual release check.
- Structured errors: Tasks 3, 7, 12, 16.
- GitHub Pages/Rust-WASM-Vite build: Tasks 8 and 21.
- No fake fallback: enforced in Global Constraints and release checks.
- V1.5/V2 non-goals remain out of this plan.

### Type/interface consistency

- Product IDs are `u16`/number values 1-6 everywhere.
- Elevation identity is `u8`/number `elevationNumber` everywhere.
- PSWP cache key is `SITE|SCAN_START_MS|ELEVATION_NUMBER|PRODUCT_ID`.
- Worker messages use exact names frozen in Task 12.
- Rust structured errors map to the same diagnostic object forwarded by workers/UI.
- `RadarEngineCore` remains native-testable; `#[wasm_bindgen] RadarEngine` is only the JS wrapper.

### Release-risk focus

The riskiest dependency/API assumption is isolated in Task 2 and must compile before any UI integration work. The riskiest runtime boundary—WASM loading under a GitHub project path—is proven in Task 8 before workers/UI depend on it. The full-network audit is separate from ordinary CI so upstream outages do not make every normal commit flaky, but a clean audit is mandatory before the V1.4.8 handoff.
