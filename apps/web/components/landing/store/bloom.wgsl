struct Bloom {
  texel: vec2f,
  light: vec2f,
  spread: f32,
  gain: f32,
  exposure: f32,
  grain: f32,
  scatter: f32,
  halo: f32,
  frame: f32,
  dispersion: f32,
}

@group(0) @binding(0) var<uniform> bloom: Bloom;
@group(0) @binding(1) var sceneTexture: texture_2d<f32>;
@group(0) @binding(2) var sceneSampler: sampler;

const TAPS = 32u;
const RAY_STEPS = 256;
const GOLDEN = 2.39996323;
const LUMA = vec3f(0.2126, 0.7152, 0.0722);

fn resolve(radiance: vec3f) -> vec3f {
  return max(vec3f(0.0), vec3f(1.0) - exp(-radiance));
}

fn hash12(point: vec2f) -> f32 {
  var seed = fract(vec3f(point.xyx) * 0.1031);
  seed += dot(seed, seed.yzx + 33.33);
  return fract((seed.x + seed.y) * seed.z);
}

fn scene_at(uv: vec2f) -> vec3f {
  return textureSample(sceneTexture, sceneSampler, clamp(uv, vec2f(0.0), vec2f(1.0))).rgb;
}

fn radiance_at(uv: vec2f, scale: f32) -> vec3f {
  var pooled = vec3f(0.0);
  var weight = 0.0;
  for (var tap = 0u; tap < TAPS; tap++) {
    let angle = f32(tap) * GOLDEN;
    let radius = sqrt(f32(tap) + 0.5) / sqrt(f32(TAPS));
    let falloff = exp(-radius * radius * 2.4);
    pooled += scene_at(uv + vec2f(cos(angle), sin(angle)) * radius * scale * bloom.texel) * falloff;
    weight += falloff;
  }
  return pooled / max(weight, 0.001);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let base = textureSample(sceneTexture, sceneSampler, uv);
  let aspect = vec2f(bloom.texel.y / max(bloom.texel.x, 1e-6), 1.0);

  let near = radiance_at(uv, bloom.spread * 0.35);
  let far = radiance_at(uv, bloom.spread);
  let radiance = near * 0.34 + far * 1.05;

  let toLight = uv - bloom.light;
  let step = toLight / f32(RAY_STEPS) * 1.4;
  let jitter = fract(hash12(uv / max(bloom.texel.x, 1e-6)) + bloom.frame * 0.618034);
  let sideways = vec2f(-step.y, step.x);
  var coordinate = uv - step * jitter;
  var illumination = 1.0;
  var weight = 0.0;
  var rays = vec3f(0.0);
  for (var index = 0; index < RAY_STEPS; index++) {
    coordinate -= step;
    let feather = (fract(jitter + f32(index) * 0.381966) - 0.5) * 2.4;
    let sampled = scene_at(coordinate + sideways * feather);
    let phase = f32(index) / f32(RAY_STEPS);
    let split = vec3f(phase, 0.5, 1.0 - phase) * 2.0 - 1.0;
    let prism = vec3f(1.0) + split * bloom.dispersion;
    rays += max(sampled - vec3f(0.06), vec3f(0.0)) * illumination * prism;
    weight += illumination;
    illumination *= 0.977;
  }
  rays /= max(weight, 0.001);

  let offset = toLight * aspect;
  let halo = exp(-dot(offset, offset) / (bloom.halo * bloom.halo));
  let flare = radiance * bloom.gain + rays * bloom.scatter * (0.6 + halo * 0.7) + radiance * halo * 0.4;

  let centered = uv - vec2f(0.5);
  let envelope = smoothstep(0.6, 0.12, length(centered * aspect));
  let glow = resolve(flare * envelope);
  let grain = (hash12(uv * 311.7 + bloom.frame) - 0.5) * bloom.grain;
  let glowAlpha = clamp(dot(glow, LUMA) * bloom.exposure + grain, 0.0, 1.0);

  let color = base.rgb + glow * glowAlpha * (1.0 - base.a);
  let alpha = clamp(base.a + glowAlpha * (1.0 - base.a), 0.0, 1.0);
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), alpha);
}
