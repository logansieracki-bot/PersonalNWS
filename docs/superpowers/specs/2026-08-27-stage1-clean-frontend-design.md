# PersonalNWS Stage 1 Clean Frontend Design

## Goal
Preserve the current PersonalNWS HTML/CSS appearance while replacing the entire application runtime with a minimal GitHub-Pages-safe frontend foundation for a future NEXRAD implementation.

## Visual contract
`index.html` remains the UI donor. Keep the map, status strip, disclaimer, fatal/debug panel, controls, readout, timeline, progress bar, slider, and timestamps in the same structure and styling. Stage 1 does not redesign the dashboard.

## Runtime architecture
Stage 1 contains only five responsibilities:

1. `src/main.js` boots the page and composes the other modules.
2. `src/map-shell.js` owns MapLibre construction and map readiness/error reporting.
3. `src/ui-bindings.js` owns DOM reads/writes and visual-only control behavior.
4. `src/diagnostics.js` owns structured logs and the existing Copy Debug Report surface.
5. `src/radar-slot.js` is an inert adapter boundary. Stage 2 can attach a NEXRAD controller without changing HTML or the Stage 1 map/UI modules.

No NEXRAD data, Rust, WASM, Web Workers, S3, radar cache, frame history, radar renderer, or station discovery ships in Stage 1.

## Deployment
The project remains a Vite static application deployed by GitHub Actions to GitHub Pages after pushes to `main`. Stage 1's workflow installs Node dependencies, runs frontend tests, builds `dist`, stamps `build-info.json`, audits the final static artifact, deploys it, and verifies the live Pages origin serves the pushed commit.

## Diagnostics
Stage 1 logs boot, map, UI, and radar-slot events with stable stage/code/message/context fields. Window errors and unhandled promise rejections are captured. The existing fatal panel and Copy Debug Report button remain functional.

## Stage 2 interface
Stage 2 supplies an adapter implementing `start(context)` and optional `stop()`. The context contains the MapLibre map, UI bindings, and diagnostics logger. The radar adapter owns all NEXRAD behavior; Stage 1 never imports NEXRAD-specific code.

## Success criteria
- The page visually retains the current PersonalNWS shell.
- MapLibre boots on GitHub Pages.
- No decoder/WASM/worker/NEXRAD code ships in Stage 1.
- The bottom controls/timeline remain present.
- The current-frame timestamp styling remains 17px/850.
- Diagnostics and Copy Debug Report work before radar exists.
- `window.PersonalNWS.attachRadar(adapter)` is the only Stage 2 attachment boundary.
- GitHub Pages deployment uses the exact built `dist` for the pushed commit.
