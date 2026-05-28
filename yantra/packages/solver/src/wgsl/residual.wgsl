struct Params {
  Nx: u32,
  Ny: u32,
  Nz: u32,
  h: f32,
};

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read>       T_a:    array<f32>;
@group(0) @binding(2) var<storage, read>       T_b:    array<f32>;
@group(0) @binding(3) var<storage, read_write> outRes: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read>       mask:   array<u32>;

fn maskAt(v: u32) -> u32 {
  let word = mask[v / 4u];
  let shift = (v % 4u) * 8u;
  return (word >> shift) & 0xffu;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let v = gid.x;
  let N = P.Nx * P.Ny * P.Nz;
  if (v >= N) { return; }
  if (maskAt(v) == 0u) { return; }
  let d = abs(T_a[v] - T_b[v]);
  let t = abs(T_a[v]);
  let dq: u32 = u32(d * 1e6);
  let tq: u32 = u32(t * 1e6);
  atomicMax(&outRes[0], dq);
  atomicMax(&outRes[1], tq);
}
