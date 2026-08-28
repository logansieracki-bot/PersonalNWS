# PersonalNWS Alpha — Stage 1 NEXRAD Design

**Date:** 2026-08-28

## Goal

Stage 1 proves one complete, deterministic KDOX radar volume end-to-end inside PersonalNWS Alpha. The finished snapshot must support all available tilts for four products (Reflectivity, Velocity, Spectrum Width, Correlation Coefficient), use the user's supplied palettes with interpolation, support cursor interrogation, and display matching NEXRAD Storm Tracking Information through the existing Tracks toggle.

Stage 1 is intentionally historical and fixed. It does not fetch the newest scan, animate two hours of history, or support every radar yet. Those are Stage 2 and Stage 3.

## Success definition

A fresh page load must:

1. Load one committed KDOX Archive II volume.
2. Decode it in-browser through Rust/WebAssembly.
3. Show KDOX metadata and real available elevation cuts.
4. Render recognizable, geographically aligned radar data on the existing MapLibre map.
5. Switch among REF, VEL, SW, and RHO without fetching another Level II volume.
6. Switch among real available elevation cuts for the selected product.
7. Apply the supplied `.pal` files with continuous color interpolation.
8. Make REF below 0 dBZ fully transparent, fade alpha from 0–2 dBZ, and use full palette opacity at 2 dBZ and above.
9. Preserve missing/below-threshold/range-folded semantics instead of blending them as normal values.
10. Show the physical radar value under the cursor.
11. Load a committed matching NST Level III product and toggle storm tracks with the existing Tracks button.
12. Preserve the current map appearance, station dots, state/county/CWA styling, controls, and general layout.
13. Produce no uncaught console errors during the Stage 1 acceptance sequence.

## Explicit non-goals

- No live Level II data.
- No `unidata-nexrad-level2-chunks` polling.
- No two-hour timeline.
- No playback or frame stepping yet.
- No all-radar data loading.
- No Stage 2 cache/IndexedDB system.
- No storm-cell detection invented from Level II data; Stage 1 Tracks come from NEXRAD Level III NST.
- No ZDR or PHI rendering until palettes are provided for those products. The existing menu entries may remain visible but disabled/unavailable.
- No MapLibre major-version upgrade during Stage 1.
- No renderer rewrite to image tiles/PNGs.

## Deterministic test event

Use KDOX during the severe-thunderstorm period spanning **2024-07-17 02:45:00Z through 04:00:00Z** (the evening of July 16 local time). This window is intentionally stormy so reflectivity, velocity, CC, alignment, and storm tracks are visually testable.

A fixture-preparation tool will select the earliest complete KDOX volume in that window that satisfies all of these checks:

- at least 5 sweeps;
- at least 300 radials in the lowest usable reflectivity sweep;
- REF exists;
- VEL exists;
- SW exists;
- RHO exists;
- KDOX site metadata decodes correctly;
- a matching DOX NST Level III object exists within ±7 minutes;
- the selected NST parses as product 58 and contains at least one usable storm-cell/vector record.

Once selected, the exact Level II and Level III files are committed under `public/test-data/`, and `fixture.json` records their keys, timestamps, SHA-256 hashes, and expected minimums. CI never chooses a different Stage 1 volume.

## Technology choices

### Application

- Vite **8.2.2**.
- TypeScript.
- Node.js **22.12+** for local build tooling and GitHub Actions.
- Vitest **4.1.11** for TypeScript unit/integration tests.
- MapLibre GL JS pinned to **5.24.0**, matching the current working page.

### Level II decoder

Use Daniel Way's Rust `nexrad` crate family, pinned at major version **1.0**, compiled to WebAssembly.

The browser will not implement NOAA Archive II parsing itself. The WASM wrapper constructs `nexrad_data::volume::File` from bytes, decompresses if required, converts it to the `nexrad_model::data::Scan` model, and exposes only a small stable PersonalNWS API.

### Level III tracks

Use `nexrad-level-3-data` as a development/fixture parser for NST product 58. Stage 1 ships the raw NST fixture and a normalized JSON representation produced from it. The browser does not need a general live Level III loader yet.

### Map rendering

Use a MapLibre `CustomLayerInterface` in 2D mode sharing MapLibre's WebGL2 context.

The renderer draws a geospatial quad covering the selected radar sweep. The fragment shader converts each screen fragment to radar polar coordinates and samples textures containing radar values/status. This avoids generating one polygon per radar gate and avoids pre-rendering a PNG.

## File structure

```text
PersonalNWS/
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── .github/
│   └── workflows/
│       └── deploy-pages.yml
├── src/
│   ├── main.ts
│   ├── app-state.ts
│   ├── map/
│   │   ├── create-map.ts
│   │   ├── boundaries.ts
│   │   └── stations.ts
│   ├── radar/
│   │   ├── types.ts
│   │   ├── volume-worker.ts
│   │   ├── volume-client.ts
│   │   ├── selectors.ts
│   │   ├── resample.ts
│   │   ├── geometry.ts
│   │   ├── radar-layer.ts
│   │   ├── shaders.ts
│   │   └── interrogation.ts
│   ├── palettes/
│   │   ├── parser.ts
│   │   ├── lut.ts
│   │   └── catalog.ts
│   └── tracks/
│       ├── types.ts
│       ├── load-tracks.ts
│       └── map-layer.ts
├── radar-wasm/
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs
├── scripts/
│   ├── prepare-stage1-fixture.mjs
│   └── normalize-nst.mjs
├── public/
│   ├── palettes/
│   │   ├── BR.pal
│   │   ├── BV.pal
│   │   ├── SW.pal
│   │   └── KK.pal
│   └── test-data/
│       ├── kdox-stage1.ar2v
│       ├── kdox-stage1-nst.bin
│       ├── kdox-stage1-tracks.json
│       └── fixture.json
└── tests/
    ├── baseline-ui.test.ts
    ├── palette.test.ts
    ├── selectors.test.ts
    ├── resample.test.ts
    ├── geometry.test.ts
    ├── tracks.test.ts
    └── fixture-contract.test.ts
```

## Stable decoder boundary

The rest of PersonalNWS must never depend on NOAA message block layouts.

The WASM package exposes two classes:

### `RadarVolume`

```text
constructor(bytes: Uint8Array)
stationId(): string
siteLatitude(): number
siteLongitude(): number
siteElevationMeters(): number
collectionTimeMs(): number
vcpNumber(): number
sweepSummariesJson(): string
extractField(sweepIndex: number, product: string): RadarField
```

`sweepSummariesJson()` returns a small metadata array with:

```ts
export interface SweepSummary {
  index: number;
  elevationDeg: number;
  collectionTimeMs: number;
  isSails: boolean;
  products: RadarProduct[];
}
```

### `RadarField`

A `RadarField` owns one selected product/sweep as a rectangular polar grid. It exposes:

```text
product(): string
elevationDeg(): number
radialCount(): number
gateCount(): number
firstGateMeters(): number
gateSpacingMeters(): number
azimuths(): Float32Array
values(): Float32Array
status(): Uint8Array
```

Status codes are fixed:

```text
0 = missing / no gate
1 = valid physical value
2 = below threshold
3 = range folded
```

Values remain in decoded physical units:

- REF: dBZ
- VEL: m/s
- SW: m/s
- RHO: unitless correlation coefficient

The palette layer, not the decoder, applies `.pal` Scale and Offset.

## Product mapping

```text
UI Reflectivity             -> REF -> BR.pal
UI Velocity                 -> VEL -> BV.pal
UI Spectrum Width           -> SW  -> SW.pal
UI Correlation Coefficient  -> RHO -> KK.pal
```

ZDR and PHI are not rendered during Stage 1 because no approved palettes were provided.

## Palette semantics

The parser is case-insensitive and strips text after `;` as comments. Unknown non-directive lines are ignored.

Supported directives for Stage 1:

- `Product:`
- `Units:`
- `Step:`
- `Scale:`
- `Offset:`
- `RF:`
- `Color:`

`Color:` has either one RGB triplet or two RGB triplets. With two triplets, the first is the start color and the second is the end color for the interval from that breakpoint to the next higher breakpoint. With one triplet, the same color is used as both interval endpoints unless the next stop defines its own start color.

Stops are sorted numerically before LUT construction, so the descending CC file is valid.

The renderer converts physical value to palette-domain value as:

```text
paletteValue = physicalValue * Scale + Offset
```

This intentionally follows the supplied BV/SW files, whose `Scale: 1.9426` converts decoded m/s into knots.

The palette is baked into a 2048-entry RGBA LUT texture. RF is stored separately.

### Reflectivity alpha rule

For REF only:

```text
physical dBZ < 0  -> alpha 0
physical dBZ = 0  -> alpha 0
0 < dBZ < 2       -> alpha = dBZ / 2
physical dBZ >= 2 -> palette alpha
```

The palette RGB is still evaluated through the fade interval. Only alpha changes.

Below-threshold and missing gates are transparent. Range-folded gates use the palette RF color when defined; otherwise they are transparent.

## Azimuth normalization

Raw radials are preserved by WASM, including their decoded azimuths. Before GPU upload, TypeScript resamples each field onto a regular circular azimuth grid:

- choose 720 bins when median raw azimuth spacing is < 0.75°;
- otherwise choose 360 bins;
- map each raw radial to its nearest circular bin;
- if two raw radials choose the same bin, keep the radial with the smaller angular error;
- unfilled bins remain status 0;
- never interpolate across an unfilled radial during the resample step.

The regular grid makes the shader deterministic and allows fast texture lookup.

## Radar geometry

Use the standard 4/3-effective-Earth approximation with:

```text
R = (4 / 3) * 6,371,000 meters
```

The fragment shader first computes geodesic ground distance `s` and bearing from the radar site to the fragment's latitude/longitude. Then:

```text
alpha = s / R
slantRange = R * sin(alpha) / cos(elevation + alpha)
```

where elevation and alpha are radians.

Gate coordinate:

```text
gate = (slantRange - firstGateMeters) / gateSpacingMeters
```

Azimuth coordinate is bearing normalized to `[0, 360)`.

The quad is clipped to the maximum ground range of the field. Fragments outside the sweep or on missing data are transparent.

## Spatial sampling

The custom shader performs manual bilinear sampling across range and azimuth only when the required neighboring statuses are valid. Invalid/missing/RF gates are not treated as ordinary numeric samples.

Rules:

- four valid neighbors -> bilinear interpolation;
- otherwise use the nearest valid neighbor within the same 2×2 neighborhood;
- no valid neighbor -> transparent;
- nearest selected status is RF -> RF color rather than numeric interpolation.

Azimuth wraps circularly between the first and last row.

## Map layer order

Radar must sit above base land/roads but below the line/label overlays that make the map readable.

Desired visual stack from bottom to top:

```text
base land/water/roads
radar custom layer
county boundaries
CWA boundaries
state boundaries
storm tracks
radar site dots/labels
place labels
```

Implementation may insert the custom layer immediately before the first existing boundary/label overlay and then explicitly move the PersonalNWS boundary layers above it.

## Product and tilt behavior

The product selector is driven by products present in the decoded volume.

The tilt selector is rebuilt whenever product changes. It shows one option per unique elevation angle for the selected product.

Repeated SAILS/MRLE elevations are grouped by elevation within ±0.05°. The newest complete sweep in the group is chosen for display. Internal metadata keeps the original sweep index so the renderer always extracts the intended sweep.

Changing product attempts to keep the same elevation. If unavailable, choose the closest available elevation, preferring the lower elevation on exact ties.

## Cursor interrogation

When the cursor moves over the map:

1. Convert cursor lat/lon to ground distance/bearing from KDOX.
2. Convert ground distance to slant range using the same geometry function as the shader.
3. Compute azimuth row and gate index in the regularized field.
4. Read the nearest gate status/value.
5. Display:
   - REF: one decimal + ` dBZ`
   - VEL: palette-converted value + ` kt`
   - SW: palette-converted value + ` kt`
   - RHO: two decimals
   - RF: `RF`
   - missing/outside: `—`

The CPU geometry utility and shader formula must use the same constants and equations.

## Tracks

Stage 1 uses the raw Level III NST fixture closest to the Level II volume time. Product 58 is parsed during fixture preparation using `nexrad-level-3-data` and normalized to:

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

`kdox-stage1-tracks.json` contains only this stable schema. The browser does not depend on the external parser's raw object shape.

The Tracks button controls one GeoJSON source with:

- current cell point;
- past path;
- forecast path;
- subtle cell ID label.

Tracks start in the user's existing saved on/off state. If the fixture has no usable tracks, fixture preparation fails; Stage 1 does not silently ship an empty tracks demo.

## Worker behavior

Archive II decode occurs in `volume-worker.ts`, not on the map's main thread.

Messages:

```ts
// main -> worker
{ type: 'load', url: string }
{ type: 'extract', requestId: number, sweepIndex: number, product: RadarProduct }

// worker -> main
{ type: 'ready', metadata: VolumeMetadata }
{ type: 'field', requestId: number, field: TransferableRadarField }
{ type: 'error', code: RadarErrorCode, message: string }
```

`TransferableRadarField` uses transferable ArrayBuffers for azimuths, values, and status to avoid structured-clone duplication.

The main thread caches extracted product/sweep fields in a `Map<string, RegularPolarField>` for the one Stage 1 volume.

## Error codes

Use specific stable codes:

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

The top status bar may show a short human-readable message, while the console logs the code and underlying error.

## Diagnostics

Development logging is prefixed and grouped:

```text
[PNWS:LOAD]
[PNWS:WASM]
[PNWS:DECODE]
[PNWS:FIELD]
[PNWS:PALETTE]
[PNWS:RENDER]
[PNWS:TRACKS]
```

At minimum, successful load logs station, volume time, VCP, sweep count, product availability, chosen sweep, radial count, gate count, texture dimensions, and track count.

## GitHub Pages build

Vite base is fixed to:

```text
/PersonalNWS/
```

Build order:

1. install Node dependencies with `npm ci`;
2. install Rust target `wasm32-unknown-unknown`;
3. build the WASM package with `wasm-pack`;
4. run Rust tests;
5. run TypeScript tests;
6. run TypeScript typecheck;
7. run Vite production build;
8. upload `dist/` as the Pages artifact;
9. deploy Pages.

Stage 1's fixed radar files are ordinary `public/` assets copied into `dist/`.

## Acceptance sequence

A Stage 1 release is accepted only after this sequence works in a normal desktop browser:

1. Hard refresh.
2. Map appears with the current PersonalNWS styling.
3. KDOX fixture loads and status shows its timestamp.
4. REF appears at the lowest available tilt.
5. Pan and zoom; radar remains geographically attached.
6. Toggle CWA; radar remains intact.
7. Switch REF -> VEL -> SW -> RHO; each renders.
8. For each product, change through at least three available tilts.
9. Return to REF and verify 0–2 dBZ fade/no hard low-end rectangle.
10. Hover strong and weak echoes; readout values are plausible and change spatially.
11. Toggle Tracks off/on; only tracks disappear/reappear.
12. Select another station dot; the map may highlight/focus that station but Stage 1 radar remains explicitly labeled as the fixed KDOX fixture rather than pretending data changed.
13. Return to KDOX.
14. Check DevTools: no uncaught exceptions, no failed local Stage 1 asset requests, no shader errors.
15. Run `npm test`, `cargo test`, `npm run typecheck`, and `npm run build`; all pass.

## Stage boundary

When the acceptance sequence passes, Stage 1 is frozen. Stage 2 may replace only the fixture acquisition/time source and add frame history/playback. The decoder, normalized field contract, palette engine, geometry, shader renderer, tilt/product selectors, interrogation, and tracks schema should carry forward unchanged unless a measured Stage 2 requirement proves otherwise.

## Research basis

- NOAA/Unidata's current open-data registry identifies `unidata-nexrad-level2` as the Level II archive and notes the old archive bucket was retired in 2025.
- The Rust `nexrad` project documents its `Scan -> Sweep -> Radial -> MomentData` model, `volume::File::new`, volume-to-scan conversion, and WASM-compatible feature set.
- MapLibre documents `CustomLayerInterface` for rendering directly into the map's WebGL context.
- `nexrad-level-3-data` documents support for Level III product 58 (`NST`, Storm Tracking Information).
- GR color-table documentation defines `Color:` interval gradients and the user-supplied BV/SW palettes explicitly define `Scale: 1.9426` as m/s-to-knots conversion.
