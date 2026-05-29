import type { Detection } from './detect.ts';
import { type CocoClass, VEHICLE_CLASSES } from './models.ts';

export type IncidentKind = 'looming-vehicle' | 'pedestrian-close' | 'traffic-control';

export interface FrameSummary {
  timestamp: number;
  detections: Detection[];
  largestBoxFraction: number;
  vehicleArea: number;
  pedestrianArea: number;
  hasStopOrLight: boolean;
}

export interface Incident {
  kind: IncidentKind;
  start: number;
  end: number;
  peakScore: number;
  label: string;
}

/**
 * Summarize a frame for scoring. Cheap aggregates the incident pass uses without holding every
 * detection in memory.
 */
export function summarizeFrame(
  detections: Detection[],
  sourceWidth: number,
  sourceHeight: number,
  timestamp: number,
): FrameSummary {
  const area = sourceWidth * sourceHeight;
  let largest = 0;
  let vehicleArea = 0;
  let pedestrianArea = 0;
  let hasStopOrLight = false;
  for (const d of detections) {
    const a = (d.width * d.height) / area;
    if (a > largest) largest = a;
    const cls = d.className as CocoClass;
    if (VEHICLE_CLASSES.has(cls)) {
      if (cls === 'person') pedestrianArea += a;
      else if (cls === 'traffic light' || cls === 'stop sign') hasStopOrLight = true;
      else vehicleArea += a;
    }
  }
  return {
    timestamp,
    detections,
    largestBoxFraction: largest,
    vehicleArea,
    pedestrianArea,
    hasStopOrLight,
  };
}

/**
 * Heuristic incident scoring. Looks for:
 * - **looming-vehicle**: vehicle bbox area grows past 18% of frame for 5+ frames.
 * - **pedestrian-close**: any pedestrian bbox covers 12%+ of frame.
 * - **traffic-control**: stop sign / traffic light detected for 3+ frames in a row.
 *
 * Returns merged incident clips with a small pre-roll / post-roll for context. Tunable
 * thresholds; defaults are reasonable for 720p dashcam footage at 5 FPS sampling.
 */
export function detectIncidents(
  frames: readonly FrameSummary[],
  opts: IncidentOptions = {},
): Incident[] {
  const loomThreshold = opts.loomThreshold ?? 0.18;
  const pedThreshold = opts.pedestrianThreshold ?? 0.12;
  const sustain = opts.sustain ?? 5;
  const preRoll = opts.preRoll ?? 1.5;
  const postRoll = opts.postRoll ?? 1.5;
  const incidents: Incident[] = [];
  let loomRun: { start: number; end: number; peak: number } | null = null;
  let lightRun: { start: number; end: number; count: number } | null = null;
  for (const f of frames) {
    // Looming vehicle.
    if (f.vehicleArea > loomThreshold) {
      if (loomRun) {
        loomRun.end = f.timestamp;
        loomRun.peak = Math.max(loomRun.peak, f.vehicleArea);
      } else {
        loomRun = { start: f.timestamp, end: f.timestamp, peak: f.vehicleArea };
      }
    } else if (loomRun) {
      if (countFramesBetween(frames, loomRun.start, loomRun.end) >= sustain) {
        incidents.push({
          kind: 'looming-vehicle',
          start: Math.max(0, loomRun.start - preRoll),
          end: loomRun.end + postRoll,
          peakScore: loomRun.peak,
          label: `Looming vehicle · ${(loomRun.peak * 100).toFixed(0)}% of frame`,
        });
      }
      loomRun = null;
    }
    // Pedestrian close.
    if (f.pedestrianArea > pedThreshold) {
      incidents.push({
        kind: 'pedestrian-close',
        start: Math.max(0, f.timestamp - preRoll),
        end: f.timestamp + postRoll,
        peakScore: f.pedestrianArea,
        label: `Pedestrian close · ${(f.pedestrianArea * 100).toFixed(0)}% of frame`,
      });
    }
    // Traffic control sustained.
    if (f.hasStopOrLight) {
      if (lightRun) {
        lightRun.end = f.timestamp;
        lightRun.count += 1;
      } else {
        lightRun = { start: f.timestamp, end: f.timestamp, count: 1 };
      }
    } else if (lightRun) {
      if (lightRun.count >= 3) {
        incidents.push({
          kind: 'traffic-control',
          start: Math.max(0, lightRun.start - preRoll),
          end: lightRun.end + postRoll,
          peakScore: 0.5,
          label: 'Traffic control · stop sign / light visible',
        });
      }
      lightRun = null;
    }
  }
  return mergeOverlapping(incidents);
}

export interface IncidentOptions {
  loomThreshold?: number;
  pedestrianThreshold?: number;
  sustain?: number;
  preRoll?: number;
  postRoll?: number;
}

function countFramesBetween(
  frames: readonly FrameSummary[],
  startTs: number,
  endTs: number,
): number {
  return frames.filter((f) => f.timestamp >= startTs && f.timestamp <= endTs).length;
}

function mergeOverlapping(incidents: Incident[]): Incident[] {
  if (incidents.length === 0) return [];
  const sorted = incidents.slice().sort((a, b) => a.start - b.start);
  const merged: Incident[] = [];
  let cur: Incident | undefined;
  for (const inc of sorted) {
    if (!cur) {
      cur = { ...inc };
      continue;
    }
    if (inc.kind === cur.kind && inc.start <= cur.end) {
      cur.end = Math.max(cur.end, inc.end);
      cur.peakScore = Math.max(cur.peakScore, inc.peakScore);
    } else {
      merged.push(cur);
      cur = { ...inc };
    }
  }
  if (cur) merged.push(cur);
  return merged;
}
