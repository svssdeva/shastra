import { COCO_CLASSES } from './models.ts';

export interface Detection {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  classIndex: number;
  className: string;
}

/**
 * Decode YOLOv10 output tensor `[1, N, 6]` where each row is `[x1, y1, x2, y2, score, class_id]`
 * in 640×640 input coordinates. YOLOv10 is NMS-free at export time — rows are pre-sorted by
 * score and zero-padded below the keep threshold, so we just trim by `confThreshold`.
 *
 * Caller is expected to map the boxes back to source image coordinates using the same letterbox
 * scale used during preprocessing.
 */
export function decodeYolov10(
  output: Float32Array,
  numDetections = 300,
  confThreshold = 0.35,
): Detection[] {
  const stride = 6;
  const out: Detection[] = [];
  for (let i = 0; i < numDetections; i++) {
    const base = i * stride;
    const score = output[base + 4] ?? 0;
    if (score < confThreshold) continue; // rows are sorted by score; could `break` instead
    const x1 = output[base + 0] ?? 0;
    const y1 = output[base + 1] ?? 0;
    const x2 = output[base + 2] ?? 0;
    const y2 = output[base + 3] ?? 0;
    const classIndex = Math.round(output[base + 5] ?? 0);
    out.push({
      x: x1,
      y: y1,
      width: Math.max(0, x2 - x1),
      height: Math.max(0, y2 - y1),
      score,
      classIndex,
      className: COCO_CLASSES[classIndex] ?? `class-${classIndex}`,
    });
  }
  return out;
}

/** Convert a 640×640 letterbox-coords box back to source video coords. */
export function unletterbox(
  det: Detection,
  letterSize: number,
  sourceWidth: number,
  sourceHeight: number,
): Detection {
  const scale = Math.min(letterSize / sourceWidth, letterSize / sourceHeight);
  const padX = (letterSize - sourceWidth * scale) / 2;
  const padY = (letterSize - sourceHeight * scale) / 2;
  return {
    ...det,
    x: (det.x - padX) / scale,
    y: (det.y - padY) / scale,
    width: det.width / scale,
    height: det.height / scale,
  };
}
