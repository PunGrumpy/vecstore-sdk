import { existsSync, writeFileSync, readFileSync } from "node:fs";

import { Resvg } from "@resvg/resvg-js";
import { parse } from "opentype.js";
import type { Font, Path } from "opentype.js";

import { cubicPathData } from "./glyph-path";

const SEMIBOLD_FILE = "assets/fonts/Geist-SemiBold.ttf";
const OUTPUT_SCALE = 4;
const PATH_PRECISION = 3;

const NAME = "VecStore";
const SUFFIX = "SDK";
const NAME_SIZE = 96;
const NAME_TRACKING = -0.02;
const SUFFIX_SCALE = 0.66;
const SUFFIX_TRACKING = 0.01;
const PILL_STROKE = 0.105;
const PILL_PAD_X = 0.22;
const PILL_PAD_Y = 0.09;
const PILL_GAP = 0.26;

const GRID = 3;
const CELL_UNIT = 0.36;
const CELL_SIZE = 0.82;
const CELL_RADIUS = 0.16;
const HOLLOW_INSET = 0.06;
const HOLLOW_STROKE = 0.12;
const MARK_GAP = 0.34;
const PADDING = 0.2;

interface Theme {
  readonly name: string;
  readonly ink: string;
}

const THEMES: Theme[] = [
  { ink: "#ededed", name: "dark" },
  { ink: "#171717", name: "light" },
];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const loadFont = (file: string): Font => {
  const bytes = readFileSync(file);
  return parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
};

const format = (value: number): string => value.toFixed(PATH_PRECISION);

const font = loadFont(SEMIBOLD_FILE);

const textPath = (text: string, size: number, tracking: number): Path =>
  font.getPath(text, 0, 0, size, { kerning: true, letterSpacing: tracking });

const bounds = (path: Path): Box => {
  const box = path.getBoundingBox();
  return {
    height: box.y2 - box.y1,
    width: box.x2 - box.x1,
    x: box.x1,
    y: box.y1,
  };
};

const translate = (x: number, y: number, inner: string): string =>
  `<g transform="translate(${format(x)} ${format(y)})">${inner}</g>`;

interface Piece {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
}

const wordmark = (ink: string): Piece => {
  const name = textPath(NAME, NAME_SIZE, NAME_TRACKING);
  const nameBox = bounds(name);
  const suffixSize = NAME_SIZE * SUFFIX_SCALE;
  const suffix = textPath(SUFFIX, suffixSize, SUFFIX_TRACKING);
  const suffixBox = bounds(suffix);
  const stroke = NAME_SIZE * PILL_STROKE;
  const padX = NAME_SIZE * PILL_PAD_X;
  const padY = NAME_SIZE * PILL_PAD_Y;
  const pillWidth = suffixBox.width + padX * 2 + stroke * 2;
  const pillHeight = suffixBox.height + padY * 2 + stroke * 2;
  const height = Math.max(nameBox.height, pillHeight);
  const nameY = (height - nameBox.height) / 2 - nameBox.y;
  const pillX = nameBox.width + NAME_SIZE * PILL_GAP;
  const pillY = (height - pillHeight) / 2;
  const suffixX = pillX + (pillWidth - suffixBox.width) / 2 - suffixBox.x;
  const suffixY = pillY + (pillHeight - suffixBox.height) / 2 - suffixBox.y;
  const radius = (pillHeight - stroke) / 2;
  const svg = [
    translate(
      -nameBox.x,
      nameY,
      `<path fill="${ink}" d="${cubicPathData(name, PATH_PRECISION)}"/>`
    ),
    `<rect x="${format(pillX + stroke / 2)}" y="${format(pillY + stroke / 2)}" width="${format(pillWidth - stroke)}" height="${format(pillHeight - stroke)}" rx="${format(radius)}" fill="none" stroke="${ink}" stroke-width="${format(stroke)}"/>`,
    translate(
      suffixX,
      suffixY,
      `<path fill="${ink}" d="${cubicPathData(suffix, PATH_PRECISION)}"/>`
    ),
  ].join("");
  return { height, svg, width: pillX + pillWidth };
};

const cell = (
  column: number,
  row: number,
  unit: number,
  ink: string,
  filled: boolean
): string => {
  const size = unit * CELL_SIZE;
  const radius = unit * CELL_RADIUS;
  const x = column * unit + (unit - size) / 2;
  const y = row * unit + (unit - size) / 2;
  if (filled) {
    return `<rect x="${format(x)}" y="${format(y)}" width="${format(size)}" height="${format(size)}" rx="${format(radius)}" fill="${ink}"/>`;
  }
  const inset = unit * HOLLOW_INSET;
  const stroke = unit * HOLLOW_STROKE;
  return `<rect x="${format(x + inset)}" y="${format(y + inset)}" width="${format(size - inset * 2)}" height="${format(size - inset * 2)}" rx="${format(radius)}" fill="none" stroke="${ink}" stroke-width="${format(stroke)}"/>`;
};

const mark = (ink: string, unit: number): Piece => {
  const cells: string[] = [];
  for (let row = 0; row < GRID; row += 1) {
    for (let column = 0; column < GRID; column += 1) {
      cells.push(cell(column, row, unit, ink, column === row));
    }
  }
  const side = unit * GRID;
  return { height: side, svg: cells.join(""), width: side };
};

const document = (piece: Piece): string => {
  const pad = NAME_SIZE * PADDING;
  const width = piece.width + pad * 2;
  const height = piece.height + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${format(width)}" height="${format(height)}" viewBox="0 0 ${format(width)} ${format(height)}">${translate(pad, pad, piece.svg)}</svg>`;
};

const lockup = (ink: string): Piece => {
  const word = wordmark(ink);
  const icon = mark(ink, NAME_SIZE * CELL_UNIT);
  const gap = NAME_SIZE * MARK_GAP;
  const height = Math.max(word.height, icon.height);
  return {
    height,
    svg:
      translate(0, (height - icon.height) / 2, icon.svg) +
      translate(icon.width + gap, (height - word.height) / 2, word.svg),
    width: icon.width + gap + word.width,
  };
};

const renderPng = (svg: string): Buffer =>
  new Resvg(svg, {
    fitTo: { mode: "zoom", value: OUTPUT_SCALE },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();

const write = (name: string, svg: string): void => {
  writeFileSync(`assets/${name}.svg`, `${svg}\n`);
  writeFileSync(`assets/${name}.png`, renderPng(svg));
};

const run = (): void => {
  if (!existsSync(SEMIBOLD_FILE)) {
    throw new Error(`missing ${SEMIBOLD_FILE}`);
  }
  for (const theme of THEMES) {
    write(
      `mark-${theme.name}`,
      document(mark(theme.ink, NAME_SIZE * CELL_UNIT))
    );
    write(`logo-${theme.name}`, document(lockup(theme.ink)));
  }
  process.stdout.write(`${THEMES.length} themes rendered\n`);
};

run();
