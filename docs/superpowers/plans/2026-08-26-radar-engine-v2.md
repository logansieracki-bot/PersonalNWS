# Radar Engine V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace decoder-first radar startup with a hybrid fast-current + native-Level-II radar engine while preserving the existing PersonalNWS UI/map appearance.

**Architecture:** `RadarEngineV2` coordinates NWS RIDGE2 prepared radar and lazy Rust/WASM Level II as two sources inside one always-fast engine. First pixels, live refresh, frame metadata, advanced products, history, caching, and diagnostics are isolated so slow or failed background work cannot blank the visible radar.

**Tech Stack:** Vite, JavaScript modules, MapLibre GL, NWS RIDGE2/GeoServer WMS/WFS, Unidata NEXRAD Level II S3, Rust, wasm-bindgen/wasm-pack, IndexedDB, Playwright, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-26-radar-engine-v2-design.md`

## Global Constraints

- GitHub Pages remains the frontend deployment target.
- Do not redesign or reposition existing UI/map controls.
- Latest visible radar outranks history and decoder warm-up.
- Generic WSR-88D handling; no station-specific production paths.
- Stage-specific diagnostics are required for every critical boundary.

---

### Task 1: Fast NWS radar lane

**Files:** `src/radar/fast-radar-source.js`, `src/render/fast-radar-layer.js`, `tests/js/fast-radar-source.test.mjs`, `tests/js/fast-radar-layer.test.mjs`

- [x] Add product-to-RIDGE2 layer mapping for SR_BREF/SR_BVEL.
- [x] Build generic per-site WMS tile URLs with cache tokens.
- [x] Stage replacement raster sources at zero opacity.
- [x] Swap only after source readiness and preserve old radar on failure.
- [x] Add source error and timeout diagnostics.

### Task 2: Hybrid controller and live refresh

**Files:** `src/radar/radar-engine-v2.js`, `tests/js/radar-engine-v2.test.mjs`

- [x] Make prepared NWS radar the first-frame source without introducing a fast/slow mode.
- [x] Keep Level II lazy until advanced/history work requires it.
- [x] Poll live data and preserve historical user selection.
- [x] Make fast product changes independent of Level II metadata latency.
- [x] Delay history warm-up until metadata actually exists.
- [x] Restore previous-completed-volume fallback for Level II failures.

### Task 3: Full WSR-88D catalog

**Files:** `src/radar/wsr88d-ids.js`, `src/radar/site-catalog.js`, `scripts/refresh-radar-catalog.mjs`, `.github/workflows/pages.yml`, `tests/js/source-catalog.test.mjs`

- [x] Add the official per-radar WSR-88D service allow-list.
- [x] Refresh names/coordinates from NWS WFS.
- [x] Fall through to WFS if a checked-in catalog is undersized.
- [x] Block Pages deploy when fewer than 150 WSR-88D sites are present.

### Task 4: Structured diagnostics

**Files:** `src/diagnostics.js`, `src/radar/worker-client.js`, `src/radar/frame-pipeline.js`, `src/radar/radar-engine-v2.js`, `src/main.js`, `tests/js/diagnostics.test.mjs`

- [x] Record stage/code/context/timing/detail in a bounded log.
- [x] Forward worker diagnostic/metric events to the browser trail.
- [x] Expose state/log/report/copy helpers through `window.__PERSONALNWS__`.
- [x] Include the recent pipeline trail in fatal diagnostics.

### Task 5: UI metadata without redesign

**Files:** `src/ui/ui-adapter.js`, `src/ui/styles.css`, `tests/js/ui-adapter.test.mjs`, `tests/js/timestamp-style.test.mjs`

- [x] Mark newest frame as `LIVE · <time>`.
- [x] Increase only the current frame time typography modestly.
- [x] Keep the existing timeline/control positions and map styling.

### Task 6: Release/deployment gates and documentation

**Files:** `README.md`, `REPAIR_NOTES.md`, `index.html`, `public/manifest.webmanifest`, `decoder/Cargo.toml`, `.github/workflows/pages.yml`, `tests/browser/real-frame.spec.js`, `tests/js/release-metadata.test.mjs`, `tests/js/workflow-smoke-gate.test.mjs`

- [x] Synchronize Alpha release metadata across app/decoder/docs/workflow.
- [x] Document hybrid architecture, live behavior, all-site scope, debugging, and GitHub Desktop flow.
- [x] Gate browser smoke on real fast-radar pixels before forcing real Level II WASM/WebGL.
- [x] Verify decoder assets survive the final Vite/Pages artifact.
- [ ] Run full JS suite and syntax checks.
- [ ] Run production Vite build where dependencies are available.
- [ ] Let GitHub Actions run authoritative Cargo/WASM/current-data/browser gates after push.
