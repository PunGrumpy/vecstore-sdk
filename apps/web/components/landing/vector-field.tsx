"use client";

import { useEffect, useRef, useState } from "react";
import { clock, draw, frameLoop, init, surface } from "vgpu";

import shader from "./vector-field.wgsl";

const POINTS = 700;
const LIGHT_OPACITY = 0.7;
const DARK_OPACITY = 0.8;
const POINTER_EASE = 0.06;
const ORBIT_X = 0.55;
const ORBIT_Y = 0.35;
const LIGHT_INK = [0.09, 0.09, 0.09] as const;
const DARK_INK = [0.93, 0.93, 0.93] as const;

const isDark = () => document.documentElement.classList.contains("dark");
const readInk = () => (isDark() ? DARK_INK : LIGHT_INK);
const readOpacity = () => (isDark() ? DARK_OPACITY : LIGHT_OPACITY);

export const VectorField = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!(canvas && "gpu" in navigator)) {
      setSupported(false);
      return;
    }
    let disposed = false;
    let stop: (() => void) | undefined;
    const pointer = { target: { x: 0, y: 0 }, tracking: false, x: 0, y: 0 };
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.target = {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: 1 - ((event.clientY - rect.top) / rect.height) * 2,
      };
      pointer.tracking = true;
    };
    const onPointerLeave = () => {
      pointer.tracking = false;
    };

    const run = async () => {
      const gpu = await init();
      if (disposed) {
        gpu.dispose();
        return;
      }
      const target = surface(gpu, canvas, {
        alphaMode: "premultiplied",
        clearColor: [0, 0, 0, 0],
        dpr: [1, 2],
      });
      const points = draw(gpu, {
        blend: "alpha",
        instances: POINTS,
        set: {
          params: {
            aspect: 1,
            ink: [...readInk()],
            opacity: 1,
            pad: 0,
            pointer: [0, 0],
            time: 0,
          },
        },
        shader,
        vertices: 6,
      });
      const time = clock(gpu);
      const loop = frameLoop(gpu, (frame) => {
        const elapsed = reduceMotion ? 0 : time.time;
        if (!pointer.tracking) {
          pointer.target = {
            x: Math.sin(elapsed * 0.25) * ORBIT_X,
            y: Math.cos(elapsed * 0.18) * ORBIT_Y,
          };
        }
        pointer.x += (pointer.target.x - pointer.x) * POINTER_EASE;
        pointer.y += (pointer.target.y - pointer.y) * POINTER_EASE;
        points.set({
          params: {
            aspect: canvas.width / Math.max(canvas.height, 1),
            ink: [...readInk()],
            opacity: readOpacity(),
            pointer: [pointer.x, pointer.y],
            time: elapsed,
          },
        });
        frame.pass(target, points);
      });
      stop = () => {
        loop.stop();
        gpu.dispose();
      };
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);
    const start = async () => {
      try {
        await run();
      } catch {
        setSupported(false);
      }
    };
    start();

    return () => {
      disposed = true;
      stop?.();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  if (!supported) {
    return null;
  }

  return (
    <canvas
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] w-full [mask-image:radial-gradient(ellipse_80%_70%_at_50%_40%,black_30%,transparent_100%)]"
      ref={canvasRef}
    />
  );
};
