export interface FrameSample {
  /** Time of this frame, in seconds, on the source video timeline. */
  timestamp: number;
  /** Frame data resized to 640×640 normalized 0..1, channel-first (RGB CHW). */
  tensor: Float32Array;
  /** Original frame width/height for projecting boxes back to source coordinates. */
  sourceWidth: number;
  sourceHeight: number;
}

const TARGET = 640;

/**
 * Decode video frames at a target sampling rate. Uses `requestVideoFrameCallback` where
 * available; falls back to a `setInterval` reader on browsers without RVFC. Yields normalized
 * CHW tensors ready for YOLOv10n.
 */
export async function* sampleFrames(
  video: HTMLVideoElement,
  fps: number,
  signal?: AbortSignal,
): AsyncGenerator<FrameSample> {
  const dt = 1 / fps;
  const canvas = new OffscreenCanvas(TARGET, TARGET);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('sampleFrames: 2D context unavailable');

  let next = 0;
  await video.play().catch(() => {});
  while (!signal?.aborted && !video.ended) {
    if (video.currentTime + 1e-3 < next) {
      await waitForTime(video, next, signal);
      continue;
    }
    ctx.clearRect(0, 0, TARGET, TARGET);
    drawLetterboxed(ctx, video, TARGET);
    const img = ctx.getImageData(0, 0, TARGET, TARGET);
    yield {
      timestamp: video.currentTime,
      tensor: imageDataToCHW(img),
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
    };
    next = video.currentTime + dt;
  }
}

function waitForTime(video: HTMLVideoElement, t: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const id = setInterval(() => {
      if (video.currentTime >= t || video.ended || signal?.aborted) {
        clearInterval(id);
        resolve();
      }
    }, 30);
    signal?.addEventListener('abort', () => {
      clearInterval(id);
      resolve();
    });
  });
}

function drawLetterboxed(
  ctx: OffscreenCanvasRenderingContext2D,
  video: HTMLVideoElement,
  size: number,
): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.min(size / vw, size / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(video, dx, dy, dw, dh);
}

function imageDataToCHW(img: ImageData): Float32Array {
  const { data, width, height } = img;
  const out = new Float32Array(3 * width * height);
  const plane = width * height;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = (data[i] ?? 0) / 255;
    out[plane + p] = (data[i + 1] ?? 0) / 255;
    out[2 * plane + p] = (data[i + 2] ?? 0) / 255;
  }
  return out;
}

export const YOLO_INPUT_SIZE = TARGET;
