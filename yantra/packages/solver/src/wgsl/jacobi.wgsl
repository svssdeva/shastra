struct Params {
  Nx: u32,
  Ny: u32,
  Nz: u32,
  h: f32,
};

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read>       T_in:  array<f32>;
@group(0) @binding(2) var<storage, read_write> T_out: array<f32>;
@group(0) @binding(3) var<storage, read>       mask:  array<u32>;
@group(0) @binding(4) var<storage, read>       kCond: array<f32>;
@group(0) @binding(5) var<storage, read>       Q:     array<f32>;

fn idxOf(i: u32, j: u32, k: u32) -> u32 {
  return i + P.Nx * (j + P.Ny * k);
}

fn maskAt(v: u32) -> u32 {
  let word = mask[v / 4u];
  let shift = (v % 4u) * 8u;
  return (word >> shift) & 0xffu;
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  let k = gid.z;
  if (i >= P.Nx || j >= P.Ny || k >= P.Nz) { return; }
  let v = idxOf(i, j, k);
  let m = maskAt(v);
  if (m == 0u) { T_out[v] = 0.0; return; }
  if (m == 2u) { T_out[v] = T_in[v]; return; }

  let h2 = P.h * P.h;
  let kv = kCond[v];
  var num: f32 = Q[v] * h2;
  var den: f32 = 0.0;

  if (i + 1u < P.Nx) {
    let nv = idxOf(i + 1u, j, k);
    if (maskAt(nv) != 0u) {
      let kf = (2.0 * kv * kCond[nv]) / (kv + kCond[nv] + 1e-30);
      num = num + kf * T_in[nv];
      den = den + kf;
    }
  }
  if (i > 0u) {
    let nv = idxOf(i - 1u, j, k);
    if (maskAt(nv) != 0u) {
      let kf = (2.0 * kv * kCond[nv]) / (kv + kCond[nv] + 1e-30);
      num = num + kf * T_in[nv];
      den = den + kf;
    }
  }
  if (j + 1u < P.Ny) {
    let nv = idxOf(i, j + 1u, k);
    if (maskAt(nv) != 0u) {
      let kf = (2.0 * kv * kCond[nv]) / (kv + kCond[nv] + 1e-30);
      num = num + kf * T_in[nv];
      den = den + kf;
    }
  }
  if (j > 0u) {
    let nv = idxOf(i, j - 1u, k);
    if (maskAt(nv) != 0u) {
      let kf = (2.0 * kv * kCond[nv]) / (kv + kCond[nv] + 1e-30);
      num = num + kf * T_in[nv];
      den = den + kf;
    }
  }
  if (k + 1u < P.Nz) {
    let nv = idxOf(i, j, k + 1u);
    if (maskAt(nv) != 0u) {
      let kf = (2.0 * kv * kCond[nv]) / (kv + kCond[nv] + 1e-30);
      num = num + kf * T_in[nv];
      den = den + kf;
    }
  }
  if (k > 0u) {
    let nv = idxOf(i, j, k - 1u);
    if (maskAt(nv) != 0u) {
      let kf = (2.0 * kv * kCond[nv]) / (kv + kCond[nv] + 1e-30);
      num = num + kf * T_in[nv];
      den = den + kf;
    }
  }

  if (den == 0.0) { T_out[v] = T_in[v]; return; }
  T_out[v] = num / den;
}
