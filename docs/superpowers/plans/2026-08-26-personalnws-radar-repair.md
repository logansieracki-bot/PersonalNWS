# PersonalNWS Radar Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the complete static GitHub Pages radar loading pipeline without changing UI/map appearance.

**Architecture:** Keep the existing priority/history Rust-WASM worker model, but isolate history startup, bound network/worker operations, make S3 discovery resilient, retain one active decoded volume for interactive switching, and make Rust decode/PSWP serialization tolerant of isolated bad records. GitHub Actions remains the full integration gate.

**Tech Stack:** Vite, MapLibre GL JS, Web Workers, IndexedDB, Rust/WASM via wasm-pack, danielway/nexrad crates, Playwright, GitHub Pages Actions.

**Spec:** `docs/superpowers/specs/2026-08-26-personalnws-radar-repair-design.md`

## Global Constraints
- No UI, map-style, control-layout, or radar-appearance redesign.
- No mandatory backend service.
- Deployment remains push-to-main via GitHub Desktop → GitHub Actions → GitHub Pages.
- Current real Level II decode/render smoke test must gate deployment.

---

### Task 1: Browser/WASM startup hardening
- [x] Add module-or-path wasm-bindgen initialization with compatibility fallback.
- [x] Add worker request timeouts and message-error handling.
- [x] Start priority worker independently from history worker.
- [x] Ensure history initialization failure cannot fail primary startup.
- [x] Add regression tests.

### Task 2: S3/network hardening
- [x] Follow ListObjectsV2 continuation tokens.
- [x] Use no-store for radar discovery/object retrieval.
- [x] Keep successful date listings when another date returns a transient error.
- [x] Remove unnecessary future-day listing.
- [x] Add archive fetch retry and timeout behavior.
- [x] Add regression tests.

### Task 3: Decoder/serialization tolerance
- [x] Fall back from full message parsing to radial parsing when VCP metadata parsing fails.
- [x] Skip isolated compressed-record decompression failures.
- [x] Apply the same fallback to live record paths.
- [x] Select dominant PSWP moment geometry rather than failing an entire sweep on an isolated outlier.
- [x] Add Rust regression coverage for geometry tolerance.

### Task 4: Interactive performance/cache safety
- [x] Bump decoder cache engine generation.
- [x] Retain one active decoded source in priority/history pipeline for same-volume product/tilt reuse.
- [x] Release retained source when moving to another volume or disposing pipeline.
- [x] Add regression tests.

### Task 5: GitHub Pages deployment guardrails
- [x] Add build timeout.
- [x] Verify generated decoder files before Vite build.
- [x] Verify decoder JS/WASM exist in final `dist/decoder` Pages artifact.
- [x] Preserve current real-volume native Rust + browser WASM/render release gates.
- [x] Document GitHub Desktop push/testing flow.
