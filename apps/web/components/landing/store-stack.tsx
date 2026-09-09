"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const LAYERS = [1, 0, -1];
const LAYER_FADE = [1, 0.5, 0.26];
const MARK = new Set([0, 4, 8]);
const SPECTRUM = [
  "--color-pink-700",
  "--color-purple-700",
  "--color-blue-700",
  "--color-red-700",
  "--color-blue-700",
  "--color-teal-700",
  "--color-amber-700",
  "--color-green-700",
  "--color-green-700",
];
const REACH_X = 420;
const REACH_Y = 320;
const REST_X = -16;
const REST_Y = -22;
const SWING_X = 14;
const SWING_Y = 18;
const SPREAD = 1.8;
const NEAR = 1.1;
const DEPTH_COST = 0.7;
const clamp = (value: number) => Math.min(Math.max(value, -1), 1);

export const StoreStack = ({
  className,
  ...props
}: ComponentProps<"button">) => {
  const sceneRef = useRef<HTMLButtonElement>(null);
  const stackRef = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState<ReadonlySet<number>>(new Set());
  const [spectrum, setSpectrum] = useState(false);

  useEffect(() => {
    const scene = sceneRef.current;
    const stack = stackRef.current;
    if (
      !(scene && stack) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    let frame = 0;
    let selected = "";

    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = scene.getBoundingClientRect();
        const x = clamp((event.clientX - rect.left - rect.width / 2) / REACH_X);
        const y = clamp((event.clientY - rect.top - rect.height / 2) / REACH_Y);
        stack.style.setProperty("--rx", `${REST_X - y * SWING_X}deg`);
        stack.style.setProperty("--ry", `${REST_Y + x * SWING_Y}deg`);

        const queryX = 1 + x * SPREAD;
        const queryY = 1 + y * SPREAD;
        const hits: number[] = [];
        for (const [layer] of LAYERS.entries()) {
          for (const cell of CELLS) {
            const distance = Math.hypot(
              (cell % 3) - queryX,
              Math.floor(cell / 3) - queryY,
              layer * DEPTH_COST
            );
            if (distance < NEAR) {
              hits.push(layer * CELLS.length + cell);
            }
          }
        }
        const key = hits.join(",");
        if (key !== selected) {
          selected = key;
          setNear(new Set(hits));
        }
      });
    };

    window.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <button
      aria-label="Spectrum"
      aria-pressed={spectrum}
      className={cn(
        "group relative isolate block [--bloom:22px] [--depth:36px] [--glow:oklch(0_0_0/0.28)] [--halo:3px] perspective-midrange md:[--bloom:46px] md:[--depth:64px] md:[--halo:7px] dark:[--glow:oklch(1_0_0/0.7)]",
        className
      )}
      onClick={() => setSpectrum((on) => !on)}
      ref={sceneRef}
      type="button"
      {...props}
    >
      <span
        aria-hidden
        className="relative block size-full [transform:rotateX(var(--rx,-16deg))_rotateY(var(--ry,-22deg))] transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] transform-3d motion-reduce:transition-none"
        ref={stackRef}
      >
        {LAYERS.map((depth, layer) => (
          <span
            className="absolute inset-0 grid grid-cols-3 gap-[8%]"
            key={depth}
            style={{
              opacity: LAYER_FADE[layer],
              transform: `translateZ(calc(var(--depth) * ${depth}))`,
            }}
          >
            {CELLS.map((cell) => {
              const lit =
                (layer === 0 && MARK.has(cell)) ||
                near.has(layer * CELLS.length + cell);
              const tone = spectrum ? SPECTRUM[cell] : "--glow";
              return (
                <span
                  className={cn(
                    "rounded-[20%] border transition-[background-color,border-color,box-shadow] duration-500 ease-out",
                    lit ? "bg-gray-1000 border-transparent" : "border-gray-500"
                  )}
                  key={cell}
                  style={{
                    boxShadow: lit
                      ? `0 0 var(--bloom) var(--halo) var(${tone})`
                      : undefined,
                  }}
                />
              );
            })}
          </span>
        ))}
      </span>
    </button>
  );
};
