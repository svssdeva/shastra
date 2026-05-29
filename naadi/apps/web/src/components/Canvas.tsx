import {
  acquireDevice,
  type CompileDiagnostic,
  type DeviceBundle,
  makeBindGroupLayout,
  Recompiler,
  UNIFORMS_BYTES,
  WebGPUUnavailable,
  writeUniforms,
} from '@naadi/gpu';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

interface Props {
  source: string;
  zoom: number;
  onDiagnostics?: (d: CompileDiagnostic[]) => void;
}

type Status =
  | { kind: 'init' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'compiling' }
  | { kind: 'ok' }
  | { kind: 'error'; count: number };

const RECOMPILE_DEBOUNCE_MS = 200;

export default function Canvas({ source, zoom, onDiagnostics }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'init' });

  // Live state held in refs so the rAF loop can read without React re-runs.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let rafId = 0;
    let bundle: DeviceBundle | null = null;
    let ctx: GPUCanvasContext | null = null;
    let pipeline: GPURenderPipeline | null = null;
    let bindGroup: GPUBindGroup | null = null;
    let uniformBuf: GPUBuffer | null = null;
    const scratchBytes: ArrayBuffer = new ArrayBuffer(UNIFORMS_BYTES);
    const startMs = performance.now();
    const mouseNorm: [number, number] = [0.5, 0.5];
    let recompileTimer: number | undefined;

    const onMouse = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouseNorm[0] = (e.clientX - r.left) / r.width;
      mouseNorm[1] = (e.clientY - r.top) / r.height;
    };
    canvas.addEventListener('pointermove', onMouse);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      return [w, h] as [number, number];
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    (async () => {
      try {
        bundle = await acquireDevice();
      } catch (e) {
        if (!cancelled)
          setStatus({
            kind: 'unsupported',
            reason: e instanceof WebGPUUnavailable ? e.message : String(e),
          });
        return;
      }
      if (cancelled) return;

      // Surface mid-session device loss instead of silently freezing the canvas.
      bundle.device.lost.then((info) => {
        if (cancelled) return;
        // info.reason === 'destroyed' is the normal teardown path; don't flag.
        if (info.reason === 'destroyed') return;
        pipeline = null;
        setStatus({ kind: 'unsupported', reason: `device lost: ${info.message}` });
      });

      ctx = canvas.getContext('webgpu');
      if (!ctx) {
        setStatus({ kind: 'unsupported', reason: 'canvas.getContext("webgpu") returned null' });
        return;
      }
      ctx.configure({
        device: bundle.device,
        format: bundle.format,
        alphaMode: 'opaque',
      });

      const bgl = makeBindGroupLayout(bundle.device);
      uniformBuf = bundle.device.createBuffer({
        label: 'naadi-uniforms',
        size: UNIFORMS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      bindGroup = bundle.device.createBindGroup({
        label: 'naadi-bg',
        layout: bgl,
        entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
      });

      const recompiler = new Recompiler(
        { device: bundle.device, format: bundle.format, bindGroupLayout: bgl },
        (result) => {
          if (cancelled) return;
          onDiagnostics?.(result.diagnostics);
          const errs = result.diagnostics.filter((d) => d.type === 'error').length;
          if (result.pipeline) {
            pipeline = result.pipeline;
            setStatus(errs > 0 ? { kind: 'error', count: errs } : { kind: 'ok' });
          } else {
            setStatus({ kind: 'error', count: errs || 1 });
          }
        },
      );
      // Initial compile (no debounce — first paint should be fast).
      setStatus({ kind: 'compiling' });
      recompiler.request(sourceRef.current);

      const onSourceTick = () => {
        recompileTimer = window.setTimeout(() => {
          setStatus({ kind: 'compiling' });
          recompiler.request(sourceRef.current);
        }, RECOMPILE_DEBOUNCE_MS);
      };

      // Watch sourceRef for changes via a small polling loop in rAF.
      let lastSrc = sourceRef.current;

      const frame = () => {
        if (cancelled) return;
        const [w, h] = resize();
        if (sourceRef.current !== lastSrc) {
          lastSrc = sourceRef.current;
          window.clearTimeout(recompileTimer);
          onSourceTick();
        }
        if (pipeline && bundle && ctx && uniformBuf && bindGroup) {
          writeUniforms(scratchBytes, {
            resolutionPx: [w, h],
            timeSec: (performance.now() - startMs) / 1000,
            mouseNorm,
            zoom: zoomRef.current,
          });
          bundle.device.queue.writeBuffer(uniformBuf, 0, scratchBytes);
          const enc = bundle.device.createCommandEncoder();
          const tex = ctx.getCurrentTexture();
          const pass = enc.beginRenderPass({
            colorAttachments: [
              {
                view: tex.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
          });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.draw(3, 1, 0, 0);
          pass.end();
          bundle.device.queue.submit([enc.finish()]);
        }
        rafId = requestAnimationFrame(frame);
      };
      rafId = requestAnimationFrame(frame);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      window.clearTimeout(recompileTimer);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMouse);
      uniformBuf?.destroy();
      bundle?.device.destroy();
    };
  }, []);

  return (
    <div class="relative w-full h-full">
      <canvas
        ref={canvasRef}
        class="block w-full h-full"
        style="background: var(--color-canvas);"
      />
      <StatusPill status={status} />
    </div>
  );
}

function StatusPill({ status }: { status: Status }): JSX.Element {
  let label: string;
  let bg: string;
  let fg: string;
  switch (status.kind) {
    case 'init':
      label = 'init';
      bg = 'var(--color-surface-card)';
      fg = 'var(--color-muted)';
      break;
    case 'unsupported':
      label = 'no webgpu';
      bg = 'var(--color-accent-rose)';
      fg = 'var(--color-on-dark)';
      break;
    case 'compiling':
      label = 'compiling…';
      bg = 'var(--color-surface-card)';
      fg = 'var(--color-on-dark)';
      break;
    case 'ok':
      label = 'ok';
      bg = 'var(--color-accent-emerald)';
      fg = 'var(--color-on-dark)';
      break;
    case 'error':
      label = `${status.count} error${status.count === 1 ? '' : 's'}`;
      bg = 'var(--color-accent-rose)';
      fg = 'var(--color-on-dark)';
      break;
  }
  return (
    <span
      class="absolute top-3 right-3 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
      style={`background:${bg};color:${fg};`}
      title={status.kind === 'unsupported' ? status.reason : undefined}
    >
      {label}
    </span>
  );
}
