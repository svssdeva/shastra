import { expect, test } from 'bun:test';
import { decodeYolov10 } from '../src/detect.ts';
import { detectIncidents, summarizeFrame } from '../src/incidents.ts';
import { DashcamPipeline, PIPELINE_DASHCAM_VERSION } from '../src/index.ts';

test('pipeline-dashcam version is published', () => {
  expect(PIPELINE_DASHCAM_VERSION).toMatch(/^\d+\.\d+\.\d+/);
});

test('DashcamPipeline identifies itself correctly', () => {
  const p = new DashcamPipeline();
  expect(p.id).toBe('dashcam');
  expect(p.inputKind).toBe('video');
});

test('decodeYolov10 returns no detections below threshold', () => {
  const numDetections = 300;
  const out = new Float32Array(numDetections * 6);
  // All zeros → score=0, below the 0.35 threshold → no detections.
  const dets = decodeYolov10(out, numDetections, 0.35);
  expect(dets.length).toBe(0);
});

test('summarizeFrame aggregates vehicle vs pedestrian area', () => {
  const dets = [
    { x: 0, y: 0, width: 320, height: 240, score: 0.9, classIndex: 2, className: 'car' },
    { x: 0, y: 0, width: 100, height: 200, score: 0.8, classIndex: 0, className: 'person' },
  ];
  const s = summarizeFrame(dets, 1280, 720, 1.0);
  expect(s.vehicleArea).toBeGreaterThan(0);
  expect(s.pedestrianArea).toBeGreaterThan(0);
});

test('detectIncidents finds a pedestrian-close incident on high coverage', () => {
  const dets = [
    { x: 0, y: 0, width: 800, height: 600, score: 0.95, classIndex: 0, className: 'person' },
  ];
  const s = summarizeFrame(dets, 1280, 720, 1.0);
  const incidents = detectIncidents([s]);
  expect(incidents.length).toBe(1);
  expect(incidents[0]?.kind).toBe('pedestrian-close');
});
