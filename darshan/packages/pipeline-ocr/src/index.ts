import type {
  InferenceBackend,
  LoadedModel,
  ModelSpec,
  Pipeline,
  PipelineProgress,
} from '@darshan/inference-core';
import type { Worker as TesseractWorker } from 'tesseract.js';
import { TRANSLATOR_OPUS_HI_EN } from './models.ts';
import type { BBox } from './regions.ts';
import { cropToCanvas, proposeRegions } from './regions.ts';

export * from './models.ts';
export type { BBox } from './regions.ts';

export interface OcrInput {
  file: File;
}

export interface OcrRegion {
  bbox: BBox;
  recognized: string;
  translated: string;
}

export interface OcrOutput {
  imageWidth: number;
  imageHeight: number;
  regions: OcrRegion[];
  recognizer: string;
  translator: string;
}

export interface OcrPipelineOptions {
  /** Tesseract language code(s). `hin` is Hindi/Devanagari; `hin+eng` adds Latin fallback. */
  recognizerLanguage?: string;
  /** Override the translator model. Defaults to Opus-MT Hi→En (~80 MB q8). */
  translator?: ModelSpec;
}

interface TranslatorOutput {
  translation_text: string;
}

export const PIPELINE_OCR_VERSION = '0.3.0';

/**
 * Devanagari OCR + Hindi→English translation pipeline.
 *
 * **Recognizer**: Tesseract.js with Hindi traineddata. Tesseract is actually trained on
 * Devanagari script — unlike TrOCR-small-printed which is English-only and was producing
 * receipt-shaped hallucinations on Hindi input.
 *
 * **Translator**: `@huggingface/transformers` v4 Opus-MT-hi-en (~80 MB q8). Still routed through
 * the standard `InferenceBackend` interface so the seam claim holds.
 *
 * Tesseract is the right tool for printed/cursive Devanagari at the cost of being a separate
 * runtime from the rest of the pluggable backends. The `Pipeline` abstraction tolerates this
 * because pipelines own their recognizer choice.
 */
export class OcrPipeline implements Pipeline<OcrInput, OcrOutput> {
  readonly id = 'ocr' as const;
  readonly label = 'Devanagari OCR + translate';
  readonly inputKind = 'image' as const;

  private readonly language: string;
  private readonly translatorSpec: ModelSpec;
  private tesseract?: TesseractWorker;
  private translator?: LoadedModel<unknown, TranslatorOutput>;

  constructor(opts: OcrPipelineOptions = {}) {
    this.language = opts.recognizerLanguage ?? 'hin';
    this.translatorSpec = opts.translator ?? TRANSLATOR_OPUS_HI_EN;
  }

  async load(backend: InferenceBackend, onProgress?: (p: PipelineProgress) => void): Promise<void> {
    onProgress?.({
      phase: 'loading',
      loaded: 0,
      total: 1,
      message: `loading Tesseract (${this.language})`,
    });
    const tesseract = await loadTesseract();
    this.tesseract = await tesseract.createWorker(this.language, 1, {
      logger: (m: { status?: string; progress?: number }) => {
        if (typeof m.progress === 'number' && m.status) {
          onProgress?.({
            phase: 'loading',
            loaded: Math.round(m.progress * 0.5 * 1000),
            total: 1000,
            message: `tesseract: ${m.status}`,
          });
        }
      },
    });

    const translatorBytes = this.translatorSpec.files[0]?.bytes ?? 1;
    onProgress?.({
      phase: 'loading',
      loaded: 500,
      total: 1000,
      message: 'loading translator',
    });
    this.translator = await backend.load<unknown, TranslatorOutput>(this.translatorSpec, {
      onProgress: (p) => {
        const ratio = p.total > 0 ? p.loaded / p.total : 0;
        onProgress?.({
          phase: 'loading',
          loaded: Math.round(500 + ratio * 500),
          total: 1000,
          message: `translator: ${p.message ?? p.phase}`,
        });
      },
    });
    void translatorBytes;
    onProgress?.({ phase: 'idle' });
  }

  async *process(
    input: OcrInput,
    onProgress?: (p: PipelineProgress) => void,
  ): AsyncIterable<OcrOutput> {
    if (!this.tesseract || !this.translator) {
      throw new Error('OcrPipeline: call load() before process()');
    }
    onProgress?.({ phase: 'running', loaded: 0, total: 1, message: 'decoding image' });
    const bitmap = await createImageBitmap(input.file);
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(bitmap.width, bitmap.height)
        : Object.assign(document.createElement('canvas'), {
            width: bitmap.width,
            height: bitmap.height,
          });
    const ctx = (canvas as HTMLCanvasElement).getContext('2d');
    if (!ctx) throw new Error('OcrPipeline: 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    onProgress?.({ phase: 'running', loaded: 0, total: 1, message: 'proposing regions' });
    const boxes = proposeRegions(ctx, canvas.width, canvas.height);
    const regions: OcrRegion[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const bbox = boxes[i];
      if (!bbox) continue;
      onProgress?.({
        phase: 'running',
        loaded: i,
        total: boxes.length,
        message: `region ${i + 1}/${boxes.length}`,
      });
      const crop = cropToCanvas(canvas as HTMLCanvasElement, bbox);
      const cropBlob = await canvasToBlob(crop);
      const recognition = await this.tesseract.recognize(cropBlob);
      const text = (recognition.data.text ?? '').trim();
      let translated = '';
      if (text.length > 0) {
        const translateArgs = this.translatorSpec.id.includes('nllb')
          ? [text, { src_lang: 'hin_Deva', tgt_lang: 'eng_Latn' }]
          : text;
        const translatedRaw = (await this.translator.run(
          translateArgs as unknown as never,
        )) as unknown;
        translated = extractTranslatedText(translatedRaw);
      }
      regions.push({ bbox, recognized: text, translated });
    }
    onProgress?.({ phase: 'done', message: `${regions.length} region(s) recognized` });
    yield {
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      regions,
      recognizer: `tesseract.js/${this.language}`,
      translator: this.translatorSpec.id,
    };
  }

  async dispose(): Promise<void> {
    await this.tesseract?.terminate();
    await this.translator?.dispose();
    this.tesseract = undefined;
    this.translator = undefined;
  }
}

async function loadTesseract(): Promise<typeof import('tesseract.js')> {
  try {
    return await import('tesseract.js');
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new Error(
      `tesseract.js failed to load — ${detail}. Run 'bun install' or restart 'bun dev'.`,
    );
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas toBlob returned null'))),
      'image/png',
    );
  });
}

function extractTranslatedText(raw: unknown): string {
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (first && typeof first === 'object' && 'translation_text' in first) {
      return String((first as { translation_text: string }).translation_text);
    }
  }
  if (raw && typeof raw === 'object' && 'translation_text' in raw) {
    return String((raw as { translation_text: string }).translation_text);
  }
  return '';
}
