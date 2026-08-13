import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { IN, inch } from '../src/engine/units';
import {
  baseSequence,
  cyclicShift,
  reverseCells,
  runPipeline,
} from '../src/engine/construction/pipeline';
import type { BoardSpec, SliceTransform, StripSpec } from '../src/engine/construction/types';

const STEP = IN / 32; // strip widths in 1/32″ increments

const stripArb = fc.record({
  species: fc.constantFrom('hard-maple', 'black-walnut', 'black-cherry', 'padauk'),
  width: fc.integer({ min: 8, max: 80 }).map((n) => n * STEP), // 1/4″ .. 2.5″
});

const stripsArb = fc.array(stripArb, { minLength: 2, maxLength: 12 });

function endGrainBoard(strips: StripSpec[], transform: SliceTransform): BoardSpec {
  return {
    name: 'prop',
    construction: {
      kind: 'endGrain',
      layers: [{ strips, repeat: 1 }],
      crosscut: { angleDeg: 90 },
      transform,
    },
    targetLength: inch(12),
    targetWidth: 0,
    stockThickness: inch(1.125),
    finishedThickness: inch(1.25),
    kerf: inch(0.125),
    cleanup: { widthTrim: inch(0.25), lengthTrim: inch(0.5), planingLoss: inch(0.125) },
    wasteFactor: 0.2,
    roughStock: true,
    patternOffset: 0,
  };
}

describe('property: cell sequence algebra', () => {
  it('reverse ∘ reverse = id', () => {
    fc.assert(
      fc.property(stripsArb, (strips) => {
        const { cells, run } = baseSequence(strips);
        expect(reverseCells(reverseCells(cells, run), run)).toEqual(cells);
      }),
    );
  });

  it('reverse preserves the exact tiling of [0, run]', () => {
    fc.assert(
      fc.property(stripsArb, (strips) => {
        const { cells, run } = baseSequence(strips);
        const rev = reverseCells(cells, run);
        let u = 0;
        for (const c of rev) {
          expect(c.u0).toBe(u);
          expect(c.u1).toBeGreaterThan(c.u0);
          u = c.u1;
        }
        expect(u).toBe(run);
      }),
    );
  });

  it('cyclic shift: exact front width, one kerf lost, no gaps', () => {
    fc.assert(
      fc.property(
        stripsArb,
        fc.integer({ min: 1, max: 60 }).map((n) => n * STEP),
        (strips, by) => {
          const { cells, run } = baseSequence(strips);
          const kerf = inch(0.125);
          fc.pre(by < run - kerf - STEP);
          const out = cyclicShift(cells, run, by, kerf);
          expect(out.run).toBe(run - kerf);
          let u = 0;
          for (const c of out.cells) {
            expect(c.u0).toBe(u);
            u = c.u1;
          }
          expect(u).toBe(out.run);
        },
      ),
    );
  });
});

describe('property: pipeline conservation', () => {
  it('area conservation & per-row tiling across transforms (square end grain)', () => {
    const transformArb = fc.oneof(
      fc.constant({ kind: 'none' } as const),
      fc.constant({ kind: 'flipAlternate' } as const),
      fc.constant({ kind: 'rotate180Alternate' } as const),
    );
    fc.assert(
      fc.property(stripsArb, transformArb, (strips, transform) => {
        const r = runPipeline(endGrainBoard(strips, transform));
        expect(r.ok).toBe(true);
        const slabWidth = strips.reduce((t, s) => t + s.width, 0);
        for (const row of r.grid.rows) {
          // exact tiling of each row
          let u = 0;
          let area = 0;
          for (const c of row.cells) {
            expect(c.u0).toBe(u);
            u = c.u1;
            area += c.u1 - c.u0;
          }
          expect(u).toBe(row.run);
          expect(row.run).toBe(slabWidth);
          expect(area).toBe(slabWidth);
        }
        // Σ cell areas == slab width × assembled length (exact integers)
        let total = 0;
        for (const row of r.grid.rows) {
          for (const c of row.cells) total += (c.u1 - c.u0) * (row.v1 - row.v0);
        }
        expect(total).toBe(slabWidth * r.finished.length);
      }),
    );
  });

  it('cut list rebuilt from the grid matches the strip stack (pipeline inverse)', () => {
    fc.assert(
      fc.property(stripsArb, (strips) => {
        const r = runPipeline(endGrainBoard(strips, { kind: 'none' }));
        // every row carries the same multiset of (species,width) intervals
        const key = (s: string, w: number) => `${s}|${w}`;
        const expected = new Map<string, number>();
        for (const s of strips) expected.set(key(s.species, s.width), (expected.get(key(s.species, s.width)) ?? 0) + 1);
        for (const row of r.grid.rows) {
          const got = new Map<string, number>();
          for (const c of row.cells) got.set(key(c.species, c.u1 - c.u0), (got.get(key(c.species, c.u1 - c.u0)) ?? 0) + 1);
          expect(got).toEqual(expected);
        }
      }),
    );
  });

  it('chevron stripe angle equals θ for any angle in range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 25, max: 89 }),
        fc.integer({ min: 2, max: 8 }),
        (angleDeg, pairs) => {
          const strips: StripSpec[] = [];
          for (let i = 0; i < pairs; i++) {
            strips.push({ species: 'black-walnut', width: inch(1) });
            strips.push({ species: 'hard-maple', width: inch(1) });
          }
          const board: BoardSpec = {
            ...endGrainBoard(strips, { kind: 'flipAlternate' }),
            construction: {
              kind: 'endGrain',
              layers: [{ strips, repeat: 1 }],
              crosscut: { angleDeg, sliceWidth: inch(1.5) },
              transform: { kind: 'flipAlternate' },
            },
            targetWidth: inch(1), // stay far inside coverage
          };
          const r = runPipeline(board);
          expect(r.ok).toBe(true);
          for (const row of r.grid.rows) {
            const boundaryAngleFromCut = 90 - Math.atan(Math.abs(row.shear)) * (180 / Math.PI);
            expect(Math.abs(boundaryAngleFromCut - angleDeg)).toBeLessThan(1e-9);
          }
        },
      ),
    );
  });
});
