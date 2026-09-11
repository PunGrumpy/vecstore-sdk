import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const CARD_STROKE_ACTIVE = "#666666";
const CARD_STROKE_WIDTH = 2;
const CARD_WIDTH = 400;
const CARD_HEIGHT = 104;
const CARD_GAP = 25;
const CARD_PITCH = CARD_HEIGHT + CARD_GAP;
const CARD_RADIUS = 16;
const CARD_ICON = 42;
const CARD_ICON_INSET = 28;
const CARD_ICON_Y = (CARD_HEIGHT - CARD_ICON) / 2;
const CARD_LABEL_GAP = 20;
const CARD_LABEL_SIZE = 42;
const CARD_LABEL_X = CARD_ICON_INSET + CARD_ICON + CARD_LABEL_GAP;
const COLUMN_LIFT = 24;
const OG_LOGO_WIDTH = 580;
const MARK_SIZE = 103.68;
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const OG_PADDING = 80;
const COLUMN_WINDOW = 5;
const ACTIVE_SLOT = 2;
const TAGLINE = "One filter language for every vector store.";
const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;
const ICO_SIZES = [16, 32, 48] as const;
const BITS_PER_PIXEL = 32;

const root = path.join(import.meta.dir, "..");
const assets = path.join(root, "assets");
const output = path.join(root, "apps", "web", "app");
const ogOutput = path.join(output, "og", "docs", "[...slug]");

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
const VECTORIZE_ORANGE = "#f6821f";
const REDIS_RED = "#ff4438";

interface ProviderRow {
  readonly file: string;
  readonly id: string;
  readonly label: string;
  readonly tint: string;
}

const providers: readonly ProviderRow[] = [
  { file: "qdrant.svg", id: "qdrant", label: "Qdrant", tint: QDRANT_RED },
  {
    file: "postgresql.svg",
    id: "pgvector",
    label: "pgvector",
    tint: PGVECTOR_BLUE,
  },
  {
    file: "pinecone.svg",
    id: "pinecone",
    label: "Pinecone",
    tint: PINECONE_INK,
  },
  {
    file: "supabase.svg",
    id: "supabase",
    label: "Supabase",
    tint: SUPABASE_GREEN,
  },
  { file: "upstash.svg", id: "upstash", label: "Upstash", tint: UPSTASH_GREEN },
  {
    file: "cloudflare.svg",
    id: "vectorize",
    label: "Vectorize",
    tint: VECTORIZE_ORANGE,
  },
  { file: "redis.svg", id: "redis", label: "Redis", tint: REDIS_RED },
];

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

const providerBody = (row: ProviderRow, labelFont: Font): string => {
  const label = labelFont.getPath(row.label, 0, 0, CARD_LABEL_SIZE, {
    kerning: true,
  });
  const box = label.getBoundingBox();
  const textY = CARD_HEIGHT / 2 - (box.y1 + box.y2) / 2;
  return `<g transform="translate(${CARD_ICON_INSET} ${format(CARD_ICON_Y)})">${providerIcon(row.file, CARD_ICON, row.tint)}</g><g transform="translate(${format(CARD_LABEL_X - box.x1)} ${format(textY)})"><path d="${cubicPathData(label, PATH_PRECISION)}" fill="${INK}"/></g>`;
};

const card = (
  row: ProviderRow,
  y: number,
  labelFont: Font,
  active: boolean
): string => {
  const body = providerBody(row, labelFont);
  const stroke = active ? CARD_STROKE_ACTIVE : CARD_STROKE;
  return `<g transform="translate(0 ${format(y)})"><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="${CARD_RADIUS}" fill="${CARD_FILL}" stroke="${stroke}" stroke-width="${CARD_STROKE_WIDTH}"/>${body}</g>`;
};

interface Column {
  readonly cards: string;
  readonly mask: string;
}

const column = (
  items: readonly ProviderRow[],
  labelFont: Font,
  activeId?: string
): Column => {
  const height = items.length * CARD_HEIGHT + (items.length - 1) * CARD_GAP;
  const top = (OG_HEIGHT - height) / 2 - COLUMN_LIFT;
  const lastTop = top + (items.length - 1) * CARD_PITCH;
  const cards = items
    .map((row, index) =>
      card(row, top + index * CARD_PITCH, labelFont, row.id === activeId)
    )
    .join("");
  const solidFrom = (top + CARD_HEIGHT) / OG_HEIGHT;
  const solidTo = lastTop / OG_HEIGHT;
  const clearTo = (lastTop + CARD_PITCH) / OG_HEIGHT;
  const fade = `<linearGradient id="column-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000"/><stop offset="${format(solidFrom)}" stop-color="#ffffff"/><stop offset="${format(solidTo)}" stop-color="#ffffff"/><stop offset="${format(clearTo)}" stop-color="#000000"/></linearGradient><mask id="column-mask"><rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#column-fade)"/></mask>`;
  return { cards, mask: fade };
};

const columnX = OG_WIDTH - OG_PADDING - CARD_WIDTH;

const frame = (mask: string, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}"><defs>${mask}</defs><rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${BACKGROUND}"/>${body}</svg>`;

const logoSvg = readFileSync(path.join(assets, "logo-dark.svg"), "utf-8");
const logoData = Buffer.from(logoSvg).toString("base64");
const logoBox = /viewBox="0 0 (?<width>[\d.]+) (?<height>[\d.]+)"/u.exec(
  logoSvg
);
const logoRatio =
  Number(logoBox?.groups?.height ?? 1) / Number(logoBox?.groups?.width ?? 1);

const logoImage = (width: number, y: number): string =>
  `<image href="data:image/svg+xml;base64,${logoData}" x="${OG_PADDING}" y="${format(y)}" width="${width}" height="${format(width * logoRatio)}"/>`;

const logoTop = (OG_HEIGHT - OG_LOGO_WIDTH * logoRatio) / 2;

const labelFont = loadFont(path.join(assets, "fonts", "Geist-SemiBold.ttf"));

const rotate = (by: number): readonly ProviderRow[] => [
  ...providers.slice(by),
  ...providers.slice(0, by),
];

const windowFor = (activeId?: string): readonly ProviderRow[] => {
  const index = providers.findIndex((row) => row.id === activeId);
  if (index === -1) {
    return providers.slice(0, COLUMN_WINDOW);
  }
  const offset = (index - ACTIVE_SLOT + providers.length) % providers.length;
  return rotate(offset).slice(0, COLUMN_WINDOW);
};

const socialCard = (activeId?: string): string => {
  const { cards, mask } = column(windowFor(activeId), labelFont, activeId);
  return frame(
    mask,
    `${logoImage(OG_LOGO_WIDTH, logoTop)}<g mask="url(#column-mask)"><g transform="translate(${format(columnX)} 0)">${cards}</g></g>`
  );
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
  const defaultCard = renderPng(socialCard(), OG_WIDTH);
  writeFileSync(path.join(output, "opengraph-image.png"), defaultCard);
  writeFileSync(
    path.join(output, "opengraph-image.alt.txt"),
    `VecStore SDK. ${TAGLINE}\n`
  );
  mkdirSync(ogOutput, { recursive: true });
  writeFileSync(path.join(ogOutput, "background.png"), defaultCard);
  for (const row of providers) {
    writeFileSync(
      path.join(ogOutput, `background-${row.id}.png`),
      renderPng(socialCard(row.id), OG_WIDTH)
    );
  }
  process.stdout.write("icons rendered\n");
};

run();
