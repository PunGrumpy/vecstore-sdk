struct Params {
  time: f32,
  opacity: f32,
  pitch: f32,
  pulseAge: f32,
  pointer: vec2f,
  pulse: vec2f,
  resolution: vec2f,
  pad: vec2f,
  ink: vec3f,
}

@group(0) @binding(0) var<uniform> params: Params;

fn hash2(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2(i);
  let b = hash2(i + vec2f(1.0, 0.0));
  let c = hash2(i + vec2f(0.0, 1.0));
  let d = hash2(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let px = uv * params.resolution;
  let cell = floor(px / params.pitch);
  let center = (cell + 0.5) * params.pitch;

  let query = (params.pointer * vec2f(0.5, -0.5) + 0.5) * params.resolution;
  let toQuery = query - center;
  let dist = length(toQuery);
  let pull = exp(-dist * dist / (2.0 * 200.0 * 200.0));

  let pulseCenter = (params.pulse * vec2f(0.5, -0.5) + 0.5) * params.resolution;
  let fromPulse = center - pulseCenter;
  let pulseDist = length(fromPulse);
  let ringRadius = params.pulseAge * 520.0;
  let ring = exp(-pow((pulseDist - ringRadius) / 70.0, 2.0)) * max(0.0, 1.0 - params.pulseAge * 0.8);

  let drift = noise2(cell * 0.16 + vec2f(params.time * 0.045, params.time * 0.02)) * 6.2831853;
  let flowDir = vec2f(cos(drift), sin(drift));
  let queryDir = normalize(toQuery + vec2f(0.0001, 0.0));
  let pulseDir = normalize(fromPulse + vec2f(0.0001, 0.0));
  var dir = normalize(mix(flowDir, queryDir, pull));
  dir = normalize(mix(dir, pulseDir, ring));

  let emphasis = max(pull, ring);
  let len = params.pitch * (0.14 + 0.2 * emphasis);
  let a = center - dir * len;
  let b = center + dir * len;
  let d = segment(px, a, b);
  let line = 1.0 - smoothstep(0.5, 1.3, d);
  let head = 1.0 - smoothstep(1.0, 2.4, length(px - b));

  let alpha = (line * 0.7 + head) * (0.14 + 0.86 * emphasis) * params.opacity;
  return vec4f(params.ink * alpha, alpha);
}
