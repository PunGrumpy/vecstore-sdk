struct Scene {
  viewProj: mat4x4f,
  ink: vec4f,
  params: vec4f,
  camera: vec4f,
  lights: array<vec4f, 16>,
  colors: array<vec4f, 16>,
}

@group(0) @binding(0) var<uniform> scene: Scene;

struct Surface {
  @builtin(position) clip: vec4f,
  @location(0) normal: vec3f,
  @location(1) emissive: vec4f,
  @location(2) fade: f32,
  @location(3) world: vec3f,
  @location(4) local: vec2f,
}

@vertex fn vs_main(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) origin: vec4f,
  @location(3) emissive: vec4f,
) -> Surface {
  var out: Surface;
  let world = position + origin.xyz;
  out.clip = scene.viewProj * vec4f(world, 1.0);
  out.normal = normal;
  out.emissive = emissive;
  out.fade = origin.w;
  out.world = world;
  out.local = position.xy;
  return out;
}

fn rounded_square(point: vec2f) -> f32 {
  let corner = abs(point) - vec2f(0.36);
  return length(max(corner, vec2f(0.0))) + min(max(corner.x, corner.y), 0.0) - 0.14;
}

@fragment fn fs_main(surface: Surface) -> @location(0) vec4f {
  let raw = normalize(surface.normal);
  let view = normalize(scene.camera.xyz - surface.world);
  let normal = select(-raw, raw, dot(raw, view) >= 0.0);
  let facing = clamp(dot(normal, view), 0.0, 1.0);
  let fresnel = pow(1.0 - facing, 4.0);
  let key = normalize(vec3f(-0.4, 0.75, 0.9));
  let specular = pow(max(dot(normal, normalize(view + key)), 0.0), 120.0);
  let rim = pow(1.0 - abs(raw.z), 2.4);
  let lit = surface.emissive.a;

  var bounce = vec3f(0.0);
  let count = u32(scene.params.x);
  for (var index = 0u; index < count; index++) {
    let light = scene.lights[index];
    let toLight = light.xyz - surface.world;
    let distance = length(toLight);
    let lambert = max(dot(normal, toLight / max(distance, 0.001)), 0.0);
    bounce += scene.colors[index].rgb * lambert * light.w / (1.0 + distance * distance * 1.5);
  }
  bounce *= scene.params.y;

  let glass = scene.ink.rgb * (0.4 + 0.75 * fresnel) + vec3f(specular * scene.camera.w);
  let shell = glass + bounce;
  let sheen = mix(0.74, 1.0, abs(normal.z));
  let core = surface.emissive.rgb * scene.params.z * (1.0 + 0.35 * rim) * sheen;
  let edge = rounded_square(surface.local);
  let band = smoothstep(-0.075, -0.02, edge);
  let cap = abs(normal.z) > 0.5;
  let outline = select(1.0, band, cap);
  let softness = select(1.0, smoothstep(0.0, -0.17, edge), cap);
  let color = mix(shell, core * mix(0.38, 1.0, softness), lit);
  let glow = clamp(max(max(bounce.r, bounce.g), bounce.b), 0.0, 1.0);
  let pane = scene.ink.a * (0.06 + 0.5 * fresnel + specular * 0.9 + 0.35 * glow);
  let shellAlpha = max(scene.ink.a * (0.5 + 0.4 * rim + 0.6 * glow) * outline, pane);
  let alpha = mix(shellAlpha, mix(0.55, 1.0, softness), lit) * surface.fade;
  return vec4f(color * alpha, alpha);
}
