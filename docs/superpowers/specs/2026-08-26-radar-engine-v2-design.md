# PersonalNWS Radar Engine V2 Design

## Goal

Make radar appear in seconds, stay live, work generically across the current WSR-88D network, preserve the existing PersonalNWS map/UI appearance, and retain native Level II products/elevations/history without making Rust/WASM decoding a prerequisite for the first visible frame.

## Constraints

- Frontend remains a static Vite app deployed by GitHub Actions to GitHub Pages.
- Existing map styling, control placement, radar-marker look, and overall UI remain unchanged.
- Latest radar must get priority over history/backfill.
- All current WSR-88D sites use the same engine path; test stations are not special-cased.
- Errors must identify the failing pipeline stage instead of collapsing to `Decoder failed`.
- The bottom current-frame timestamp stays in the existing location but is more visually prominent.

## Architecture

Radar Engine V2 is one always-fast controller with two data/render sources. There is no fast/slow mode state; source choice is a capability decision and the UI only tracks actual radar visibility/readiness.

### Prepared current-radar source

The latest lowest-cut reflectivity and velocity use the official NWS RIDGE2/IDP-GIS per-site WMS services (`SR_BREF` and `SR_BVEL`). MapLibre raster sources are cache-busted for live refresh. A new source is loaded invisibly and swapped only after the source is ready; failed refreshes preserve the last known-good radar.

### Native Level II source

Advanced moments, non-lowest elevations, and historical frames use current public Unidata NEXRAD Level II volumes. Rust/WASM runs in workers, builds PSWP sweep buffers, caches completed sweeps in IndexedDB with RAM fallback, and feeds the existing custom WebGL2 radial renderer. Level II workers are lazy and cannot block first visible radar.

## Data flow

```text
site selection
   ├─ prepared WMS source -> MapLibre raster -> first pixels
   └─ frame discovery -> Level II metadata
                           └─ delayed history warm

advanced/historical request
   -> Level II archive fetch
   -> worker Rust/WASM decode
   -> PSWP sweep
   -> WebGL2 radar layer
```

## Live behavior

- Poll selected radar every 20 seconds while a site is active.
- Prepared radar stages a cache-busted replacement raster while the old frame stays visible; this is a source refresh, not a mode switch.
- Level II frame metadata refreshes in parallel.
- If the user is on newest data, new Level II volumes advance the live selection.
- If the user selected an older frame, refresh does not yank them forward.
- History warm-up begins only after frame metadata exists and never blocks first pixels.

## Station catalog

The official NWS per-radar service directory defines a 156-ID WSR-88D allow-list. GitHub Actions refreshes coordinates/names from the NWS radar-sites WFS before Vite builds. Deployment is blocked if fewer than 150 WSR-88D stations survive normalization/filtering. Runtime can fall through to WFS if a local catalog is undersized.

## Error handling and diagnostics

A bounded diagnostic logger records structured entries across boot, catalog, selection, fast radar, S3 listing, network fetch, worker/WASM init, archive decode, sweep build, cache, renderer, history, and live refresh. Worker events are forwarded into the same trail. Each record includes stage, stable code, station/product/elevation context when available, source/object identifiers, elapsed time, bytes, and original details.

The browser exposes `window.__PERSONALNWS__` helpers for state, recent logs, a complete debug report, clipboard copy, and log clearing. Fatal UI output contains the recent pipeline trail.

## Resilience

- If prepared current radar is unavailable, the same engine can display the requested frame from Level II without entering a separate speed mode.
- Prepared-radar refresh failure preserves the old visible source.
- Current Level II loading tries up to three newest completed scans before showing a fatal error.
- IndexedDB failure falls back to RAM.
- Worker/network/listing operations have bounded timeouts.
- Decoder/cache release generation invalidates stale pre-V2 state.

## Release verification

GitHub Actions must verify Rust tests, WASM target compile, generated decoder artifacts, JS tests, refreshed national catalog size, production Vite build, current real Level II native decode, browser prepared-radar loading, current real Level II WASM decode, and WebGL rendering before Pages deployment.
