import { useEffect, useRef, useState } from 'react';
import { StlDropZone } from './StlDropZone';
import { Viewport } from './Viewport';
import { BcEditor, applyBcs, type BcConfig } from './BcEditor';
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
  const pipeRef = useRef<Pipeline | null>(null);
  const cancelRef = useRef(false);

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
  }, []);

  const handleStl = async (buf: ArrayBuffer) => {
    setBusy(true);
    setError(null);
    setTField(null);
    setIters(0);
    setResidual(null);
    pipeRef.current?.destroy();
    pipeRef.current = null;
    try {
      const result = await voxelizeInWorker(buf, resolution);
      setGrid(result);
      const mat = MATERIALS.find((m) => m.id === material)!;
      const sg = buildSimGrid(result, { kVal: mat.k });
      applyBcs(sg, bc);
      setSim(sg);
      setTField(normalize(sg.T, sg.mask));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
    if (!sim) return;
    if (!bc.hotFace && !bc.coldFace) {
      setError('Set at least one face to a fixed temperature.');
      return;
    }
    if (!('gpu' in navigator)) {
      setError('WebGPU is required.');
      return;
    }
    setRunning(true);
    setError(null);
    cancelRef.current = false;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('No GPU adapter');
      const device = await adapter.requestDevice();
      const pipe = await buildPipeline(device, sim);
      pipeRef.current = pipe;
      const batch = 200;
      let total = 0;
      for (let step = 0; step < 400; step++) {
        if (cancelRef.current) break;
        pipe.step(batch);
        total += batch;
        const r = await pipe.computeResidual();
        setIters(total);
        setResidual(r);
        const T = await pipe.readBack();
        setTField(normalize(T, sim.mask));
        await new Promise((res) => setTimeout(res, 0));
        if (r < 1e-4) break;
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
    applyBcs(sg, bc);
    setSim(sg);
    setTField(normalize(sg.T, sg.mask));
    setIters(0);
    setResidual(null);
  };

  if (gpuOk === false) {
    return (
      <div style={{ padding: '4rem 2rem', maxWidth: 640, margin: '0 auto' }}>
        <h1>WebGPU not available</h1>
        <p>
          This simulator needs WebGPU. As of 2026 that means recent Chrome, Edge, Arc, or
          Brave on a discrete-GPU machine. Try opening this URL in <strong>Chrome</strong>.
        </p>
      </div>
    );
  }
  if (gpuOk === null) return <div style={{ padding: '2rem' }}>Checking WebGPU…</div>;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: '1rem',
        padding: '1rem',
        height: '100vh',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ minHeight: 0 }}>
        <Viewport grid={grid} temperatures={tField} />
      </div>
      <aside style={{ overflowY: 'auto' }}>
        <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.6rem' }}>Yantra</h1>
        <p style={{ color: '#9aa', marginTop: 0, fontSize: '0.85em' }}>
          WebGPU heat sim, in your tab.
        </p>
        <StlDropZone onStl={handleStl} />
        <label>
          Resolution: {resolution}
          <input
            type="range"
            min={16}
            max={96}
            step={8}
            value={resolution}
            onChange={(e) => setResolution(Number(e.target.value))}
          />
        </label>
        <MaterialPicker value={material} onChange={setMaterial} />
        <BcEditor config={bc} onChange={setBc} />
        <SolveControls
          running={running}
          residual={residual}
          iters={iters}
          onSolve={handleSolve}
          onReset={handleReset}
        />
        {busy && <p>Voxelizing…</p>}
        {error && <p style={{ color: '#ff7' }}>Error: {error}</p>}
        {grid && (
          <div style={{ fontSize: '0.8em', color: '#9aa', marginTop: '1rem' }}>
            <div>Dims: {grid.dims.join('×')}</div>
            <div>Voxel: {grid.h.toFixed(4)} m</div>
            <div>Triangles: {grid.triCount}</div>
          </div>
        )}
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
