"use client";

import { useEffect, useRef, useState } from "react";
import { clock, effect, frameLoop, init, surface } from "vgpu";

import shader from "./vector-field.wgsl";

const POINTER_EASE = 0.08;
const ORBIT_X = 0.55;
const ORBIT_Y = 0.3;
const PULSE_SECONDS = 1.4;
const LIGHT_INK = [0.09, 0.09, 0.09] as const;
const DARK_INK = [0.93, 0.93, 0.93] as const;

const isDark = () => document.documentElement.classList.contains("dark");

const toClip = (
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: 1 - ((clientY - rect.top) / rect.height) * 2,
  };
};

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
    const pulse = { at: Number.NEGATIVE_INFINITY, x: 0, y: 0 };
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const onPointerMove = (event: PointerEvent) => {
      pointer.target = toClip(canvas, event.clientX, event.clientY);
      pointer.tracking = true;
    };
    const onPointerLeave = () => {
      pointer.tracking = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      const clip = toClip(canvas, event.clientX, event.clientY);
      pulse.x = clip.x;
      pulse.y = clip.y;
      pulse.at = performance.now();
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
      const field = effect(gpu, shader, {
        blend: "alpha",
        set: {
          params: {
            ink: [...LIGHT_INK],
            opacity: 1,
            pad: [0, 0],
            pitch: 36,
            pointer: [0, 0],
            pulse: [0, 0],
            pulseAge: 10,
            resolution: [1, 1],
            time: 0,
          },
        },
      });
      const time = clock(gpu);
      const loop = frameLoop(gpu, (frame) => {
        const elapsed = reduceMotion ? 0 : time.time;
        if (!pointer.tracking) {
          pointer.target = reduceMotion
            ? { x: 0, y: 0 }
            : {
                x: Math.sin(elapsed * 0.22) * ORBIT_X,
                y: Math.cos(elapsed * 0.16) * ORBIT_Y,
              };
        }
        pointer.x += (pointer.target.x - pointer.x) * POINTER_EASE;
        pointer.y += (pointer.target.y - pointer.y) * POINTER_EASE;
        const dark = isDark();
        const dpr =
          canvas.width / Math.max(canvas.getBoundingClientRect().width, 1);
        field.set({
          params: {
            ink: [...(dark ? DARK_INK : LIGHT_INK)],
            opacity: dark ? 0.85 : 0.45,
            pitch: (dark ? 36 : 40) * dpr,
            pointer: [pointer.x, pointer.y],
            pulse: [pulse.x, pulse.y],
            pulseAge: Math.min(
              (performance.now() - pulse.at) / 1000 / PULSE_SECONDS,
              10
            ),
            resolution: [canvas.width, canvas.height],
            time: elapsed,
          },
        });
        frame.pass(target, field);
      });
      stop = () => {
        loop.stop();
        gpu.dispose();
      };
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerdown", onPointerDown);
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
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  if (!supported) {
    return null;
  }

  return (
    <canvas
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] w-full [mask-image:radial-gradient(ellipse_75%_65%_at_50%_42%,black_25%,transparent_100%)]"
      ref={canvasRef}
    />
  );
};
