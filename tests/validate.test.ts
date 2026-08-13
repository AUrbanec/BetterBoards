import { describe, expect, it } from 'vitest';
import { inch } from '../src/engine/units';
import { runPipeline } from '../src/engine/construction/pipeline';
import { validateBoard, type SpeciesMeta } from '../src/engine/validate/rules';
import { SPECIES_BY_ID } from '../src/data/species';
import type { BoardSpec } from '../src/engine/construction/types';

const meta = (id: string): SpeciesMeta | undefined => {
  const s = SPECIES_BY_ID.get(id);
  if (!s) return undefined;
  return {
    id: s.id,
    commonName: s.commonName,
    janka_lbf: s.janka_lbf,
    foodSafe: s.foodSafe,
    porosity: s.porosity,
    cautions: s.cautions,
    movement: s.movement,
  };
};

function board(over: Partial<BoardSpec> = {}): BoardSpec {
  return {
    name: 'lint',
    construction: {
      kind: 'edgeGrain',
      layers: [
        {
          strips: [
            { species: 'hard-maple', width: inch(1.5) },
            { species: 'black-walnut', width: inch(1.5) },
          ],
          repeat: 4,
        },
      ],
    },
    targetLength: inch(18),
    targetWidth: 0,
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

describe('manufacturability lint', () => {
  it('clean maple/walnut board has no warnings', () => {
    const b = board();
    const lints = validateBoard(b, runPipeline(b), meta);
    expect(lints.filter((l) => l.level === 'error')).toEqual([]);
    expect(lints.find((l) => l.id === 'softwood')).toBeUndefined();
  });

  it('flags soft species', () => {
    const b = board({
      construction: {
        kind: 'edgeGrain',
        layers: [{ strips: [{ species: 'eastern-white-pine', width: inch(2) }], repeat: 4 }],
      },
    });
    const lints = validateBoard(b, runPipeline(b), meta);
    expect(lints.some((l) => l.id === 'softwood')).toBe(true);
    expect(lints.some((l) => l.id === 'species-cautions')).toBe(true);
  });

  it('flags thin strips, sub-kerf strips are errors', () => {
    const thin = board({
      construction: {
        kind: 'edgeGrain',
        layers: [
          { strips: [{ species: 'hard-maple', width: inch(0.1875) }, { species: 'black-walnut', width: inch(2) }], repeat: 3 },
        ],
      },
    });
    const lints = validateBoard(thin, runPipeline(thin), meta);
    expect(lints.some((l) => l.id === 'strip-thin' && l.level === 'warning')).toBe(true);

    const subKerf = board({
      construction: {
        kind: 'edgeGrain',
        layers: [
          { strips: [{ species: 'hard-maple', width: inch(0.0625) }, { species: 'black-walnut', width: inch(2) }], repeat: 3 },
        ],
      },
    });
    const lints2 = validateBoard(subKerf, runPipeline(subKerf), meta);
    expect(lints2.some((l) => l.id === 'strip-lt-kerf' && l.level === 'error')).toBe(true);
  });

  it('flags open-pore share above 15%', () => {
    const b = board({
      construction: {
        kind: 'edgeGrain',
        layers: [
          {
            strips: [
              { species: 'red-oak', width: inch(2) },
              { species: 'hard-maple', width: inch(2) },
            ],
            repeat: 3,
          },
        ],
      },
    });
    const lints = validateBoard(b, runPipeline(b), meta);
    expect(lints.some((l) => l.id === 'open-pores')).toBe(true);
  });

  it('flags movement mismatch between adjacent species', () => {
    const b = board({
      construction: {
        kind: 'edgeGrain',
        layers: [
          {
            strips: [
              { species: 'european-beech', width: inch(2) }, // 11.9 tangential
              { species: 'teak', width: inch(2) },           // 5.8
            ],
            repeat: 2,
          },
        ],
      },
    });
    const lints = validateBoard(b, runPipeline(b), meta);
    expect(lints.some((l) => l.id === 'movement-mismatch')).toBe(true);
  });

  it('flags not-food-safe species and slice marathons', () => {
    const b = board({
      construction: {
        kind: 'endGrain',
        layers: [{ strips: [{ species: 'wenge', width: inch(1) }, { species: 'hard-maple', width: inch(1) }], repeat: 5 }],
        crosscut: { angleDeg: 90 },
        transform: { kind: 'flipAlternate' },
      },
      stockThickness: inch(0.375), // tiny slices → many of them
      finishedThickness: inch(1.25),
      targetLength: inch(18),
    });
    const lints = validateBoard(b, runPipeline(b), meta);
    expect(lints.some((l) => l.id === 'not-food-safe')).toBe(true);
    expect(lints.some((l) => l.id === 'slice-sanity')).toBe(true);
  });

  it('every lint carries a why paragraph', () => {
    const b = board({
      construction: {
        kind: 'edgeGrain',
        layers: [{ strips: [{ species: 'eastern-white-pine', width: inch(0.1875) }], repeat: 4 }],
      },
    });
    const lints = validateBoard(b, runPipeline(b), meta);
    expect(lints.length).toBeGreaterThan(0);
    for (const l of lints) expect(l.why.length).toBeGreaterThan(40);
  });
});
