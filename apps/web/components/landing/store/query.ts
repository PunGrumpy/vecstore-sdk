export const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
export const LAYERS = [1, 0, -1];
export const LAYER_FADE = [1, 0.62, 0.34];
export const MARK = new Set([0, 4, 8]);
export const SPECTRUM = [
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

export interface StoreQuery {
  readonly lit: readonly number[];
  readonly tiltX: number;
  readonly tiltY: number;
}

export const queryFrom = (
  rect: DOMRect,
  clientX: number,
  clientY: number
): StoreQuery => {
  const x = clamp((clientX - rect.left - rect.width / 2) / REACH_X);
  const y = clamp((clientY - rect.top - rect.height / 2) / REACH_Y);
  const queryX = 1 + x * SPREAD;
  const queryY = 1 + y * SPREAD;
  const lit: number[] = [];
  for (const [layer] of LAYERS.entries()) {
    for (const cell of CELLS) {
      const distance = Math.hypot(
        (cell % 3) - queryX,
        Math.floor(cell / 3) - queryY,
        layer * DEPTH_COST
      );
      if (distance < NEAR) {
        lit.push(layer * CELLS.length + cell);
      }
    }
  }
  return { lit, tiltX: REST_X - y * SWING_X, tiltY: REST_Y + x * SWING_Y };
};

export const restQuery: StoreQuery = { lit: [], tiltX: REST_X, tiltY: REST_Y };

export const isLit = (query: StoreQuery, layer: number, cell: number) =>
  (layer === 0 && MARK.has(cell)) ||
  query.lit.includes(layer * CELLS.length + cell);
