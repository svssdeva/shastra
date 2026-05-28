# Yantra

> A finite-element heat-conduction solver that runs in a browser tab. Drop an STL,
> set the hot face, set the cold face, watch heat spread through the part on your
> GPU. No install, no cloud, no account.

```
 ┌─────────┐    ┌──────────────┐    ┌───────────────┐    ┌───────────────┐
 │  .stl   │───▶│  voxelize    │───▶│  WebGPU       │───▶│  Three.js     │
 │ (drag)  │    │  (worker)    │    │  Jacobi (WGSL)│    │  voxel viewer │
 └─────────┘    └──────────────┘    └───────────────┘    └───────────────┘
```

Most engineering simulation lives behind ten-thousand-dollar licenses and three-day
install guides. Yantra runs the same numerical method — Jacobi iteration of the
steady-state heat PDE on a voxel grid with harmonic-mean diffusion at material
faces — entirely on the GPU your browser already has. A URL is the install.

---

## Table of contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Quickstart](#quickstart)
- [Browser & GPU support](#browser--gpu-support)
- [Performance & limits](#performance--limits)
- [Architecture](#architecture)
- [Numerics](#numerics)
- [Repo layout](#repo-layout)
- [Development](#development)
- [Roadmap](#roadmap)
- [Name](#name)
- [License](#license)

---

## What it does

- **Drop any STL** (binary or ASCII). The mesh is parsed and voxelized into a
  regular grid in a Web Worker, so the UI stays responsive even on a 100k-tri model.
- **Pick a material** (Copper, Aluminum, Steel, PLA, FR4) → sets the thermal
  conductivity `k`.
- **Set boundary conditions** — pick which face is hot, which is cold, and at
  what temperature in °C.
- **Solve** the steady-state heat equation `∇·(k∇T) + Q = 0` on the GPU. Watch
  the colormap evolve as the residual converges to 1e-4.
- **Detect WebGPU up front** — if your browser can't run the simulator, you get
  a clear message instead of a half-broken state.

## How it works

```
STL → triangle soup → ray-crossing voxelizer (Web Worker)
                                  │
                                  ▼
                           voxel mask  (0 = outside, 1 = interior, 2 = Dirichlet)
                                  │
            ┌─────────────────────┴────────────────────────┐
            ▼                                              ▼
     Three.js InstancedMesh                      WebGPU storage buffers
      (one cube per interior voxel,              (T, k, Q, mask, params)
       color = normalised temperature)                    │
            ▲                                             ▼
            │                                   jacobi.wgsl   (ping-pong T_in/T_out)
            │                                   residual.wgsl (atomicMax → ‖ΔT‖∞ / ‖T‖∞)
            └──── readBack each batch ◀───────────────────┘
```

The solver runs 200 Jacobi iterations per submit, then reads the temperature
field back, repaints the voxels, and computes the residual. It stops when the
relative residual `max|T_new − T| / max(|T|, 1)` drops below `1e-4` or after
80,000 iterations.

## Quickstart

```bash
bun install
bun dev                 # http://localhost:4321
bun test                # ~10 unit + property tests across mesh + solver
bun build               # static site → apps/web/dist/
```

Try a built-in fixture without dropping an STL:

- `/sim?fx=cube` — opposite-face BCs, settles to a linear gradient.
- `/sim?fx=sphere` — radial conduction problem.
- `/sim?fx=fins` — finned heatsink, the geometry the solver was built for.

## Browser & GPU support

Yantra is **WebGPU only**. There's no WebGL2 fallback because WebGL2 has no
compute shaders, and the Jacobi kernel is the whole simulator. If your browser
can't run WebGPU, the simulator gate will tell you up front rather than failing
later.

### Browsers

| Browser              | Status (as of 2026)                      | Notes |
|----------------------|------------------------------------------|-------|
| Chrome / Edge / Arc / Brave | **Supported (113+)** on Windows · macOS · Linux · ChromeOS · Android (148+) | The reference target. Tested daily. |
| Opera                | Supported (99+)                          | Chromium-based, same engine as Chrome. |
| Safari (macOS)       | **Partial** — Safari 26 enables it       | Some shader patterns differ vs Chromium; works for our kernels. |
| Safari (iOS)         | **Partial** — Safari 26+                 | Mobile GPU limits apply, see below. |
| Firefox              | **Not enabled by default**               | Available in Nightly behind `dom.webgpu.enabled`. Stable target slipping. |
| Samsung Internet     | 24+                                      | Android only. |

If you don't have a supported browser, the simplest fix is **Chrome on the
machine that runs your discrete GPU**. Everything else is gravy.

### GPUs

WebGPU translates to **D3D12 on Windows**, **Metal on macOS / iOS**, and
**Vulkan on Linux / Android / ChromeOS**. The simulator is friendly to all
three. What matters is the GPU underneath:

| GPU class                        | Verdict      | Why |
|----------------------------------|--------------|-----|
| Discrete (NVIDIA RTX, AMD Radeon RX, Intel Arc) | **Recommended** | Plenty of VRAM + compute. 96³ grids feel instant. |
| Apple Silicon (M1/M2/M3/M4)      | **Excellent** | Unified memory and a mature Metal backend make this the smoothest macOS experience. |
| Intel Iris Xe / UHD              | **Works**    | Real-time below 64³ resolution; pause-and-think above that. |
| AMD Radeon integrated (780M etc) | **Works**    | Similar to Intel Iris; surprisingly capable. |
| Older Intel HD (pre-Iris)        | **Avoid**    | Compute shaders supported, but slow + thermal-throttled. |
| Mobile (Mali, Adreno, Apple A-series) | **Caveat** | Workgroup-size limits + sometimes-flaky compute paths. Use resolution ≤ 48. |
| VMs / remote desktops            | **No**       | WebGPU usually disabled — no Vulkan/D3D12 pass-through. |

### Driver notes (read this if you hit a crash)

If the page hangs, the colormap freezes mid-solve, or Chrome reports a
"device lost" error, the GPU driver hit a fault. These are not Yantra bugs;
they're driver bugs in the WebGPU translation layer that we can sometimes
work around.

- **NVIDIA Blackwell (RTX 50-series) on Linux** — early-2026 driver branches
  (575–580) sporadically GSP-fault under sustained compute load. Yantra
  pre-allocates every WebGPU resource once per Solve, which mostly avoids
  this, but if you see a "GSP error" in `dmesg`, update to the latest
  NVIDIA-OPEN or proprietary driver.
- **NVIDIA on Windows (TDR)** — if a single Solve takes longer than 2 s
  Windows resets the GPU. Lower resolution to 32 or 48 if you hit this.
- **macOS Metal** — extremely stable. If it doesn't work, your Safari version
  is too old.
- **Linux Mesa (Intel / AMD)** — works from Mesa 24+. Older Mesa needs
  `--enable-features=Vulkan` on Chrome launch.

## Performance & limits

- **Voxel grid is uniform** — resolution is the longest side count (16 … 96).
  At 96 the grid holds up to **884,736 voxels** (96³), ~3.5 MB per scalar
  field. The solver allocates 6 such buffers (T_a, T_b, k, Q, mask, readback)
  ≈ 21 MB on the GPU, plus pipelines / bind groups ≈ negligible.
- **Iteration cap** is `400 batches × 200 iters = 80,000` Jacobi sweeps per
  Solve. On an RTX 5080 the fins fixture converges in ~3 s; on Iris Xe expect
  10–30 s; on an M2 around 4 s.
- **The Three.js viewer is the bottleneck above 80³** — it draws one cube per
  interior voxel via `InstancedMesh`. At 884 k voxels the viewer rebuild is
  ~200 ms; this is on the post-MVP list (marching-cubes isosurface).
- **No SOR yet** — convergence is plain Jacobi. Adding red-black SOR is the
  highest-impact single change for solver speed (the roadmap has it).

## Architecture

Yantra is a small Bun workspace. Three packages, one app:

- **`apps/web`** — Astro 5 site with two pages. `/` is the landing; `/sim`
  mounts a single Preact island (`YantraApp`) via `client:only="preact"`.
- **`packages/mesh`** — STL parser, voxelizer, and Web Worker wrapper that
  voxelizes the dropped file off the main thread.
- **`packages/solver`** — CPU reference Jacobi (pure TS, used by tests), WGSL
  kernels, and the WebGPU pipeline builder.

The split is deliberate: the solver and the mesh tools never depend on the
DOM, so they're testable in `bun test` and reusable if anyone wants to wrap
them in a different UI.

## Numerics

- **Discretization** — classic 7-point stencil. Each cell averages its six
  neighbours weighted by face-conductivities.
- **Face conductivity** — harmonic mean `k_face = 2·k₁·k₂ / (k₁ + k₂)`. This
  is what makes multi-material interfaces tractable; arithmetic mean would
  smear gradients across interfaces.
- **Boundary conditions** — face Dirichlet only in the MVP. Out-of-mesh voxels
  are treated as insulated (Neumann zero). Click-to-paint per-voxel BCs is on
  the roadmap.
- **Source term** — `Q` is bound but currently zero everywhere; the
  infrastructure for volumetric heat generation is in place.
- **Convergence test** — `max|T_new − T| / max(|T|, 1) < 1e-4`. The CPU
  reference uses the same threshold, and the test suite verifies the GPU port
  agrees with the CPU on 1D-bar and 2D-plate-symmetry problems.

## Repo layout

```
yantra/
├── apps/web/                         # Astro site
│   └── src/
│       ├── pages/
│       │   ├── index.astro           # Landing
│       │   └── sim.astro             # /sim — mounts YantraApp
│       ├── components/yantra/        # Sim UI (Preact)
│       └── styles/                   # tokens.css + sim.css
└── packages/
    ├── mesh/                         # STL parse · voxelize · worker
    └── solver/                       # CPU ref · WGSL kernels · pipeline
```

## Development

```bash
bun install
bun dev                   # http://localhost:4321
bun --filter @yantra/web build
bun test                  # mesh + solver unit tests
bun lint                  # Biome lint
bun format                # Biome format
```

The dev server hot-reloads everything except WGSL — restart `bun dev` after
editing a shader. Voxel fixtures are generated by
`bun --filter @yantra/mesh run scripts/gen-{cube,sphere,fins}.ts` and live in
`apps/web/public/fixtures/`.

## Roadmap

- **Transient heat** — time-stepped explicit and implicit schemes.
- **Marching-cubes isosurfaces** — replace the voxel cube viewer with a smooth
  surface so high-resolution grids stay readable.
- **Per-voxel BC painting** — click to paint hot / cold regions on the model,
  not just on the bounding faces.
- **Multi-material assignment** — region-of-interest brush + a per-voxel `k`
  map (the GPU buffer already supports it).
- **Red-black SOR** — ~10× convergence over plain Jacobi.
- **LLM narrator** — a small "ask the simulation a question" panel that
  surfaces gradients and hotspots in plain English.
- **Adaptive resolution** — refine only near material interfaces and hot
  spots; trim cost on the bulk interior.

## Name

*Yantra* (Sanskrit: यन्त्र) — *instrument, machine, mystical diagram*. The
word covers astronomical instruments, mechanical contraptions, and the
geometric diagrams used in ritual practice. It feels apt for software that
turns a triangle soup into a grid of differential-equation cells and asks the
GPU to settle the diagram.

## License

MIT — see [LICENSE](./LICENSE).
