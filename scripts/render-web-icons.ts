import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Resvg } from "@resvg/resvg-js";
import type { Font } from "opentype.js";
import { parse } from "opentype.js";

import { cubicPathData } from "./glyph-path";

const PATH_PRECISION = 3;
const BACKGROUND = "#000000";
const INK = "#ededed";
const CARD_FILL = "#0a0a0a";
const CARD_STROKE = "#2e2e2e";
const CARD_STROKE_WIDTH = 2;
const CARD_WIDTH = 400;
const CARD_HEIGHT = 92;
const CARD_GAP = 23;
const CARD_RADIUS = 20;
const CARD_ICON = 34;
const CARD_ICON_INSET = 28;
const CARD_ICON_Y = (CARD_HEIGHT - CARD_ICON) / 2;
const CARD_LABEL_GAP = 20;
const CARD_LABEL_SIZE = 32;
const CARD_LABEL_X = CARD_ICON_INSET + CARD_ICON + CARD_LABEL_GAP;
const PLACEHOLDER_FILL = "#2e2e2e";
const PLACEHOLDER_ICON_RADIUS = 10;
const PLACEHOLDER_BAR_WIDTH = 132;
const PLACEHOLDER_BAR_HEIGHT = 16;
const PLACEHOLDER_BAR_RADIUS = 8;
const OG_LOGO_WIDTH = 580;
const MARK_SIZE = 103.68;
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const OG_PADDING = 80;
const TAGLINE = "One filter language for every vector store.";
const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;
const ICO_SIZES = [16, 32, 48] as const;
const BITS_PER_PIXEL = 32;

const root = path.join(import.meta.dir, "..");
const assets = path.join(root, "assets");
const output = path.join(root, "apps", "web", "app");

const loadFont = (file: string): Font => {
  const bytes = readFileSync(file);
  return parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
};

const format = (value: number): string => value.toFixed(PATH_PRECISION);

const markInner = readFileSync(path.join(assets, "mark-dark.svg"), "utf-8")
  .replace(/^[\s\S]*?<g transform="translate\([^)]*\)">/u, "")
  .replace(/<\/g>\s*<\/svg>\s*$/u, "");

const markSvg = (size: number, scale: number, radius: number): string => {
  const inner = size * scale;
  const offset = (size - inner) / 2;
  const factor = inner / MARK_SIZE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${format(size * radius)}" fill="${BACKGROUND}"/><g transform="translate(${format(offset)} ${format(offset)}) scale(${format(factor)})">${markInner}</g></svg>`;
};

const renderPng = (svg: string, width: number): Buffer =>
  new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();

const ico = (entries: readonly { size: number; png: Buffer }[]): Buffer => {
  const header = Buffer.alloc(ICO_HEADER_BYTES);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(ICO_ENTRY_BYTES * entries.length);
  let offset = ICO_HEADER_BYTES + directory.length;
  for (const [index, entry] of entries.entries()) {
    const base = index * ICO_ENTRY_BYTES;
    directory.writeUInt8(entry.size, base);
    directory.writeUInt8(entry.size, base + 1);
    directory.writeUInt8(0, base + 2);
    directory.writeUInt8(0, base + 3);
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(BITS_PER_PIXEL, base + 6);
    directory.writeUInt32LE(entry.png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
  }
  return Buffer.concat([
    header,
    directory,
    ...entries.map((entry) => entry.png),
  ]);
};

const PINECONE_INK = INK;
const QDRANT_RED = "#dc244c";
const PGVECTOR_BLUE = "#4169e1";
const SUPABASE_GREEN = "#3ecf8e";
const UPSTASH_GREEN = "#00e9a3";

interface ProviderRow {
  readonly kind: "provider";
  readonly file: string;
  readonly label: string;
  readonly tint: string;
}

interface PlaceholderRow {
  readonly kind: "placeholder";
}

type Row = ProviderRow | PlaceholderRow;

const rows: readonly Row[] = [
  { kind: "placeholder" },
  { file: "qdrant.svg", kind: "provider", label: "Qdrant", tint: QDRANT_RED },
  {
    file: "postgresql.svg",
    kind: "provider",
    label: "pgvector",
    tint: PGVECTOR_BLUE,
  },
  {
    file: "pinecone.svg",
    kind: "provider",
    label: "Pinecone",
    tint: PINECONE_INK,
  },
  {
    file: "supabase.svg",
    kind: "provider",
    label: "Supabase",
    tint: SUPABASE_GREEN,
  },
  {
    file: "upstash.svg",
    kind: "provider",
    label: "Upstash",
    tint: UPSTASH_GREEN,
  },
  { kind: "placeholder" },
];

const providerIndexes = rows.flatMap((row, index) =>
  row.kind === "provider" ? [index] : []
);

const providerIcon = (file: string, size: number, tint: string): string => {
  const svg = readFileSync(path.join(assets, "providers", file), "utf-8");
  const viewBox =
    /viewBox="[\d.]+ [\d.]+ (?<width>[\d.]+) (?<height>[\d.]+)"/u.exec(svg);
  const width = Number(viewBox?.groups?.width ?? size);
  const height = Number(viewBox?.groups?.height ?? size);
  const scale = size / Math.max(width, height);
  const d = /\sd="(?<d>[^"]+)"/u.exec(svg)?.groups?.d ?? "";
  return `<g transform="scale(${format(scale)})"><path d="${d}" fill="${tint}"/></g>`;
};

const placeholderBody = (): string => {
  const barY = (CARD_HEIGHT - PLACEHOLDER_BAR_HEIGHT) / 2;
  return `<rect x="${CARD_ICON_INSET}" y="${format(CARD_ICON_Y)}" width="${CARD_ICON}" height="${CARD_ICON}" rx="${PLACEHOLDER_ICON_RADIUS}" fill="${PLACEHOLDER_FILL}"/><rect x="${CARD_LABEL_X}" y="${format(barY)}" width="${PLACEHOLDER_BAR_WIDTH}" height="${PLACEHOLDER_BAR_HEIGHT}" rx="${PLACEHOLDER_BAR_RADIUS}" fill="${PLACEHOLDER_FILL}"/>`;
};

const providerBody = (row: ProviderRow, labelFont: Font): string => {
  const label = labelFont.getPath(row.label, 0, 0, CARD_LABEL_SIZE, {
    kerning: true,
  });
  const box = label.getBoundingBox();
  const textY = CARD_HEIGHT / 2 - (box.y1 + box.y2) / 2;
  return `<g transform="translate(${CARD_ICON_INSET} ${format(CARD_ICON_Y)})">${providerIcon(row.file, CARD_ICON, row.tint)}</g><g transform="translate(${format(CARD_LABEL_X - box.x1)} ${format(textY)})"><path d="${cubicPathData(label, PATH_PRECISION)}" fill="${INK}"/></g>`;
};

const card = (row: Row, y: number, labelFont: Font): string => {
  const body =
    row.kind === "placeholder"
      ? placeholderBody()
      : providerBody(row, labelFont);
  return `<g transform="translate(0 ${format(y)})"><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="${CARD_RADIUS}" fill="${CARD_FILL}" stroke="${CARD_STROKE}" stroke-width="${CARD_STROKE_WIDTH}"/>${body}</g>`;
};

const openGraph = (): string => {
  const logo = readFileSync(path.join(assets, "logo-dark.svg"), "utf-8");
  const logoViewBox = /viewBox="0 0 (?<width>[\d.]+) (?<height>[\d.]+)"/u.exec(
    logo
  );
  const logoWidth = Number(logoViewBox?.groups?.width ?? OG_LOGO_WIDTH);
  const logoHeight = Number(logoViewBox?.groups?.height ?? OG_LOGO_WIDTH);
  const logoDrawnHeight = (logoHeight * OG_LOGO_WIDTH) / logoWidth;
  const logoData = Buffer.from(logo).toString("base64");
  const labelFont = loadFont(path.join(assets, "fonts", "Geist-SemiBold.ttf"));
  const columnHeight = rows.length * CARD_HEIGHT + (rows.length - 1) * CARD_GAP;
  const columnTop = (OG_HEIGHT - columnHeight) / 2;
  const columnX = OG_WIDTH - OG_PADDING - CARD_WIDTH;
  const cards = rows
    .map((row, index) =>
      card(row, columnTop + index * (CARD_HEIGHT + CARD_GAP), labelFont)
    )
    .join("");
  const firstProvider = providerIndexes[0] ?? 0;
  const lastProvider = providerIndexes.at(-1) ?? rows.length - 1;
  const fadeStart =
    (columnTop + firstProvider * (CARD_HEIGHT + CARD_GAP)) / OG_HEIGHT;
  const fadeEnd =
    (columnTop + lastProvider * (CARD_HEIGHT + CARD_GAP) + CARD_HEIGHT) /
    OG_HEIGHT;
  const fade = `<linearGradient id="column-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000"/><stop offset="${format(fadeStart)}" stop-color="#ffffff"/><stop offset="${format(fadeEnd)}" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient><mask id="column-mask"><rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#column-fade)"/></mask>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}"><defs>${fade}</defs><rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${BACKGROUND}"/><image href="data:image/svg+xml;base64,${logoData}" x="${OG_PADDING}" y="${format((OG_HEIGHT - logoDrawnHeight) / 2)}" width="${OG_LOGO_WIDTH}" height="${format(logoDrawnHeight)}"/><g mask="url(#column-mask)"><g transform="translate(${format(columnX)} 0)">${cards}</g></g></svg>`;
};

const run = (): void => {
  writeFileSync(
    path.join(output, "icon.png"),
    renderPng(markSvg(64, 0.8, 0.2), 64)
  );
  writeFileSync(
    path.join(output, "apple-icon.png"),
    renderPng(markSvg(180, 0.62, 0), 180)
  );
  writeFileSync(
    path.join(output, "favicon.ico"),
    ico(
      ICO_SIZES.map((size) => ({
        png: renderPng(markSvg(size, 0.8, 0.2), size),
        size,
      }))
    )
  );
  writeFileSync(
    path.join(output, "opengraph-image.png"),
    renderPng(openGraph(), OG_WIDTH)
  );
  writeFileSync(
    path.join(output, "opengraph-image.alt.txt"),
    `VecStore SDK. ${TAGLINE}\n`
  );
  process.stdout.write("icons rendered\n");
};

run();
