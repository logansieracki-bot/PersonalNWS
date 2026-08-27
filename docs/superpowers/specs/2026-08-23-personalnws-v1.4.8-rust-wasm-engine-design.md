# PersonalNWS V1.4.8 — Rust/WASM Radar Engine Migration

Date: 2026-08-23
Status: APPROVED — frozen for implementation
Release type: Numbered production release, not a prototype

## 1. Purpose

PersonalNWS V1.4.8 replaces the unstable JavaScript Level II decoder path used in V1.4.7 and earlier with a Rust-to-WebAssembly radar engine built around the `danielway/nexrad` ecosystem and the browser architecture proven by NEXRAD Workbench.

The release must remain a GitHub Pages-hosted web application. GitHub Desktop remains the user's update path: replace project files locally, commit, and push. GitHub Actions builds Rust/WASM and the Vite site, then deploys to GitHub Pages.

V1.4.8 is not a throwaway vertical-slice or prototype. Internally, implementation may be validated incrementally, but the user-facing artifact is a complete numbered release with the defined feature set in this document.

## 2. Release goals

V1.4.8 must provide:

- Real WSR-88D Level II data from the public Unidata/NOAA source path already used by PersonalNWS.
- Rust/WASM decoding instead of the existing JavaScript Message 31 decoder.
- Native base moments: REF, VEL, SW, ZDR, RHO/CC, and PHI.
- Exact elevation-number identity. Duplicate low-level cuts remain separate even when their displayed elevation angles are nearly identical.
- Live Level II chunk ingestion so partial sweeps can update while a volume is still scanning.
- Precomputed binary sweep blobs stored in IndexedDB.
- Decode-free timeline scrubbing and product/elevation switching when a requested blob is already cached.
- WebGL rendering from raw radar codes with scale/offset conversion at render/probe time.
- Existing PersonalNWS map/UI concepts: radar selection on the map, compact product/tilt/playback controls, timeline, arrow-key timeline navigation, and black/purple operational styling.
- Strong stage-specific diagnostics with stable error codes.
- GitHub Actions build pipeline: Rust tests -> WASM build -> JS tests/build -> GitHub Pages deploy.

## 3. Explicit non-goals for V1.4.8

The following are not part of this release and must not delay the decoder migration:

- V1.5 station/layer panel (ASOS/AWOS, sounding stations, etc.).
- V2 warning/watch/MD workstation issuance workflow.
- Server-side radar preprocessing or paid tile APIs.
- WASM threads, Rayon, SharedArrayBuffer, or cross-origin-isolation requirements.
- 3D radar, cross sections, MRMS, MESH, VIL, echo tops, or KDP as production features.
- Replacing GitHub Pages with a native desktop app.
- Fake/fallback radar imagery when Level II decode fails.

## 4. High-level architecture

The browser remains split into a thin main thread and radar workers.

```text
Main/UI thread
  - MapLibre map
  - WebGL radar layer
  - timeline and controls
  - keyboard handling
        |
        | commands / transferable ArrayBuffers
        v
Radar worker pool
  - NEXRAD HTTP fetches
  - live chunk polling
  - IndexedDB cache
  - Rust/WASM RadarEngine instances
        |
        v
Rust nexrad stack
  - Archive II record handling
  - BZip2 decompression
  - Message/radial decoding
  - elevation/product grouping
  - PSWP V1 blob construction
        |
        v
SweepBlob V1
  - cached in IndexedDB for completed data
  - transferred directly to renderer for live/partial data
```

The main thread must never instantiate or directly call the radar WASM module.

## 5. Worker model

V1.4.8 uses ordinary browser workers rather than WASM threads.

### Priority worker

Responsibilities:

- Current selected radar.
- Latest completed scan.
- Real-time chunk polling and ingestion.
- Current/near-current frame requests.
- Fast response to product/elevation changes.

### History worker

Responsibilities:

- Two-hour archive backfill.
- Decoding old completed volumes.
- Creating and persisting sweep blobs in the background.

Each worker owns an independent WASM instance. A slow history decode must not block live ingest or UI interaction.

## 6. Rust dependency baseline

The first V1.4.8 implementation pins the versions already proven by NEXRAD Workbench rather than silently floating to newer releases during debugging:

- `nexrad = 1.0.0-rc.4` with `default-features = false`, `features = ["wasm"]`
- `nexrad-data = 1.0.0-rc.7`
- `nexrad-decode = 1.0.0-rc.3`
- `nexrad-model = 1.0.0-rc.2`
- required `wasm-bindgen` / serialization support as determined by compilation

Dependency versions must be exact/pinned in Cargo.lock for the release.

The implementation may use lower-level `nexrad-*` crates directly where needed, but JavaScript sees only the PersonalNWS wrapper API.

## 7. Confirmed Level II call path

### Completed Archive II volume

Conceptual Rust flow:

```text
Vec<u8>
 -> nexrad_data::volume::File::new(data)
 -> file.records()
 -> record.decompress() when compressed
 -> decompressed.radials() and/or messages()
 -> group Radial values by elevation_number
 -> retain decoded source temporarily
```

Messages may also be inspected to recover VCP/volume metadata.

### Live first chunk

The start chunk contains Archive II context and follows the file path:

```text
File::new(data)
 -> records()
 -> decompress
 -> decode radials/messages
 -> initialize live accumulator
```

### Live intermediate/end record

```text
Record::from_slice(data)
 -> decompress()
 -> radials()
 -> merge into live accumulator by elevation number
```

Radial status is used to identify meaningful scan/elevation boundaries instead of guessing from a 359-to-0 azimuth wrap.

## 8. Rust/WASM public API — RadarEngine API V1

JavaScript must not receive Rust `Scan`, `Sweep`, `Radial`, or `MomentData` objects. The public ABI is limited to five methods.

### 8.1 `ingest_archive`

Conceptual signature:

```rust
ingest_archive(source_id, site, bytes) -> ManifestV1
```

Responsibilities:

- Parse/decompress a completed Archive II volume.
- Decode radials and metadata.
- Group radials by exact elevation number.
- Determine available native moments per elevation.
- Retain the decoded source temporarily.
- Return only a compact manifest; do not return gate matrices.

### 8.2 `start_live`

Conceptual signature:

```rust
start_live(source_id, site, bytes) -> LiveDeltaV1
```

Responsibilities:

- Initialize a stateful live-volume accumulator from the first realtime chunk.
- Decode available radials/metadata.
- Return which elevations changed and which products are currently available.

### 8.3 `ingest_live_record`

Conceptual signature:

```rust
ingest_live_record(source_id, bytes) -> LiveDeltaV1
```

Responsibilities:

- Decode one subsequent realtime LDM record/chunk.
- Merge/update radials in the matching live accumulator.
- Report changed elevations, radial counts, product availability, and completion state.

### 8.4 `build_sweep_blob`

Conceptual signature:

```rust
build_sweep_blob(source_id, elevation_number, product_id) -> Uint8Array
```

Responsibilities:

- Select one exact elevation-number cut and one product.
- Sort selected radials by actual azimuth for a completed sweep; partial-live behavior may preserve/update scan order if required, but output must advertise the sorted flag accurately.
- Validate geometry/scale/offset/word-size compatibility.
- Preserve raw native gate codes.
- Serialize the data into PersonalNWS SweepBlob V1.
- Return a JS-owned byte buffer rather than exposing pointers into mutable WASM memory.

### 8.5 `release_source`

Conceptual signature:

```rust
release_source(source_id)
```

Responsibilities:

- Release retained completed-volume data or a live accumulator.
- Prevent two hours of full decoded volumes from remaining in WASM memory after blobs have been persisted.

## 9. ManifestV1

`ingest_archive` returns metadata similar to:

```json
{
  "version": 1,
  "sourceId": "KDOX|1787493405123",
  "site": "KDOX",
  "scanStartMs": 1787493405123,
  "scanEndMs": 1787493728451,
  "vcp": 212,
  "complete": true,
  "elevations": [
    {
      "number": 1,
      "angle": 0.48,
      "startMs": 1787493405123,
      "endMs": 1787493439811,
      "radialCount": 720,
      "products": [1,2,3,4,5,6]
    }
  ]
}
```

Elevation number is the identity. Display angle is metadata only.

## 10. LiveDeltaV1

`start_live` and `ingest_live_record` return compact change metadata rather than automatically serializing all products after every chunk.

```json
{
  "version": 1,
  "sourceId": "live:KDOX:...",
  "site": "KDOX",
  "scanStartMs": 1787493405123,
  "vcp": 212,
  "volumeComplete": false,
  "changed": [
    {
      "elevationNumber": 1,
      "elevationAngle": 0.48,
      "radialCount": 720,
      "complete": true,
      "products": [1,2,3,4,5,6]
    }
  ]
}
```

The JS worker decides which changed partial sweep should be serialized immediately for display and which completed product blobs should be persisted.

## 11. Product ABI

These IDs are stable for RadarEngine API V1 / SweepBlob V1:

- `1` REF — Reflectivity
- `2` VEL — Radial velocity
- `3` SW — Spectrum width
- `4` ZDR — Differential reflectivity
- `5` RHO/CC — Correlation coefficient
- `6` PHI — Differential phase
- `7` CFP — reserved native clutter-filter product if exposed
- `100-199` reserved for PersonalNWS derived products

V1.4.8 release UI is required to support IDs 1-6 when present in the selected elevation.

## 12. SweepBlob V1 (`PSWP`)

All multibyte values are little-endian. Header size is fixed at 96 bytes and aligned to 8 bytes.

| Bytes | Type | Field |
|---:|---|---|
| 0-3 | ASCII | Magic `PSWP` |
| 4-5 | u16 | Format version = 1 |
| 6-7 | u16 | Header size = 96 |
| 8-9 | u16 | Product ID |
| 10 | u8 | Elevation number |
| 11 | u8 | Gate word size in bytes: 1 or 2 |
| 12-15 | u32 | Flags |
| 16-19 | u32 | Radial count |
| 20-23 | u32 | Maximum gate count |
| 24-31 | f64 | First gate range, km |
| 32-39 | f64 | Gate interval, km |
| 40-47 | f64 | Maximum range, km |
| 48-51 | f32 | Moment scale |
| 52-55 | f32 | Moment offset |
| 56-59 | f32 | Mean elevation angle |
| 60-63 | f32 | Nominal azimuth spacing |
| 64-71 | f64 | Sweep start Unix ms |
| 72-79 | f64 | Sweep end Unix ms |
| 80-83 | u32 | Azimuth-array offset |
| 84-87 | u32 | Radial-time-array offset |
| 88-91 | u32 | Radial-elevation-array offset |
| 92-95 | u32 | Gate-data offset |

Payload sections:

1. `f32 azimuths[radialCount]`
2. 8-byte alignment padding
3. `f64 radialTimes[radialCount]`
4. `f32 radialElevations[radialCount]`
5. required alignment padding
6. gate matrix, row-major: `u8` or `u16 [radialCount * maxGateCount]`

The blob stores raw Level II gate codes. It must not preconvert REF to dBZ, VEL to velocity units, or otherwise normalize native values.

Level II special/sentinel raw values remain raw. The renderer/probe applies scale/offset only for meaningful gate values.

## 13. SweepBlob flags

Reserved V1 lower bits:

- bit 0: complete sweep
- bit 1: live/partial sweep
- bit 2: radial timestamps present
- bit 3: per-radial elevations present
- bit 4: sorted by azimuth
- bit 5: missing/short rows zero-filled

Unknown future bits must be ignored by V1 readers.

## 14. Geometry validation

For a single elevation/product blob, the builder validates that radials use compatible:

- first-gate range
- gate interval
- scale
- offset
- native data word size

The blob's gate width is the maximum gate count found among compatible radials. Short rows are zero-filled rather than truncating longer radials.

An incompatible mid-sweep geometry change must fail explicitly with `E_GEOMETRY_MISMATCH`; the engine must not silently corrupt or reinterpret data.

## 15. IndexedDB layout

Two primary stores are required.

### `scans`

Key:

```text
SITE|SCAN_START_MS
```

Value:

- site
- scan start/end
- VCP
- elevation manifest
- available products
- complete/incomplete state
- cache bookkeeping/version

### `sweeps`

Key:

```text
SITE|SCAN_START_MS|ELEVATION_NUMBER|PRODUCT_ID
```

Value:

- PSWP V1 ArrayBuffer

Completed blobs are written once and reused for later playback/product/elevation changes.

## 16. Cache and memory lifecycle

### Completed archive ingest

```text
fetch volume
 -> transfer to history/priority worker
 -> ingest_archive
 -> build required PSWP blobs
 -> IndexedDB transaction completes
 -> release_source
```

Decoded Rust radial structures do not remain in memory for the full two-hour history.

### Cached playback

```text
timeline/product/elevation request
 -> IndexedDB lookup
 -> PSWP ArrayBuffer
 -> transfer to main thread
 -> GPU
```

No network, BZip2, or Rust decoder work occurs for a cached request.

### Live partial sweep

```text
live chunk
 -> ingest_live_record
 -> selected elevation/product changed
 -> build partial PSWP
 -> transfer directly to renderer
```

Partial blobs are not persisted on every chunk.

### Completed live elevation

When an elevation is reported complete, final blobs for available release products are built and persisted once. The final current blob can also be transferred to the renderer.

## 17. WebGL renderer contract

The renderer consumes PSWP V1 directly.

Responsibilities:

- Validate magic/version/header bounds before creating typed-array views.
- Read raw `u8` or `u16` gate matrix.
- Use actual azimuth values rather than assuming a fixed 360/720-row grid.
- Use actual gate geometry.
- Convert raw values using the moment scale/offset in shader/probe logic.
- Preserve missing/range-fold/sentinel handling.
- Apply product-specific color tables without re-decoding radar data.
- Redraw for map zoom/pan using existing GPU data rather than refetching radar.

V1.4.8 must not restore the previous fixed `720 x 1840` storage/resampling model.

## 18. Radar UI behavior retained

V1.4.8 remains a PersonalNWS radar release rather than a decoder demo.

Required retained behavior:

- Map dominates screen.
- Near-black UI with restrained purple accent.
- Radar-site selection through markers on the map, not a separate site dropdown.
- Compact bottom-left Product / Tilt / Speed / Play-Pause controls.
- Tilt menu is generated from the actual volume manifest and keyed by elevation number.
- Product menu enables only products available for the selected elevation.
- Full-width bottom timeline covering approximately two hours.
- Left/right arrow keys change frames only and never pan the map.
- Space toggles animation.
- Map drag handles pan.
- Town/road/boundary basemap remains useful but not over-cluttered.
- Existing storm-track overlay may remain only if it consumes genuine decoded reflectivity; if unavailable or confidence is insufficient, no fake track is drawn.

## 19. Network/data path

The application uses no paid weather API or usage-based billing service.

Radar data continues to come from public NEXRAD Level II storage:

- completed volume bucket
- realtime chunk bucket

The browser/worker performs the fetch directly. GitHub Pages hosts only application assets, including the compiled decoder WASM.

MapLibre/OpenFreeMap remains the intended map stack unless a separate future decision changes it.

## 20. WASM build/deployment

The Rust source lives in the repository:

```text
decoder/
  Cargo.toml
  Cargo.lock
  src/
    lib.rs
    archive.rs
    live.rs
    blob.rs
    error.rs
```

GitHub Actions must build the decoder separately from Vite.

Target output:

```text
public/decoder/
  personalnws_decoder.js
  personalnws_decoder.d.ts
  personalnws_decoder_bg.wasm
```

`wasm-pack`/`wasm-bindgen` owns compilation of the WASM module. Vite must not parse or transform the `.wasm` binary; it only copies `public/decoder/` into the final site.

Worker decoder URLs are resolved relative to the deployed document/repository base rather than hardcoding `/decoder/...`, so GitHub project-site paths work under any repository name.

## 21. Error contract

The release must not reduce failures to a generic `decoder failed` message.

Worker/Rust errors have structured fields:

```json
{
  "code": "E_RECORD_DECOMPRESS",
  "stage": "archive",
  "sourceId": "KDOX|...",
  "message": "BZip2 decompression failed for record 19",
  "detail": "..."
}
```

Stable V1 codes include:

- `E_ARCHIVE_HEADER`
- `E_RECORD_DECOMPRESS`
- `E_RADAR_DECODE`
- `E_NO_RADIALS`
- `E_SOURCE_NOT_FOUND`
- `E_ELEVATION_NOT_FOUND`
- `E_PRODUCT_NOT_AVAILABLE`
- `E_GEOMETRY_MISMATCH`
- `E_BLOB_BUILD`
- `E_LIVE_START`
- `E_LIVE_RECORD`
- `E_WASM_INIT`
- `E_NETWORK`
- `E_CACHE`
- `E_INTERNAL`

The same complete diagnostic object must be logged to the console and surfaced in the visible diagnostic panel/status UI.

Ordinary corrupt/missing radar input must return `Result`/structured errors rather than causing a Rust panic to cross the WASM boundary.

## 22. Testing strategy

V1.4.8 implementation follows test-first boundaries.

### Rust unit tests

Required coverage:

- product-ID mapping
- elevation grouping preserves duplicate/similar-angle cuts
- geometry validation
- max-gate-count/short-row zero fill
- `u8` blob serialization
- `u16` blob serialization and endianness
- PSWP header offsets/alignment
- flags
- raw-value preservation
- manifest construction
- LiveDelta changed-elevation reporting
- release_source lifecycle
- structured error conversion

### Binary fixture tests

Repository should contain small legal/test radar fixtures where licensing/size permits, or test fixtures downloaded during CI only from a stable public source if necessary.

Acceptance fixtures should confirm at least:

- one completed real Level II archive decodes
- manifest has plausible elevations/products
- REF blob is generated
- at least one dual-pol product blob is generated when present
- duplicate elevation-number cuts are not collapsed

### JS blob-reader tests

Required coverage:

- PSWP magic/version validation
- bounds checks
- typed-array offset/alignment handling
- `u8` and `u16` gate views
- invalid/truncated blob rejection

### Worker integration tests

Required coverage:

- WASM initialization
- archive manifest response
- sweep blob response
- structured error forwarding
- source release
- cache hit does not invoke decoder path

### GitHub Actions release gate

The Pages deployment job must depend on successful:

1. Rust tests
2. Rust/WASM build
3. JS/unit tests
4. Vite production build

A failing decoder test must block deployment.

## 23. Implementation acceptance sequence

These are implementation checkpoints, not separate prototypes/releases.

1. Rust crate compiles natively and its unit tests pass.
2. WASM package builds in GitHub Actions and initializes in a module worker.
3. One real completed Level II volume decodes to a correct manifest.
4. One real REF PSWP blob reaches the renderer and displays geographically correctly.
5. VEL/SW/ZDR/CC/PHI use the same blob/render pipeline.
6. Exact elevation-number tilt selection works, including duplicated low-angle cuts.
7. Completed sweep blobs persist to IndexedDB and reload without re-decoding.
8. Two-hour history backfill operates in the history worker without blocking current radar.
9. Realtime chunks update partial current sweeps.
10. Completed live elevations are finalized/persisted.
11. Timeline/keyboard/playback behavior and performance are validated.
12. Diagnostic/error pathways are deliberately tested.

Only after these release requirements pass is the package labeled and handed off as PersonalNWS V1.4.8.

## 24. Performance requirements

The design targets radar-app-like interaction rather than a tile-reload experience.

- Current map pan/zoom must not trigger radar refetch or radar decode.
- Cached left/right timeline movement must not invoke Archive II decompression.
- Heavy archive/history processing remains off the main thread.
- Live/priority work must not wait for two-hour backfill decoding.
- Transferable `ArrayBuffer`s are used at worker boundaries where ownership can move safely.
- Completed blobs are generated once, then reused.
- Rust/WASM memory is released after persistence rather than retaining the entire history.

No hard FPS number is frozen for V1.4.8 because browser/GPU hardware varies, but obvious UI stalls caused by radar decoding are release-blocking defects.

## 25. Versioning and compatibility

- This document defines `RadarEngine API V1` and `SweepBlob V1`.
- V1 contracts are not silently repurposed later.
- Incompatible future blob changes become `PSWP V2`.
- Incompatible future WASM API changes become `RadarEngine API V2`.
- IndexedDB records include format/version information so incompatible stale data can be invalidated cleanly.

## 26. Release definition of done

PersonalNWS V1.4.8 is complete when a fresh GitHub repository can be populated with the full release, GitHub Actions builds/deploys it without manual decoder workarounds, and the deployed Pages site can:

1. select a real WSR-88D site,
2. ingest genuine Level II data through Rust/WASM,
3. display real native radar moments for real elevation-number cuts,
4. ingest realtime chunks for the current scan,
5. cache completed sweep blobs for fast history playback,
6. scrub the timeline without re-decoding cached frames,
7. remain responsive during background history loading, and
8. expose precise actionable diagnostics when any stage fails.

No fake radar fallback is allowed to make a failing requirement appear successful.

## 27. Approved coverage and smoothness amendment

The user approved the design with two additional release-blocking requirements.

### 27.1 All active NEXRAD Level II radars

"All radars" means every active WSR-88D/NEXRAD Level II site in the current NOAA/NWS station catalog that publishes through the public Unidata NEXRAD Level II data path. The engine must not use a handpicked supported-site allowlist or site-specific decoder branches.

The runtime station catalog uses NOAA/NCEI station metadata when available and merges it with a checked-in fallback catalog. The release audit compares the fallback against the authoritative current catalog so newly added/renamed/retired sites are detected.

TDWR is a different network/data path and is outside V1.4.8 unless it is explicitly added in a future version.

A station that is temporarily offline or has no recent upstream Level II object must be shown as unavailable/no recent data. That condition is not allowed to masquerade as a decoder failure.

### 27.2 Smoothness is measurable

V1.4.8 must pass both architectural and timing gates:

- Map pan/zoom never triggers Level II network fetch, BZip2 decompression, or Rust decode.
- A cached frame request never invokes Archive II decode.
- All archive/history decode, IndexedDB work, and live chunk decode remain off the main UI thread.
- Priority/live ingest is isolated from history backfill by separate workers.
- Twenty consecutive cached timeline changes in the automated Chromium performance test must have p95 request-to-render-ready latency <= 150 ms and median <= 75 ms on the CI reference environment.
- A blob already resident in renderer memory must switch to GPU-ready state with p95 <= 50 ms in the same benchmark.
- During the automated cached-playback benchmark, radar code must create zero main-thread Long Tasks (>50 ms) attributable to decode/cache work.
- A manual release check in current desktop Chrome must confirm smooth continuous pan/zoom and timeline playback while history backfill is active.

Timing gates are reference-environment release gates, not promises that every possible low-end device will achieve identical timings.
