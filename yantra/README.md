# Yantra

> Drop an STL. Set the hot side. Set the cold side. Watch heat conduct through the part — on your GPU, in your browser tab. No install. No cloud.

Yantra is a browser-only **finite-element heat conduction solver** built on WebGPU compute shaders. Most engineering simulation lives behind ten-thousand-dollar licenses and three-day install guides. Yantra runs the same numerical method — Jacobi iteration of the heat PDE on a voxel grid with harmonic-mean diffusion coefficients — entirely on your GPU. A URL is the install.

## What it does (today)

- **Drop any STL** (binary or ASCII). The mesh is parsed and voxelized into a regular grid in a Web Worker so the UI stays responsive.
- **Pick a material** (Copper, Aluminum, Steel, PLA, FR4) → sets thermal conductivity *k*.
- **Set boundary conditions**: pick which face is hot, which is cold, and at what temperature (°C).
- **Solve** the steady-state heat equation `∇·(k∇T) + Q = 0` on the GPU. Watch the colormap evolve as the residual converges.
- **Detect WebGPU** up front and tell the user clearly if their browser can't run it — no half-broken state.

## How it works

```
STL → triangle soup → ray-crossing voxelizer (Web Worker)
                                     │
                                     ▼
                              voxel mask (0=out, 1=interior, 2=Dirichlet)
                                     │
              ┌──────────────────────┴────────────────────────┐
              ▼                                               ▼
       Three.js InstancedMesh                       WebGPU storage buffers
        (renders one cube per                       (T, k, Q, mask, params)
         interior voxel, color =                            │
         normalized temperature)                            ▼
              ▲                                  jacobi.wgsl  (ping-pong)
              │                                  residual.wgsl (atomic max)
              │                                              │
              └──── readBack() each batch ◄──────────────────┘
```

- **Solver:** classic 7-point stencil discretization. Harmonic-mean *k* at faces handles material interfaces correctly. Out-of-mesh voxels are treated as insulated; Dirichlet voxels are pinned. Convergence is a relative residual `max|T_new - T| / max(|T|,1) < 1e-4`.
- **Renderer:** instanced cubes (MVP). Future: marching-cubes isosurfaces.
- **CPU reference:** the same algorithm in pure TS lives in `packages/solver/src/cpu-jacobi.ts` and is exercised by analytical 1D-bar + 2D-plate-symmetry tests. The GPU port is validated against it.

## Build

```bash
bun install
bun dev                # http://localhost:4321
bun test               # 9 unit + property tests
```

Visit `/sim?fx=cube`, `/sim?fx=sphere`, or `/sim?fx=fins` for built-in fixtures.

Requires a **WebGPU-capable browser** (Chrome / Edge / Arc / Brave on a discrete GPU machine).

## Stack

Astro 5 · React 19 · Three.js · WebGPU + WGSL · Bun workspaces · Vitest/Bun:test · Biome

## Repo layout

```
yantra/
├─ apps/web/                  # Astro site (landing + sim UI)
└─ packages/
   ├─ mesh/                   # STL parse, voxelize, worker wrapper
   └─ solver/                 # CPU reference + WGSL kernels + pipeline builder
```

## Status

MVP. Steady-state heat conduction, single material per run, face-level BCs. See `../docs/superpowers/specs/2026-05-28-yantra-design.md` for the design and `../docs/superpowers/plans/2026-05-28-yantra.md` for the implementation plan.

### Roadmap (post-MVP)

- Transient heat (time-stepped explicit / implicit).
- Marching-cubes isosurface renderer.
- Click-to-paint BCs on the volume (not just faces).
- LLM narrator panel ("the gradient steepens at this fillet — round it to 2 mm").
- Multi-material assignment per voxel region.
- SOR / red-black coloring for ~10× convergence.

## Name

*Yantra* (Sanskrit: यन्त्र) — *instrument, machine, mystical diagram*. Engineering wrapped in geometry.

## License

MIT.
