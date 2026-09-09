import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { Resvg } from "@resvg/resvg-js";
import { parse } from "opentype.js";
import type { Font } from "opentype.js";

const SANS_FILE = "assets/fonts/Geist-Regular.ttf";
const SANS_SEMIBOLD_FILE = "assets/fonts/Geist-SemiBold.ttf";

const WIDTH = 2000;
const HEIGHT = 500;
const OUTPUT_WIDTH = 4000;
const FRAME_INSET = 24;
const TEXT_X = 104;
const HEADLINE_Y = 208;
const HEADLINE_SIZE = 84;
const SUBTITLE_Y = 282;
const SUBTITLE_SIZE = 30;
const SUBTITLE_LINE_HEIGHT = 44;
const PANEL_X = 1180;
const DOT_SPACING = 12;
const DOT_MIN_RADIUS = 0.5;
const DOT_MAX_RADIUS = 4.6;
const DENSITY_START = 0.04;
const DENSITY_END = 1;
const HASH_X = 12.9898;
const HASH_Y = 78.233;
const HASH_SCALE = 43_758.5453;

const HEADLINE = "One API for vector stores";
const SUBTITLE = [
  "vecstore-sdk is an open-source TypeScript library that",
  "compiles one metadata filter to Qdrant, pgvector, and Pinecone.",
];

interface Theme {
  readonly name: string;
  readonly background: string;
  readonly panel: string;
  readonly frame: string;
  readonly headline: string;
  readonly subtitle: string;
  readonly dot: string;
}

const THEMES: Theme[] = [
  {
    background: "#000000",
    dot: "#ededed",
    frame: "#2e2e2e",
    headline: "#ededed",
    name: "dark",
    panel: "#000000",
    subtitle: "#a1a1a1",
  },
  {
    background: "#ffffff",
    dot: "#171717",
    frame: "#eaeaea",
    headline: "#171717",
    name: "light",
    panel: "#ffffff",
    subtitle: "#666666",
  },
];

const hash = (column: number, row: number): number => {
  const value = Math.sin(column * HASH_X + row * HASH_Y) * HASH_SCALE;
  return value - Math.floor(value);
};

const frame = (theme: Theme): string =>
  `<rect x="${FRAME_INSET}" y="${FRAME_INSET}" width="${WIDTH - FRAME_INSET * 2}" height="${HEIGHT - FRAME_INSET * 2}" fill="none" stroke="${theme.frame}"/>`;

const halftone = (theme: Theme): string => {
  const left = PANEL_X;
  const right = WIDTH - FRAME_INSET;
  const top = FRAME_INSET;
  const bottom = HEIGHT - FRAME_INSET;
  const dots: string[] = [];
  for (let y = top + DOT_SPACING; y < bottom; y += DOT_SPACING) {
    for (let x = left + DOT_SPACING; x < right; x += DOT_SPACING) {
      const progress = (x - left) / (right - left);
      const density =
        DENSITY_START + (DENSITY_END - DENSITY_START) * progress ** 2;
      if (hash(x, y) > density) {
        continue;
      }
      const radius =
        DOT_MIN_RADIUS + (DOT_MAX_RADIUS - DOT_MIN_RADIUS) * progress;
      dots.push(
        `<circle cx="${x}" cy="${y}" r="${radius.toFixed(2)}" fill="${theme.dot}"/>`
      );
    }
  }
  return `<rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="${theme.panel}"/>${dots.join(
    ""
  )}`;
};

const loadFont = (file: string): Font => {
  const bytes = readFileSync(file);
  return parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
};

const regular = loadFont(SANS_FILE);
const semibold = loadFont(SANS_SEMIBOLD_FILE);

const PATH_PRECISION = 2;
const HEADLINE_TRACKING = -0.024;

const textPath = (
  font: Font,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  letterSpacing = 0
): string =>
  `<path fill="${fill}" d="${font
    .getPath(text, x, y, size, { kerning: true, letterSpacing })
    .toPathData(PATH_PRECISION)}"/>`;

const copy = (theme: Theme): string =>
  textPath(
    semibold,
    HEADLINE,
    TEXT_X,
    HEADLINE_Y,
    HEADLINE_SIZE,
    theme.headline,
    HEADLINE_TRACKING
  ) +
  SUBTITLE.map((line, index) =>
    textPath(
      regular,
      line,
      TEXT_X,
      SUBTITLE_Y + index * SUBTITLE_LINE_HEIGHT,
      SUBTITLE_SIZE,
      theme.subtitle
    )
  ).join("");

const heroSvg = (theme: Theme): string =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${theme.background}"/>`,
    halftone(theme),
    frame(theme),
    copy(theme),
    "</svg>",
  ].join("");

const renderPng = (svg: string): Buffer =>
  new Resvg(svg, {
    fitTo: { mode: "width", value: OUTPUT_WIDTH },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();

const run = (): void => {
  for (const file of [SANS_FILE, SANS_SEMIBOLD_FILE]) {
    if (!existsSync(file)) {
      throw new Error(`missing ${file}`);
    }
  }
  for (const theme of THEMES) {
    const svg = heroSvg(theme);
    writeFileSync(`assets/hero-${theme.name}.svg`, `${svg}\n`);
    writeFileSync(`assets/hero-${theme.name}.png`, renderPng(svg));
  }
  process.stdout.write(`${THEMES.length} themes rendered\n`);
};

run();
