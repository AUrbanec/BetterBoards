import { describe, expect, it } from 'vitest';
import { inch, IN } from '../src/engine/units';
import {
  baseSequence,
  cyclicShift,
  resolveTransform,
  reverseCells,
  runPipeline,
} from '../src/engine/construction/pipeline';
import type { BoardSpec } from '../src/engine/construction/types';

const cleanup = { widthTrim: inch(0.25), lengthTrim: inch(0.5), planingLoss: inch(0.125) };

function edgeBoard(over: Partial<BoardSpec> = {}): BoardSpec {
  return {
    name: 'test',
    construction: {
      kind: 'edgeGrain',
      layers: [{ strips: Array.from({ length: 12 }, () => ({ species: 'hard-maple', width: inch(1.25) })), repeat: 1 }],
    },
    targetLength: inch(18),
    targetWidth: 0,
    stockThickness: inch(0.875),
    finishedThickness: inch(0.75),
    kerf: inch(0.125),
    cleanup,
    wasteFactor: 0.2,
    roughStock: true,
    patternOffset: 0,
    ...over,
  };
}

function checkerboardBoard(over: Partial<BoardSpec> = {}): BoardSpec {
  return {
    name: 'checker',
    construction: {
      kind: 'endGrain',
      layers: [
        {
          strips: [
            { species: 'hard-maple', width: inch(1.5) },
            { species: 'black-walnut', width: inch(1.5) },
          ],
          repeat: 4,
        },
      ],
      crosscut: { angleDeg: 90 },
      transform: { kind: 'flipAlternate' },
    },
    targetLength: inch(18),
    targetWidth: 0,
    stockThickness: inch(1.625),
    finishedThickness: inch(1.25),
    kerf: inch(0.125),
    cleanup,
    wasteFactor: 0.2,
    roughStock: true,
    patternOffset: 0,
    ...over,
  };
}

describe('edge grain', () => {
  it('derives width from the stack and renders one row per strip', () => {
    const r = runPipeline(edgeBoard());
    expect(r.ok).toBe(true);
    expect(r.finished.width).toBe(inch(15));
    expect(r.finished.length).toBe(inch(18));
    expect(r.finished.thickness).toBe(inch(0.75));
    expect(r.grid.rows.length).toBe(12);
    // area conservation: Σ cell areas == board area (exact integers)
    let area = 0;
    for (const row of r.grid.rows) {
      for (const c of row.cells) area += (c.u1 - c.u0) * (row.v1 - row.v0);
    }
    expect(area).toBe(inch(15) * inch(18));
    // strips need length + trim
    expect(r.glueUp1.strips[0].length).toBe(inch(18.5));
    expect(r.glueUp1.ripCount).toBe(11);
  });
});

describe('end grain — golden 24-slice example', () => {
  // Classic worked example: 18″ finished length, slab flattened to 3/4″,
  // 1-1/4″ finished thickness, 1/8″ kerf → 24 slices, slab ≥ 33″.
  it('reproduces the published slice count and slab length', () => {
    const board = checkerboardBoard({
      stockThickness: inch(0.75),
      cleanup: { ...cleanup, planingLoss: 0 }, // slab already at 3/4
      finishedThickness: inch(1.25),
    });
    const r = runPipeline(board);
    expect(r.ok).toBe(true);
    expect(r.crosscut!.sliceCount).toBe(24);
    // slices × (finished thickness + kerf) + end trim = 24×1.375 + 0.5 = 33.5
    expect(r.glueUp1.slabLength).toBe(inch(33.5));
    expect(r.glueUp1.slabLength).toBeGreaterThanOrEqual(inch(33));
    expect(r.finished.length).toBe(24 * inch(0.75));
    expect(r.finished.thickness).toBe(inch(1.25));
  });

  it('slice width includes planing loss when flattening glue-up #2', () => {
    const r = runPipeline(checkerboardBoard());
    // sliceWidth = 1.25 + 0.125
    expect(r.crosscut!.sliceWidth).toBe(inch(1.375));
    // T1eff = 1.625 − 0.125 = 1.5 → 12 slices for 18″
    expect(r.crosscut!.sliceCount).toBe(12);
    expect(r.finished.length).toBe(inch(18));
  });
});

describe('checkerboard transform', () => {
  it('alternate rows reverse the stripe order', () => {
    const r = runPipeline(checkerboardBoard());
    const row0 = r.grid.rows[0];
    const row1 = r.grid.rows[1];
    expect(row0.cells[0].species).toBe('hard-maple');
    expect(row1.cells[0].species).toBe('black-walnut');
    // uniform cells → perfect checker: cell edges align
    expect(row0.cells.map((c) => c.u0)).toEqual(row1.cells.map((c) => c.u0));
    // every row spans the full slab width
    for (const row of r.grid.rows) {
      expect(row.cells[0].u0).toBe(0);
      expect(row.cells[row.cells.length - 1].u1).toBe(inch(12));
      expect(row.run).toBe(inch(12));
    }
  });

  it('board width equals slab width when nothing is shifted', () => {
    const r = runPipeline(checkerboardBoard());
    expect(r.finished.width).toBe(inch(12));
  });
});

describe('cell sequence ops', () => {
  const cells = [
    { species: 'A', u0: 0, u1: inch(4) },
    { species: 'B', u0: inch(4), u1: inch(6) },
  ];

  it('reverse is an involution and preserves tiling', () => {
    const rev = reverseCells(cells, inch(6));
    expect(rev[0]).toEqual({ species: 'B', u0: 0, u1: inch(2) });
    expect(rev[1]).toEqual({ species: 'A', u0: inch(2), u1: inch(6) });
    expect(reverseCells(rev, inch(6))).toEqual(cells);
  });

  it('cyclic shift moves exactly `by` to the front and pays one kerf', () => {
    const { cells: out, run } = cyclicShift(cells, inch(6), inch(2), inch(0.125));
    expect(run).toBe(inch(5.875));
    // front piece: B, exactly 2″ wide
    expect(out[0].species).toBe('B');
    expect(out[0].u0).toBe(0);
    expect(out[0].u1).toBe(inch(2));
    // remaining A follows, kerf came out of A's tail
    expect(out[1].species).toBe('A');
    expect(out[1].u0).toBe(inch(2));
    expect(out[1].u1).toBe(inch(5.875));
    // tiling with no gaps
    let total = 0;
    for (const c of out) total += c.u1 - c.u0;
    expect(total).toBe(inch(5.875));
  });

  it('shifted slices make the board one kerf narrower', () => {
    const board = checkerboardBoard({
      construction: {
        kind: 'endGrain',
        layers: [
          {
            strips: [
              { species: 'black-cherry', width: inch(2) },
              { species: 'hard-maple', width: inch(2) },
            ],
            repeat: 3,
          },
        ],
        crosscut: { angleDeg: 90 },
        transform: { kind: 'shift', by: inch(2), alternate: true },
      },
    });
    const r = runPipeline(board);
    expect(r.ok).toBe(true);
    expect(r.finished.width).toBe(inch(12) - inch(0.125));
    expect(r.issues.some((i) => i.id === 'shift-kerf')).toBe(true);
    // shifted rows still tile fully
    for (const row of r.grid.rows) {
      let total = 0;
      for (const c of row.cells) total += c.u1 - c.u0;
      expect(total).toBe(row.run);
    }
  });
});

describe('angled crosscut (chevron)', () => {
  function chevronBoard(angleDeg = 45): BoardSpec {
    return checkerboardBoard({
      construction: {
        kind: 'endGrain',
        layers: [
          {
            strips: [
              { species: 'black-walnut', width: inch(1) },
              { species: 'hard-maple', width: inch(1) },
            ],
            repeat: 7,
          },
        ],
        crosscut: { angleDeg, sliceWidth: inch(1.75) },
        transform: { kind: 'flipAlternate' },
      },
      stockThickness: inch(1),
      targetLength: inch(17.5),
      targetWidth: inch(11),
    });
  }

  it('computes slab length with 1/sinθ stretch and triangular end waste', () => {
    const r = runPipeline(chevronBoard(45));
    expect(r.ok).toBe(true);
    const sin45 = Math.SQRT1_2;
    const slices = r.crosscut!.sliceCount;
    expect(slices).toBe(10); // 17.5 / 1.75
    const expected = slices * (inch(1.875) / sin45) + inch(14) * 1 + inch(0.5);
    expect(Math.abs(r.glueUp1.slabLength - expected)).toBeLessThanOrEqual(1); // ceil to integer nm
    expect(r.crosscut!.endWaste).toBeCloseTo(inch(14), 6);
  });

  it('mirrors alternate rows and keeps the stripe angle at θ', () => {
    const r = runPipeline(chevronBoard(45));
    const r0 = r.grid.rows[0];
    const r1 = r.grid.rows[1];
    expect(r0.shear).toBeCloseTo(1, 12); // cot 45
    expect(r1.shear).toBeCloseTo(-1, 12);
    // boundary angle from the stack axis: atan(|shear|) == 90−θ … for 45° both are 45
    expect(Math.atan(Math.abs(r0.shear)) * (180 / Math.PI)).toBeCloseTo(90 - 45, 9);
    // V continuity: at the shared edge the same u maps to the same y
    const h = r0.v1 - r0.v0;
    const u = inch(3);
    const yEndRow0 = u * r0.scale - r0.offset + r0.shear * h;
    const yStartRow1 = u * r1.scale - r1.offset;
    expect(yEndRow0).toBeCloseTo(yStartRow1, 6);
  });

  it('validates that the finished width fits the stack coverage', () => {
    const too = runPipeline(checkerboardBoard({
      construction: {
        kind: 'endGrain',
        layers: [{ strips: [{ species: 'hard-maple', width: inch(2) }], repeat: 2 }],
        crosscut: { angleDeg: 45, sliceWidth: inch(2) },
        transform: { kind: 'flipAlternate' },
      },
      targetWidth: inch(11),
      stockThickness: inch(1),
    }));
    expect(too.ok).toBe(false);
    expect(too.issues.some((i) => i.id === 'angled-coverage')).toBe(true);
  });

  it('rejects unsafe angles', () => {
    const r = runPipeline(chevronBoard(15));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.id === 'bad-angle')).toBe(true);
  });
});

describe('resolveTransform', () => {
  it('maps named transforms to per-slice ops', () => {
    expect(resolveTransform({ kind: 'flipAlternate' }, 4, false)).toEqual([
      {},
      { reverse: true },
      {},
      { reverse: true },
    ]);
    expect(resolveTransform({ kind: 'flipAlternate' }, 2, true)).toEqual([{}, { mirror: true }]);
    expect(resolveTransform({ kind: 'shift', by: inch(1), alternate: true }, 3, false)).toEqual([
      {},
      { shift: inch(1) },
      {},
    ]);
    const seq = resolveTransform(
      { kind: 'sequence', ops: [{}, { mirror: true, shift: inch(1) }] },
      3,
      true,
    );
    expect(seq[2]).toEqual({});
    expect(seq[1]).toEqual({ mirror: true, shift: inch(1) });
  });
});

describe('diagonal edge grain', () => {
  it('computes the oversized panel and validates coverage', () => {
    const strips = Array.from({ length: 11 }, () => ({ species: 'hard-maple', width: inch(1.75) }));
    const board = edgeBoard({
      construction: { kind: 'edgeGrain', layers: [{ strips, repeat: 1 }], diagonalAngleDeg: 45 },
      targetLength: inch(16),
      targetWidth: inch(10),
    });
    const r = runPipeline(board);
    expect(r.ok).toBe(true);
    const need = (16 + 10) * Math.SQRT1_2 * IN;
    expect(Math.abs(r.diagonalPanel!.panelWidth - need)).toBeLessThan(2);
    expect(r.finished.width).toBe(inch(10));

    const short = runPipeline(edgeBoard({
      construction: {
        kind: 'edgeGrain',
        layers: [{ strips: strips.slice(0, 4), repeat: 1 }],
        diagonalAngleDeg: 45,
      },
      targetLength: inch(16),
      targetWidth: inch(10),
    }));
    expect(short.ok).toBe(false);
    expect(short.issues.some((i) => i.id === 'diag-coverage')).toBe(true);
  });
});

describe('base sequence', () => {
  it('accumulates exact positions', () => {
    const { cells, run } = baseSequence([
      { species: 'A', width: inch(1.5) },
      { species: 'B', width: inch(0.375) },
    ]);
    expect(run).toBe(inch(1.875));
    expect(cells[1].u0).toBe(inch(1.5));
  });
});
