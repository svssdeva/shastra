import { useEffect, useRef, useState } from 'preact/hooks';
import { StlDropZone } from './StlDropZone';
import { Viewport } from './Viewport';
import { BcEditor, applyBcs, type BcConfig, type BcApplyReport } from './BcEditor';
import { MaterialPicker } from './MaterialPicker';
import { SolveControls } from './SolveControls';
import { voxelizeInWorker, type VoxelizeResult } from '@yantra/mesh';
import {
  buildPipeline,
  buildSimGrid,
  MATERIALS,
  type Pipeline,
  type SimGrid,
} from '@yantra/solver';
import '../../styles/sim.css';

const DEFAULT_BC: BcConfig = { hotFace: '+z', hotT: 100, coldFace: '-z', coldT: 0 };

export default function YantraApp() {
  const [gpuOk, setGpuOk] = useState<boolean | null>(null);
  const [grid, setGrid] = useState<VoxelizeResult | null>(null);
  const [sim, setSim] = useState<SimGrid | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState(40);
  const [material, setMaterial] = useState('aluminum');
  const [bc, setBc] = useState<BcConfig>(DEFAULT_BC);
  const [running, setRunning] = useState(false);
  const [residual, setResidual] = useState<number | null>(null);
  const [iters, setIters] = useState(0);
  const [tField, setTField] = useState<Float32Array | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [bcReport, setBcReport] = useState<BcApplyReport>({ hotCount: 0, coldCount: 0 });
  const [tRange, setTRange] = useState<{ lo: number; hi: number } | null>(null);
  const [heatFlux, setHeatFlux] = useState<number | null>(null);
  const pipeRef = useRef<Pipeline | null>(null);
  const cancelRef = useRef(false);
  const deviceRef = useRef<GPUDevice | null>(null);
  // Keep a copy of the most recent STL buffer so we can re-voxelize when the
  // resolution slider changes. The worker transfers ownership of the buffer
  // passed to it, so we must stash a copy before calling voxelizeInWorker.
  const stlBufRef = useRef<ArrayBuffer | null>(null);
  // Most recent post-solve raw T field, used to recompute Q̇ when the user
  // switches material (T is independent of k, so no need to re-solve).
  const lastTRef = useRef<Float32Array | null>(null);
  // Pending BC-debounce timer. Cancelled at the start of handleSolve so an
  // in-flight debounce can't wipe a fresh solve result 300 ms after the click.
  const bcDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function getDevice(): Promise<GPUDevice> {
    if (deviceRef.current) return deviceRef.current;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');
    const device = await adapter.requestDevice();
    device.lost.then((info) => {
      // Surface a lost device once and clear refs so the next Solve grabs a fresh one.
      setError(`GPU device lost: ${info.reason} — ${info.message || 'no detail'}`);
      pipeRef.current?.destroy();
      pipeRef.current = null;
      if (deviceRef.current === device) deviceRef.current = null;
    });
    deviceRef.current = device;
    return device;
  }

  useEffect(() => {
    (async () => {
      if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        setGpuOk(false);
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter();
        setGpuOk(!!adapter);
      } catch {
        setGpuOk(false);
      }
    })();
    return () => {
      cancelRef.current = true;
      pipeRef.current?.destroy();
      pipeRef.current = null;
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
  }, []);

  const voxelizeAndBuild = async (buf: ArrayBuffer, res: number) => {
    setBusy(true);
    setError(null);
    setTField(null);
    setIters(0);
    setResidual(null);
    setHeatFlux(null);
    pipeRef.current?.destroy();
    pipeRef.current = null;
    try {
      const result = await voxelizeInWorker(buf, res);
      setGrid(result);
      const mat = MATERIALS.find((m) => m.id === material)!;
      const sg = buildSimGrid(result, { kVal: mat.k });
      setBcReport(applyBcs(sg, bc));
      setSim(sg);
      setTField(normalize(sg.T, sg.mask));
      setTRange(rawRange(sg.T, sg.mask));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleStl = async (buf: ArrayBuffer) => {
    // Cache a copy before the worker takes ownership of `buf`.
    stlBufRef.current = buf.slice(0);
    await voxelizeAndBuild(buf, resolution);
  };

  // Re-voxelize the cached STL when the resolution slider settles. Debounced
  // so dragging the slider doesn't fire one voxelize per pixel.
  useEffect(() => {
    if (!stlBufRef.current) return;
    if (running) return;
    const handle = setTimeout(() => {
      const buf = stlBufRef.current;
      if (!buf) return;
      // Pass a slice so the cached buffer survives the worker transfer.
      voxelizeAndBuild(buf.slice(0), resolution);
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolution]);

  // Re-apply BCs (rebuild sim from current bc + material) whenever the BC
  // config changes. Debounced so typing in the temperature inputs doesn't
  // fire one rebuild per keystroke. Resets any prior solve result because the
  // T field is no longer valid for the new BCs.
  useEffect(() => {
    if (!grid) return;
    if (running) return;
    if (bcDebounceRef.current) clearTimeout(bcDebounceRef.current);
    bcDebounceRef.current = setTimeout(() => {
      bcDebounceRef.current = null;
      const mat = MATERIALS.find((m) => m.id === material)!;
      const sg = buildSimGrid(grid, { kVal: mat.k });
      setBcReport(applyBcs(sg, bc));
      setSim(sg);
      setTField(normalize(sg.T, sg.mask));
      setTRange(rawRange(sg.T, sg.mask));
      setIters(0);
      setResidual(null);
      setHeatFlux(null);
      lastTRef.current = null;
    }, 300);
    return () => {
      if (bcDebounceRef.current) {
        clearTimeout(bcDebounceRef.current);
        bcDebounceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bc]);

  // Material change: T field is independent of k under current physics, so
  // don't reset the solve state. Just sync sim.k (used by the next Solve's
  // pipeline build) and recompute Q̇ from the existing T field.
  useEffect(() => {
    if (!sim) return;
    const mat = MATERIALS.find((m) => m.id === material)!;
    sim.k.fill(mat.k);
    if (lastTRef.current && bc.hotFace) {
      setHeatFlux(computeHotFaceFlux(sim, lastTRef.current, bc.hotT, mat.k));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fx = new URLSearchParams(window.location.search).get('fx');
    if (!fx) return;
    (async () => {
      try {
        const r = await fetch(`/fixtures/${fx}.stl`);
        if (!r.ok) {
          setError(`fixture not found: ${fx}`);
          return;
        }
        const buf = await r.arrayBuffer();
        await handleStl(buf);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSolve = async () => {
    if (!grid) return;
    if (!bc.hotFace && !bc.coldFace) {
      setError('Set at least one face to a fixed temperature.');
      return;
    }
    if (!('gpu' in navigator)) {
      setError('WebGPU is required.');
      return;
    }
    // Cancel any in-flight BC-debounce so it can't wipe our results 300 ms
    // after we display them.
    if (bcDebounceRef.current) {
      clearTimeout(bcDebounceRef.current);
      bcDebounceRef.current = null;
    }
    // Belt-and-suspenders: always rebuild the sim from current BCs + material
    // at Solve time. The [bc] effect is debounced, so if the user clicked
    // Solve before the debounce fired, the React `sim` state may still hold
    // stale BC temperatures. Build a fresh sg and use it locally.
    const mat = MATERIALS.find((m) => m.id === material)!;
    const sg = buildSimGrid(grid, { kVal: mat.k });
    setBcReport(applyBcs(sg, bc));
    setSim(sg);
    setTField(normalize(sg.T, sg.mask));
    setTRange(rawRange(sg.T, sg.mask));

    setRunning(true);
    setError(null);
    cancelRef.current = false;
    try {
      const device = await getDevice();
      // Always rebuild the pipeline per Solve — the SimGrid (mask, BCs, k) may
      // have changed since the last run, and the old pipe holds stale GPU buffers.
      pipeRef.current?.destroy();
      const pipe = await buildPipeline(device, sg);
      pipeRef.current = pipe;
      const batch = 200;
      let total = 0;
      let lastT: Float32Array | null = null;
      for (let step = 0; step < 400; step++) {
        if (cancelRef.current) break;
        pipe.step(batch);
        total += batch;
        const r = await pipe.computeResidual();
        setIters(total);
        setResidual(r);
        const T = await pipe.readBack();
        setTField(normalize(T, sg.mask));
        setTRange(rawRange(T, sg.mask));
        lastT = T;
        await new Promise((res) => setTimeout(res, 0));
        if (r < 1e-4) break;
      }
      if (lastT && bc.hotFace) {
        lastTRef.current = lastT;
        setHeatFlux(computeHotFaceFlux(sg, lastT, bc.hotT, mat.k));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleReset = () => {
    if (!grid) return;
    cancelRef.current = true;
    pipeRef.current?.destroy();
    pipeRef.current = null;
    const mat = MATERIALS.find((m) => m.id === material)!;
    const sg = buildSimGrid(grid, { kVal: mat.k });
    setBcReport(applyBcs(sg, bc));
    setSim(sg);
    setTField(normalize(sg.T, sg.mask));
    setTRange(rawRange(sg.T, sg.mask));
    setIters(0);
    setResidual(null);
    setHeatFlux(null);
  };

  if (gpuOk === false) {
    return (
      <div className="gpu-gate">
        <h1>WebGPU not available</h1>
        <p>
          This simulator needs WebGPU. As of 2026 that means recent Chrome, Edge, Arc,
          or Brave on a discrete-GPU machine. Try opening this URL in{' '}
          <strong>Chrome</strong>.
        </p>
      </div>
    );
  }
  if (gpuOk === null) {
    return (
      <div className="gpu-gate">
        <p className="busy-line">
          <span className="dot" /> Probing WebGPU…
        </p>
      </div>
    );
  }

  return (
    <div className="sim-grid">
      <div className="viewport-wrap">
        {running && (
          <div className="corner-label">
            <span className="badge-yellow">Solving</span>
          </div>
        )}
        <div className="viewport-toolbar">
          <button
            type="button"
            className={`vp-btn${autoRotate ? ' on' : ''}`}
            onClick={() => setAutoRotate((v) => !v)}
            title="Toggle auto-rotation"
          >
            <span className="vp-btn-dot" /> Auto-rotate {autoRotate ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="axes-legend">
          <span><i className="ax x" /> X</span>
          <span><i className="ax y" /> Y</span>
          <span><i className="ax z" /> Z</span>
        </div>
        <div className="viewport-hint">drag · rotate · scroll · zoom · shift-drag · pan</div>
        <Viewport grid={grid} temperatures={tField} autoRotate={autoRotate} />
        {tRange && (
          <div className="t-scale">
            <div className="t-scale-bar" />
            <div className="t-scale-labels">
              <span>{formatT(tRange.lo)}</span>
              <span>{formatT((tRange.lo + tRange.hi) / 2)}</span>
              <span>{formatT(tRange.hi)}</span>
            </div>
          </div>
        )}
      </div>
      <aside>
        <div className="panel">
          <div className="panel-title">
            <span className="caption-uppercase">Geometry</span>
            {busy && (
              <span className="busy-line">
                <span className="dot" /> Voxelizing
              </span>
            )}
          </div>
          <StlDropZone onStl={handleStl} />
          <div className="field" style={{ marginTop: 'var(--space-md)' }}>
            <label>Resolution · {resolution}</label>
            <input
              type="range"
              min={16}
              max={96}
              step={8}
              value={resolution}
              onChange={(e) =>
                setResolution(Number((e.target as HTMLInputElement).value))
              }
            />
          </div>
          {grid && (
            <div className="dims-readout">
              <span>dims</span>
              <span>{grid.dims.join(' × ')}</span>
              <span>voxel</span>
              <span>{grid.h.toFixed(4)} m</span>
              <span>tris</span>
              <span>{grid.triCount.toLocaleString()}</span>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">
            <span className="caption-uppercase">Material</span>
          </div>
          <MaterialPicker value={material} onChange={setMaterial} />
        </div>

        <div className="panel">
          <div className="panel-title">
            <span className="caption-uppercase">Boundary conditions</span>
          </div>
          <BcEditor config={bc} onChange={setBc} report={bcReport} />
        </div>

        <div className="panel">
          <div className="panel-title">
            <span className="caption-uppercase">Solver</span>
          </div>
          <SolveControls
            running={running}
            residual={residual}
            iters={iters}
            heatFlux={heatFlux}
            onSolve={handleSolve}
            onReset={handleReset}
          />
        </div>

        {error && <div className="error-card">Error · {error}</div>}
      </aside>
    </div>
  );
}

function normalize(T: Float32Array, mask: Uint8Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < T.length; i++)
    if (mask[i] !== 0) {
      if (T[i]! < lo) lo = T[i]!;
      if (T[i]! > hi) hi = T[i]!;
    }
  const out = new Float32Array(T.length);
  const span = Math.max(hi - lo, 1e-9);
  for (let i = 0; i < T.length; i++) out[i] = (T[i]! - lo) / span;
  return out;
}

function rawRange(T: Float32Array, mask: Uint8Array): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < T.length; i++)
    if (mask[i] !== 0) {
      if (T[i]! < lo) lo = T[i]!;
      if (T[i]! > hi) hi = T[i]!;
    }
  if (!isFinite(lo)) return { lo: 0, hi: 0 };
  return { lo, hi };
}

function formatT(t: number): string {
  const abs = Math.abs(t);
  if (abs >= 1000) return `${(t / 1000).toFixed(1)}k °C`;
  if (abs >= 100) return `${t.toFixed(0)} °C`;
  if (abs >= 10) return `${t.toFixed(1)} °C`;
  return `${t.toFixed(2)} °C`;
}

// Conductive heat flux out of the hot Dirichlet voxels into the rest of the
// part. For each face between a hot voxel and a non-hot interior voxel,
//   q_face = k · (T_hot − T_neighbour) · h   [W]
// (Face area h², gradient (T_hot − T_neighbour)/h, conductivity k.)
//
// At steady state with no source, every joule entering the hot surface leaves
// through the cold surface, so this is the part's heat-flow rating at the
// configured ΔT — and unlike the temperature field it DOES scale with k.
function computeHotFaceFlux(
  sg: SimGrid,
  T: Float32Array,
  hotT: number,
  k: number,
): number {
  const [Nx, Ny, Nz] = sg.dims;
  const h = sg.h;
  const stride = { i: 1, j: Nx, k: Nx * Ny };
  const EPS = 1e-4;
  const isHot = (v: number) => sg.mask[v] === 2 && Math.abs(T[v]! - hotT) < EPS;

  let flux = 0;
  for (let kk = 0; kk < Nz; kk++) {
    for (let j = 0; j < Ny; j++) {
      for (let i = 0; i < Nx; i++) {
        const v = i + Nx * (j + Ny * kk);
        if (!isHot(v)) continue;
        const ns = [
          i > 0 ? v - stride.i : -1,
          i < Nx - 1 ? v + stride.i : -1,
          j > 0 ? v - stride.j : -1,
          j < Ny - 1 ? v + stride.j : -1,
          kk > 0 ? v - stride.k : -1,
          kk < Nz - 1 ? v + stride.k : -1,
        ];
        for (const n of ns) {
          if (n < 0) continue;
          if (sg.mask[n] === 0) continue;
          if (isHot(n)) continue;
          flux += k * (hotT - T[n]!) * h;
        }
      }
    }
  }
  return flux;
}
