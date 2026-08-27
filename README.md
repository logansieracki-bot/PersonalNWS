# PersonalNWS Alpha

PersonalNWS Alpha is a browser-based personal NEXRAD workstation deployed as a static GitHub Pages app. The Alpha radar engine keeps the existing map/UI appearance while replacing the old single-path radar loader with a hybrid engine built for fast first pixels, live updates, all current WSR-88D sites, advanced Level II products, progressive history, and useful diagnostics when something breaks.

PersonalNWS is a personal display and is **not** an official National Weather Service product.

## Alpha radar engine

PersonalNWS has **one radar engine and one performance target: fast**. It does not expose separate speed modes. Instead, the same controller chooses the best data source for the requested view while keeping a single visible radar state.

```text
SELECT WSR-88D SITE
        │
        ├── NWS prepared radar (SR_BREF / SR_BVEL)
        │      └── immediate current reflectivity / velocity
        │
        └── Unidata Level II
               ├── advanced native products and elevations
               ├── historical frames
               ├── Rust/WASM decoding
               └── PSWP / WebGL2 rendering

Both sources feed the same live radar experience.
```

### Prepared current radar

For the latest lowest-cut reflectivity or velocity, PersonalNWS renders the official NWS RIDGE2 per-site radar service directly as a MapLibre raster layer. This path does **not** wait for Rust/WASM, Archive II download, decompression, or history backfill before showing radar.

NWS GeoServer product codes are mapped to station-scoped WMS resources. For example, KDIX `SR_BREF` is requested as the `kdix_sr_bref` layer through `/geoserver/kdix/kdix_sr_bref/ows`; Alpha never sends bare `layers=SR_BREF` to a station workspace.

Prepared radar becomes ready on the **first usable raster-tile/content event**, not only after MapLibre says every requested viewport tile is finished. One failed/offscreen tile no longer kills the whole radar source. Refreshes are atomic: the previous working radar stays visible until replacement data becomes usable.

### Native Level II data

Advanced products, non-lowest elevations, historical frames, and the native radial renderer use the public Unidata Level II archive. Level II initializes lazily so advanced/background work cannot block the first visible radar.

The worker/Rust path is:

```text
Unidata Level II object
        ↓
priority Web Worker
        ↓
Rust/WASM RadarEngine
        ↓
Archive II records → radial moments
        ↓
PSWP V1 sweep buffer
        ↓
MapLibre custom WebGL2 radar layer
```

A separate history worker backfills frames after visible radar is already usable. Cached sweeps bypass network fetch and Rust decode. When IndexedDB is unavailable, the cache falls back to memory instead of failing radar startup.

## Live refresh

The selected radar stays live automatically. The Alpha radar engine polls for new data every 20 seconds while the user is following the newest frame.

- Prepared radar refreshes use a cache-busted source URL so newly published NWS imagery can replace the current frame.
- The currently visible radar remains on-screen until replacement data is usable.
- Level II metadata is refreshed in parallel so the timeline advances as new completed volumes appear.
- If the user moves backward in history, live polling continues but does not yank the timeline back to newest.
- When the user returns to the newest frame, live-follow behavior resumes.
- History/backfill work never blocks the latest visible frame.

The bottom-center frame time is intentionally emphasized and marks the newest frame with `LIVE ·` while preserving the actual frame clock time.

## Full WSR-88D catalog

The Alpha radar engine is not built around a small test list. The source checkout carries a small emergency fallback catalog, but both runtime startup and GitHub Actions refresh from the official NWS radar-sites WFS whenever that fallback is undersized. The deployment workflow refuses to publish a built catalog with fewer than **150** current WSR-88D sites.

The runtime understands four-character site IDs generically; KDIX, KDOX, KTLX, PAHG, PHKI, TJUA, PGUA, and every other supported WSR-88D use the same code path. Namespaced IDs such as `NEXRAD:KGGW` are normalized to the Level II station ID.

## Native Level II products

When present on the selected elevation:

- REF — Reflectivity
- VEL — Radial velocity
- SW — Spectrum width
- ZDR — Differential reflectivity
- RHO/CC — Correlation coefficient
- PHI — Differential phase

Elevation number remains the identity, so repeated/similar low-level cuts stay distinct rather than being merged only by displayed angle.

## Diagnostics and debugging

Alpha no longer reduces failures to `Decoder failed`. The browser keeps a bounded structured radar-pipeline log with timestamps, stages, stable event/error codes, station/product/elevation context, source/object identifiers, byte counts, elapsed time, and original error details when available.

Important stages include:

```text
boot → catalog → selection → fast-radar → listing → network
     → wasm → decode → sweep → cache → render → history → live
```

Worker diagnostics are forwarded into the same browser log so the trail can show exactly where a load stopped, for example:

```text
FAST_FAILED
FRAME_DISCOVERY_OK
ARCHIVE_FETCH_OK
WASM_INGEST_START
E_NO_RADIALS
```

From the browser console:

```js
// Current engine/render state
window.__PERSONALNWS__.debug()

// Recent structured events
window.__PERSONALNWS__.logs(100)

// Complete copy/paste-friendly report
window.__PERSONALNWS__.debugReport()

// Copies the report to the clipboard when the browser allows it
await window.__PERSONALNWS__.copyDebugReport()

// Clear the in-memory diagnostic trail
window.__PERSONALNWS__.clearLogs()
```

Fatal runtime diagnostics also include the most recent radar-pipeline trail instead of only one generic error sentence.

## Rendering behavior

- Existing PersonalNWS map styling and controls are preserved.
- Prepared NWS raster radar and native Level II radar occupy the same radar layer position below map labels.
- Source swaps are atomic: a working radar frame stays visible while its replacement loads.
- The custom Level II renderer keeps decoded sweep data when temporarily hidden, so changing data sources does not automatically discard useful work.
- Left/right arrow keys navigate radar frames; MapLibre keyboard panning remains disabled.

## GitHub Desktop → GitHub Pages deployment

The intended test/deploy workflow remains simple:

1. Copy/update the project in the local GitHub Desktop clone.
2. Commit to `main`.
3. Push with GitHub Desktop.
4. GitHub Actions builds and verifies the release.
5. GitHub Pages deploys after all blocking build/decoder/catalog gates pass. The live-browser radar smoke is diagnostic during Alpha so a flaky external-service check cannot strand Pages on an older build.

Repository **Settings → Pages → Source** should be **GitHub Actions**.

The deployment workflow verifies:

- Rust formatting and tests.
- Exact `nexrad` dependency API assumptions.
- Browser-WASM compilation.
- Generated decoder `.js` and `.wasm` assets before and after the Vite build.
- JavaScript unit/regression tests.
- A refreshed full WSR-88D station catalog (minimum 150 sites).
- A genuinely current Level II volume through native Rust decode.
- A production-browser smoke test that proves prepared NWS radar becomes visible first and then forces the real Level II/WASM/WebGL path.

Rust compilation/tests, WASM compilation, JS regressions, catalog-size validation, production build checks, decoder-artifact checks, and the native current-Level-II smoke are blocking gates. The real-browser radar smoke is intentionally non-blocking during Alpha; its Playwright diagnostics are uploaded when it fails so the newest instrumented Alpha can still be tested on Pages.

## Full-audit hardening

The Alpha codebase has been audited across the actual production entrypoint, radar controller, prepared-radar renderer, Level II worker/session lifecycle, cache, S3 discovery/download path, Rust archive/blob handling, WebGL renderer, station catalog, browser smoke test, and Pages workflow. Important hardening from that audit includes:

- Decoder glue and WASM URLs include the exact Git build SHA, preventing a new app bundle from silently reusing an older decoder.
- Worker crashes and timeouts permanently invalidate dead clients; retries create genuinely fresh decoder workers.
- The history worker can restart independently without taking down the priority decoder.
- Level II requests are generation-guarded so older downloads/results cannot overwrite a newer requested frame.
- The current decoded Rust source remains usable while replacement bytes download, and stale sources are released at the actual source-swap boundary.
- IndexedDB is optional: open/read/write failures degrade to memory/uncached operation instead of blocking radar.
- Cache writes are off the first-sweep critical path.
- S3 listing, archive fetch/body reads, catalog fetches, map startup, worker requests, and CI smoke discovery/downloads have bounded deadlines.
- Rust PSWP serialization uses checked geometry/layout arithmetic and avoids production panic-style `unwrap()`/`expect()` paths.
- WebGL setup, shader compilation, program linking, texture upload, and draw failures use structured diagnostic codes.
- Real user actions go through the diagnostic action boundary; the browser smoke test clicks an actual MapLibre radar marker rather than calling a hidden selection API.
- The duplicate worker-side site-selection/listing controller and deprecated ArcGIS catalog implementation were removed, leaving one production frame-selection path and one current station-catalog service.

The bottom current-frame timestamp is `17px` / `850` weight: intentionally stronger, but still inside the original timeline layout.

### Build reproducibility limitation

The repository still does not contain `package-lock.json` or `decoder/Cargo.lock`. Direct JavaScript dependencies and the NEXRAD Rust crates are version-pinned, but transitive dependency resolution is not fully frozen until those lockfiles are generated and committed from an environment with package-registry access. This repair environment cannot reliably reach npm and does not provide Cargo, so lockfiles are deliberately not fabricated.

## Data sources and cost

PersonalNWS does not require a paid weather API, AWS account, Mapbox token, Google Maps key, or usage-based radar subscription.

- Prepared current radar: NWS RIDGE2 / IDP-GIS GeoServer WSR-88D services.
- Native radar: public Unidata NEXRAD Level II archive.
- Basemap: MapLibre GL with OpenFreeMap.

## Alpha release notes

- Replaced the old decoder-first startup path with the Alpha always-fast radar engine.
- Added official NWS prepared current radar for lowest-cut reflectivity and velocity.
- Kept Rust/WASM Level II for native products, elevations, and history without making it a speed mode.
- Made Level II decoder startup lazy so it cannot block first radar pixels.
- Added atomic prepared-radar refresh/swap behavior.
- Added continuous live refresh with user-respecting history behavior.
- Replaced the six-site failure mode with a full WSR-88D catalog plus deployment-size gate.
- Added structured cross-thread diagnostics and copyable debug reports.
- Preserved old visible radar when a refresh fails.
- Preserved the existing PersonalNWS map/UI visual design.
- Strengthened the bottom frame-time readout without turning it into a large banner.

### Alpha deployment behavior

Alpha intentionally treats the real-browser radar smoke test as diagnostic rather than a deployment blocker. Rust compilation, unit tests, the production Vite build, decoder artifact checks, the full radar catalog gate, and the native current-Level-II smoke test still block a bad build. If the browser radar smoke fails, GitHub Actions uploads the Playwright diagnostics and still deploys the latest Alpha so runtime debugging is performed against the code that was actually pushed instead of leaving GitHub Pages stuck on an older successful release.

`window.__PERSONALNWS__.debug()` includes the current Git commit as `buildId`, and fatal diagnostics include a **Copy Debug Report** button.

## Deployment identity proof

Alpha deployments now prove the files that actually reach GitHub Pages, not only the source tree.

After Vite builds, GitHub Actions creates `dist/build-info.json` containing the exact commit SHA and release label. The workflow then audits the final `dist` artifact for the Alpha page title, the `Copy Debug Report` control, the emphasized current-frame timestamp CSS, and the generated decoder assets before the Pages artifact is uploaded.

After `actions/deploy-pages` completes, the deploy job requests the real Pages URL with a cache-busting query string and verifies both:

- the live HTML contains `PersonalNWS Alpha`, and
- the live `build-info.json` contains the exact `${GITHUB_SHA}` that triggered the workflow.

The live verification retries for up to 60 seconds to allow Pages/CDN propagation. If an old release such as 1.4 is still being served, the workflow fails the **Verify live Pages deployment** step and prints the live title plus the last `build-info.json` response. This separates a deployment/cache problem from a radar/decoder problem.

For a successfully deployed Alpha build, `window.__PERSONALNWS__.debug().buildId` is the same Git SHA recorded in `/build-info.json`.
