# Yantra — WebGPU Finite-Element Heat Simulator in the Browser

**Status**: Design (v1)
**Date**: 2026-05-28
**Author**: Claude (drafted on behalf of svssdeva)

---

## Context

The 2026 wow-zone for solo-built portfolio projects is **narrow + physical + locally-run + technically improbable in a browser tab**. Reference: WebHeat (GPU thermal sim of any STL — went viral as a high-schooler internship project), Party (WebGPU particle playground), Audiomass (full DAW in a browser).

svssdeva's portfolio is strong in Rust, Bun, Astro, Capacitor, and AI streaming, but has **zero WebGPU**, **zero scientific compute**, and **zero serious data-viz product**. Yantra fills all three gaps with one project, plays to Rust→WGSL transferability, and ships as a single-URL viral-friendly demo.

**Outcome**: A web app where any engineer drops in an `.stl` mechanical part, sets boundary conditions (which faces are hot, which are cold, what's the material), and watches steady-state heat conduction solve in real-time on their GPU. Optional LLM narrator explains the result in plain English.

Sanskrit naming pattern from existing repos (Trinetra, Dasha, Tithi-Mala, Katha-Mala, Leela, Trishul). **Yantra** = "instrument / machine / mystical diagram" — fits the engineering-meets-mythos brand.

---

## Non-goals (YAGNI)

- Not a SOLIDWORKS / ANSYS replacement.
- No multiphysics (no CFD, no EM, no fluid-structure coupling).
- No dynamic / transient heat in MVP (steady-state only). Time evolution is a stretch.
- No stress / structural analysis in MVP.
- No mesh-from-CAD-kernel; STL only. No tetrahedral solver in MVP — voxel grid (regular cartesian) is the discretization.
- No cloud compute fallback. WebGPU or bust.
- No accounts, no saved projects in MVP — single-session, drop-and-go.

---

## MVP Scope

A user can:
1. Open the URL (no install).
2. See WebGPU availability check; graceful hard-stop with help if missing.
3. Drag any `.stl` (binary or ASCII) into the viewport. See it rendered (Three.js).
4. Voxelize the model into a regular grid at chosen resolution (32³ → 256³).
5. Paint faces / regions of the voxel volume as **boundary conditions**:
   - Fixed temperature (Dirichlet, e.g., 100°C on a top face).
   - Insulated (Neumann zero-flux, default for unset boundaries).
   - Heat source (volumetric W/m³).
6. Pick a material from a preset list (copper, aluminum, steel, PLA, FR4) — sets thermal conductivity `k`.
7. Click **Solve**. A WebGPU compute pipeline runs Jacobi iteration of the steady-state heat equation `∇·(k∇T) + Q = 0` until residual converges below ε.
8. See the volume rendered with a temperature colormap, updating live as iterations proceed. Scrub through slices.
9. Get a summary panel: max temp, location, gradient hot-spots.
10. (Stretch) Click **Explain** → an LLM (OpenRouter, streaming SSE — matches existing whiteboard-react stack) narrates the physics in plain English.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Astro v6 site (SSG + islands)                              │
│  ├─ React 19 island: <YantraApp/>                          │
│  │   ├─ <StlDropZone/>          drag-drop, parse           │
│  │   ├─ <Viewport/>             Three.js scene, camera     │
│  │   ├─ <BcEditor/>             paint Dirichlet/source     │
│  │   ├─ <MaterialPicker/>       presets + custom k         │
│  │   ├─ <SolveControls/>        run/pause/reset, residual  │
│  │   └─ <Narrator/>             SSE stream → markdown      │
│  └─ Web Worker: stl-voxelizer    parse + voxelize off-main │
│                                                              │
│ WebGPU pipeline (in <Viewport/>):                           │
│   ┌──────────────────────────┐                              │
│   │ buffers:                  │                             │
│   │   T (temperature, RW)     │  Float32Array, voxelCount   │
│   │   T_next (ping-pong)      │                             │
│   │   k (conductivity)        │  per-voxel, material map    │
│   │   Q (source)              │  per-voxel, sparse          │
│   │   mask (in/out/Dirichlet) │  u32, packed flags          │
│   │   residual (atomic)       │  u32, fp32-as-bits          │
│   └──────────────────────────┘                              │
│   passes (per frame):                                       │
│     jacobi.wgsl (N iters)  → updates T_next from T, mask    │
│     residual.wgsl           → atomic max |T - T_next|       │
│     swap T <-> T_next                                       │
│   render: raymarched volume OR colored instanced cubes      │
│                                                              │
│ Optional cloud:                                             │
│   OpenRouter SSE  ─── /api/narrate (Bun edge func) ───      │
│   (only invoked on Explain; no PII; no result storage)      │
└─────────────────────────────────────────────────────────────┘
```

### Why this shape
- **Astro + React island**: matches user's stack (heavy Astro bias, React 19 already used in whiteboard-react). Site itself ships static; the heavy app boots only on the canvas page.
- **Web Worker for voxelization**: STL parse + voxel rasterization is CPU-bound (~100ms–2s). Keeps main thread + WebGPU loop responsive.
- **Ping-pong buffers**: standard Jacobi pattern. Two storage buffers, swap each step. Avoids races without locks.
- **Atomic residual buffer**: GPU reports convergence each pass; main thread polls every N frames and decides to stop.
- **No backend for the simulation**. Everything runs in the user's GPU. The OpenRouter narrator is the only network call, and only on explicit user action.

---

## Component breakdown

| Unit | Purpose | Inputs | Outputs | Depends on |
|---|---|---|---|---|
| `stl-parse.ts` | Parse binary/ASCII STL → triangle soup | `ArrayBuffer` | `Triangle[]` | none |
| `voxelize.ts` (worker) | Triangle soup → occupancy grid | `Triangle[]`, resolution | `Uint8Array` mask + bbox | stl-parse |
| `mesh-from-voxels.ts` | Voxel grid → renderable mesh (instanced cubes for MVP; marching cubes stretch) | mask, T | `THREE.InstancedMesh` | three |
| `solver/pipeline.ts` | Build WebGPU compute pipelines, buffers, bind groups | grid dims, mask, k, Q, BCs | `step()`, `residual()` handles | WGSL files |
| `solver/jacobi.wgsl` | One Jacobi iteration | T, k, mask, BC | T_next | — |
| `solver/residual.wgsl` | Max abs diff across volume | T, T_next | atomic u32 | — |
| `bc-editor.tsx` | Paint Dirichlet/source on voxel boundary | mask | bc-buffer updates | viewport |
| `narrator.ts` | Stream LLM explanation via SSE | sim summary JSON | streamed markdown | OpenRouter |

Each unit is independently testable. The solver is decoupled from rendering — you can run it headless in a test.

---

## Physics (steady-state heat conduction)

Discretize `∇·(k∇T) + Q = 0` on a regular grid with spacing `h`. For an interior voxel:

```
T_new[i,j,k] = (
  k_x⁺·T[i+1,j,k] + k_x⁻·T[i-1,j,k] +
  k_y⁺·T[i,j+1,k] + k_y⁻·T[i,j-1,k] +
  k_z⁺·T[i,j,k+1] + k_z⁻·T[i,j,k-1] +
  Q[i,j,k]·h²
) / (k_x⁺ + k_x⁻ + k_y⁺ + k_y⁻ + k_z⁺ + k_z⁻)
```

`k_x⁺` = harmonic mean of `k[i,j,k]` and `k[i+1,j,k]` (handles material interfaces correctly).
**Dirichlet** voxels: skip update (T fixed).
**Outside-mesh** voxels: skip update (treated as insulated).
**Neumann zero-flux** (default boundary): drop the missing neighbor term and divisor.

Convergence: `max |T_new - T| / max(|T|, 1) < 1e-4`.

Jacobi is slow but parallel-perfect and bullet-proof; SOR is a stretch optimization. Expected MVP: <1s on a 128³ grid on a mid-tier discrete GPU.

---

## Error handling

| Scenario | Behavior |
|---|---|
| No WebGPU (Safari pre-26, locked-down Firefox) | Hard banner with feature-detect explanation + screenshot link |
| STL > 50 MB | Warn + offer downsample-on-load (decimate to 200k triangles) |
| Non-watertight STL | Voxelize anyway via "stochastic inside-check" (cast rays from voxel center, even crossings = outside). Show count of "ambiguous" voxels |
| User clicks Solve with no Dirichlet BC | Block; toast "Pin at least one face to a fixed temperature" |
| Solver diverges (shouldn't happen for Jacobi on linear PDE) | Detect (NaN sweep), surface diagnostics |
| WebGPU device lost | Recreate pipeline once; if it recurs, surface error |
| OpenRouter call fails | Narrator panel shows error inline; sim is unaffected |

---

## Testing strategy

- **Unit (vitest, runs in headless WebGPU via @webgpu/dawn or skipped with a marker)**
  - `stl-parse`: round-trip a known cube, sphere; reject malformed.
  - `voxelize`: cube → exactly NxNxN filled voxels at fitted resolution; sphere → voxel count within 5% of analytical volume.
  - `solver` headless: 1D-equivalent (`Nx1x1` grid) with Dirichlet at ends, verify linear gradient within 1e-3.
  - `solver` 2D plate with hot spot → match analytical Gaussian-decay approximation in central region.
- **Property**: residual is monotonically non-increasing across iterations on a converging problem.
- **Integration (Playwright)**: full flow — load STL fixture, paint BC programmatically via test hook, run solver, snapshot canvas, compare against golden image with SSIM tolerance.
- **Performance budget**: 128³ grid solves to ε=1e-4 in <3s on RTX 3060-class. Logged in `bench/`.

---

## File layout

```
yantra/
├─ apps/web/                 # Astro site
│  ├─ src/pages/index.astro
│  ├─ src/pages/sim.astro
│  └─ src/components/yantra/  # React island lives here
├─ packages/solver/          # Pure TS + WGSL, no DOM
│  ├─ src/pipeline.ts
│  ├─ src/wgsl/jacobi.wgsl
│  ├─ src/wgsl/residual.wgsl
│  └─ tests/
├─ packages/mesh/            # STL parse, voxelize, marching cubes
├─ packages/ui/              # React components
├─ bench/                    # perf harness
├─ bun.lockb
├─ package.json              # workspaces
└─ README.md
```

Bun workspace monorepo (matches existing shiksha-monorepo and beyondcodekarma patterns).

---

## Build phases

1. **Phase 0 — skeleton**: Astro site, Bun workspace, CI (Biome + vitest), README, license. ½ day.
2. **Phase 1 — STL + voxel pipeline**: parse, voxelize in worker, render voxel cubes with Three.js. End: drag STL, see voxels. ~2 days.
3. **Phase 2 — solver (CPU first, then GPU)**: Implement Jacobi in pure TS for the 1D/2D tests. Port to WGSL compute pipeline. End: solve 1D bar, match analytical. ~3-4 days.
4. **Phase 3 — full 3D solve + BC editor**: Dirichlet painting UI, residual feedback, live re-render. End: drop STL → set BC → solve → see colormap. ~3-4 days.
5. **Phase 4 — polish**: material presets, performance pass, error UX, dark-mode WebGPU-shader-style visuals, landing page. ~2-3 days.
6. **Phase 5 (stretch)**: LLM narrator (SSE via Bun edge function), transient heat, isosurfaces (marching cubes), shareable URL state.

Total MVP (Phases 0–4): ~2 weeks of focused solo work.

---

## Verification (end-to-end)

After Phase 4 a reviewer can:
1. `bun install && bun dev` from repo root.
2. Open http://localhost:4321/sim in a WebGPU-capable browser.
3. Drag in `fixtures/heatsink.stl`.
4. Set top face → fixed 100 °C, bottom face → fixed 25 °C, material → aluminum.
5. Click **Solve**. Residual graph drops; volume colors evolve top-red → bottom-blue.
6. Confirm via slice scrubber that gradient is monotonic top→bottom.
7. (Stretch) Click **Explain** → narrator streams a paragraph identifying the steepest gradient.

Headless verification:
- `bun test` → all unit + property tests pass.
- `bun playwright test` → integration golden-image diff passes.
- `bun bench/solver.bench.ts` → 128³ Jacobi converges < 3 s.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| WebGPU surface still flaky on Firefox / Safari | MVP targets Chrome/Edge/Arc; degrade message elsewhere. Note in README. |
| WGSL skill ramp-up | Compute shaders are well-documented; Jacobi is the simplest possible kernel. CPU reference implementation de-risks correctness before GPU port. |
| Non-watertight STLs from the wild | Stochastic inside-check + visible "ambiguous voxel" count. Don't pretend it's perfect. |
| Voxel resolution vs. memory | Cap at 256³ for MVP (~64 MB per buffer). Soft warning at 128³. |
| Demo-fragility (looks great on dev machine, dies on reviewer's laptop) | Test on integrated GPU before launch; provide preset that runs on 32³ for low-end. |

---

## Open questions

None blocking; all locked above. (Stretch decisions — transient heat scheme, marching-cubes vs. raymarched volume — deferred to post-MVP.)
