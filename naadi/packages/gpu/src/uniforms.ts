// Layout (std140-ish, 32 bytes):
//   vec2<f32> resolution   @ 0
//   f32       time         @ 8
//   f32       zoom         @ 12  (camera/FOV multiplier, default 1.0)
//   vec2<f32> mouse        @ 16
//   vec2<f32> _pad         @ 24
export const UNIFORMS_BYTES = 32;

export interface UniformValues {
  resolutionPx: [number, number];
  timeSec: number;
  mouseNorm: [number, number];
  zoom: number;
}

export function writeUniforms(buf: ArrayBuffer, v: UniformValues): void {
  const f = new Float32Array(buf);
  f[0] = v.resolutionPx[0];
  f[1] = v.resolutionPx[1];
  f[2] = v.timeSec;
  f[3] = v.zoom;
  f[4] = v.mouseNorm[0];
  f[5] = v.mouseNorm[1];
  f[6] = 0;
  f[7] = 0;
}
