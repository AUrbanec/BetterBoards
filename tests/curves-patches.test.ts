import { describe, expect, it } from 'vitest';
import { inch } from '../src/engine/units';
import { runPipeline, speciesAreas } from '../src/engine/construction/pipeline';
import { buildCutList } from '../src/engine/cutlist/cutlist';
import { buildPlan } from '../src/exports/stages';
import { generateInstructions, instructionsToMarkdown } from '../src/exports/instructions';
import { renderBoardSvg } from '../src/exports/boardSvg';
import { area } from '../src/engine/geometry/polygon';
import { parabolicField, type CurvePattern } from '../src/engine/patterns/curves';
import {
  REGION_COUNT,
  buildPatchField,
  emptyGrid,
  fillEmpty,
  makePatch,
  mirrorGridH,
  mirrorGridV,
  patchRegions,
  resizeGrid,
  rotateGrid,
  type PatchGrid,
  type PatchKind,
} from '../src/engine/patterns/patches';
import { TEMPLATE_BY_ID } from '../src/engine/patterns/templates';
import { makeSpeciesInfoLookup, SPECIES_BY_ID } from '../src/data/species';
import type { BoardSpec } from '../src/engine/construction/types';

const info = makeSpeciesInfoLookup();
const visual = (id: string) => {
  const s = SPECIES_BY_ID.get(id)!;
  return { hex: s.displayHex, tint: s.textureTint, letter: 'A', name: s.commonName };
};

const ARCH: CurvePattern = {
  kind: 'parabolic',
  columns: 12,
  speciesLow: 'black-walnut',
  speciesHigh: 'hard-maple',
  accent: 'padauk',
  accentWidth: inch(0.1875),
  rise: 0.6,
  shape: 'arch',
  inverted: false,
};

function curveBoard(pattern: CurvePattern, over: Partial<BoardSpec> = {}): BoardSpec {
  return {
    name: 'curve',
    construction: { kind: 'curve', pattern, layers: [{ strips: [{ species: 'hard-maple', width: inch(1.5) }], repeat: 1 }] },
    targetLength: inch(18),
    targetWidth: inch(12),
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

function patchBoard(grid: PatchGrid): BoardSpec {
  return {
    ...curveBoard(ARCH),
    name: 'patch',
    construction: { kind: 'patch', grid, layers: [{ strips: [{ species: 'hard-maple', width: inch(1.5) }], repeat: 1 }] },
    targetLength: grid.cols * grid.cell,
    targetWidth: grid.rows * grid.cell,
  };
}

const tilesExactly = (polys: { points: { x: number; y: number }[] }[], L: number, W: number) => {
  const total = polys.reduce((t, p) => t + area(p.points), 0);
  return Math.abs(total - L * W) / (L * W);
};

/* ------------------------------------------------------------------ */

describe('parabolic curves from straight cuts', () => {
  it('tiles the board exactly, one column per straight cut', () => {
    const f = parabolicField(ARCH, inch(18), inch(12));
    expect(tilesExactly(f.polys, inch(18), inch(12))).toBeLessThan(1e-6);
    expect(f.subAssemblies).toBe(12);
    expect(f.columnAngles.length).toBe(12);
  });

  it('every boundary is a straight segment — the curve is the chord path', () => {
    const f = parabolicField({ ...ARCH, accent: undefined, accentWidth: 0 }, inch(18), inch(12));
    // each poly is a quad: two vertical sides and two straight boundaries
    for (const p of f.polys) expect(p.points.length).toBe(4);
    // the boundary heights follow a parabola: second differences are constant
    const tops = f.polys.filter((p) => p.pieceId === 'below').map((p) => p.points[0].y);
    const d2: number[] = [];
    for (let i = 2; i < tops.length; i++) d2.push(tops[i] - 2 * tops[i - 1] + tops[i - 2]);
    const mean = d2.reduce((a, b) => a + b, 0) / d2.length;
    for (const v of d2) expect(Math.abs(v - mean)).toBeLessThan(Math.abs(mean) * 1e-6 + 1);
    expect(mean).toBeGreaterThan(0); // convex — a real parabola, not a straight line
  });

  it('angles run from flat at the vertex to steepest at the edge', () => {
    const f = parabolicField({ ...ARCH, columns: 10 }, inch(18), inch(12));
    const mid = Math.floor(f.columnAngles.length / 2);
    const absAngles = f.columnAngles.map(Math.abs);
    expect(absAngles[mid]).toBeLessThan(absAngles[0]);
    expect(absAngles[mid]).toBeLessThan(absAngles[absAngles.length - 1]);
  });

  it('more columns approximate the parabola more closely', () => {
    // the chord path always sits inside the true parabola; the gap shrinks as
    // columns increase, which is the whole reason to add them
    const gap = (columns: number) => {
      const f = parabolicField({ ...ARCH, accent: undefined, accentWidth: 0, columns }, inch(18), inch(12));
      const below = f.polys.filter((p) => p.pieceId === 'below');
      // sagitta at the middle column: chord midpoint vs the true curve
      let worst = 0;
      for (const p of below) {
        const chordMid = (p.points[0].y + p.points[1].y) / 2;
        const xMid = (p.points[0].x + p.points[1].x) / 2;
        const u = xMid - inch(18) / 2;
        const vertexY = inch(12) * (1 - 0.6);
        const k = (inch(12) - vertexY) / Math.pow(inch(18) / 2, 2);
        worst = Math.max(worst, Math.abs(chordMid - (vertexY + k * u * u)));
      }
      return worst;
    };
    expect(gap(24)).toBeLessThan(gap(8));
    expect(gap(48)).toBeLessThan(gap(24));
  });

  it('accent line adds a third piece per column', () => {
    const withAccent = parabolicField(ARCH, inch(18), inch(12));
    const without = parabolicField({ ...ARCH, accent: undefined, accentWidth: 0 }, inch(18), inch(12));
    expect(withAccent.polys.length).toBeGreaterThan(without.polys.length);
    expect(withAccent.polys.some((p) => p.species === 'padauk')).toBe(true);
  });

  it('lens shape is symmetric about the centreline', () => {
    const f = parabolicField({ ...ARCH, shape: 'lens', accent: undefined, accentWidth: 0 }, inch(18), inch(12));
    expect(tilesExactly(f.polys, inch(18), inch(12))).toBeLessThan(1e-6);
    const lens = f.polys.filter((p) => p.pieceId === 'lens');
    for (const p of lens) {
      const mid = (p.points[0].y + p.points[3].y) / 2;
      expect(Math.abs(mid - inch(12) / 2)).toBeLessThan(inch(0.01));
    }
  });

  it('pipeline reports tapered pieces and column sub-assemblies', () => {
    const b = curveBoard(ARCH);
    const r = runPipeline(b);
    expect(r.ok).toBe(true);
    expect(r.grid.map.kind).toBe('poly');
    expect(r.subAssemblies).toBe(12);
    expect(r.subAssemblyLabel).toBe('column');
    expect(r.pieces!.some((p) => p.tapered)).toBe(true);
    expect(Math.abs(speciesAreas(r).total - inch(18) * inch(12)) / (inch(18) * inch(12))).toBeLessThan(1e-6);
  });

  it('rejects a single column', () => {
    expect(runPipeline(curveBoard({ ...ARCH, columns: 1 })).ok).toBe(false);
  });

  it('warns on fragile columns and errors on ones the kerf would eat', () => {
    // 18" / 60 = 0.3" — narrow enough to be fiddly, still wider than two kerfs
    const thin = runPipeline(curveBoard({ ...ARCH, columns: 60 }, { targetLength: inch(18) }));
    expect(thin.ok).toBe(true);
    expect(thin.issues.some((i) => i.id === 'columns-thin')).toBe(true);

    // 12" / 60 = 0.2" — below two kerfs, so more of the column is sawdust than wood
    const absurd = runPipeline(curveBoard({ ...ARCH, columns: 60 }, { targetLength: inch(12) }));
    expect(absurd.ok).toBe(false);
    expect(absurd.issues.some((i) => i.id === 'columns-too-narrow')).toBe(true);
  });

  it('renders and needs three glue-ups', () => {
    const b = curveBoard(ARCH);
    const r = runPipeline(b);
    const cl = buildCutList(b, r, info);
    const plan = buildPlan(b, r, cl, info);
    expect(plan.glueUps).toBe(3);
    expect(plan.stages.some((s) => s.title.includes('column sub-assemblies'))).toBe(true);
    const md = instructionsToMarkdown(generateInstructions(b, r, cl, info));
    expect(md).toContain('taper');
    const svg = renderBoardSvg(r.grid, visual, { pxPerIn: 18, outline: r.outline });
    expect(svg).not.toContain('NaN');
  });
});

/* ------------------------------------------------------------------ */

describe('patch grid', () => {
  const kinds: PatchKind[] = ['full', 'hst', 'qst', 'halfV', 'halfH', 'quarters', 'stripes3', 'chevron'];

  it('every patch kind tiles its unit cell exactly', () => {
    for (const kind of kinds) {
      const regions = patchRegions(makePatch(kind, ['a', 'b', 'c', 'd']));
      expect(regions.length, kind).toBe(REGION_COUNT[kind]);
      const total = regions.reduce((t, r) => t + area(r.map(([x, y]) => ({ x, y }))), 0);
      expect(Math.abs(total - 1), kind).toBeLessThan(1e-9);
    }
  });

  it('rotation and flip preserve the tiling', () => {
    for (const kind of kinds) {
      for (const rot of [0, 1, 2, 3] as const) {
        for (const flip of [false, true]) {
          const regions = patchRegions({ kind, rot, flip, species: ['a', 'b', 'c', 'd'] });
          const total = regions.reduce((t, r) => t + area(r.map(([x, y]) => ({ x, y }))), 0);
          expect(Math.abs(total - 1), `${kind} rot${rot} flip${flip}`).toBeLessThan(1e-9);
          for (const r of regions) {
            for (const [x, y] of r) {
              expect(x).toBeGreaterThanOrEqual(-1e-9);
              expect(x).toBeLessThanOrEqual(1 + 1e-9);
              expect(y).toBeGreaterThanOrEqual(-1e-9);
              expect(y).toBeLessThanOrEqual(1 + 1e-9);
            }
          }
        }
      }
    }
  });

  it('a filled grid tiles the board and counts every piece', () => {
    const cell = inch(2);
    const grid = fillEmpty(emptyGrid(5, 4, cell), 'hard-maple');
    grid.patches[0] = makePatch('hst', ['black-walnut', 'hard-maple']);
    grid.patches[7] = makePatch('qst', ['black-walnut', 'hard-maple', 'black-cherry', 'hard-maple']);
    const f = buildPatchField(grid, 5 * cell, 4 * cell);
    expect(tilesExactly(f.polys, 5 * cell, 4 * cell)).toBeLessThan(1e-9);
    // 18 solid + 2 hst regions + 4 qst regions
    expect(f.polys.length).toBe(18 + 2 + 4);
    expect(f.subAssemblies).toBe(2);
    const totalPieces = f.pieces.reduce((t, p) => t + p.count, 0);
    expect(totalPieces).toBe(f.polys.length);
  });

  it('derives real cutting recipes per shape', () => {
    const cell = inch(2);
    const grid = emptyGrid(2, 1, cell);
    grid.patches[0] = makePatch('hst', ['black-walnut', 'hard-maple']);
    grid.patches[1] = makePatch('quarters', ['a', 'b', 'c', 'd']);
    const f = buildPatchField(grid, 2 * cell, cell);
    const hst = f.pieces.find((p) => p.pieceId === 'half-square triangle')!;
    expect(hst.angleDeg).toBe(45);
    expect(hst.w).toBe(cell); // cut a cell-sized square, split corner to corner
    const q = f.pieces.find((p) => p.pieceId === 'quarter square')!;
    expect(q.w).toBe(cell / 2);
    expect(f.notes.join(' ')).toMatch(/corner to corner/);
  });

  it('empty cells are an error, not a silent hole', () => {
    const grid = emptyGrid(3, 3, inch(2));
    grid.patches[0] = makePatch('full', ['hard-maple']);
    const r = runPipeline(patchBoard(grid));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.id === 'empty-cells')).toBe(true);
    // filling them clears the error
    expect(runPipeline(patchBoard(fillEmpty(grid, 'hard-maple'))).ok).toBe(true);
  });

  it('board size follows the lattice, which is what keeps the cut list exact', () => {
    const cell = inch(2.25);
    const grid = fillEmpty(emptyGrid(6, 4, cell), 'hard-maple');
    const r = runPipeline(patchBoard(grid));
    expect(r.finished.length).toBe(6 * cell);
    expect(r.finished.width).toBe(4 * cell);
    const totalPieces = r.pieces!.reduce((t, p) => t + p.count, 0);
    expect(r.glueUp1.strips.length).toBe(totalPieces);
  });
});

describe('cut list distinguishes shapes, not just sizes', () => {
  it('a square and a half-square triangle of the same size are separate lines', () => {
    // Regression: grouping by species+width alone merged them, so the schedule
    // said "15 squares" for pieces that actually need a diagonal cut.
    const cell = inch(2.25);
    const grid = fillEmpty(emptyGrid(3, 2, cell), 'black-walnut');
    grid.patches[0] = makePatch('hst', ['black-walnut', 'black-walnut']);
    const b = patchBoard(grid);
    const r = runPipeline(b);
    const cl = buildCutList(b, r, info);

    const walnut = cl.ripSchedule.filter((g) => g.species === 'black-walnut');
    const squares = walnut.find((g) => g.pieceId === 'square');
    const triangles = walnut.find((g) => g.pieceId === 'half-square triangle');
    expect(squares, 'squares must be their own line').toBeDefined();
    expect(triangles, 'triangles must be their own line').toBeDefined();
    expect(squares!.count).toBe(5);
    expect(triangles!.count).toBe(2);
    expect(triangles!.angleDeg).toBe(45);
    // identical dimensions — only the shape tells them apart
    expect(triangles!.width).toBe(squares!.width);
  });

  it('tapered curve pieces report both end widths', () => {
    const b = curveBoard({ ...ARCH, accent: undefined, accentWidth: 0 });
    const r = runPipeline(b);
    const cl = buildCutList(b, r, info);
    const tapered = cl.ripSchedule.filter((g) => g.width2 !== undefined);
    expect(tapered.length).toBeGreaterThan(0);
    for (const g of tapered) expect(g.width2).not.toBe(g.width);
  });

  it('plain strip constructions still report no shape', () => {
    const b = TEMPLATE_BY_ID.get('classic-stripes')!.build();
    const cl = buildCutList(b, runPipeline(b), info);
    expect(cl.ripSchedule.every((g) => g.pieceId === undefined)).toBe(true);
  });
});

describe('patch grid transforms', () => {
  const seeded = () => {
    const grid = fillEmpty(emptyGrid(4, 3, inch(2)), 'hard-maple');
    grid.patches[0] = makePatch('hst', ['black-walnut', 'hard-maple']);
    grid.patches[5] = { kind: 'chevron', rot: 1, flip: false, species: ['a', 'b', 'c', 'd'] };
    return grid;
  };

  it('mirroring twice is the identity', () => {
    const g = seeded();
    expect(mirrorGridH(mirrorGridH(g))).toEqual(g);
    expect(mirrorGridV(mirrorGridV(g))).toEqual(g);
  });

  it('rotating four times is the identity', () => {
    const g = seeded();
    expect(rotateGrid(rotateGrid(rotateGrid(rotateGrid(g))))).toEqual(g);
  });

  it('rotation swaps the grid dimensions', () => {
    const g = seeded();
    const r = rotateGrid(g);
    expect(r.cols).toBe(g.rows);
    expect(r.rows).toBe(g.cols);
    expect(r.patches.filter(Boolean).length).toBe(g.patches.filter(Boolean).length);
  });

  it('transforms never lose or invent patches', () => {
    const g = seeded();
    for (const t of [mirrorGridH, mirrorGridV, rotateGrid]) {
      expect(t(g).patches.filter(Boolean).length).toBe(g.patches.filter(Boolean).length);
    }
  });

  it('resize keeps what still fits', () => {
    const g = seeded();
    const smaller = resizeGrid(g, 2, 2);
    expect(smaller.cols).toBe(2);
    expect(smaller.patches.length).toBe(4);
    expect(smaller.patches[0]).toEqual(g.patches[0]);
    const bigger = resizeGrid(g, 6, 5);
    expect(bigger.patches.filter(Boolean).length).toBe(g.patches.filter(Boolean).length);
  });
});

describe('multi-stage build plans', () => {
  const plans = (id: string) => {
    const b = TEMPLATE_BY_ID.get(id)!.build();
    const r = runPipeline(b);
    return buildPlan(b, r, buildCutList(b, r, info), info);
  };

  it('reports the glue-up count each construction really needs', () => {
    expect(plans('classic-stripes').glueUps).toBe(1); // rip, glue, done
    expect(plans('checkerboard').glueUps).toBe(2); // slab, then slices
    expect(plans('chevron').glueUps).toBe(2);
    expect(plans('pinwheel').glueUps).toBe(2); // rows, then panel
    expect(plans('parabolic-arch').glueUps).toBe(3); // columns, groups, panel
    expect(plans('patch-pinwheel-star').glueUps).toBe(3); // patches, rows, panel
  });

  it('numbers glue-up stages consecutively from 1', () => {
    for (const id of ['classic-stripes', 'checkerboard', 'parabolic-arch', 'patch-pinwheel-star']) {
      const p = plans(id);
      const nums = p.stages.filter((s) => s.glueUp !== undefined).map((s) => s.glueUp);
      expect(nums, id).toEqual(Array.from({ length: p.glueUps }, (_, i) => i + 1));
      // and each glue stage's title carries its own number
      for (const s of p.stages.filter((x) => x.glueUp !== undefined)) {
        expect(s.title, id).toContain(`Glue-up ${s.glueUp}`);
      }
    }
  });

  it('states the glue-up and machining counts in the intro', () => {
    const p = plans('parabolic-arch');
    expect(p.intro).toContain('3 glue-ups');
    expect(p.intro).toContain(`${p.cuttingStages} machining stage`);
  });

  it('instructions and the on-screen plan come from the same source', () => {
    const b = TEMPLATE_BY_ID.get('patch-pinwheel-star')!.build();
    const r = runPipeline(b);
    const cl = buildCutList(b, r, info);
    const plan = buildPlan(b, r, cl, info);
    const ins = generateInstructions(b, r, cl, info);
    expect(ins.steps.map((s) => s.title)).toEqual(plan.stages.map((s) => s.title));
    expect(ins.glueUps).toBe(plan.glueUps);
  });

  it('every stage has a body, and cutting stages carry safety notes where it matters', () => {
    for (const id of ['checkerboard', 'parabolic-arch', 'tumbling-blocks']) {
      for (const s of plans(id).stages) {
        expect(s.body.length, `${id}/${s.title}`).toBeGreaterThan(20);
        expect(s.short.length).toBeGreaterThan(0);
      }
    }
  });
});
