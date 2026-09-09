"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Draw, Effect, FramePass } from "vgpu";
import {
  draw,
  effect,
  frameLoop,
  geometry,
  init,
  sampler,
  surface,
  target,
} from "vgpu";

import bloomShader from "./bloom.wgsl";
import glowShader from "./glow.wgsl";
import {
  cameraPosition,
  cellMesh,
  modelDepth,
  project,
  viewProjection,
} from "./mesh";
import { CELLS, isLit, LAYER_FADE, LAYERS, SPECTRUM } from "./query";
import type { StoreQuery } from "./query";
import sceneShader from "./scene.wgsl";

const PITCH = 1.16;
const LAYER_STEP = 0.85;
const INSTANCE_FLOATS = 8;
const SLOTS = LAYERS.length * CELLS.length;
const MAX_LIGHTS = 16;
const SHELL_TOKEN = "--color-gray-500";
const CORE_TOKEN = "--color-gray-1000";
const SHELL_ALPHA = 0.85;
const BLOOM_SPREAD = 62;
const BLOOM_GRAIN = 0.012;
const FLARE_SCATTER = 0.62;
const FLARE_HALO = 0.24;
const DARK_GLOW = 0.09;
const LIGHT_GLOW = 0.07;
const DARK_EXPOSURE = 0.72;
const LIGHT_EXPOSURE = 0.4;
const EMISSIVE_DARK = 5.5;
const EMISSIVE_LIGHT = 1.05;
const BOUNCE_GAIN = 0.55;
const SPECULAR = 0.9;
const LIGHT_REACH = 0.17;
const POOL_DARK = 0.34;
const POOL_LIGHT = 0.12;

interface StoreCanvasProps {
  readonly queryRef: RefObject<StoreQuery>;
  readonly spectrum: boolean;
}

const originOf = (slot: number) => {
  const cell = slot % CELLS.length;
  return [
    ((cell % 3) - 1) * PITCH,
    (1 - Math.floor(cell / 3)) * PITCH,
    LAYERS[Math.floor(slot / CELLS.length)] * LAYER_STEP,
  ];
};

const depthOf = (slot: number, query: StoreQuery) => {
  const [x, y, z] = originOf(slot);
  return modelDepth(x, y, z, query.tiltX, query.tiltY);
};

const byDepth = (query: StoreQuery) => (left: number, right: number) =>
  depthOf(left, query) - depthOf(right, query);

const stageBody = (pool: Effect, cubes: Draw) => (pass: FramePass) => {
  pass.draw(pool);
  pass.draw(cubes);
};

const themeOf = (dark: boolean) => ({
  bounce: dark ? BOUNCE_GAIN : BOUNCE_GAIN * 0.5,
  emissive: dark ? EMISSIVE_DARK : EMISSIVE_LIGHT,
  exposure: dark ? DARK_EXPOSURE : LIGHT_EXPOSURE,
  glow: dark ? DARK_GLOW : LIGHT_GLOW,
  pool: dark ? POOL_DARK : POOL_LIGHT,
  scatter: dark ? FLARE_SCATTER : FLARE_SCATTER * 0.35,
});

const readPalette = (probe: CanvasRenderingContext2D) => {
  const styles = getComputedStyle(document.documentElement);
  const parse = (token: string) => {
    probe.fillStyle = styles.getPropertyValue(token).trim() || "#888888";
    probe.fillRect(0, 0, 1, 1);
    const [red, green, blue] = probe.getImageData(0, 0, 1, 1).data;
    return [red / 255, green / 255, blue / 255];
  };
  return {
    core: parse(CORE_TOKEN),
    dark: document.documentElement.classList.contains("dark"),
    hues: SPECTRUM.map(parse),
    shell: parse(SHELL_TOKEN),
  };
};

export const StoreCanvas = ({ queryRef, spectrum }: StoreCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumRef = useRef(spectrum);

  useEffect(() => {
    spectrumRef.current = spectrum;
  }, [spectrum]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const probe = document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true });
    if (!(canvas && probe && "gpu" in navigator)) {
      return;
    }
    let disposed = false;
    let stop: (() => void) | undefined;
    let palette = readPalette(probe);
    const observer = new MutationObserver(() => {
      palette = readPalette(probe);
    });
    observer.observe(document.documentElement, { attributeFilter: ["class"] });

    const run = async () => {
      const gpu = await init();
      if (disposed) {
        gpu.dispose();
        return;
      }
      const view = surface(gpu, canvas, {
        alphaMode: "premultiplied",
        clearColor: [0, 0, 0, 0],
        dpr: [1, 2],
      });
      const stage = target(gpu, {
        format: "rgba16float",
        msaa: true,
        size: view.size,
      });
      const mesh = cellMesh();
      const instances = new Float32Array(SLOTS * INSTANCE_FLOATS);
      const modelLights = Array.from({ length: MAX_LIGHTS }, () => [
        0, 0, 0, 0,
      ]);
      const screenLights = Array.from({ length: MAX_LIGHTS }, () => [
        0, 0, 0, 0,
      ]);
      const colors = Array.from({ length: MAX_LIGHTS }, () => [0, 0, 0, 0]);
      const cellGeometry = geometry(gpu, {
        buffers: [
          {
            attributes: {
              normal: { format: "float32x3", offset: 12 },
              position: { format: "float32x3", offset: 0 },
            },
            data: mesh.vertices,
            stride: 24,
          },
          {
            attributes: {
              emissive: { format: "float32x4", offset: 16 },
              origin: { format: "float32x4", offset: 0 },
            },
            data: instances,
            stepMode: "instance",
            stride: 32,
          },
        ],
        indices: mesh.indices,
      });
      const pool = effect(gpu, glowShader, {
        blend: "premultiplied",
        set: {
          glow: {
            colors,
            count: 0,
            gain: POOL_DARK,
            lights: screenLights,
            resolution: [1, 1],
          },
        },
      });
      const cubes = draw(gpu, {
        blend: "premultiplied",
        cull: "back",
        geometry: cellGeometry,
        instances: SLOTS,
        set: {
          scene: {
            camera: [...cameraPosition(0, 0), SPECULAR],
            colors,
            ink: [...palette.shell, SHELL_ALPHA],
            lights: modelLights,
            params: [0, BOUNCE_GAIN, EMISSIVE_DARK, 0],
            viewProj: viewProjection(1, 0, 0),
          },
        },
        shader: sceneShader,
      });
      const composite = effect(gpu, bloomShader, {
        blend: "premultiplied",
        set: {
          bloom: {
            exposure: DARK_EXPOSURE,
            frame: 0,
            gain: DARK_GLOW,
            grain: BLOOM_GRAIN,
            halo: FLARE_HALO,
            light: [0.5, 0.5],
            pad: 0,
            scatter: FLARE_SCATTER,
            spread: BLOOM_SPREAD,
            texel: [1, 1],
          },
          sceneSampler: sampler(gpu, {
            magFilter: "linear",
            minFilter: "linear",
          }),
          sceneTexture: stage.color,
        },
      });

      const order = [...Array.from({ length: SLOTS }).keys()];
      let frameIndex = 0;
      const stage3d = stageBody(pool, cubes);
      const loop = frameLoop(gpu, (frame) => {
        const query = queryRef.current;
        const [width, height] = view.size;
        if (stage.size[0] !== width || stage.size[1] !== height) {
          stage.resize([width, height]);
        }
        const aspect = width / Math.max(height, 1);
        const matrix = viewProjection(aspect, query.tiltX, query.tiltY);
        const hues = spectrumRef.current ? palette.hues : undefined;
        const tone = themeOf(palette.dark);
        order.sort(byDepth(query));

        let count = 0;
        let centreU = 0;
        let centreV = 0;
        for (const slot of modelLights) {
          slot.fill(0);
        }
        for (const slot of screenLights) {
          slot.fill(0);
        }
        for (const slot of colors) {
          slot.fill(0);
        }
        for (const [position, slot] of order.entries()) {
          const layer = Math.floor(slot / CELLS.length);
          const cell = slot % CELLS.length;
          const lit = isLit(query, layer, cell);
          const [red, green, blue] = palette.core;
          const [tintRed, tintGreen, tintBlue] = hues?.[cell] ?? palette.core;
          const [x, y, z] = originOf(slot);
          const base = position * INSTANCE_FLOATS;
          instances[base] = x;
          instances[base + 1] = y;
          instances[base + 2] = z;
          instances[base + 3] = LAYER_FADE[layer];
          instances[base + 4] = red;
          instances[base + 5] = green;
          instances[base + 6] = blue;
          instances[base + 7] = lit ? 1 : 0;
          if (lit && count < MAX_LIGHTS) {
            const screen = project(matrix, x, y, z);
            screenLights[count][0] = screen.x * 0.5 * aspect;
            screenLights[count][1] = -screen.y * 0.5;
            screenLights[count][2] = LIGHT_REACH;
            screenLights[count][3] = LAYER_FADE[layer];
            centreU += screen.x * 0.5 + 0.5;
            centreV += 0.5 - screen.y * 0.5;
            modelLights[count][0] = x;
            modelLights[count][1] = y;
            modelLights[count][2] = z;
            modelLights[count][3] = LAYER_FADE[layer];
            colors[count][0] = tintRed;
            colors[count][1] = tintGreen;
            colors[count][2] = tintBlue;
            count += 1;
          }
        }
        cellGeometry.buffers[1].write(instances);
        frameIndex = (frameIndex + 1) % 64;
        const lightU = count > 0 ? centreU / count : 0.5;
        const lightV = count > 0 ? centreV / count : 0.5;

        pool.set({
          glow: {
            colors,
            count,
            gain: tone.pool,
            lights: screenLights,
            resolution: [width, height],
          },
        });
        cubes.set({
          scene: {
            camera: [...cameraPosition(query.tiltX, query.tiltY), SPECULAR],
            colors,
            ink: [...palette.shell, SHELL_ALPHA],
            lights: modelLights,
            params: [count, tone.bounce, tone.emissive, 0],
            viewProj: matrix,
          },
        });
        composite.set({
          bloom: {
            exposure: tone.exposure,
            frame: frameIndex,
            gain: tone.glow,
            grain: BLOOM_GRAIN,
            halo: FLARE_HALO,
            light: [lightU, lightV],
            pad: 0,
            scatter: tone.scatter,
            spread: BLOOM_SPREAD,
            texel: [1 / width, 1 / height],
          },
          sceneTexture: stage.color,
        });
        frame.pass({ clear: [0, 0, 0, 0], target: stage }, stage3d);
        frame.pass(view, composite);
      });

      stop = () => {
        loop.stop();
        gpu.dispose();
      };
    };

    const start = async () => {
      try {
        await run();
      } catch {
        stop?.();
      }
    };
    start();

    return () => {
      disposed = true;
      observer.disconnect();
      stop?.();
    };
  }, [queryRef]);

  return <canvas className="absolute inset-0 size-full" ref={canvasRef} />;
};
