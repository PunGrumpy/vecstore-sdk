struct Glow {
  resolution: vec2f,
  count: f32,
  gain: f32,
  lights: array<vec4f, 16>,
  colors: array<vec4f, 16>,
}

@group(0) @binding(0) var<uniform> glow: Glow;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = glow.resolution.x / max(glow.resolution.y, 1.0);
  let point = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
  var pooled = vec3f(0.0);
  let count = u32(glow.count);
  for (var index = 0u; index < count; index++) {
    let light = glow.lights[index];
    let spacing = length(point - light.xy);
    let reach = max(light.z, 0.001);
    let hollow = smoothstep(0.0, reach * 0.85, spacing);
    pooled += glow.colors[index].rgb * light.w * hollow / (1.0 + pow(spacing / reach, 2.8));
  }
  let vignette = smoothstep(0.5, 0.1, length(point));
  let energy = pooled * glow.gain * vignette;
  let alpha = clamp(max(max(energy.r, energy.g), energy.b), 0.0, 1.0);
  return vec4f(energy, alpha);
}
