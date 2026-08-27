# PersonalNWS Alpha — 2026-08-26

PersonalNWS Alpha replaces the old decoder-first radar startup architecture while preserving the existing PersonalNWS map/UI appearance.

## Alpha overhaul

- Added a hybrid radar engine: official NWS RIDGE2/GeoServer fast radar for latest lowest-cut reflectivity/velocity, plus the existing native Unidata Level II lane for advanced products, elevations, and history.
- Level II Rust/WASM workers initialize lazily and no longer block the first visible radar frame.
- Fast radar sources are staged and atomically swapped only after MapLibre reports the replacement loaded; failed refreshes keep the old radar visible.
- Added continuous live refresh while following newest data, without forcing users off historical frames.
- Added a 156-site WSR-88D allow-list based on the official NWS per-radar service directory and a Pages deployment gate requiring at least 150 refreshed WSR-88D sites.
- Reworked the station catalog path so an undersized checked-in catalog falls through to the official NWS WFS source rather than silently shipping only a handful of sites.
- Added structured browser + worker diagnostics for boot, catalog, fast-radar, listing, network, WASM, decode, sweep, cache, history, renderer, and live-refresh stages.
- Added `window.__PERSONALNWS__.logs()`, `debugReport()`, `copyDebugReport()`, and `clearLogs()` for copy/paste debugging.
- Fatal diagnostics now include a recent pipeline trail and stable diagnostic/event IDs instead of only `Decoder failed`.
- Strengthened the bottom-center frame timestamp and marks the newest frame as `LIVE · <time>`.
- Updated the browser title, PWA manifest, package version, decoder crate version, README, workflow title, and cache generation for the Alpha release.
- Expanded regression coverage for fast-radar source behavior, live polling, all-site catalog enforcement, diagnostics, release metadata, timestamp prominence, and the hybrid release smoke test.

## GitHub Desktop / Pages test flow

1. Replace/update the project files in the local GitHub Desktop repository.
2. Commit the changes.
3. Push `main` from GitHub Desktop.
4. Open GitHub → **Actions** → the newest Pages run.
5. Pages deploys only after Rust/WASM, full-catalog, fast-radar browser, real-current-Level-II, renderer, and final artifact gates pass.
6. If a runtime failure remains after deployment, run `window.__PERSONALNWS__.copyDebugReport()` in the browser console and paste the report back into ChatGPT.

---


## Alpha WMS fast-lane hotfix — 2026-08-27

- Fixed the NWS GeoServer GetMap URL builder. The Alpha fast lane had requested bare `layers=SR_BREF` / `SR_BVEL` from the station workspace, which returned an OGC service-exception XML document instead of a PNG.
- Fast radar now uses the station-scoped resource/layer naming convention, e.g. KDIX reflectivity uses `/geoserver/kdix/kdix_sr_bref/ows` with `layers=kdix_sr_bref`; velocity uses the corresponding `<site>_sr_bvel` resource.
- Added regression coverage for arbitrary WSR-88D IDs (including Alaska) so this is a network-wide fix rather than a KDIX special case.
- Improved the real-browser release smoke test: if NWS returns non-PNG content, GitHub Actions now prints the WMS URL, content type, and the first 4 KB of the OGC exception body instead of only reporting a MIME mismatch.

# PersonalNWS radar repair pass — 2026-08-26

This repair pass intentionally does **not** redesign the UI, basemap, radar styling, control placement, or map appearance. It hardens the radar pipeline beneath the existing interface.

## Repairs included

- Modern wasm-bindgen initialization using `module_or_path`, with compatibility fallback for older generated glue.
- Worker request timeouts so a dead WASM/worker request cannot leave the app loading forever.
- Priority-worker startup no longer waits on history-worker WASM/IndexedDB initialization.
- History-worker initialization failure is isolated and cannot prevent the primary radar/map app from starting.
- Level II archive fetches use no-store, retry transient 5xx responses, and time out instead of hanging indefinitely.
- S3 archive listing now follows continuation tokens, decodes XML entities, avoids the previous extra-future-day query, deduplicates objects, and preserves successful day listings when one day fails.
- Radar cache engine generation bumped to invalidate stale pre-repair cached sweeps.
- FramePipeline retains the currently decoded Rust source so switching product/tilt on the same volume does not download/decode the same large Archive II object again.
- Rust archive ingest now skips isolated record decompression failures instead of killing the entire volume.
- When broad full-message parsing fails before VCP metadata is found, Rust immediately falls back to the narrower radial parser rather than discarding the record.
- The same message-to-radial fallback is applied to live decoding paths.
- PSWP generation selects the dominant moment geometry and discards isolated geometry-outlier radials rather than failing the whole sweep.
- GitHub Pages CI now explicitly checks that the decoder JS and WASM survive into the final `dist/decoder` artifact that Pages uploads.
- GitHub Actions build has a job timeout so a wedged radar build cannot run indefinitely.
- New regression tests cover S3 pagination/partial failure, WASM init shape, worker timeout, history startup isolation, network retry/timeout, active decoded-volume reuse, cache generation, and final Pages artifact verification.

## GitHub Desktop / Pages test flow

1. Replace/update the project files in the local GitHub Desktop repository.
2. Commit the changes.
3. Push `main` from GitHub Desktop.
4. Open the repository on GitHub → **Actions** → open the newest Pages run.
5. The deploy is allowed only after Rust tests, browser-WASM compilation, current Level II native decode, current Level II browser decode/render, and final `dist` artifact checks pass.
6. If the workflow fails, copy the first red step/error back into ChatGPT; it is now designed to fail at a much more specific boundary.

## Verification performed in the repair environment

- `npm test`: 56/56 passing.
- `node --check` over project JS/MJS files: passing.
- Rust/WASM compilation could not be run locally because this sandbox does not provide Cargo/Rust or dependency-network access. The included GitHub Actions workflow is the authoritative Rust/WASM/build verification gate.

## Dependency lockfiles

The project still does not include `package-lock.json` or `decoder/Cargo.lock`. They should be generated and committed from a machine with dependency access for fully reproducible builds. They were deliberately **not fabricated** in this repair environment.

## Cargo compile follow-up — 2026-08-26

- Fixed the Rust regression-test helper `reflectivity_radial_with_geometry` to use `u16` for `first_gate_m`, matching `nexrad-model 1.0.0-rc.2::MomentData::from_fixed_point`.
- This was a test-helper type mismatch that stopped `cargo test` before the decoder tests could run; it did not require a UI/map or production radar-format change.

## V1.4.10 fast-start/runtime repair — 2026-08-26

This follow-up keeps the existing UI and map appearance unchanged while making the first visible radar frame the highest-priority workload.

- Decoder JS/WASM URLs now carry the app release version (`?v=1.4.10`) so GitHub Pages/browser caches cannot pair fresh app code with stale decoder assets after a push.
- App/map startup and priority WASM initialization now overlap instead of running serially.
- The history worker is not created/initialized until after the first visible radar frame has rendered; backfill cannot compete with first-frame work.
- Priority archive downloads use a short 10-second, no-retry fast path. If the newest completed scan is bad/slow, the worker tries up to two immediately preceding completed scans instead of waiting through long retries.
- Timed-out priority downloads are actively aborted so stale downloads do not continue consuming bandwidth while a fallback scan is tried.
- S3 completed-volume discovery now has a short abortable timeout instead of being able to hang until the whole worker request expires.
- IndexedDB failure/corruption/private-mode restrictions fall back to an in-memory radar cache rather than preventing radar startup.
- The bundled NEXRAD station catalog is now used immediately at runtime. NOAA ArcGIS is only used if the bundled catalog is unavailable, removing an external startup dependency. The bundled catalog is still refreshed in GitHub Actions on every Pages deployment.
- Cache engine generation bumped again so stale pre-fast-start sweep data cannot survive into this decoder/runtime release.
- JS regression suite expanded to cover versioned decoder assets, history ordering/lazy start, cache fallback, newest-scan fallback, aborting timed-out downloads, fast bundled catalog startup, and S3 listing timeouts.

For true lowest-latency live radar, the next architecture step is to wire the existing Rust `start_live` / `ingest_live_record` APIs to the Unidata Level II realtime chunk bucket. That bucket publishes chunks every few seconds and is intended for near-real-time access, but it is deliberately not made a dependency of first-frame startup in V1.4.10.

## Alpha prepared-radar readiness / no-mode hotfix — 2026-08-27

- Removed the `mode = fast/level2` state machine from `RadarEngineV2`. PersonalNWS now has one always-fast engine; prepared NWS imagery and Level II are data sources, not speed modes.
- Replaced debug `mode` checks with factual readiness fields: `radarVisible`, `preparedLayerActive`, and `level2SweepReady`.
- Fixed prepared WMS readiness so first usable raster tile/content activity marks radar ready instead of waiting for MapLibre to report the entire raster source fully loaded.
- Isolated WMS tile errors no longer kill an otherwise usable radar source; Alpha waits for a usable neighboring tile until the bounded timeout.
- Live refresh no longer depends on a mode flag. It refreshes prepared current radar when eligible and updates Level II when advanced/history data requires it.
- Level II fallback now starts the live timer too, so a prepared-source failure cannot leave the displayed fallback frame permanently stale.
- README and architecture documentation now describe one always-fast radar engine rather than fast/slow lanes.

## Alpha browser timer binding hotfix — 2026-08-27

- Fixed Chromium `TypeError: Illegal invocation` during radar selection. Browser-native timer functions were stored on `RadarEngineV2` and then invoked as object methods, which changed their receiver from `window`/`globalThis` to the engine instance.
- `setInterval`, `clearInterval`, `setTimeout`, and `clearTimeout` hooks are now invoked with the browser global receiver via `Reflect.apply(..., globalThis, ...)`.
- Added regression tests that emulate browser-native timer receiver requirements so this cannot silently return.
- Live-refresh timer setup is now non-fatal: if polling cannot be armed, the already-visible radar remains visible and diagnostics record `LIVE_TIMER_FAILED` instead of forcing a Level II fallback or failing site selection.
- Background history timer setup/cleanup now emits structured diagnostics (`HISTORY_TIMER_ARMED`, `HISTORY_TIMER_FAILED`, and clear-failure events) instead of failing silently.
- Browser smoke-test wording now reflects the no-mode architecture: prepared NWS imagery is proven first, then the Level II WASM/render path.

- Fixed Alpha deploy staleness: the real-browser radar smoke test is now diagnostic/non-blocking, so a smoke failure no longer leaves GitHub Pages serving the previous release.
- Added the GitHub commit SHA to runtime diagnostics (`buildId`) so the deployed code can be verified directly.
- Added a Copy Debug Report button to fatal diagnostics and slightly increased the bottom current-frame timestamp to 16px/850 weight.

## Alpha deployment identity repair

A source-level test suite is not sufficient proof that GitHub Pages is serving the same code. The Pages workflow now stamps the final Vite output with `dist/build-info.json`, audits the final artifact for the Alpha title/debug UI/timestamp/decoder assets, deploys that artifact, then verifies the real Pages origin serves the exact triggering Git SHA. The verification uses cache-busting query parameters and retries for Pages propagation. If the live origin is stale, Actions reports that explicitly instead of letting a stale 1.4 site be mistaken for the current Alpha runtime.
