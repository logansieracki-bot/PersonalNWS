# Third-party components

## NEXRAD Rust crates

Pinned browser-tested release candidates:

- `nexrad` 1.0.0-rc.4 — Rust/WASM radar API
- `nexrad-data` 1.0.0-rc.7 — Archive II record/data handling
- `nexrad-decode` 1.0.0-rc.3 — NEXRAD message decoding
- `nexrad-model` 1.0.0-rc.2 — decoded radar domain model
- `nexrad-render` 1.0.0-rc.4 — product/moment selection support

Licensing is governed by the respective upstream crate repositories/packages.

## wasm-bindgen / wasm-pack

- `wasm-bindgen` — Rust ↔ browser WebAssembly bindings
- `wasm-pack` 0.13.1 — CI build tool for the browser decoder package

## MapLibre GL JS

- Package: `maplibre-gl`
- Version: 5.24.0
- License: BSD-3-Clause

## OpenFreeMap

OpenFreeMap public map styles/tiles are used for the basemap. Map data is derived from OpenStreetMap according to OpenFreeMap/OpenStreetMap attribution requirements.

## Vite

- Package: `vite`
- Version: 7.3.6
- License: MIT

## Playwright

- Package: `@playwright/test`
- Version: 1.55.0
- Role: production-browser integration test in GitHub Actions

## Radar data

NEXRAD Level II data is NOAA data distributed through the public Unidata/NODD buckets. NOAA makes these data publicly available; use of NOAA data does not imply NOAA endorsement of PersonalNWS.
