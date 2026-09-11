import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Resvg } from "@resvg/resvg-js";

const CELLS = 16;
const PITCH = 7;
const RADIUS = 3.5;
const SAMPLE_WIDTH = 512;
const RELATIVE_THRESHOLD = 0.35;
const INK_THRESHOLD = 0.5;
const RGBA = 4;
const LUMA = { b: 0.0722, g: 0.7152, r: 0.2126 } as const;
const MAX_CHANNEL = 255;

const root = path.join(import.meta.dir, "..");
const assets = path.join(root, "assets", "providers");
const output = path.join(
  root,
  "apps",
  "web",
  "components",
  "landing",
  "provider-marks.tsx"
);

const sources = {
  pgvector: readFileSync(path.join(assets, "postgresql.svg"), "utf-8"),
  pinecone: readFileSync(path.join(assets, "pinecone.svg"), "utf-8"),
  qdrant: readFileSync(path.join(assets, "qdrant.svg"), "utf-8"),
  redis: readFileSync(path.join(assets, "redis.svg"), "utf-8"),
  supabase: readFileSync(path.join(assets, "supabase.svg"), "utf-8"),
  upstash: readFileSync(path.join(assets, "upstash.svg"), "utf-8"),
  vectorize: readFileSync(path.join(assets, "cloudflare.svg"), "utf-8"),
} as const;

const inkAt = (pixels: Uint8Array, index: number): number => {
  const alpha = pixels[index + 3] ?? 0;
  const red = pixels[index] ?? 0;
  const green = pixels[index + 1] ?? 0;
  const blue = pixels[index + 2] ?? 0;
  const luma = (LUMA.r * red + LUMA.g * green + LUMA.b * blue) / MAX_CHANNEL;
  return (alpha / MAX_CHANNEL) * (1 - luma);
};

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const measure = (pixels: Uint8Array, width: number, height: number): Bounds => {
  let bounds: Bounds = { maxX: 0, maxY: 0, minX: width, minY: height };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (inkAt(pixels, (y * width + x) * RGBA) > INK_THRESHOLD) {
        bounds = {
          maxX: Math.max(bounds.maxX, x),
          maxY: Math.max(bounds.maxY, y),
          minX: Math.min(bounds.minX, x),
          minY: Math.min(bounds.minY, y),
        };
      }
    }
  }
  return bounds;
};

const toGrid = (svg: string): boolean[][] => {
  const image = new Resvg(svg, {
    background: "transparent",
    fitTo: { mode: "width", value: SAMPLE_WIDTH },
  }).render();
  const { height, pixels, width } = image;
  const bounds = measure(pixels, width, height);
  const boxWidth = bounds.maxX - bounds.minX + 1;
  const boxHeight = bounds.maxY - bounds.minY + 1;
  const side = Math.max(boxWidth, boxHeight);
  const originX = bounds.minX - (side - boxWidth) / 2;
  const originY = bounds.minY - (side - boxHeight) / 2;
  const step = side / CELLS;
  const coverage: number[][] = [];
  let peak = 0;
  for (let cy = 0; cy < CELLS; cy += 1) {
    const row: number[] = [];
    for (let cx = 0; cx < CELLS; cx += 1) {
      let sum = 0;
      let count = 0;
      const startY = Math.floor(originY + cy * step);
      const endY = originY + (cy + 1) * step;
      const startX = Math.floor(originX + cx * step);
      const endX = originX + (cx + 1) * step;
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          count += 1;
          const inside = x >= 0 && y >= 0 && x < width && y < height;
          if (inside) {
            sum += inkAt(pixels, (y * width + x) * RGBA);
          }
        }
      }
      const value = sum / count;
      row.push(value);
      peak = Math.max(peak, value);
    }
    coverage.push(row);
  }
  return coverage.map((row) =>
    row.map((value) => value >= RELATIVE_THRESHOLD * peak)
  );
};

const toPath = (grid: boolean[][]): string => {
  const dots: string[] = [];
  for (const [y, row] of grid.entries()) {
    for (const [x, filled] of row.entries()) {
      if (filled) {
        const cx = x * PITCH + RADIUS;
        const cy = y * PITCH + RADIUS;
        dots.push(
          `M${cx - RADIUS} ${cy}a${RADIUS} ${RADIUS} 0 1 0 ${RADIUS * 2} 0a${RADIUS} ${RADIUS} 0 1 0 -${RADIUS * 2} 0`
        );
      }
    }
  }
  return dots.join("");
};

const entries = Object.entries(sources).map(
  ([id, svg]) => `  ${id}: "${toPath(toGrid(svg))}",`
);

const size = CELLS * PITCH;

writeFileSync(
  output,
  `import type { ComponentProps } from "react";

const marks = {
${entries.join("\n")}
} as const;

export type ProviderMarkId = keyof typeof marks;

interface ProviderMarkProps extends ComponentProps<"svg"> {
  readonly id: ProviderMarkId;
}

export const ProviderMark = ({ id, ...props }: ProviderMarkProps) => (
  <svg
    aria-hidden
    fill="currentColor"
    viewBox="0 0 ${size} ${size}"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d={marks[id]} />
  </svg>
);
`
);

process.stdout.write(`${output}\n`);
