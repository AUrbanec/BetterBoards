import { describe, expect, it } from 'vitest';
import { inch } from '../src/engine/units';
import { runPipeline, speciesAreas } from '../src/engine/construction/pipeline';
import { buildCutList } from '../src/engine/cutlist/cutlist';
import { validateBoard, type SpeciesMeta } from '../src/engine/validate/rules';
import { generateInstructions, instructionsToMarkdown } from '../src/exports/instructions';
import { renderBoardSvg } from '../src/exports/boardSvg';
import { area } from '../src/engine/geometry/polygon';
import { isPlainRect, outlineToRing } from '../src/engine/geometry/outline';
import { SPECIES_BY_ID, makeSpeciesInfoLookup } from '../src/data/species';
import type { BoardSpec } from '../src/engine/construction/types';
import type { OutlineSpec } from '../src/engine/geometry/outline';

const info = makeSpeciesInfoLookup();
const visual = (id: string) => {
  const s = SPECIES_BY_ID.get(id)!;
  return { hex: s.displayHex, tint: s.textureTint, letter: 'A', name: s.commonName };
};
const meta = (id: string): SpeciesMeta | undefined => {
  const s = SPECIES_BY_ID.get(id);
  return s && {
    id: s.id,
    commonName: s.commonName,
    janka_lbf: s.janka_lbf,
    foodSafe: s.foodSafe,
    porosity: s.porosity,
    cautions: s.cautions,
    movement: s.movement,
  };
};

/** 16" × 10" edge-grain blank: 8 strips of 1-1/4". */
function board(outline?: OutlineSpec, over: Partial<BoardSpec> = {}): BoardSpec {
  return {
    name: 'shaped',
    construction: {
      kind: 'edgeGrain',
      layers: [
        {
          strips: [
            { species: 'hard-maple', width: inch(1.25) },
            { species: 'black-walnut', width: inch(1.25) },
          ],
          repeat: 4,
        },
      ],
    },
    targetLength: inch(16),
    targetWidth: 0,
    stockThickness: inch(0.875),
    finishedThickness: inch(0.75),
    kerf: inch(0.125),
    cleanup: { widthTrim: inch(0.25), lengthTrim: inch(0.5), planingLoss: inch(0.125) },
    wasteFactor: 0.2,
    roughStock: true,
    patternOffset: 0,
    outline,
    ...over,
  };
}

describe('outline resolution', () => {
  it('defaults to a plain rectangle matching the blank', () => {
    const r = runPipeline(board());
    expect(r.ok).toBe(true);
    expect(isPlainRect(r.outline)).toBe(true);
    expect(r.outline).toEqual({ kind: 'rect', w: inch(16), h: inch(10), cornerRadius: 0 });
  });

  it('inscribes each shape in the blank without changing the glue-up', () => {
    const plain = runPipeline(board());
    const specs: OutlineSpec[] = [
      { kind: 'rect', cornerRadius: inch(1) },
      { kind: 'ellipse' },
      { kind: 'paddle', handleL: inch(5), handleW: inch(2), filletR: inch(1) },
    ];
    for (const spec of specs) {
      const r = runPipeline(board(spec));
      expect(r.ok, spec.kind).toBe(true);
      // the blank, the strips, and the cut list are identical to the rect case
      expect(r.glueUp1).toEqual(plain.glueUp1);
      expect(r.finished).toEqual(plain.finished);
      expect(r.grid.boardLength).toBe(inch(16));
      expect(r.grid.boardWidth).toBe(inch(10));
      // and the shape fits inside the blank
      const ring = outlineToRing(r.outline);
      expect(area(ring)).toBeLessThanOrEqual(inch(16) * inch(10) + 1);
      expect(area(ring)).toBeGreaterThan(0);
    }
  });

  it('clamps a corner radius to half the short side', () => {
    const r = runPipeline(board({ kind: 'rect', cornerRadius: inch(50) }));
    expect(r.outline).toMatchObject({ kind: 'rect', cornerRadius: inch(5) });
  });

  it('warns (not errors) when the handle is oversized, and clamps it', () => {
    const r = runPipeline(board({ kind: 'paddle', handleL: inch(14), handleW: inch(30), filletR: inch(1) }));
    expect(r.ok).toBe(true); // advisory, never blocking
    expect(r.issues.some((i) => i.id === 'handle-too-long')).toBe(true);
    expect(r.issues.some((i) => i.id === 'handle-too-wide')).toBe(true);
    const o = r.outline as Extract<typeof r.outline, { kind: 'paddle' }>;
    expect(o.handleL).toBeLessThanOrEqual(inch(16) * 0.6);
    expect(o.handleW).toBeLessThanOrEqual(inch(10));
  });

  it('errors when a custom polygon escapes the blank', () => {
    const r = runPipeline(
      board({
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: inch(40), y: 0 },
          { x: inch(40), y: inch(9) },
          { x: 0, y: inch(9) },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.id === 'outline-exceeds-blank')).toBe(true);
  });

  it('rejects a degenerate polygon', () => {
    const r = runPipeline(board({ kind: 'polygon', points: [{ x: 0, y: 0 }, { x: inch(4), y: 0 }] }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.id === 'polygon-degenerate')).toBe(true);
  });
});

describe('outline-clipped areas', () => {
  it('rectangle areas sum to the full blank', () => {
    const r = runPipeline(board());
    const { total } = speciesAreas(r);
    expect(total).toBeCloseTo(inch(16) * inch(10), -8);
  });

  it('ellipse areas sum to πab, not the blank', () => {
    const r = runPipeline(board({ kind: 'ellipse' }));
    const { total, bySpecies } = speciesAreas(r);
    const expected = Math.PI * inch(8) * inch(5);
    expect(Math.abs(total - expected) / expected).toBeLessThan(1e-3);
    // both species still appear, and neither dominates
    expect(bySpecies.size).toBe(2);
    for (const a of bySpecies.values()) {
      expect(a / total).toBeGreaterThan(0.3);
      expect(a / total).toBeLessThan(0.7);
    }
  });

  it('a paddle reports less surface than its blank', () => {
    const rect = runPipeline(board());
    const paddle = runPipeline(board({ kind: 'paddle', handleL: inch(5), handleW: inch(2), filletR: inch(1) }));
    expect(speciesAreas(paddle).total).toBeLessThan(speciesAreas(rect).total * 0.8);
  });

  it('open-pore lint measures the finished surface, not the blank', () => {
    // Red oak occupies the outer strips only; an ellipse trims their corners,
    // so the oak share must come out lower than on the rectangle.
    const layers = [
      { strips: [{ species: 'red-oak', width: inch(1.25) }], repeat: 1 },
      { strips: [{ species: 'hard-maple', width: inch(1.25) }], repeat: 6 },
      { strips: [{ species: 'red-oak', width: inch(1.25) }], repeat: 1 },
    ];
    const rect = runPipeline(board(undefined, { construction: { kind: 'edgeGrain', layers } }));
    const ell = runPipeline(board({ kind: 'ellipse' }, { construction: { kind: 'edgeGrain', layers } }));
    const oakShare = (r: ReturnType<typeof runPipeline>) => {
      const { bySpecies, total } = speciesAreas(r);
      return (bySpecies.get('red-oak') ?? 0) / total;
    };
    expect(oakShare(ell)).toBeLessThan(oakShare(rect));
  });
});

describe('outline downstream', () => {
  it('adds a shaping step to the instructions, with the real dimensions', () => {
    const b = board({ kind: 'paddle', handleL: inch(5), handleW: inch(2), filletR: inch(1) });
    const r = runPipeline(b);
    const cl = buildCutList(b, r, info);
    const md = instructionsToMarkdown(generateInstructions(b, r, cl, info));
    expect(md).toContain('Cut the outline');
    expect(md).toContain('5"'); // handle length
    expect(md).toContain('flush-trim');
  });

  it('omits the shaping step for a plain rectangle', () => {
    const b = board();
    const r = runPipeline(b);
    const cl = buildCutList(b, r, info);
    expect(instructionsToMarkdown(generateInstructions(b, r, cl, info))).not.toContain('Cut the outline');
  });

  it('renders a clipPath and the outline stroke in the board SVG', () => {
    const r = runPipeline(board({ kind: 'ellipse' }));
    const svg = renderBoardSvg(r.grid, visual, { pxPerIn: 20, outline: r.outline, showBlank: true });
    expect(svg).toContain('clipPath');
    expect(svg).toContain('A'); // elliptical arc in the clip path
    expect(svg).not.toContain('NaN');
  });

  it('lints still run and the cut list is unchanged by shaping', () => {
    const plain = board();
    const shaped = board({ kind: 'ellipse' });
    const rp = runPipeline(plain);
    const rs = runPipeline(shaped);
    expect(buildCutList(shaped, rs, info).ripSchedule).toEqual(buildCutList(plain, rp, info).ripSchedule);
    expect(validateBoard(shaped, rs, meta).filter((l) => l.level === 'error')).toEqual([]);
  });
});
