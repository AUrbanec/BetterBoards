import { describe, expect, it } from 'vitest';
import { IN, inch } from '../src/engine/units';
import { runPipeline, speciesAreas } from '../src/engine/construction/pipeline';
import { buildCutList } from '../src/engine/cutlist/cutlist';
import { packStock } from '../src/engine/cutlist/optimizer';
import { basketWeaveField, pinwheelField, tumblingField } from '../src/engine/patterns/blocks';
import { generateInstructions, instructionsToMarkdown } from '../src/exports/instructions';
import { renderBoardSvg } from '../src/exports/boardSvg';
import { area } from '../src/engine/geometry/polygon';
import { makeSpeciesInfoLookup, SPECIES_BY_ID } from '../src/data/species';
import type { BlockPattern } from '../src/engine/patterns/blocks';
import type { BoardSpec } from '../src/engine/construction/types';

const info = makeSpeciesInfoLookup();
const visual = (id: string) => {
  const s = SPECIES_BY_ID.get(id)!;
  return { hex: s.displayHex, tint: s.textureTint, letter: 'A', name: s.commonName };
};

function board(pattern: BlockPattern, over: Partial<BoardSpec> = {}): BoardSpec {
  return {
    name: 'blocks',
    construction: {
      kind: 'blocks',
      pattern,
      layers: [{ strips: [{ species: 'hard-maple', width: inch(1.5) }], repeat: 1 }],
    },
    targetLength: inch(18),
    targetWidth: inch(13.5),
    stockThickness: inch(0.875),
    finishedThickness: inch(0.75),
    kerf: inch(0.125),
    cleanup: { widthTrim: inch(0.25), lengthTrim: inch(0.5), planingLoss: inch(0.125) },
    wasteFactor: 0.2,
    roughStock: true,
    patternOffset: 0,
    ...over,
  };
}

const PINWHEEL: BlockPattern = { kind: 'pinwheel', unit: inch(4.5), speciesA: 'black-walnut', speciesB: 'hard-maple' };
const WEAVE: BlockPattern = { kind: 'basketweave', unit: inch(3), slats: 3, speciesA: 'black-cherry', speciesB: 'hard-maple' };
const TUMBLING: BlockPattern = { kind: 'tumbling', side: inch(1.75), speciesA: 'hard-maple', speciesB: 'black-walnut', speciesC: 'black-cherry' };

/** Every field must tile its rectangle exactly — no gaps, no overlaps. */
function expectTiles(polys: { points: { x: number; y: number }[] }[], L: number, W: number) {
  const total = polys.reduce((t, p) => t + area(p.points), 0);
  const rel = Math.abs(total - L * W) / (L * W);
  expect(rel, `covered ${total} of ${L * W}`).toBeLessThan(1e-6);
}

describe('pinwheel', () => {
  it('tiles the field with 4 arms and a hub per unit', () => {
    const f = pinwheelField(PINWHEEL as Extract<BlockPattern, { kind: 'pinwheel' }>, inch(18), inch(13.5));
    expectTiles(f.polys, inch(18), inch(13.5));
    // 4×3 units of 4.5" → 12 units × 5 pieces
    expect(f.polys.length).toBe(12 * 5);
    const arms = f.pieces.filter((p) => p.pieceId === 'arm').reduce((t, p) => t + p.count, 0);
    const hubs = f.pieces.filter((p) => p.pieceId === 'center').reduce((t, p) => t + p.count, 0);
    expect(arms).toBe(48);
    expect(hubs).toBe(12);
    // arms are 1u × 2u where u = unit/3
    const u = inch(4.5) / 3;
    for (const p of f.pieces.filter((x) => x.pieceId === 'arm')) {
      expect(Math.min(p.w, p.h)).toBeCloseTo(u, -3);
      expect(Math.max(p.w, p.h)).toBeCloseTo(2 * u, -3);
    }
  });

  it('alternates species so adjacent wheels differ', () => {
    const f = pinwheelField(PINWHEEL as Extract<BlockPattern, { kind: 'pinwheel' }>, inch(18), inch(13.5));
    const speciesUsed = new Set(f.polys.map((p) => p.species));
    expect(speciesUsed).toEqual(new Set(['black-walnut', 'hard-maple']));
    // both species carry arms and hubs somewhere in the field
    for (const sp of speciesUsed) {
      expect(f.pieces.some((p) => p.species === sp && p.pieceId === 'arm')).toBe(true);
      expect(f.pieces.some((p) => p.species === sp && p.pieceId === 'center')).toBe(true);
    }
  });
});

describe('basket weave', () => {
  it('tiles the field with n slats per unit', () => {
    const f = basketWeaveField(WEAVE as Extract<BlockPattern, { kind: 'basketweave' }>, inch(18), inch(12));
    expectTiles(f.polys, inch(18), inch(12));
    expect(f.polys.length).toBe(6 * 4 * 3); // 6×4 units × 3 slats
    const total = f.pieces.reduce((t, p) => t + p.count, 0);
    expect(total).toBe(72);
  });

  it('slats are unit-long and unit/n wide', () => {
    const f = basketWeaveField(WEAVE as Extract<BlockPattern, { kind: 'basketweave' }>, inch(18), inch(12));
    for (const p of f.pieces) {
      expect(Math.max(p.w, p.h)).toBeCloseTo(inch(3), -3);
      expect(Math.min(p.w, p.h)).toBeCloseTo(inch(1), -3);
    }
  });
});

describe('tumbling blocks', () => {
  it('tiles the field with rhombi in three species', () => {
    const f = tumblingField(TUMBLING as Extract<BlockPattern, { kind: 'tumbling' }>, inch(16), inch(12));
    expectTiles(f.polys, inch(16), inch(12));
    const species = new Set(f.polys.map((p) => p.species));
    expect(species).toEqual(new Set(['hard-maple', 'black-walnut', 'black-cherry']));
  });

  it('gives each species an equal share (the cube illusion depends on it)', () => {
    const f = tumblingField(TUMBLING as Extract<BlockPattern, { kind: 'tumbling' }>, inch(16), inch(12));
    const byS = new Map<string, number>();
    for (const p of f.polys) byS.set(p.species, (byS.get(p.species) ?? 0) + area(p.points));
    const total = [...byS.values()].reduce((a, b) => a + b, 0);
    for (const a of byS.values()) {
      expect(a / total).toBeGreaterThan(0.28);
      expect(a / total).toBeLessThan(0.39);
    }
  });

  it('derives a strip-and-60°-crosscut schedule', () => {
    const f = tumblingField(TUMBLING as Extract<BlockPattern, { kind: 'tumbling' }>, inch(16), inch(12));
    for (const p of f.pieces) {
      expect(p.angleDeg).toBe(60);
      expect(p.w).toBeCloseTo(inch(1.75) * Math.sin(Math.PI / 3), -3);
      expect(p.h).toBeCloseTo(inch(1.75), -3);
    }
    expect(f.notes.join(' ')).toMatch(/60°/);
  });
});

describe('block pipeline', () => {
  it('produces a poly grid, piece schedule, and finished dims', () => {
    const b = board(PINWHEEL);
    const r = runPipeline(b);
    expect(r.ok).toBe(true);
    expect(r.grid.map.kind).toBe('poly');
    expect(r.grid.polys!.length).toBeGreaterThan(0);
    expect(r.grid.rows).toEqual([]);
    expect(r.finished.length).toBe(inch(18));
    expect(r.finished.width).toBe(inch(13.5));
    expect(r.pieces!.length).toBeGreaterThan(0);
  });

  it('areas are computed from the polygons and cover the board', () => {
    const r = runPipeline(board(PINWHEEL));
    const { total, bySpecies } = speciesAreas(r);
    expect(Math.abs(total - inch(18) * inch(13.5)) / total).toBeLessThan(1e-6);
    expect(bySpecies.size).toBe(2);
  });

  it('clips to an outline like every other construction', () => {
    const r = runPipeline(board(PINWHEEL, { outline: { kind: 'ellipse' } }));
    const { total } = speciesAreas(r);
    const expected = Math.PI * (inch(18) / 2) * (inch(13.5) / 2);
    expect(Math.abs(total - expected) / expected).toBeLessThan(1e-3);
  });

  it('errors when the unit is bigger than the board', () => {
    const r = runPipeline(board({ ...PINWHEEL, unit: inch(30) } as BlockPattern));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.id === 'unit-too-big')).toBe(true);
  });

  it('cut list counts every piece and costs them', () => {
    const b = board(WEAVE, { targetWidth: inch(12) });
    const r = runPipeline(b);
    const cl = buildCutList(b, r, info);
    const pieces = r.pieces!.reduce((t, p) => t + p.count, 0);
    expect(r.glueUp1.strips.length).toBe(pieces);
    expect(cl.totals.boardFeetRough).toBeGreaterThan(0);
    expect(cl.perSpecies.length).toBe(2);
  });

  it('instructions describe a flat-panel glue-up, not a slab and slices', () => {
    const b = board(TUMBLING, { targetLength: inch(16), targetWidth: inch(12) });
    const r = runPipeline(b);
    const cl = buildCutList(b, r, info);
    const md = instructionsToMarkdown(generateInstructions(b, r, cl, info));
    expect(md).toContain('Cut the pieces');
    expect(md).toContain('Dry-fit the field');
    expect(md).toContain('Glue-up 1 — rows');
    expect(md).toContain('Glue-up 2 — join into the panel');
    expect(md).not.toContain('Crosscut into slices');
    expect(md).toMatch(/60°/);
    // a flat-panel field is two glue-ups, and the plan says so
    const ins = generateInstructions(b, r, cl, info);
    expect(ins.glueUps).toBe(2);
    expect(ins.intro).toContain('2 glue-ups');
  });

  it('renders every block pattern to clean SVG', () => {
    for (const pattern of [PINWHEEL, WEAVE, TUMBLING]) {
      const r = runPipeline(board(pattern, { targetLength: inch(16), targetWidth: inch(12) }));
      expect(r.ok).toBe(true);
      const svg = renderBoardSvg(r.grid, visual, { pxPerIn: 18, outline: r.outline });
      expect(svg).not.toContain('NaN');
      expect(svg).not.toContain('undefined');
      const paths = (svg.match(/<path d="M/g) ?? []).length;
      expect(paths).toBeGreaterThanOrEqual(r.grid.polys!.length);
    }
  });
});

describe('stock optimizer', () => {
  const rip = (species: string, count: number, width: number, length: number) => ({
    species,
    count,
    width,
    thickness: inch(0.875),
    length,
  });

  it('packs parts first-fit-decreasing and reports offcuts', () => {
    const res = packStock(
      [rip('hard-maple', 4, inch(2), inch(20))],
      [{ species: 'hard-maple', length: inch(96), count: 1 }],
      inch(0.125),
    );
    expect(res.unplaced).toEqual([]);
    expect(res.boards.length).toBe(1);
    expect(res.boards[0].parts.length).toBe(4);
    // 4×20 + 3 kerfs = 80.375
    expect(res.boards[0].used).toBeCloseTo(inch(80.375), -3);
    expect(res.boards[0].offcut).toBeCloseTo(inch(15.625), -3);
    expect(res.utilization).toBeGreaterThan(0.8);
  });

  it('opens more boards when the on-hand stock runs out, and says so', () => {
    const res = packStock(
      [rip('hard-maple', 10, inch(2), inch(30))],
      [{ species: 'hard-maple', length: inch(60), count: 1 }],
      inch(0.125),
    );
    expect(res.unplaced).toEqual([]);
    expect(res.shortfall.length).toBe(1);
    expect(res.shortfall[0].count).toBeGreaterThan(0);
    expect(res.boards.length).toBeGreaterThan(1);
  });

  it('reports parts longer than any board rather than dropping them', () => {
    const res = packStock(
      [rip('hard-maple', 2, inch(2), inch(120))],
      [{ species: 'hard-maple', length: inch(96), count: 2 }],
      inch(0.125),
    );
    expect(res.unplaced.length).toBe(2);
    expect(res.boards.length).toBe(0);
  });

  it('never places a part on the wrong species', () => {
    const res = packStock(
      [rip('hard-maple', 2, inch(2), inch(20)), rip('black-walnut', 2, inch(2), inch(20))],
      [
        { species: 'hard-maple', length: inch(96), count: 1 },
        { species: 'black-walnut', length: inch(96), count: 1 },
      ],
      inch(0.125),
    );
    for (const b of res.boards) {
      for (const p of b.parts) expect(p.species).toBe(b.species);
    }
  });

  it('never overfills a board', () => {
    const res = packStock(
      [rip('hard-maple', 30, inch(2), inch(13))],
      [{ species: 'hard-maple', length: inch(48), count: 4 }],
      inch(0.125),
    );
    for (const b of res.boards) expect(b.used).toBeLessThanOrEqual(b.length + 1);
    expect(res.usableOffcut).toBeGreaterThanOrEqual(0);
  });

  it('handles empty inventory by reporting everything unplaced', () => {
    const res = packStock([rip('hard-maple', 3, inch(2), inch(20))], [], inch(0.125));
    expect(res.unplaced.length).toBe(3);
    expect(res.utilization).toBe(0);
  });
});

describe('grid model regression', () => {
  it('strip constructions still use rows, not polys', () => {
    const r = runPipeline({
      ...board(PINWHEEL),
      construction: {
        kind: 'edgeGrain',
        layers: [{ strips: [{ species: 'hard-maple', width: inch(1.5) }], repeat: 8 }],
      },
    });
    expect(r.grid.map.kind).toBe('rows-y');
    expect(r.grid.polys).toBeUndefined();
    expect(r.grid.rows.length).toBe(8);
    expect(speciesAreas(r).total).toBeCloseTo(IN * 18 * IN * 12, -8);
  });
});
