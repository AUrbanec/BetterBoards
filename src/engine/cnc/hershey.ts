/**
 * Single-stroke ("stick") engraving font.
 *
 * Why not the classic Hershey tables? Their compact encoding is easy to get
 * subtly wrong, and a corrupted glyph becomes a wrong cut in somebody's board.
 * This is an explicit, readable, verifiable table instead: every glyph is a
 * list of polylines on a fixed grid, checked by tests to stay in its box.
 *
 * Grid: x ∈ [0, w], y ∈ [0, 14] with y *up* and the baseline at y = 0.
 * Cap height is 14 units. Lowercase input is engraved as uppercase — a
 * deliberate choice for monograms, and documented in the UI.
 *
 * Strokes are centerlines: the cutter follows them exactly, so with a V-bit the
 * groove width follows depth. Purely tabular data — no inference anywhere.
 */

import type { Nm } from '../units';
import type { Vec2 } from '../geometry/vec';

interface Glyph {
  /** Advance width in grid units (glyph box is 0..w). */
  w: number;
  strokes: [number, number][][];
}

const CAP = 14;
const SP = 3; // inter-glyph spacing in grid units

/** A small square standing in for a round dot — one closed stroke. */
const DOT = (x: number, y: number): [number, number][] => [
  [x - 0.6, y],
  [x + 0.6, y],
  [x + 0.6, y + 1.2],
  [x - 0.6, y + 1.2],
  [x - 0.6, y],
];

const FONT: Record<string, Glyph> = {
  ' ': { w: 6, strokes: [] },

  A: { w: 10, strokes: [[[0, 0], [5, 14], [10, 0]], [[1.9, 5.4], [8.1, 5.4]]] },
  B: {
    w: 9,
    strokes: [
      [[0, 0], [0, 14], [5.5, 14], [7.8, 12.6], [8.2, 10.2], [6.8, 8.2], [0, 7.6]],
      [[0, 7.6], [6.5, 7.2], [8.8, 5.4], [9, 2.6], [6.8, 0.4], [0, 0]],
    ],
  },
  C: {
    w: 10,
    strokes: [[[9.6, 10.8], [8, 13], [5, 14], [2, 12.6], [0.4, 9.4], [0.4, 4.6], [2, 1.4], [5, 0], [8, 1], [9.6, 3.2]]],
  },
  D: { w: 10, strokes: [[[0, 0], [0, 14], [5, 14], [8, 12.2], [9.6, 9], [9.6, 5], [8, 1.8], [5, 0], [0, 0]]] },
  E: { w: 9, strokes: [[[9, 14], [0, 14], [0, 0], [9, 0]], [[0, 7.4], [6.8, 7.4]]] },
  F: { w: 9, strokes: [[[9, 14], [0, 14], [0, 0]], [[0, 7.4], [6.8, 7.4]]] },
  G: {
    w: 10,
    strokes: [
      [[9.6, 10.8], [8, 13], [5, 14], [2, 12.6], [0.4, 9.4], [0.4, 4.6], [2, 1.4], [5, 0], [8, 1], [9.6, 3.4], [9.6, 6.4], [6, 6.4]],
    ],
  },
  H: { w: 10, strokes: [[[0, 0], [0, 14]], [[10, 0], [10, 14]], [[0, 7.4], [10, 7.4]]] },
  I: { w: 7, strokes: [[[0.5, 14], [6.5, 14]], [[3.5, 14], [3.5, 0]], [[0.5, 0], [6.5, 0]]] },
  J: { w: 9, strokes: [[[8, 14], [8, 3.6], [6.6, 0.8], [3.8, 0], [1.2, 1.2], [0.4, 3.8]]] },
  K: { w: 10, strokes: [[[0, 0], [0, 14]], [[9.4, 14], [0.4, 6.4]], [[3.4, 8.8], [10, 0]]] },
  L: { w: 9, strokes: [[[0, 14], [0, 0], [9, 0]]] },
  M: { w: 11, strokes: [[[0, 0], [0, 14], [5.5, 3.2], [11, 14], [11, 0]]] },
  N: { w: 10, strokes: [[[0, 0], [0, 14], [10, 0], [10, 14]]] },
  O: {
    w: 10,
    strokes: [
      [[5, 14], [8, 12.8], [9.7, 9.6], [9.7, 4.4], [8, 1.2], [5, 0], [2, 1.2], [0.3, 4.4], [0.3, 9.6], [2, 12.8], [5, 14]],
    ],
  },
  P: { w: 9, strokes: [[[0, 0], [0, 14], [5.8, 14], [8.4, 12.4], [8.6, 9.4], [6.2, 7.2], [0, 6.8]]] },
  Q: {
    w: 10,
    strokes: [
      [[5, 14], [8, 12.8], [9.7, 9.6], [9.7, 4.4], [8, 1.2], [5, 0], [2, 1.2], [0.3, 4.4], [0.3, 9.6], [2, 12.8], [5, 14]],
      [[6.2, 3.4], [10, -1]],
    ],
  },
  R: { w: 10, strokes: [[[0, 0], [0, 14], [5.8, 14], [8.4, 12.4], [8.6, 9.4], [6.2, 7.2], [0, 6.8]], [[5.2, 7], [9.8, 0]]] },
  S: {
    w: 9,
    strokes: [
      [[8.8, 11.4], [7, 13.6], [3.4, 14], [1.2, 12.4], [0.6, 9.8], [2.4, 8.2], [6.6, 6.6], [8.6, 4.8], [8.6, 2.2], [6.6, 0.4], [3, 0], [1, 1], [0.2, 3]],
    ],
  },
  T: { w: 10, strokes: [[[0, 14], [10, 14]], [[5, 14], [5, 0]]] },
  U: { w: 10, strokes: [[[0, 14], [0, 4], [1.8, 0.9], [5, 0], [8.2, 0.9], [10, 4], [10, 14]]] },
  V: { w: 10, strokes: [[[0, 14], [5, 0], [10, 14]]] },
  W: { w: 12, strokes: [[[0, 14], [3, 0], [6, 9.6], [9, 0], [12, 14]]] },
  X: { w: 10, strokes: [[[0, 0], [10, 14]], [[0, 14], [10, 0]]] },
  Y: { w: 10, strokes: [[[0, 14], [5, 7], [10, 14]], [[5, 7], [5, 0]]] },
  Z: { w: 10, strokes: [[[0, 14], [10, 14], [0, 0], [10, 0]]] },

  '0': {
    w: 9,
    strokes: [
      [[4.5, 14], [7, 12.8], [8.6, 9.6], [8.6, 4.4], [7, 1.2], [4.5, 0], [2, 1.2], [0.4, 4.4], [0.4, 9.6], [2, 12.8], [4.5, 14]],
    ],
  },
  '1': { w: 9, strokes: [[[1.6, 11.4], [4.6, 14], [4.6, 0]], [[1.4, 0], [7.8, 0]]] },
  '2': { w: 9, strokes: [[[0.4, 11.4], [1.6, 13.4], [4.2, 14], [6.8, 13.4], [8.4, 11.4], [8.2, 8.8], [6.2, 6.2], [0.4, 0], [8.8, 0]]] },
  '3': {
    w: 9,
    strokes: [
      [[0.6, 12.6], [3, 14], [6.4, 14], [8.4, 12.4], [8.2, 9.6], [5.4, 8], [8.4, 6.4], [8.8, 3.4], [6.8, 0.6], [3.4, 0], [0.6, 1.4]],
    ],
  },
  '4': { w: 9, strokes: [[[6.6, 0], [6.6, 14], [0, 4.4], [9, 4.4]]] },
  '5': { w: 9, strokes: [[[8.2, 14], [1.4, 14], [0.9, 7.4], [3.4, 8.6], [6.4, 8.6], [8.6, 6.8], [8.6, 3], [6.4, 0.4], [3, 0], [0.6, 1.2]]] },
  '6': {
    w: 9,
    strokes: [
      [[8.2, 12.4], [5.8, 14], [3, 13.4], [1, 10.4], [0.4, 6], [1.4, 2.4], [4, 0], [6.8, 0.6], [8.6, 3], [8.6, 5.4], [6.8, 7.6], [4, 8], [1.4, 6.4]],
    ],
  },
  '7': { w: 9, strokes: [[[0.2, 14], [8.8, 14], [3.6, 0]]] },
  '8': {
    w: 9,
    strokes: [
      [[4.5, 7.6], [2, 8.8], [0.8, 11], [2, 13.2], [4.5, 14], [7, 13.2], [8.2, 11], [7, 8.8], [4.5, 7.6]],
      [[4.5, 7.6], [1.5, 6.4], [0.3, 3.6], [1.6, 1], [4.5, 0], [7.4, 1], [8.7, 3.6], [7.5, 6.4], [4.5, 7.6]],
    ],
  },
  '9': {
    w: 9,
    strokes: [
      [[0.8, 1.6], [3.2, 0], [6, 0.6], [8, 3.6], [8.6, 8], [7.6, 11.6], [5, 14], [2.2, 13.4], [0.4, 11], [0.4, 8.6], [2.2, 6.4], [5, 6], [7.6, 7.6]],
    ],
  },

  '.': { w: 4, strokes: [DOT(2, 0)] },
  ',': { w: 4, strokes: [[[2.4, 1.2], [2, 0], [1, -1.8]]] },
  '-': { w: 8, strokes: [[[1, 7], [7, 7]]] },
  '_': { w: 9, strokes: [[[0, -1.5], [9, -1.5]]] },
  "'": { w: 4, strokes: [[[2, 14], [2, 10.8]]] },
  '"': { w: 6, strokes: [[[1.6, 14], [1.6, 10.8]], [[4.4, 14], [4.4, 10.8]]] },
  '!': { w: 4, strokes: [[[2, 14], [2, 4]], DOT(2, 0)] },
  '?': { w: 9, strokes: [[[0.6, 11.4], [2, 13.4], [4.6, 14], [7.2, 13], [8.4, 11], [7.4, 8.6], [4.6, 7.2], [4.6, 4.4]], DOT(4.6, 0)] },
  ':': { w: 4, strokes: [DOT(2, 0), DOT(2, 7)] },
  ';': { w: 4, strokes: [DOT(2, 7), [[2.4, 1.2], [2, 0], [1, -1.8]]] },
  '+': { w: 9, strokes: [[[4.5, 10.4], [4.5, 3.6]], [[1.1, 7], [7.9, 7]]] },
  '=': { w: 9, strokes: [[[1, 9], [8, 9]], [[1, 5], [8, 5]]] },
  '/': { w: 8, strokes: [[[0.6, 0], [7.4, 14]]] },
  '\\': { w: 8, strokes: [[[0.6, 14], [7.4, 0]]] },
  '(': { w: 5, strokes: [[[4.2, 14], [1.6, 10.6], [0.8, 7], [1.6, 3.4], [4.2, 0]]] },
  ')': { w: 5, strokes: [[[0.8, 14], [3.4, 10.6], [4.2, 7], [3.4, 3.4], [0.8, 0]]] },
  '&': {
    w: 11,
    strokes: [
      [[10.4, 0], [3.4, 12.2], [3.6, 13.4], [5, 14], [6.4, 13.4], [6.6, 12.2], [5.8, 10.6], [1, 6.6], [0.4, 4], [1.4, 1.2], [4, 0], [7, 1], [9.4, 4.2], [10.8, 6.6]],
    ],
  },
  '#': { w: 10, strokes: [[[3, 14], [1.6, 0]], [[7, 14], [5.6, 0]], [[0.6, 9.6], [8.6, 9.6]], [[0.2, 4.6], [8.2, 4.6]]] },
  '*': { w: 8, strokes: [[[4, 13], [4, 7]], [[1.4, 11.5], [6.6, 8.5]], [[1.4, 8.5], [6.6, 11.5]]] },
};

/** Characters this font can engrave. */
export const SUPPORTED_CHARS = Object.keys(FONT).sort().join('');

export function unsupportedChars(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    if (ch === '\n') continue;
    if (!FONT[ch.toUpperCase()]) bad.add(ch);
  }
  return [...bad];
}

/** Grid metrics, exposed for tests. */
export const FONT_METRICS = { capHeight: CAP, spacing: SP };
export const glyphFor = (ch: string): Glyph | undefined => FONT[ch.toUpperCase()];

export interface TextOptions {
  /** Center of the rendered text block, in board space. */
  cx: number;
  cy: number;
}

/** Advance width of a string, in grid units. */
function textWidthUnits(text: string): number {
  let w = 0;
  const chars = [...text];
  chars.forEach((ch, i) => {
    const g = FONT[ch.toUpperCase()];
    if (!g) return;
    w += g.w + (i < chars.length - 1 ? SP : 0);
  });
  return w;
}

/**
 * Lay out `text` as single-line polylines, `size` tall (cap height), centered
 * on `opts`. Y is flipped on output because the font grid is y-up while board
 * space is y-down. Unsupported characters are skipped (see `unsupportedChars`).
 */
export function hersheyText(text: string, size: Nm, opts: TextOptions): Vec2[][] {
  const line = text.replace(/\s*\n\s*/g, ' ').trim();
  if (!line) return [];
  const scale = size / CAP;
  const totalW = textWidthUnits(line) * scale;

  const out: Vec2[][] = [];
  let penX = opts.cx - totalW / 2;
  const baseline = opts.cy + size / 2; // vertical center of the cap box
  const chars = [...line];

  chars.forEach((ch, i) => {
    const g = FONT[ch.toUpperCase()];
    if (!g) return;
    for (const stroke of g.strokes) {
      if (stroke.length < 2) continue;
      out.push(stroke.map(([x, y]) => ({ x: penX + x * scale, y: baseline - y * scale })));
    }
    penX += (g.w + (i < chars.length - 1 ? SP : 0)) * scale;
  });
  return out;
}
