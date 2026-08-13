/**
 * Pattern library (§6): each template is a deterministic function that fills
 * the construction pipeline. Templates are presets, not modes — every board
 * stays fully editable after instantiation.
 */

import { inch, type Nm } from '../units';
import type { BoardSpec, LayerGroup } from '../construction/types';
import { emptyGrid, makePatch, type Patch } from './patches';

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  build: () => BoardSpec;
}

const DEFAULTS = {
  kerf: inch(0.125),
  cleanup: { widthTrim: inch(0.25), lengthTrim: inch(0.5), planingLoss: inch(0.125) },
  wasteFactor: 0.2,
  roughStock: true,
  patternOffset: 0,
};

function base(name: string, construction: BoardSpec['construction'], over: Partial<BoardSpec> = {}): BoardSpec {
  return {
    name,
    construction,
    targetLength: inch(18),
    targetWidth: inch(12),
    stockThickness: inch(0.875),
    finishedThickness: inch(0.75),
    ...DEFAULTS,
    ...over,
  };
}

const g = (repeat: number, ...strips: { species: string; width: Nm }[]): LayerGroup => ({
  strips,
  repeat,
});
const s = (species: string, width: Nm) => ({ species, width });

/* ---------------- deterministic PRNG for the rustic template ---------------- */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- templates ---------------- */

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'classic-stripes',
    name: 'Classic Stripes',
    description: 'Edge-grain walnut & maple stripes — the timeless first board.',
    build: () =>
      base('Classic Stripes', {
        kind: 'edgeGrain',
        layers: [
          g(1, s('black-walnut', inch(1.75))),
          g(4, s('hard-maple', inch(1.25)), s('black-walnut', inch(0.75))),
          g(1, s('hard-maple', inch(1.25)), s('black-walnut', inch(1.75))),
        ],
      }),
  },
  {
    id: 'three-wood-bands',
    name: 'Three-Wood Bands',
    description: 'Bold cherry, maple, and walnut bands, edge grain.',
    build: () =>
      base('Three-Wood Bands', {
        kind: 'edgeGrain',
        layers: [
          g(1, s('black-walnut', inch(2.5)), s('hard-maple', inch(1))),
          g(1, s('black-cherry', inch(2.25)), s('hard-maple', inch(1))),
          g(1, s('black-walnut', inch(2.5)), s('hard-maple', inch(1))),
          g(1, s('black-cherry', inch(2.25))),
        ],
      }),
  },
  {
    id: 'checkerboard',
    name: 'Checkerboard',
    description: 'Classic end-grain checkerboard: walnut & maple, 1-1/2″ cells.',
    build: () =>
      base(
        'Checkerboard',
        {
          kind: 'endGrain',
          layers: [g(4, s('hard-maple', inch(1.5)), s('black-walnut', inch(1.5)))],
          crosscut: { angleDeg: 90 },
          transform: { kind: 'flipAlternate' },
        },
        {
          stockThickness: inch(1.625), // 1.5″ after flattening → square cells
          finishedThickness: inch(1.25),
          targetLength: inch(18),
        },
      ),
  },
  {
    id: 'brick',
    name: 'Brick / Running Bond',
    description: 'End-grain cherry bricks with maple mortar lines, half-cell offset.',
    build: () =>
      base(
        'Brick',
        {
          kind: 'endGrain',
          layers: [g(5, s('black-cherry', inch(2)), s('hard-maple', inch(0.375))), g(1, s('black-cherry', inch(2)))],
          crosscut: { angleDeg: 90 },
          transform: { kind: 'shift', by: inch(1.1875), alternate: true },
        },
        {
          stockThickness: inch(1.375), // 1-1/4″ bricks tall after flattening
          finishedThickness: inch(1.25),
          targetLength: inch(17.5),
        },
      ),
  },
  {
    id: 'chevron',
    name: 'Chevron',
    description: '45° chevron from walnut & maple stripes — angled crosscut, mirrored pairs.',
    build: () =>
      base(
        'Chevron',
        {
          kind: 'endGrain',
          layers: [g(7, s('black-walnut', inch(1)), s('hard-maple', inch(1)))],
          crosscut: { angleDeg: 45, sliceWidth: inch(1.75) },
          transform: { kind: 'flipAlternate' },
        },
        {
          stockThickness: inch(1),
          targetLength: inch(17.5),
          targetWidth: inch(11),
        },
      ),
  },
  {
    id: 'herringbone',
    name: 'Herringbone',
    description: 'Chevron with a half-stripe stagger between rows.',
    build: () =>
      base(
        'Herringbone',
        {
          kind: 'endGrain',
          layers: [g(8, s('black-walnut', inch(1)), s('hard-maple', inch(1)))],
          crosscut: { angleDeg: 45, sliceWidth: inch(1.5) },
          transform: { kind: 'sequence', ops: [{}, { mirror: true, shift: inch(1) }] },
        },
        {
          stockThickness: inch(1),
          targetLength: inch(18),
          targetWidth: inch(11),
        },
      ),
  },
  {
    id: 'diagonal-accent',
    name: 'Diagonal Accent',
    description: 'Edge-grain maple field crossed by walnut & padauk accent stripes at 45°.',
    build: () => {
      const layers: LayerGroup[] = [
        g(3, s('hard-maple', inch(1.75))),
        g(1, s('black-walnut', inch(0.5)), s('padauk', inch(0.375)), s('black-walnut', inch(0.5))),
        g(3, s('hard-maple', inch(1.75))),
        g(1, s('black-walnut', inch(0.75))),
        g(4, s('hard-maple', inch(1.75))),
      ];
      return base(
        'Diagonal Accent',
        { kind: 'edgeGrain', layers, diagonalAngleDeg: 45 },
        { targetLength: inch(16), targetWidth: inch(10) },
      );
    },
  },
  {
    id: 'paddle-serving',
    name: 'Paddle Serving Board',
    description: 'Edge-grain walnut & maple with a handle — shows outline shaping.',
    build: () =>
      base(
        'Paddle Serving Board',
        {
          kind: 'edgeGrain',
          layers: [
            g(1, s('black-walnut', inch(1.5))),
            g(3, s('hard-maple', inch(1)), s('black-walnut', inch(1))),
            g(1, s('hard-maple', inch(1)), s('black-walnut', inch(1.5))),
          ],
        },
        {
          targetLength: inch(20),
          stockThickness: inch(0.875),
          outline: { kind: 'paddle', handleL: inch(6), handleW: inch(2.5), filletR: inch(1.25) },
        },
      ),
  },
  {
    id: 'round-cheese',
    name: 'Round Cheese Board',
    description: 'Circular edge-grain board in cherry and maple.',
    build: () =>
      base(
        'Round Cheese Board',
        {
          kind: 'edgeGrain',
          layers: [
            g(1, s('black-cherry', inch(1.5))),
            g(4, s('hard-maple', inch(0.75)), s('black-cherry', inch(1.5))),
            g(1, s('hard-maple', inch(0.75))),
          ],
        },
        {
          targetLength: inch(12),
          stockThickness: inch(0.875),
          outline: { kind: 'ellipse' },
        },
      ),
  },
  {
    id: 'pinwheel',
    name: 'Pinwheel',
    description: 'Rotating 4-arm blocks in walnut and maple — a flat-panel glue-up.',
    build: () =>
      base(
        'Pinwheel',
        {
          kind: 'blocks',
          pattern: { kind: 'pinwheel', unit: inch(4.5), speciesA: 'black-walnut', speciesB: 'hard-maple' },
          layers: [g(1, s('black-walnut', inch(1.5)), s('hard-maple', inch(1.5)))],
        },
        { targetLength: inch(18), targetWidth: inch(13.5), stockThickness: inch(0.875) },
      ),
  },
  {
    id: 'basket-weave',
    name: 'Basket Weave',
    description: 'Alternating 3-slat units that read as woven strips.',
    build: () =>
      base(
        'Basket Weave',
        {
          kind: 'blocks',
          pattern: { kind: 'basketweave', unit: inch(3), slats: 3, speciesA: 'black-cherry', speciesB: 'hard-maple' },
          layers: [g(1, s('black-cherry', inch(1)), s('hard-maple', inch(1)))],
        },
        { targetLength: inch(18), targetWidth: inch(12), stockThickness: inch(0.875) },
      ),
  },
  {
    id: 'tumbling-blocks',
    name: 'Tumbling Blocks',
    description: '3-D cube illusion from three species on a rhombille tiling.',
    build: () =>
      base(
        'Tumbling Blocks',
        {
          kind: 'blocks',
          pattern: {
            kind: 'tumbling',
            side: inch(1.75),
            speciesA: 'hard-maple',
            speciesB: 'black-walnut',
            speciesC: 'black-cherry',
          },
          layers: [g(1, s('hard-maple', inch(1.5)), s('black-walnut', inch(1.5)), s('black-cherry', inch(1.5)))],
        },
        { targetLength: inch(16), targetWidth: inch(12), stockThickness: inch(0.875) },
      ),
  },
  {
    id: 'parabolic-arch',
    name: 'Parabolic Arch',
    description: 'A parabola drawn with one straight crosscut per column, with a padauk accent line.',
    build: () =>
      base(
        'Parabolic Arch',
        {
          kind: 'curve',
          pattern: {
            kind: 'parabolic',
            columns: 16,
            speciesLow: 'black-walnut',
            speciesHigh: 'hard-maple',
            accent: 'padauk',
            accentWidth: inch(0.1875),
            rise: 0.62,
            shape: 'arch',
            inverted: false,
          },
          layers: [g(1, s('black-walnut', inch(1.5)), s('hard-maple', inch(1.5)))],
        },
        { targetLength: inch(18), targetWidth: inch(12), stockThickness: inch(0.875) },
      ),
  },
  {
    id: 'parabolic-lens',
    name: 'Parabolic Lens',
    description: 'Two mirrored parabolas forming an eye — straight cuts only.',
    build: () =>
      base(
        'Parabolic Lens',
        {
          kind: 'curve',
          pattern: {
            kind: 'parabolic',
            columns: 20,
            speciesLow: 'black-cherry',
            speciesHigh: 'hard-maple',
            accent: 'black-walnut',
            accentWidth: inch(0.125),
            rise: 0.72,
            shape: 'lens',
            inverted: false,
          },
          layers: [g(1, s('black-cherry', inch(1.5)), s('hard-maple', inch(1.5)))],
        },
        { targetLength: inch(18), targetWidth: inch(12), stockThickness: inch(0.875) },
      ),
  },
  {
    id: 'patch-pinwheel-star',
    name: 'Patch Studio — Star',
    description: 'A worked example for the interactive designer: half-square triangles making a star.',
    build: () => {
      const cell = inch(2.25);
      const grid = emptyGrid(6, 6, cell);
      const A = 'hard-maple';
      const B = 'black-walnut';
      const set = (col: number, row: number, p: Patch) => {
        grid.patches[row * grid.cols + col] = p;
      };
      const hst = (rot: 0 | 1 | 2 | 3, a: string, b: string): Patch => ({
        kind: 'hst',
        rot,
        flip: false,
        species: [a, b],
      });
      for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 6; i++) set(i, j, makePatch('full', [A]));
      }
      // star points: four HSTs around the middle, mirrored into each quadrant
      set(2, 1, hst(0, B, A));
      set(3, 1, hst(1, A, B));
      set(1, 2, hst(0, B, A));
      set(4, 2, hst(1, A, B));
      set(1, 3, hst(3, A, B));
      set(4, 3, hst(2, B, A));
      set(2, 4, hst(3, A, B));
      set(3, 4, hst(2, B, A));
      set(2, 2, makePatch('full', [B]));
      set(3, 2, makePatch('full', [B]));
      set(2, 3, makePatch('full', [B]));
      set(3, 3, makePatch('full', [B]));
      return base(
        'Patch Studio — Star',
        { kind: 'patch', grid, layers: [g(1, s(A, inch(1.5)), s(B, inch(1.5)))] },
        { targetLength: 6 * cell, targetWidth: 6 * cell, stockThickness: inch(0.875) },
      );
    },
  },
  {
    id: 'random-rustic',
    name: 'Random Rustic',
    description: 'Seeded random stripe mix — deterministic for a given seed.',
    build: () => {
      const rnd = mulberry32(20240817);
      const pool = [
        { id: 'hard-maple', w: [inch(0.75), inch(1.25), inch(1.75)] },
        { id: 'black-walnut', w: [inch(0.75), inch(1.25), inch(1.75)] },
        { id: 'black-cherry', w: [inch(0.75), inch(1.25)] },
        { id: 'white-oak', w: [inch(0.75), inch(1.25)] },
        { id: 'sapele', w: [inch(0.75)] },
      ];
      const layers: LayerGroup[] = [];
      let total = 0;
      let last = '';
      while (total < inch(12)) {
        const p = pool[Math.floor(rnd() * pool.length)];
        if (p.id === last) continue;
        last = p.id;
        const w = p.w[Math.floor(rnd() * p.w.length)];
        layers.push(g(1, s(p.id, w)));
        total += w;
      }
      return base('Random Rustic', { kind: 'edgeGrain', layers }, { targetLength: inch(17) });
    },
  },
];

export const TEMPLATE_BY_ID: ReadonlyMap<string, TemplateDef> = new Map(
  TEMPLATES.map((t) => [t.id, t]),
);
