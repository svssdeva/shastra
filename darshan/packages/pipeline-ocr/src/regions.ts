export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Region proposal for handwritten Devanagari pages. Phase 2 ships a deliberately simple
 * connected-components-on-darkness scheme — works well enough on a clean scan, avoids pulling
 * in opencv.js (~10 MB) at this stage. Production would swap to CRAFT or DBNet.
 *
 * The image must already be drawn into the canvas. Returns boxes in image coordinates.
 */
export function proposeRegions(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: { darknessThreshold?: number; minArea?: number; pad?: number } = {},
): BBox[] {
  const darknessThreshold = opts.darknessThreshold ?? 110;
  const minArea = opts.minArea ?? Math.floor((width * height) / 2000);
  const pad = opts.pad ?? 6;
  const img = ctx.getImageData(0, 0, width, height);
  const data = img.data;
  const bw = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // ITU-R BT.601 luma; on a near-white page, dark pixels mark ink.
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const y = (r * 299 + g * 587 + b * 114) / 1000;
    bw[p] = y < darknessThreshold ? 1 : 0;
  }
  // Horizontal-line projection groups Devanagari text rows (shirorekha bias).
  const rowMass = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let m = 0;
    for (let x = 0; x < width; x++) m += bw[y * width + x] ?? 0;
    rowMass[y] = m;
  }
  const lineThreshold = Math.max(3, Math.floor(width * 0.01));
  const lines: { y0: number; y1: number }[] = [];
  let inLine = false;
  let y0 = 0;
  for (let y = 0; y < height; y++) {
    const mass = rowMass[y] ?? 0;
    const dense = mass > lineThreshold;
    if (dense && !inLine) {
      y0 = y;
      inLine = true;
    } else if (!dense && inLine) {
      if (y - y0 > 4) lines.push({ y0, y1: y });
      inLine = false;
    }
  }
  if (inLine) lines.push({ y0, y1: height });

  // Per line, find x-extent of ink.
  const boxes: BBox[] = [];
  for (const ln of lines) {
    let xMin = width;
    let xMax = 0;
    for (let y = ln.y0; y < ln.y1; y++) {
      for (let x = 0; x < width; x++) {
        if ((bw[y * width + x] ?? 0) === 1) {
          if (x < xMin) xMin = x;
          if (x > xMax) xMax = x;
        }
      }
    }
    if (xMax <= xMin) continue;
    const w = xMax - xMin + 1;
    const h = ln.y1 - ln.y0;
    if (w * h < minArea) continue;
    boxes.push({
      x: Math.max(0, xMin - pad),
      y: Math.max(0, ln.y0 - pad),
      width: Math.min(width - xMin + pad, w + 2 * pad),
      height: Math.min(height - ln.y0 + pad, h + 2 * pad),
    });
  }
  return boxes;
}

export function cropToCanvas(
  source: HTMLCanvasElement | OffscreenCanvas,
  box: BBox,
): HTMLCanvasElement | OffscreenCanvas {
  const useOffscreen = typeof OffscreenCanvas !== 'undefined';
  const out = useOffscreen
    ? new OffscreenCanvas(box.width, box.height)
    : Object.assign(document.createElement('canvas'), { width: box.width, height: box.height });
  const ctx = (out as HTMLCanvasElement).getContext('2d');
  if (!ctx) throw new Error('cropToCanvas: no 2D context');
  ctx.drawImage(
    source as CanvasImageSource,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    box.width,
    box.height,
  );
  return out;
}
