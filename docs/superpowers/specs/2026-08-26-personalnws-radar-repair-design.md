# PersonalNWS Radar Repair Design

## Goal
Restore reliable NEXRAD Level II loading on the existing GitHub Pages site without changing the UI or map appearance.

## Constraints
- Static GitHub Pages deployment only; no required backend.
- Preserve existing MapLibre style, radar rendering appearance, controls, and layout.
- Keep Rust/WASM Level II decoding.
- A history/cache failure must not block the latest radar frame.
- CI must reject builds that cannot decode and render a current real Level II volume.

## Architecture
The priority worker owns the interactive/latest decoded source and may retain one current volume in Rust memory for fast product/tilt switching. The history worker remains independent and optional. S3 listing and object fetch paths are bounded by robust pagination, retry, cache-bypass, and request timeouts. Rust ingest tolerates isolated corrupt records and message-parser misses. PSWP serialization tolerates isolated geometry outliers by using the dominant moment geometry.

## Verification
JavaScript regression tests cover all new boundaries. GitHub Actions remains the authoritative Rust/WASM/browser integration proof and must verify decoder files inside the final Pages `dist` artifact.
