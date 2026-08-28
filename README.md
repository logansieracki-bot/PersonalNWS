# PersonalNWS Alpha — Stage 1

PersonalNWS Stage 1 is a clean frontend reset for the weather/radar project. It intentionally preserves the existing PersonalNWS dashboard HTML and CSS while removing the old NEXRAD runtime so the site can be proven stable on GitHub Pages before live radar is added back in Stage 2.

PersonalNWS is a personal display and is **not** an official National Weather Service product.

## What Stage 1 keeps

The visual shell is preserved:

- Full-screen MapLibre map
- Top status strip
- PersonalNWS Alpha disclaimer
- Product / tilt / speed / play / tracks controls
- Coordinate/value readout
- Cache-progress strip
- Frame slider
- Left / current / right timestamps
- 17px / 850-weight current-frame timestamp
- Existing fatal/debug panel and Copy Debug Report button

The Stage 1 `index.html` and `src/ui/styles.css` are carried forward unchanged from the audited Alpha donor build.

## What Stage 1 removes

Stage 1 deliberately ships **none** of the old radar implementation:

- No Rust decoder
- No WASM
- No Web Workers
- No Level II archive code
- No S3 discovery/download code
- No NEXRAD site catalog
- No radar cache or IndexedDB pipeline
- No frame/history engine
- No radar renderer
- No previous radar controller

This is intentional. Stage 1 proves the frontend and deployment independently of radar.

## Clean frontend architecture

```text
index.html + existing CSS
        ↓
     main.js
   ┌────┼──────────┐
   ↓    ↓          ↓
Map shell   UI bindings   Diagnostics
   │         │             │
   └─────────┴──────┬──────┘
                    ↓
               Radar slot
                    ↓
             Stage 2 adapter
```

Only the `radar-slot.js` boundary knows that a future radar system may attach. The Stage 1 UI and map contain no NEXRAD-specific logic.

Stage 2 can attach with:

```js
await window.PersonalNWS.attachRadar(adapter);
```

The adapter supplies `start({ map, ui, diagnostics })` and may supply `stop()`. That keeps future NEXRAD code isolated from the frontend shell.

## Diagnostics

Diagnostics exist before radar is added so frontend/deployment bugs are still inspectable.

```js
window.PersonalNWS.debug();
window.PersonalNWS.logs(100);
window.PersonalNWS.debugReport();
await window.PersonalNWS.copyDebugReport();
```

Stage 1 records app boot, map startup/source errors, browser exceptions, unhandled promise rejections, and radar-adapter attachment events.

## GitHub Desktop → GitHub Pages

The intended workflow remains:

1. Extract/copy the repository into the GitHub Desktop clone.
2. Commit to `main`.
3. Push with GitHub Desktop.
4. GitHub Actions runs the frontend tests.
5. Vite builds `dist/` with the exact Git commit SHA embedded in the app.
6. Actions audits the Stage 1 artifact to make sure decoder/worker files did **not** sneak back in.
7. A Chromium smoke test checks the real frontend shell and MapLibre canvas.
8. GitHub Pages deploys `dist/`.
9. The deploy job verifies the live Pages site serves the exact pushed SHA from `build-info.json`.

Repository **Settings → Pages → Source** should be **GitHub Actions**.

## Stage 2 goal

Stage 2 will implement the new NEXRAD system on top of this frontend boundary: all supported WSR-88D sites, quick current radar, automatic live updates, history/timeline playback, reflectivity/velocity and later advanced products—without reintroducing radar dependencies into the Stage 1 UI shell.
