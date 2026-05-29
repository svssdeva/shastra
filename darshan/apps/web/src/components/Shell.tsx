import {
  type BackendId,
  detectCapabilities,
  type EchoOutput,
  OnnxRuntimeWebBackend,
  PipelineClient,
  type PipelineId,
  type PipelineProgress,
} from '@darshan/inference-core';
import { type DashcamOutput, DashcamPipeline } from '@darshan/pipeline-dashcam';
import type { OcrOutput } from '@darshan/pipeline-ocr';
import {
  DropZone,
  OcrCanvas,
  Picker,
  ProgressMeter,
  ResultPanel,
  TimelineScrubber,
} from '@darshan/ui-kit';
import { useEffect, useMemo, useState } from 'preact/hooks';
import InferenceWorker from '../workers/inference?worker';

type Result =
  | { kind: 'idle' }
  | { kind: 'loaded' }
  | { kind: 'running'; filename: string }
  | { kind: 'echo'; output: EchoOutput }
  | { kind: 'ocr'; file: File; output: OcrOutput }
  | { kind: 'dashcam'; output: DashcamOutput }
  | { kind: 'error'; message: string };

// Which backends each pipeline can actually use end-to-end. Anything outside this map gets
// disabled in the Backend picker once a pipeline is selected.
const ALLOWED_BACKENDS: Record<PipelineId, readonly BackendId[]> = {
  echo: ['mock', 'wasm-candle'],
  ocr: ['transformers-js'],
  dashcam: ['onnxruntime-web'],
};

const BACKEND_OPTIONS = [
  { value: 'mock' as const, label: 'Mock', hint: 'Deterministic — proves the seam' },
  {
    value: 'transformers-js' as const,
    label: 'transformers.js',
    hint: 'WebGPU / WASM via @huggingface/transformers',
  },
  {
    value: 'onnxruntime-web' as const,
    label: 'ORT Web',
    hint: 'WebGPU EP via onnxruntime-web (dashcam)',
  },
  {
    value: 'wasm-candle' as const,
    label: 'Candle (WASM)',
    hint: 'Rust → wasm32 · seam proof for the candle drop-in (today: echoes input)',
  },
];

const PIPELINE_OPTIONS = [
  { value: 'echo' as const, label: 'Echo', hint: 'Seam test — runs on Mock or Candle' },
  {
    value: 'ocr' as const,
    label: 'OCR',
    hint: 'Devanagari → English — uses transformers.js',
  },
  {
    value: 'dashcam' as const,
    label: 'Dashcam',
    hint: 'Incident extractor — uses ORT Web',
  },
];

function defaultBackendFor(pipeline: PipelineId): BackendId {
  return ALLOWED_BACKENDS[pipeline][0] ?? 'mock';
}

function isBackendAllowed(pipeline: PipelineId, backend: BackendId): boolean {
  return ALLOWED_BACKENDS[pipeline].includes(backend);
}

function isMainThreadPipeline(p: PipelineId): boolean {
  // Dashcam decodes <video> on main thread because workers have no DOM.
  return p === 'dashcam';
}

export function Shell() {
  const [pipeline, setPipeline] = useState<PipelineId>('echo');
  const [backend, setBackend] = useState<BackendId>('mock');
  const [progress, setProgress] = useState<PipelineProgress>({ phase: 'idle' });
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const [capabilities, setCapabilities] = useState<{
    webgpu: boolean;
    webgl: boolean;
    wasm: boolean;
  } | null>(null);

  const worker = useMemo(() => new InferenceWorker(), []);
  const client = useMemo(() => new PipelineClient({ worker }), [worker]);

  // Main-thread dashcam holds these refs; recreated when pipeline switches.
  const [mainPipeline, setMainPipeline] = useState<DashcamPipeline | null>(null);
  const [mainBackend, setMainBackend] = useState<OnnxRuntimeWebBackend | null>(null);

  useEffect(() => {
    detectCapabilities().then(setCapabilities);
    return () => {
      client.dispose().catch(() => {});
      mainPipeline?.dispose().catch(() => {});
      mainBackend?.dispose().catch(() => {});
    };
  }, [client, mainPipeline, mainBackend]);

  useEffect(() => {
    setBackend((prev) => (isBackendAllowed(pipeline, prev) ? prev : defaultBackendFor(pipeline)));
  }, [pipeline]);

  const backendOptionsForPipeline = BACKEND_OPTIONS.map((opt) => ({
    ...opt,
    disabled: !isBackendAllowed(pipeline, opt.value),
  }));

  // (Re)load on backend/pipeline change. Refs to mainPipeline/mainBackend are intentionally not
  // in the dependency array: load() reads + tears them down at start.
  useEffect(() => {
    let cancelled = false;
    setProgress({
      phase: 'loading',
      loaded: 0,
      total: 1,
      message: `loading ${pipeline} on ${backend}`,
    });
    setResult({ kind: 'idle' });

    async function load() {
      // Tear down any previous main-thread pipeline.
      await mainPipeline?.dispose().catch(() => {});
      await mainBackend?.dispose().catch(() => {});
      setMainPipeline(null);
      setMainBackend(null);

      if (isMainThreadPipeline(pipeline)) {
        const be = new OnnxRuntimeWebBackend();
        const pl = new DashcamPipeline();
        await pl.load(be, (p) => {
          if (!cancelled) setProgress(p);
        });
        if (cancelled) return;
        setMainBackend(be);
        setMainPipeline(pl);
      } else {
        await client.load(backend, pipeline, (p) => {
          if (!cancelled) setProgress(p);
        });
      }
      if (!cancelled) {
        setProgress({ phase: 'idle' });
        setResult({ kind: 'loaded' });
      }
    }

    load().catch((err: Error) => {
      if (!cancelled) {
        setProgress({ phase: 'error', message: err.message });
        setResult({ kind: 'error', message: err.message });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [backend, pipeline, client]);

  const onFile = (file: File) => {
    setResult({ kind: 'running', filename: file.name });
    setProgress({ phase: 'running', loaded: 0, total: 1, message: 'sending to worker' });

    if (pipeline === 'dashcam') {
      runDashcam(file).catch((err: Error) => {
        setProgress({ phase: 'error', message: err.message });
        setResult({ kind: 'error', message: err.message });
      });
      return;
    }

    client
      .process<EchoOutput | OcrOutput>(
        { fileBlob: file, fileName: file.name, fileType: file.type },
        (p) => setProgress(p),
      )
      .then((output) => {
        if (pipeline === 'ocr') {
          setResult({ kind: 'ocr', file, output: output as OcrOutput });
        } else {
          setResult({ kind: 'echo', output: output as EchoOutput });
        }
        setProgress({ phase: 'done', message: 'complete' });
      })
      .catch((err: Error) => {
        setProgress({ phase: 'error', message: err.message });
        setResult({ kind: 'error', message: err.message });
      });
  };

  async function runDashcam(file: File): Promise<void> {
    if (!mainPipeline) throw new Error('dashcam pipeline not loaded');
    let last: DashcamOutput | undefined;
    for await (const out of mainPipeline.process({ file }, (p) => setProgress(p))) {
      last = out;
    }
    if (!last) throw new Error('dashcam produced no output');
    setProgress({ phase: 'done', message: `${last.incidents.length} incident(s)` });
    setResult({ kind: 'dashcam', output: last });
  }

  const busy = progress.phase === 'loading' || result.kind === 'running';
  const accept = pipeline === 'ocr' ? 'image/*' : pipeline === 'dashcam' ? 'video/*' : '*/*';
  const inputKind = pipeline === 'ocr' ? 'image' : pipeline === 'dashcam' ? 'video' : 'any';

  return (
    <div class="shell">
      <div class="shell__left">
        <Picker
          label="Pipeline"
          value={pipeline}
          options={PIPELINE_OPTIONS}
          onChange={setPipeline}
        />
        <Picker
          label="Backend"
          value={backend}
          options={backendOptionsForPipeline}
          onChange={setBackend}
        />
        <DropZone accept={accept} inputKind={inputKind} onFile={onFile} disabled={busy} />
        <ProgressMeter progress={progress} />
        {capabilities && (
          <div class="shell__capabilities">
            <span class={`shell__cap ${capabilities.webgpu ? 'is-ok' : 'is-no'}`}>
              webgpu {capabilities.webgpu ? '✓' : '✗'}
            </span>
            <span class={`shell__cap ${capabilities.webgl ? 'is-ok' : 'is-no'}`}>
              webgl {capabilities.webgl ? '✓' : '✗'}
            </span>
            <span class={`shell__cap ${capabilities.wasm ? 'is-ok' : 'is-no'}`}>
              wasm {capabilities.wasm ? '✓' : '✗'}
            </span>
          </div>
        )}
      </div>
      <div class="shell__right">
        <ResultPanel title="Result" empty={result.kind === 'idle' || result.kind === 'loaded'}>
          {result.kind === 'echo' && <EchoResultView output={result.output} />}
          {result.kind === 'ocr' && (
            <OcrCanvas
              file={result.file}
              imageWidth={result.output.imageWidth}
              imageHeight={result.output.imageHeight}
              regions={result.output.regions}
            />
          )}
          {result.kind === 'dashcam' && (
            <TimelineScrubber
              src={result.output.videoUrl}
              duration={result.output.durationSec}
              incidents={result.output.incidents}
            />
          )}
          {result.kind === 'error' && (
            <p style={{ color: 'var(--color-rose)' }}>Error: {result.message}</p>
          )}
          {result.kind === 'running' && (
            <p>
              Processing <strong>{result.filename}</strong>…
            </p>
          )}
        </ResultPanel>
      </div>
    </div>
  );
}

function EchoResultView({ output }: { output: EchoOutput }) {
  return (
    <dl class="echo-result">
      <dt>filename</dt>
      <dd>{output.filename}</dd>
      <dt>mime</dt>
      <dd>{output.mime}</dd>
      <dt>bytes</dt>
      <dd>{output.bytes.toLocaleString()}</dd>
      <dt>sha256</dt>
      <dd>{output.digestPrefix}…</dd>
      <dt>note</dt>
      <dd style={{ color: 'var(--color-muted)' }}>{output.message}</dd>
    </dl>
  );
}
