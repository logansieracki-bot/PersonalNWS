# PersonalNWS Stage 1 Clean Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy radar runtime with a minimal static frontend while preserving the existing PersonalNWS HTML/CSS shell.

**Architecture:** `main.js` composes a MapLibre map shell, DOM bindings, structured diagnostics, and an inert radar adapter slot. All NEXRAD, Rust/WASM, worker, cache, history, and radar-rendering code is removed until Stage 2.

**Tech Stack:** HTML, CSS, JavaScript ES modules, MapLibre GL JS, Vite, Node test runner, Playwright, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-27-stage1-clean-frontend-design.md`

## Global Constraints
- Preserve the existing HTML/CSS visual contract.
- Deploy as a static Vite site on GitHub Pages.
- Do not ship Rust, WASM, worker, S3, NEXRAD, cache, history, or radar-renderer code in Stage 1.
- Keep the visible release label `Alpha`.
- Keep the current timestamp at 17px/850.

---

### Task 1: Lock the clean frontend contract
**Files:** Create/replace `tests/js/stage1-architecture.test.mjs`, `tests/js/release.test.mjs`.

- [ ] Write failing tests that assert the preserved HTML IDs/styles and forbid legacy radar/decoder directories and imports.
- [ ] Run the tests and confirm they fail against the donor repository.
- [ ] Remove legacy runtime files only after the red tests are proven.

### Task 2: Build UI, diagnostics, and map shell
**Files:** Create `src/ui-bindings.js`, `src/diagnostics.js`, `src/map-shell.js`; modify `src/main.js`.

- [ ] Write behavior tests for DOM bindings and structured diagnostic reports.
- [ ] Implement minimal modules that satisfy those contracts.
- [ ] Keep `index.html` and `src/ui/styles.css` visually unchanged.

### Task 3: Add the Stage 2 radar attachment boundary
**Files:** Create `src/radar-slot.js`, `tests/js/radar-slot.test.mjs`.

- [ ] Write tests for adapter attach/detach, duplicate attachment replacement, and structured failures.
- [ ] Implement `createRadarSlot({ map, ui, diagnostics })` with `attach(adapter)`, `detach()`, and `debug()`.
- [ ] Expose only this boundary through `window.PersonalNWS.attachRadar(adapter)`.

### Task 4: Simplify GitHub Pages deployment
**Files:** Modify `.github/workflows/pages.yml`, `package.json`; create `tests/js/workflow.test.mjs`.

- [ ] Write a failing workflow test proving Stage 1 contains no Rust/WASM steps and still builds/deploys `dist`.
- [ ] Replace the workflow with Node test/build/artifact/live-deployment verification only.
- [ ] Keep build identity stamping and live Pages SHA verification.

### Task 5: Browser shell smoke and exact-artifact verification
**Files:** Replace `tests/browser/real-frame.spec.js` with `tests/browser/frontend-shell.spec.js`.

- [ ] Browser-test the real HTML shell, MapLibre canvas, Alpha title, controls, timeline, and debug API without NEXRAD.
- [ ] Run all Node tests and syntax checks.
- [ ] Package the repository, extract the exact ZIP into a fresh directory, and rerun the source tests/checks against the extracted handoff.
