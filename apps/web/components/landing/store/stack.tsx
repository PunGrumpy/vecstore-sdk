"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

import { queryFrom, restQuery } from "./query";
import type { StoreQuery } from "./query";

const StoreCanvas = dynamic(
  async () => {
    const loaded = await import("./canvas");
    return loaded.StoreCanvas;
  },
  { ssr: false }
);

const unsubscribe = () => false;
const subscribe = () => unsubscribe;
const hasWebGpu = () => "gpu" in navigator;
const noWebGpu = () => false;

export const StoreStack = ({
  className,
  ...props
}: ComponentProps<"button">) => {
  const sceneRef = useRef<HTMLButtonElement>(null);
  const queryRef = useRef<StoreQuery>(restQuery);
  const [spectrum, setSpectrum] = useState(false);
  const accelerated = useSyncExternalStore(subscribe, hasWebGpu, noWebGpu);

  useEffect(() => {
    const scene = sceneRef.current;
    if (
      !scene ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    let frame = 0;

    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        queryRef.current = queryFrom(
          scene.getBoundingClientRect(),
          event.clientX,
          event.clientY
        );
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
      className={cn("relative block", className)}
      onClick={() => setSpectrum((on) => !on)}
      ref={sceneRef}
      type="button"
      {...props}
    >
      {accelerated ? (
        <StoreCanvas queryRef={queryRef} spectrum={spectrum} />
      ) : null}
    </button>
  );
};
