// Curated WGSL fragment-shader presets. Each one defines exactly one
// `@fragment fn fs_main(...)`; the hidden prelude (see prelude.ts) provides
// `u.time`, `u.resolution`, `u.mouse`, `PI`, `TAU`, and the vertex shader.

export const COSINE_RAINBOW = /* wgsl */ `// Welcome to naadi. Every peer in this room edits this shader.
// Uniforms: u.resolution (vec2), u.time (f32), u.mouse (vec2).

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag.xy / u.resolution;
  let t = u.time * 0.5;
  let col = 0.5 + 0.5 * cos(t + vec3<f32>(uv.x, uv.y, uv.x + uv.y) * TAU + vec3<f32>(0.0, 2.0, 4.0));
  return vec4<f32>(col, 1.0);
}
`;

export const PLASMA = /* wgsl */ `// Plasma — sin/cos interference field. Drag mouse to push the centre.

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (frag.xy - 0.5 * u.resolution) / (u.resolution.y * u.zoom);
  let m = (u.mouse - vec2<f32>(0.5)) * 2.0;
  let t = u.time;
  let v1 = sin(uv.x * 8.0 + t);
  let v2 = sin(uv.y * 8.0 + t * 1.3);
  let v3 = sin(length(uv - m) * 10.0 - t * 2.0);
  let v4 = sin((uv.x + uv.y) * 6.0 + sin(t * 0.5) * 3.0);
  let v = (v1 + v2 + v3 + v4) * 0.25;
  let col = vec3<f32>(
    0.5 + 0.5 * sin(v * PI + 0.0),
    0.5 + 0.5 * sin(v * PI + 2.0),
    0.5 + 0.5 * sin(v * PI + 4.0),
  );
  return vec4<f32>(col, 1.0);
}
`;

export const MANDELBROT = /* wgsl */ `// Mandelbrot — slow zoom into a tendril, palette cycles with u.time.

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (frag.xy - 0.5 * u.resolution) / (u.resolution.y * u.zoom);
  let zoom = exp(-u.time * 0.15);
  let centre = vec2<f32>(-0.743643887037151, 0.131825904205330);
  var c = centre + uv * zoom * 2.0;
  var z = vec2<f32>(0.0);
  var i: u32 = 0u;
  let MAX_ITER: u32 = 200u;
  loop {
    if (i >= MAX_ITER || dot(z, z) > 4.0) { break; }
    z = vec2<f32>(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    i = i + 1u;
  }
  if (i == MAX_ITER) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  let smooth_i = f32(i) - log2(log2(dot(z, z))) + 4.0;
  let n = smooth_i * 0.05 + u.time * 0.2;
  let col = 0.5 + 0.5 * cos(n * TAU + vec3<f32>(0.0, 0.5, 1.0) * TAU);
  return vec4<f32>(col, 1.0);
}
`;

export const TUNNEL = /* wgsl */ `// Endless polar tunnel — log-stretches a checker grid into infinity.

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (frag.xy - 0.5 * u.resolution) / (u.resolution.y * u.zoom);
  let r = length(uv);
  let a = atan2(uv.y, uv.x);
  let v = 1.0 / r;
  let u_t = v + u.time * 0.6;
  let v_t = a * 4.0 / PI;
  let checker = step(0.5, fract(u_t)) * step(0.5, fract(v_t))
              + step(0.5, fract(u_t + 0.5)) * step(0.5, fract(v_t + 0.5));
  let neon = vec3<f32>(
    0.5 + 0.5 * sin(u_t * 0.5 + 0.0),
    0.5 + 0.5 * sin(u_t * 0.5 + 2.0),
    0.5 + 0.5 * sin(u_t * 0.5 + 4.0),
  );
  let fade = smoothstep(0.0, 0.4, r);
  let col = neon * checker * fade;
  return vec4<f32>(col, 1.0);
}
`;

export const VORONOI = /* wgsl */ `// Voronoi cells — drifting feature points, glow along borders.

fn hash22(p: vec2<f32>) -> vec2<f32> {
  let p1 = vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3)));
  return fract(sin(p1) * 43758.5453);
}

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag.xy / (u.resolution.y * u.zoom) * 6.0;
  let i = floor(uv);
  let f = fract(uv);
  var minDist: f32 = 8.0;
  var secondMin: f32 = 8.0;
  for (var y: i32 = -1; y <= 1; y = y + 1) {
    for (var x: i32 = -1; x <= 1; x = x + 1) {
      let g = vec2<f32>(f32(x), f32(y));
      let h = hash22(i + g);
      let o = g + 0.5 + 0.5 * sin(u.time + h * TAU) - f;
      let d = length(o);
      if (d < minDist) {
        secondMin = minDist;
        minDist = d;
      } else if (d < secondMin) {
        secondMin = d;
      }
    }
  }
  let edge = smoothstep(0.0, 0.06, secondMin - minDist);
  let cell = hash22(i).x;
  let col = mix(
    vec3<f32>(0.05, 0.0, 0.15),
    vec3<f32>(0.5 + 0.5 * sin(cell * 12.0), 0.4, 1.0 - cell),
    1.0 - edge,
  );
  return vec4<f32>(col, 1.0);
}
`;

export const CYBERPUNK_AVATAR = /* wgsl */ `// Cyberpunk avatar — raymarched bust under neon rim light.
// Drag the mouse to rotate the camera; everything is one SDF.

fn sdSphere(p: vec3<f32>, r: f32) -> f32 { return length(p) - r; }
fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}
fn sdCapsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
fn sdEllipsoid(p: vec3<f32>, r: vec3<f32>) -> f32 {
  let k0 = length(p / r);
  let k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
fn smoothMin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
fn smoothSub(d1: f32, d2: f32, k: f32) -> f32 {
  let h = clamp(0.5 - 0.5 * (d1 + d2) / k, 0.0, 1.0);
  return mix(d1, -d2, h) + k * h * (1.0 - h);
}
fn rotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a); let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Returns (distance, materialId). 0 = flesh, 1 = emissive.
fn scene(p: vec3<f32>) -> vec2<f32> {
  // Skull stack — assembled top-down.
  let cranium = sdEllipsoid(p - vec3<f32>(0.0, 0.28, 0.0),  vec3<f32>(0.78, 0.95, 0.92));
  let brow    = sdEllipsoid(p - vec3<f32>(0.0, 0.18, 0.66), vec3<f32>(0.6,  0.1,  0.22));
  let cheekL  = sdSphere(p - vec3<f32>(-0.4, -0.18, 0.55),  0.27);
  let cheekR  = sdSphere(p - vec3<f32>( 0.4, -0.18, 0.55),  0.27);
  let jaw     = sdEllipsoid(p - vec3<f32>(0.0, -0.55, 0.2), vec3<f32>(0.55, 0.38, 0.55));
  let chin    = sdSphere(p - vec3<f32>(0.0, -0.78, 0.5),    0.2);
  let bridge  = sdEllipsoid(p - vec3<f32>(0.0, -0.02, 0.82), vec3<f32>(0.08, 0.26, 0.16));
  let noseTip = sdSphere(p - vec3<f32>(0.0, -0.22, 0.94),   0.1);
  let earL    = sdEllipsoid(p - vec3<f32>(-0.82, 0.0, 0.0), vec3<f32>(0.05, 0.18, 0.16));
  let earR    = sdEllipsoid(p - vec3<f32>( 0.82, 0.0, 0.0), vec3<f32>(0.05, 0.18, 0.16));

  var head = cranium;
  head = smoothMin(head, brow,    0.12);
  head = smoothMin(head, cheekL,  0.14);
  head = smoothMin(head, cheekR,  0.14);
  head = smoothMin(head, jaw,     0.18);
  head = smoothMin(head, chin,    0.14);
  head = smoothMin(head, bridge,  0.05);
  head = smoothMin(head, noseTip, 0.04);
  head = smoothMin(head, earL,    0.04);
  head = smoothMin(head, earR,    0.04);

  // Carve eye sockets + mouth slit.
  let socketL = sdSphere(p - vec3<f32>(-0.26, 0.04, 0.78), 0.17);
  let socketR = sdSphere(p - vec3<f32>( 0.26, 0.04, 0.78), 0.17);
  head = smoothSub(head, socketL, 0.04);
  head = smoothSub(head, socketR, 0.04);
  let mouth = sdBox(p - vec3<f32>(0.0, -0.5, 0.78), vec3<f32>(0.16, 0.02, 0.08));
  head = smoothSub(head, mouth, 0.02);

  // Neck + shoulders.
  let neck      = sdCapsule(p, vec3<f32>(0.0, -1.65, 0.0), vec3<f32>(0.0, -0.85, 0.08), 0.26);
  let shoulders = sdEllipsoid(p - vec3<f32>(0.0, -1.85, -0.05), vec3<f32>(1.35, 0.3, 0.55));
  let bust      = smoothMin(neck, shoulders, 0.2);

  let flesh = smoothMin(head, bust, 0.15);

  // Emissive: glowing eyes peeking through sockets + temple plate.
  let eyeL  = sdSphere(p - vec3<f32>(-0.26, 0.04, 0.88), 0.09);
  let eyeR  = sdSphere(p - vec3<f32>( 0.26, 0.04, 0.88), 0.09);
  let plate = sdBox(p - vec3<f32>(-0.72, 0.3, 0.18),     vec3<f32>(0.04, 0.14, 0.18));
  let emit  = min(min(eyeL, eyeR), plate);

  if (emit < flesh) { return vec2<f32>(emit, 1.0); }
  return vec2<f32>(flesh, 0.0);
}

fn normal(p: vec3<f32>) -> vec3<f32> {
  let e = vec2<f32>(0.001, 0.0);
  return normalize(vec3<f32>(
    scene(p + e.xyy).x - scene(p - e.xyy).x,
    scene(p + e.yxy).x - scene(p - e.yxy).x,
    scene(p + e.yyx).x - scene(p - e.yyx).x,
  ));
}

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (frag.xy - 0.5 * u.resolution) / (u.resolution.y * u.zoom);

  // Camera orbits the bust. Mouse adds yaw + pitch.
  let yaw   = u.time * 0.3 + (u.mouse.x - 0.5) * 4.0;
  let pitch = (u.mouse.y - 0.5) * 1.0;
  let camDist = 3.6;
  var ro = vec3<f32>(0.0, 0.0, -camDist);
  ro = vec3<f32>(ro.x, ro.y * cos(pitch) - ro.z * sin(pitch), ro.y * sin(pitch) + ro.z * cos(pitch));
  ro = rotY(ro, yaw);
  let lookAt = vec3<f32>(0.0, -0.15, 0.0);
  let ww = normalize(lookAt - ro);
  let uu = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), ww));
  let vv = cross(ww, uu);
  let rd = normalize(uv.x * uu - uv.y * vv + 1.7 * ww);

  var t: f32 = 0.0;
  var matId: f32 = 0.0;
  var hit: bool = false;
  for (var i: u32 = 0u; i < 128u; i = i + 1u) {
    let p = ro + rd * t;
    let h = scene(p);
    if (h.x < 0.001) { hit = true; matId = h.y; break; }
    if (t > 20.0) { break; }
    t = t + h.x * 0.85;
  }

  // Background: dark with subtle horizon scanlines.
  let scan = 0.5 + 0.5 * sin(frag.y * 3.5 + u.time * 4.0);
  let bg   = vec3<f32>(0.015, 0.0, 0.04) + vec3<f32>(0.04, 0.0, 0.12) * scan * 0.15;

  if (!hit) { return vec4<f32>(bg, 1.0); }

  let p = ro + rd * t;
  let n = normal(p);

  let cyan    = vec3<f32>(0.15, 0.95, 1.0);
  let magenta = vec3<f32>(1.0,  0.15, 0.85);

  if (matId > 0.5) {
    // Emissive: bright cyan core with magenta fresnel halo.
    let rim = pow(1.0 - max(dot(n, -rd), 0.0), 1.2);
    let col = cyan * 1.6 + magenta * rim * 0.6;
    return vec4<f32>(col, 1.0);
  }

  // Flesh: pale chrome skin, magenta fill, cyan rim.
  let keyDir  = normalize(vec3<f32>(0.4, 0.9, -0.4));
  let fillDir = normalize(vec3<f32>(-0.6, 0.2, -0.8));
  let key  = max(dot(n, keyDir),  0.0);
  let fill = max(dot(n, fillDir), 0.0);
  let rim  = pow(1.0 - max(dot(n, -rd), 0.0), 2.8);

  let base = mix(vec3<f32>(0.06, 0.04, 0.1), vec3<f32>(0.55, 0.5, 0.62), key);
  var col = base + magenta * fill * 0.35 + cyan * rim * 1.2;

  // Occasional glitch line.
  let glitch = step(0.985, fract(sin(u.time * 24.0 + p.y * 14.0) * 43758.5));
  col = mix(col, vec3<f32>(1.0, 0.1, 0.4), glitch * 0.4);

  return vec4<f32>(col, 1.0);
}
`;

export const NEON_GRID = /* wgsl */ `// Tron horizon — receding neon grid + scanning glow.

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (frag.xy - 0.5 * u.resolution) / (u.resolution.y * u.zoom);
  let horizon = 0.0;
  if (uv.y > horizon) {
    // sky
    let sky = mix(vec3<f32>(0.03, 0.0, 0.1), vec3<f32>(0.4, 0.0, 0.6), uv.y * 2.0);
    let sun = smoothstep(0.18, 0.0, abs(uv.x)) * smoothstep(0.4, 0.05, abs(uv.y - 0.2));
    let stripe = step(0.5, fract(uv.y * 30.0 - u.time));
    return vec4<f32>(sky + vec3<f32>(1.0, 0.5, 0.0) * sun * stripe, 1.0);
  }
  // ground — project to a plane below the camera
  let z = 1.0 / max(-uv.y, 0.001);
  let gx = uv.x * z;
  let gz = z + u.time * 1.5;
  let lineX = smoothstep(0.05, 0.0, abs(fract(gx) - 0.5) - 0.45);
  let lineZ = smoothstep(0.05, 0.0, abs(fract(gz) - 0.5) - 0.45);
  let grid = max(lineX, lineZ);
  let glow = exp(-z * 0.15);
  let col = vec3<f32>(0.1, 0.6, 1.0) * grid * glow + vec3<f32>(0.0, 0.0, 0.05);
  return vec4<f32>(col, 1.0);
}
`;

export const BLACK_HOLE = /* wgsl */ `// Accretion disk + lensing — a polar disk warped by 1/r doppler shift.

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (frag.xy - 0.5 * u.resolution) / (u.resolution.y * u.zoom);
  let r = length(uv);
  let a = atan2(uv.y, uv.x);
  let event = 0.18;
  if (r < event) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  // disk: rings spiral inward
  let lensing = 1.0 / (r - event);
  let spiral = sin(a * 4.0 + lensing * 0.5 - u.time * 1.5);
  let band = smoothstep(0.2, 1.0, 0.5 + 0.5 * spiral);
  let temp = mix(vec3<f32>(1.0, 0.3, 0.05), vec3<f32>(1.0, 0.9, 0.6), smoothstep(0.18, 0.5, r));
  let glow = exp(-r * 1.8) * 1.2;
  let dop = 0.5 + 0.5 * sin(a + 1.5);
  let col = temp * band * glow * (0.5 + dop);
  // ring of photons at the event horizon
  let ring = smoothstep(0.02, 0.0, abs(r - event - 0.02));
  return vec4<f32>(col + vec3<f32>(1.0, 0.9, 0.7) * ring * 1.5, 1.0);
}
`;

export const CRT_GLITCH = /* wgsl */ `// CRT corruption — RGB shift, scanlines, occasional tearing.

fn rand(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag.xy / u.resolution;
  // glitch slices — bands jump in x
  let band = floor(uv.y * 12.0);
  let jump = (rand(vec2<f32>(band, floor(u.time * 6.0))) - 0.5) * step(0.8, rand(vec2<f32>(band, floor(u.time * 3.0))));
  let warped = vec2<f32>(uv.x + jump * 0.2, uv.y);
  // base pattern: drifting hue field
  let hue = warped.x * 4.0 + sin(warped.y * 8.0 + u.time);
  let palette = 0.5 + 0.5 * cos(hue + vec3<f32>(0.0, 2.0, 4.0));
  // RGB channel separation
  let chrom = 0.005;
  let r = 0.5 + 0.5 * cos(hue + chrom * 8.0);
  let b = 0.5 + 0.5 * cos(hue - chrom * 8.0 + 4.0);
  var col = vec3<f32>(r, palette.y, b);
  // scanlines
  let scan = 0.85 + 0.15 * sin(frag.y * 3.14);
  col = col * scan;
  // vignette
  let v = smoothstep(1.0, 0.4, length(uv - 0.5));
  col = col * v;
  return vec4<f32>(col, 1.0);
}
`;

export const STARFIELD = /* wgsl */ `// Hyperspace — radial streaks accelerate outward.

fn hash13(p3: vec3<f32>) -> f32 {
  var p = fract(p3 * 0.1031);
  p = p + dot(p, vec3<f32>(p.y + 33.33, p.z + 33.33, p.x + 33.33));
  return fract((p.x + p.y) * p.z);
}

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (frag.xy - 0.5 * u.resolution) / (u.resolution.y * u.zoom);
  let dir = normalize(vec3<f32>(uv, 1.0));
  var col = vec3<f32>(0.01, 0.0, 0.04);
  for (var i: f32 = 0.0; i < 50.0; i = i + 1.0) {
    let z = fract(i * 0.137 + u.time * 0.3);
    let p = dir / z;
    let cell = floor(p * 12.0);
    let h = hash13(cell);
    let local = fract(p * 12.0) - 0.5;
    let r = length(local);
    let bright = smoothstep(0.08, 0.0, r) * (1.0 - z) * 1.5;
    let tint = mix(vec3<f32>(0.6, 0.85, 1.0), vec3<f32>(1.0, 0.6, 0.9), h);
    col = col + tint * bright * step(0.9, h);
  }
  return vec4<f32>(col, 1.0);
}
`;

export const ANIME_WAIFU = /* wgsl */ `// Anime waifu — 3D raymarched full-body, cel-shaded with anime outline.
// Curvy silhouette, pink hair w/ ahoge, leotard + stockings. Drag mouse to orbit.

fn sdSphere(p: vec3<f32>, r: f32) -> f32 { return length(p) - r; }
fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}
fn sdCapsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
fn sdEllipsoid(p: vec3<f32>, r: vec3<f32>) -> f32 {
  let k0 = length(p / r);
  let k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
fn smoothMin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
fn smoothSub(d1: f32, d2: f32, k: f32) -> f32 {
  let h = clamp(0.5 - 0.5 * (d1 + d2) / k, 0.0, 1.0);
  return mix(d1, -d2, h) + k * h * (1.0 - h);
}
fn rotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a); let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Returns (distance, materialId). 0 = skin, 1 = hair, 2 = eye.
fn scene(p: vec3<f32>) -> vec2<f32> {
  let m = vec3<f32>(abs(p.x), p.y, p.z); // mirror x for paired parts

  // ---- Head (large anime proportions) ----
  let cranium = sdEllipsoid(p - vec3<f32>(0.0, 2.32, 0.0),  vec3<f32>(0.4, 0.44, 0.4));
  let chin    = sdSphere(p - vec3<f32>(0.0, 1.95, 0.12),    0.2);
  let nose    = sdEllipsoid(p - vec3<f32>(0.0, 2.18, 0.42), vec3<f32>(0.024, 0.04, 0.05));
  var head = smoothMin(cranium, chin, 0.12);
  head = smoothMin(head, nose, 0.02);
  // Large anime eye sockets — wider than tall.
  let socket = sdEllipsoid(m - vec3<f32>(0.14, 2.28, 0.34), vec3<f32>(0.11, 0.09, 0.08));
  head = smoothSub(head, socket, 0.02);

  // ---- Neck + curvy torso (mommy proportions) ----
  let neck  = sdCapsule(p, vec3<f32>(0.0, 1.95, 0.0), vec3<f32>(0.0, 1.62, 0.0), 0.085);
  let chest = sdEllipsoid(p - vec3<f32>(0.0, 1.5, 0.0),  vec3<f32>(0.32, 0.18, 0.2));
  let bust  = sdSphere(m - vec3<f32>(0.13, 1.4, 0.18),    0.17);
  let waist = sdEllipsoid(p - vec3<f32>(0.0, 1.05, 0.0), vec3<f32>(0.24, 0.22, 0.18));
  let hips  = sdEllipsoid(p - vec3<f32>(0.0, 0.65, 0.0), vec3<f32>(0.42, 0.25, 0.22));
  var torso = smoothMin(chest, bust, 0.05);
  torso = smoothMin(torso, waist, 0.18);
  torso = smoothMin(torso, hips,  0.16);

  // ---- Arms (mirrored) ----
  let shoulder = sdSphere(m - vec3<f32>(0.34, 1.55, 0.0), 0.1);
  let upperArm = sdCapsule(m, vec3<f32>(0.34, 1.55, 0.0),  vec3<f32>(0.42, 1.05, 0.05), 0.075);
  let forearm  = sdCapsule(m, vec3<f32>(0.42, 1.05, 0.05), vec3<f32>(0.4,  0.58, 0.12), 0.065);
  let hand     = sdSphere(m - vec3<f32>(0.4, 0.5, 0.12),   0.07);
  var arm = smoothMin(shoulder, upperArm, 0.05);
  arm = smoothMin(arm, forearm, 0.04);
  arm = smoothMin(arm, hand,    0.04);

  // ---- Legs (mirrored) ----
  let thigh = sdCapsule(m, vec3<f32>(0.18, 0.45, 0.0),  vec3<f32>(0.2, -0.25, 0.0), 0.14);
  let knee  = sdSphere(m - vec3<f32>(0.2, -0.25, 0.02),  0.13);
  let calf  = sdCapsule(m, vec3<f32>(0.2, -0.25, 0.02), vec3<f32>(0.18, -0.95, 0.0), 0.1);
  let foot  = sdBox(m - vec3<f32>(0.18, -1.03, 0.08),   vec3<f32>(0.08, 0.04, 0.16));
  var leg = smoothMin(thigh, knee, 0.05);
  leg = smoothMin(leg, calf, 0.05);
  leg = smoothMin(leg, foot, 0.04);

  var body = smoothMin(neck, torso, 0.08);
  body = smoothMin(body, arm, 0.08);
  body = smoothMin(body, leg, 0.1);
  let skin = smoothMin(head, body, 0.08);

  // ---- Hair (must cover cranium top: cranium peaks at y≈2.76) ----
  let hairCrown = sdEllipsoid(p - vec3<f32>(0.0, 2.4, -0.02), vec3<f32>(0.5, 0.5, 0.46));
  let hairBack  = sdEllipsoid(p - vec3<f32>(0.0, 2.0, -0.18), vec3<f32>(0.52, 0.5, 0.42));
  let hairLong  = sdEllipsoid(p - vec3<f32>(0.0, 1.4, -0.22), vec3<f32>(0.56, 0.8, 0.3));
  let bangSide  = sdCapsule(m, vec3<f32>(0.4, 2.55, 0.22), vec3<f32>(0.34, 1.95, 0.28), 0.1);
  let frontBang = sdEllipsoid(p - vec3<f32>(0.0, 2.45, 0.32), vec3<f32>(0.38, 0.12, 0.2));
  let ahoge     = sdCapsule(p, vec3<f32>(0.0, 2.7, 0.0), vec3<f32>(sin(u.time * 1.5) * 0.06, 3.0, 0.0), 0.022);
  var hair = smoothMin(hairCrown, hairBack, 0.08);
  hair = smoothMin(hair, hairLong,  0.1);
  hair = smoothMin(hair, bangSide,  0.05);
  hair = smoothMin(hair, frontBang, 0.04);
  hair = smoothMin(hair, ahoge,     0.02);
  // Face window: carve only where eyes/nose/mouth sit, so brows + bangs stay.
  let faceCarve = sdEllipsoid(p - vec3<f32>(0.0, 2.2, 0.42), vec3<f32>(0.3, 0.18, 0.18));
  hair = smoothSub(hair, faceCarve, 0.04);

  // ---- Eyes (large anime eyes peeking through carved sockets) ----
  let eye = sdEllipsoid(m - vec3<f32>(0.14, 2.28, 0.4), vec3<f32>(0.1, 0.085, 0.05));

  var dMin = skin;
  var matId: f32 = 0.0;
  if (eye  < dMin) { dMin = eye;  matId = 2.0; }
  if (hair < dMin) { dMin = hair; matId = 1.0; }
  return vec2<f32>(dMin, matId);
}

fn normal(p: vec3<f32>) -> vec3<f32> {
  let e = vec2<f32>(0.001, 0.0);
  return normalize(vec3<f32>(
    scene(p + e.xyy).x - scene(p - e.xyy).x,
    scene(p + e.yxy).x - scene(p - e.yxy).x,
    scene(p + e.yyx).x - scene(p - e.yyx).x,
  ));
}

// 4-band cel quantizer.
fn cel(l: f32) -> f32 {
  if (l > 0.72) { return 1.0; }
  if (l > 0.4)  { return 0.78; }
  if (l > 0.1)  { return 0.55; }
  return 0.4;
}

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (frag.xy - 0.5 * u.resolution) / (u.resolution.y * u.zoom);

  // Orbit camera framed on upper body. Mouse adds yaw + pitch.
  let yaw   = u.time * 0.25 + (u.mouse.x - 0.5) * 4.0;
  let pitch = (u.mouse.y - 0.5) * 0.6;
  let camDist = 6.0;
  var ro = vec3<f32>(0.0, 1.4, -camDist);
  ro = vec3<f32>(ro.x, ro.y * cos(pitch) - ro.z * sin(pitch), ro.y * sin(pitch) + ro.z * cos(pitch));
  ro = rotY(ro, yaw);
  let lookAt = vec3<f32>(0.0, 1.4, 0.0);
  let ww = normalize(lookAt - ro);
  let uu = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), ww));
  let vv = cross(ww, uu);
  let rd = normalize(uv.x * uu - uv.y * vv + 1.5 * ww);

  var t: f32 = 0.0;
  var matId: f32 = 0.0;
  var hit: bool = false;
  for (var i: u32 = 0u; i < 160u; i = i + 1u) {
    let pp = ro + rd * t;
    let h = scene(pp);
    if (h.x < 0.001) { hit = true; matId = h.y; break; }
    if (t > 30.0) { break; }
    t = t + h.x * 0.85;
  }

  // Background: pastel sky + soft sun.
  let bgSky    = vec3<f32>(1.0, 0.78, 0.88);
  let bgGround = vec3<f32>(0.95, 0.92, 1.0);
  let horizon  = smoothstep(-0.3, 0.3, uv.y + 0.1);
  var bg = mix(bgGround, bgSky, horizon);
  let sun = exp(-length(uv - vec2<f32>(-0.4, 0.3)) * 2.5) * 0.25;
  bg = bg + vec3<f32>(1.0, 0.9, 0.8) * sun;

  if (!hit) { return vec4<f32>(bg, 1.0); }

  let p = ro + rd * t;
  let n = normal(p);
  let keyDir = normalize(vec3<f32>(0.4, 0.9, -0.5));
  let lam    = max(dot(n, keyDir), 0.0);
  let rim    = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);

  var col = vec3<f32>(0.0);

  if (matId > 1.5) {
    // Eye: iris/pupil/sclera drawn from local XY around eye center.
    let side = sign(p.x);
    let center = vec3<f32>(0.14 * side, 2.28, 0.4);
    let d = p - center;
    let r2 = length(vec2<f32>(d.x, d.y - 0.008));
    var eyeCol = vec3<f32>(1.0, 1.0, 1.0);
    if (r2 < 0.075) {
      let tt = clamp(r2 / 0.075, 0.0, 1.0);
      eyeCol = mix(vec3<f32>(0.6, 0.25, 0.85), vec3<f32>(0.2, 0.45, 0.95), tt);
    }
    if (r2 < 0.028) { eyeCol = vec3<f32>(0.04, 0.02, 0.08); }
    let sp1 = exp(-length(vec2<f32>(d.x - 0.028 * side, d.y - 0.035)) * 55.0);
    let sp2 = exp(-length(vec2<f32>(d.x + 0.03 * side,  d.y + 0.035)) * 80.0);
    col = eyeCol + vec3<f32>(1.0, 1.0, 1.0) * (sp1 * 1.0 + sp2 * 0.7);
  } else if (matId > 0.5) {
    // Hair: multi-stop vertical gradient (teal tips → lavender → pink → magenta roots)
    // with strand striations and glossy rim.
    let strand = 0.5 + 0.5 * sin(p.x * 30.0 + p.y * 8.0 + sin(p.z * 6.0));
    let vT = clamp((p.y - 1.0) / 1.6, 0.0, 1.0); // 0 at tips, 1 at crown
    let teal     = vec3<f32>(0.4,  0.85, 0.95);
    let lavender = vec3<f32>(0.65, 0.5,  0.95);
    let pink     = vec3<f32>(1.0,  0.55, 0.85);
    let magenta  = vec3<f32>(0.85, 0.25, 0.7);
    var hairBase = mix(teal, lavender, smoothstep(0.0, 0.4, vT));
    hairBase = mix(hairBase, pink,     smoothstep(0.3, 0.7, vT));
    hairBase = mix(hairBase, magenta,  smoothstep(0.75, 1.0, vT));
    let strandCol = mix(hairBase * 0.75, hairBase, strand);
    col = strandCol * cel(lam);
    col = col + vec3<f32>(1.0, 0.9, 1.0) * rim * 0.4;
  } else {
    // Skin (with leotard + stockings overlay).
    let skinBase = vec3<f32>(1.0, 0.88, 0.82);
    col = skinBase * cel(lam);

    // Soft cheek blush near face.
    let cheekL = exp(-length(p - vec3<f32>(-0.24, 2.14, 0.38)) * 11.0);
    let cheekR = exp(-length(p - vec3<f32>( 0.24, 2.14, 0.38)) * 11.0);
    col = mix(col, vec3<f32>(1.0, 0.6, 0.72), (cheekL + cheekR) * 0.7);

    // Mouth — pink ellipse painted on face front.
    let mdx = p.x;
    let mdy = p.y - 2.08;
    let mEllipse = (mdx * mdx) / (0.05 * 0.05) + (mdy * mdy) / (0.014 * 0.014);
    let mouthMask = (1.0 - smoothstep(0.7, 1.1, mEllipse)) * step(0.3, p.z);
    col = mix(col, vec3<f32>(0.92, 0.38, 0.5), mouthMask);

    // Eyebrows — two short arcs above each eye.
    let browFront = step(0.32, p.z);
    let bx = abs(p.x);
    let browXMask = step(0.07, bx) * step(bx, 0.23);
    let browYCenter = 2.43 - (bx - 0.07) * 0.35;
    let browDY = abs(p.y - browYCenter);
    let browMask = (1.0 - smoothstep(0.008, 0.018, browDY)) * browXMask * browFront;
    col = mix(col, vec3<f32>(0.45, 0.2, 0.3), browMask);

    // Black leotard: chest band + crotch wrap within torso radius.
    let xz = length(vec2<f32>(p.x, p.z));
    let chestBand  = step(1.15, p.y) * step(p.y, 1.58) * step(xz, 0.42);
    let crotchBand = step(0.3,  p.y) * step(p.y, 0.78) * step(xz, 0.45);
    let suit       = max(chestBand, crotchBand);
    let suitCol    = vec3<f32>(0.05, 0.04, 0.08) * (0.4 + 0.6 * lam);
    col = mix(col, suitCol, suit);

    // Stockings: lower legs (-0.95 < y < 0), away from centerline.
    let isLeg       = step(0.08, abs(p.x)) * step(p.y, 0.0) * step(-1.0, p.y);
    let stockingCol = vec3<f32>(0.08, 0.06, 0.12) * (0.4 + 0.6 * lam);
    col = mix(col, stockingCol, isLeg);
  }

  // Anime silhouette outline.
  col = mix(col, vec3<f32>(0.05, 0.02, 0.08), pow(1.0 - max(dot(n, -rd), 0.0), 8.0));

  return vec4<f32>(col, 1.0);
}
`;

export const MINECRAFT_PLANET = /* wgsl */ `// Minecraft planet — true voxel DDA inside a sphere bound + ray-box clouds.
// Cubes render with sharp axis-aligned faces. Drag mouse to orbit.

fn rotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a); let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
fn hash13(p: vec3<f32>) -> f32 {
  let h = dot(p, vec3<f32>(127.1, 311.7, 74.7));
  return fract(sin(h) * 43758.5453);
}

// Ray vs sphere centered at origin. Returns (t_near, t_far) or (-1, -1).
fn raySphere(ro: vec3<f32>, rd: vec3<f32>, R: f32) -> vec2<f32> {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - R * R;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2<f32>(-1.0, -1.0); }
  let sq = sqrt(disc);
  return vec2<f32>(-b - sq, -b + sq);
}

// Ray vs axis-aligned cube. Returns (t_near, t_far) or (-1, -1).
fn rayBox(ro: vec3<f32>, rd: vec3<f32>, c: vec3<f32>, halfSize: vec3<f32>) -> vec2<f32> {
  let oc = c - ro;
  let invD = vec3<f32>(1.0) / rd;
  let tN_ = (oc - halfSize) * invD;
  let tF_ = (oc + halfSize) * invD;
  let t1 = min(tN_, tF_);
  let t2 = max(tN_, tF_);
  let tN = max(max(t1.x, t1.y), t1.z);
  let tF = min(min(t2.x, t2.y), t2.z);
  if (tN > tF || tF < 0.0) { return vec2<f32>(-1.0, -1.0); }
  return vec2<f32>(tN, tF);
}

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (frag.xy - 0.5 * u.resolution) / (u.resolution.y * u.zoom);

  let yaw   = u.time * 0.15 + (u.mouse.x - 0.5) * 4.0;
  let pitch = 0.25 + (u.mouse.y - 0.5) * 0.8;
  let camDist = 4.5;
  var ro = vec3<f32>(0.0, 0.0, -camDist);
  ro = vec3<f32>(ro.x, ro.y * cos(pitch) - ro.z * sin(pitch), ro.y * sin(pitch) + ro.z * cos(pitch));
  ro = rotY(ro, yaw);
  let lookAt = vec3<f32>(0.0, 0.0, 0.0);
  let ww = normalize(lookAt - ro);
  let uu = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), ww));
  let vv = cross(ww, uu);
  let rd = normalize(uv.x * uu - uv.y * vv + 1.8 * ww);

  // Starfield background.
  let starUV = uv * 80.0;
  let starCell = floor(starUV);
  let starP = hash13(vec3<f32>(starCell.x, starCell.y, 0.0));
  let twinkle = 0.5 + 0.5 * sin(u.time * 3.0 + starP * 23.0);
  var bg = vec3<f32>(0.02, 0.01, 0.06) + vec3<f32>(1.0) * step(0.975, starP) * twinkle;

  let sunDir = normalize(vec3<f32>(0.6, 0.7, -0.5));
  let R_PLANET: f32 = 1.3;
  let CELL: f32 = 0.13;

  // ---- Planet voxel DDA: walk cell-by-cell, hit when cell center is inside sphere ----
  let sph = raySphere(ro, rd, R_PLANET);
  var planetT: f32 = -1.0;
  var planetCell = vec3<f32>(0.0);
  var planetFace = vec3<f32>(0.0);
  if (sph.y >= 0.0) {
    let tEntry = max(sph.x, 0.0);
    let pEnt = ro + rd * (tEntry + 0.0001);
    var cell = floor(pEnt / CELL);

    let step3 = sign(rd);
    let safeRd = rd + step3 * 1e-8;
    let tDelta = abs(vec3<f32>(CELL) / safeRd);
    let nextBoundary = (cell + max(step3, vec3<f32>(0.0))) * CELL;
    var tMax = (nextBoundary - ro) / safeRd;

    // Initial face: sphere normal at entry, snapped to dominant axis.
    let aN = abs(pEnt);
    var face = vec3<f32>(0.0, 0.0, sign(pEnt.z));
    if (aN.x > aN.y && aN.x > aN.z) { face = vec3<f32>(sign(pEnt.x), 0.0, 0.0); }
    else if (aN.y > aN.z)            { face = vec3<f32>(0.0, sign(pEnt.y), 0.0); }

    var curT = tEntry;
    for (var i: u32 = 0u; i < 64u; i = i + 1u) {
      let cellCenter = (cell + 0.5) * CELL;
      if (length(cellCenter) < R_PLANET) {
        planetT = curT;
        planetCell = cell;
        planetFace = face;
        break;
      }
      if (tMax.x <= tMax.y && tMax.x <= tMax.z) {
        curT = tMax.x;
        cell.x = cell.x + step3.x;
        tMax.x = tMax.x + tDelta.x;
        face = vec3<f32>(-step3.x, 0.0, 0.0);
      } else if (tMax.y <= tMax.z) {
        curT = tMax.y;
        cell.y = cell.y + step3.y;
        tMax.y = tMax.y + tDelta.y;
        face = vec3<f32>(0.0, -step3.y, 0.0);
      } else {
        curT = tMax.z;
        cell.z = cell.z + step3.z;
        tMax.z = tMax.z + tDelta.z;
        face = vec3<f32>(0.0, 0.0, -step3.z);
      }
      if (curT > sph.y + 0.1) { break; }
    }
  }

  // ---- Cloud cubes: ray-box per cube, keep nearest ----
  var cloudT: f32 = 1e9;
  var cloudFace = vec3<f32>(0.0);
  for (var i: u32 = 0u; i < 7u; i = i + 1u) {
    let s = f32(i) * 1.7;
    let theta = s * 2.0 + u.time * 0.18;
    let phi   = sin(s) * 0.8;
    let r     = 1.95 + fract(s * 1.31) * 0.3;
    let cp = vec3<f32>(cos(theta) * cos(phi) * r, sin(phi) * r, sin(theta) * cos(phi) * r);
    let box = rayBox(ro, rd, cp, vec3<f32>(0.12));
    if (box.x >= 0.0 && box.x < cloudT) {
      cloudT = box.x;
      let hitP = ro + rd * box.x - cp;
      let absH = abs(hitP);
      if (absH.x > absH.y && absH.x > absH.z)      { cloudFace = vec3<f32>(sign(hitP.x), 0.0, 0.0); }
      else if (absH.y > absH.z)                     { cloudFace = vec3<f32>(0.0, sign(hitP.y), 0.0); }
      else                                          { cloudFace = vec3<f32>(0.0, 0.0, sign(hitP.z)); }
    }
  }

  let planetHit = planetT >= 0.0;
  let cloudHit  = cloudT < 1e8;
  if (!planetHit && !cloudHit) { return vec4<f32>(bg, 1.0); }

  var n: vec3<f32>;
  var col = vec3<f32>(0.0);
  if (planetHit && (!cloudHit || planetT < cloudT)) {
    n = planetFace;
    let cellCenter = (planetCell + 0.5) * CELL;
    let h = hash13(planetCell + 0.3);
    let by = cellCenter.y;
    var blockCol = vec3<f32>(0.0);
    if (by > 0.9) {
      blockCol = mix(vec3<f32>(0.92, 0.95, 1.0), vec3<f32>(0.78, 0.82, 0.88), h); // snow
    } else if (by > 0.55) {
      blockCol = mix(vec3<f32>(0.55, 0.62, 0.45), vec3<f32>(0.4, 0.55, 0.28), h); // tundra
    } else if (by > 0.05) {
      if (n.y > 0.5) {
        blockCol = mix(vec3<f32>(0.3, 0.55, 0.18), vec3<f32>(0.45, 0.7, 0.25), h); // grass
      } else {
        blockCol = mix(vec3<f32>(0.42, 0.28, 0.16), vec3<f32>(0.55, 0.36, 0.22), h); // dirt
      }
    } else if (by > -0.55) {
      if (h > 0.6) {
        blockCol = mix(vec3<f32>(0.95, 0.85, 0.55), vec3<f32>(0.85, 0.75, 0.45), h); // sand
      } else {
        blockCol = mix(vec3<f32>(0.1, 0.3, 0.6), vec3<f32>(0.15, 0.5, 0.78), h); // water
      }
    } else {
      blockCol = mix(vec3<f32>(0.35, 0.35, 0.4), vec3<f32>(0.5, 0.5, 0.55), h); // stone
    }
    let lam = max(dot(n, sunDir), 0.0);
    col = blockCol * (lam * 0.85 + 0.25);
  } else {
    n = cloudFace;
    let lam = max(dot(n, sunDir), 0.0);
    col = vec3<f32>(0.96, 0.97, 1.0) * (lam * 0.7 + 0.4);
  }

  return vec4<f32>(col, 1.0);
}
`;

// Default shown to a brand-new room.
export const DEFAULT_WGSL = COSINE_RAINBOW;

export interface Preset {
  id: string;
  label: string;
  source: string;
}

// Order matters — first entry is the implicit default in the dropdown.
export const PRESETS: readonly Preset[] = [
  { id: 'cosine-rainbow', label: 'Cosine rainbow', source: COSINE_RAINBOW },
  { id: 'plasma', label: 'Plasma', source: PLASMA },
  { id: 'mandelbrot', label: 'Mandelbrot zoom', source: MANDELBROT },
  { id: 'tunnel', label: 'Polar tunnel', source: TUNNEL },
  { id: 'voronoi', label: 'Voronoi cells', source: VORONOI },
  { id: 'cyberpunk-avatar', label: 'Cyberpunk avatar', source: CYBERPUNK_AVATAR },
  { id: 'anime-waifu', label: 'Anime waifu', source: ANIME_WAIFU },
  { id: 'minecraft-planet', label: 'Minecraft planet', source: MINECRAFT_PLANET },
  { id: 'neon-grid', label: 'Tron horizon', source: NEON_GRID },
  { id: 'black-hole', label: 'Black hole', source: BLACK_HOLE },
  { id: 'crt-glitch', label: 'CRT glitch', source: CRT_GLITCH },
  { id: 'starfield', label: 'Hyperspace', source: STARFIELD },
] as const;
