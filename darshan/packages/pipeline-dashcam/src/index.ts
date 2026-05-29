import type {
  InferenceBackend,
  LoadedModel,
  ModelSpec,
  Pipeline,
  PipelineProgress,
} from '@darshan/inference-core';
import { type Detection, decodeYolov10, unletterbox } from './detect.ts';
import { sampleFrames, YOLO_INPUT_SIZE } from './frames.ts';
import { detectIncidents, type Incident, summarizeFrame } from './incidents.ts';
import { DETECTOR_YOLOV10N } from './models.ts';

export * from './detect.ts';
export { YOLO_INPUT_SIZE } from './frames.ts';
export * from './incidents.ts';
export * from './models.ts';

export interface DashcamInput {
  file: File;
}

export interface DashcamOutput {
  durationSec: number;
  sampledFrames: number;
  incidents: Incident[];
  videoUrl: string;
}

export interface DashcamPipelineOptions {
  detector?: ModelSpec;
  fps?: number;
}

interface YoloOutput {
  outputs: Record<string, { data: Float32Array; dims: readonly number[] }>;
}

export const PIPELINE_DASHCAM_VERSION = '0.2.0';

export class DashcamPipeline implements Pipeline<DashcamInput, DashcamOutput> {
  readonly id = 'dashcam' as const;
  readonly label = 'Dashcam clip extractor';
  readonly inputKind = 'video' as const;

  private readonly detectorSpec: ModelSpec;
  private readonly fps: number;
  private detector?: LoadedModel<unknown, YoloOutput>;

  constructor(opts: DashcamPipelineOptions = {}) {
    this.detectorSpec = opts.detector ?? DETECTOR_YOLOV10N;
    this.fps = opts.fps ?? 5;
  }

  async load(backend: InferenceBackend, onProgress?: (p: PipelineProgress) => void): Promise<void> {
    const total = this.detectorSpec.files[0]?.bytes ?? 1;
    onProgress?.({ phase: 'loading', loaded: 0, total, message: 'loading detector' });
    this.detector = await backend.load<unknown, YoloOutput>(this.detectorSpec, {
      onProgress: (p) =>
        onProgress?.({
          phase: 'loading',
          loaded: p.loaded,
          total: p.total,
          message: `detector: ${p.message ?? p.phase}`,
        }),
    });
    onProgress?.({ phase: 'idle' });
  }

  async *process(
    input: DashcamInput,
    onProgress?: (p: PipelineProgress) => void,
  ): AsyncIterable<DashcamOutput> {
    if (!this.detector) throw new Error('DashcamPipeline: call load() before process()');
    const videoUrl = URL.createObjectURL(input.file);
    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('video failed to load')), {
        once: true,
      });
    });
    const duration = video.duration || 0;
    const totalFrames = Math.max(1, Math.floor(duration * this.fps));
    const summaries: ReturnType<typeof summarizeFrame>[] = [];
    let frameIdx = 0;
    onProgress?.({
      phase: 'running',
      loaded: 0,
      total: totalFrames,
      message: 'analyzing video',
    });
    for await (const frame of sampleFrames(video, this.fps)) {
      const result = await this.detector.run({
        feeds: {
          images: { data: frame.tensor, dims: [1, 3, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE] },
        },
      });
      const outName = Object.keys(result.outputs)[0];
      const out = outName ? result.outputs[outName] : undefined;
      const detections: Detection[] = [];
      if (out) {
        const numDetections = out.dims[1] ?? 300;
        const decoded = decodeYolov10(out.data, numDetections);
        for (const d of decoded) {
          detections.push(unletterbox(d, YOLO_INPUT_SIZE, frame.sourceWidth, frame.sourceHeight));
        }
      }
      summaries.push(
        summarizeFrame(detections, frame.sourceWidth, frame.sourceHeight, frame.timestamp),
      );
      frameIdx += 1;
      onProgress?.({
        phase: 'running',
        loaded: frameIdx,
        total: totalFrames,
        message: `frame ${frameIdx}/${totalFrames}`,
      });
    }
    const incidents = detectIncidents(summaries);
    onProgress?.({ phase: 'done', message: `${incidents.length} incident(s)` });
    yield {
      durationSec: duration,
      sampledFrames: summaries.length,
      incidents,
      videoUrl,
    };
  }

  async dispose(): Promise<void> {
    await this.detector?.dispose();
    this.detector = undefined;
  }
}
