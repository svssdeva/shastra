// Hidden header prepended to every user WGSL source. The user is expected to
// supply ONLY a `@fragment fn fs_main(...) -> @location(0) vec4<f32>` entry.
// We own the vertex shader and the uniform binding.
export const NAADI_PRELUDE = /* wgsl */ `
struct NaadiUniforms {
  resolution: vec2<f32>,
  time: f32,
  zoom: f32,
  mouse: vec2<f32>,
  _pad1: vec2<f32>,
};
@group(0) @binding(0) var<uniform> u: NaadiUniforms;

const PI: f32 = 3.14159265358979323846;
const TAU: f32 = 6.28318530717958647692;

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  // Fullscreen triangle covering NDC quad in three vertices.
  let x = f32(i32(i << 1u) & 2);
  let y = f32(i32(i) & 2);
  return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

// ---- USER CODE BELOW ----
`;

// Lines in the prelude — used to remap WGSL diagnostic line numbers
// back to the user's editor lines (subtract this from reported line).
export const PRELUDE_LINE_COUNT = NAADI_PRELUDE.split('\n').length - 1;
