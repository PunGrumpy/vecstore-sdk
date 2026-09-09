struct Params {
  time: f32,
  aspect: f32,
  opacity: f32,
  pad: f32,
  pointer: vec2f,
  ink: vec3f,
}

@group(0) @binding(0) var<uniform> params: Params;

struct Out {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) glow: f32,
  @location(2) depth: f32,
}

fn hash(n: u32) -> f32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}

@vertex fn vs_main(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let u = hash(i * 3u);
  let w = hash(i * 3u + 1u);
  let r = hash(i * 3u + 2u);
  let theta = 6.2831853 * u;
  let z = 2.0 * w - 1.0;
  let s = sqrt(max(0.0, 1.0 - z * z));
  var p = vec3f(s * cos(theta), s * sin(theta), z) * (0.45 + 0.55 * sqrt(r));

  let a = params.time * 0.08;
  let c = cos(a);
  let sn = sin(a);
  p = vec3f(c * p.x + sn * p.z, p.y, -sn * p.x + c * p.z);

  let query = normalize(vec3f(params.pointer.x, params.pointer.y, 0.7));
  let similarity = dot(normalize(p), query);
  let glow = smoothstep(0.9, 0.995, similarity);

  let depth = 1.0 / (2.4 - p.z);
  let size = (0.0035 + 0.009 * glow) * depth * 2.4;
  let center = vec2f(p.x * 1.7, p.y * 1.05) * depth * 1.6;

  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let corner = corners[v];

  var out: Out;
  out.pos = vec4f(center.x + corner.x * size / params.aspect, center.y + corner.y * size, 0.0, 1.0);
  out.local = corner;
  out.glow = glow;
  out.depth = depth;
  return out;
}

@fragment fn fs_main(@location(0) local: vec2f, @location(1) glow: f32, @location(2) depth: f32) -> @location(0) vec4f {
  let d = length(local);
  let disc = 1.0 - smoothstep(0.7, 1.0, d);
  let halo = (1.0 - smoothstep(0.2, 1.0, d)) * glow * 0.5;
  let strength = (0.3 + 0.7 * glow) * clamp(depth * 1.6 - 0.4, 0.0, 1.0);
  let alpha = (disc + halo) * strength * params.opacity;
  return vec4f(params.ink * alpha, alpha);
}
