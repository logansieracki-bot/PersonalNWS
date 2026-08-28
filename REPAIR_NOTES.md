# PersonalNWS Alpha — Stage 1 clean reset

Stage 1 is not another decoder repair. The previous radar implementation was intentionally removed.

## Preserved exactly

- `index.html`
- `src/ui/styles.css`

The dashboard/map/control/timeline visual contract remains the donor Alpha design.

## Removed

- Rust decoder and toolchain configuration
- WASM build/output
- Radar workers and worker protocol
- Previous radar engine/controller
- Level II archive discovery/download/decode pipeline
- Prepared-radar renderer
- Native radial renderer
- Radar cache/history/backfill code
- NEXRAD catalog scripts and fallback data
- Old radar-specific browser/unit tests
- Old V1/V2 repair/design documents

## Added

- Minimal MapLibre map shell
- DOM-only UI bindings
- Structured frontend diagnostics
- `window.PersonalNWS` debug API
- Small Stage 2 radar adapter slot
- Frontend-only GitHub Pages workflow
- Stage 1 architecture/release/workflow tests
- Browser smoke test for the actual frontend shell

Stage 2 should attach radar through `window.PersonalNWS.attachRadar(adapter)` rather than modifying the HTML/dashboard architecture again.
