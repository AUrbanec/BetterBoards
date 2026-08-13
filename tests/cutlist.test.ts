import { describe, expect, it } from 'vitest';
import { inch } from '../src/engine/units';
import { runPipeline } from '../src/engine/construction/pipeline';
import { buildCutList } from '../src/engine/cutlist/cutlist';
import type { BoardSpec } from '../src/engine/construction/types';

const cleanup = { widthTrim: inch(0.25), lengthTrim: inch(0.5), planingLoss: inch(0.125) };

const info = (id: string) => ({ name: id, pricePerBF: id === 'black-walnut' ? 12 : 8.5 });

function stripsBoard(over: Partial<BoardSpec> = {}): BoardSpec {
  return {
    name: 'golden',
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

describe('cut list golden cases', () => {
  it('raw width: 12 strips × 1-1/4″ + 11 kerfs + 1/4″ cleanup = 16-5/8″', () => {
    const board = stripsBoard();
    const result = runPipeline(board);
    const cl = buildCutList(board, result, info);
    expect(cl.perSpecies.length).toBe(1);
    expect(cl.perSpecies[0].rawWidthNeeded).toBe(inch(16.625));
    expect(cl.perSpecies[0].stripCount).toBe(12);
  });

  it('board feet: (T+1/4)(W+1/4)L/144 with 20% waste', () => {
    // Single 1-1/4″ × 7/8″ strip, 20″ long (19.5 target + 1/2 trim).
    const board = stripsBoard({
      construction: {
        kind: 'edgeGrain',
        layers: [{ strips: [{ species: 'black-walnut', width: inch(1.25) }], repeat: 1 }],
      },
      targetLength: inch(19.5),
    });
    const result = runPipeline(board);
    const cl = buildCutList(board, result, info);
    const expected = ((0.875 + 0.25) * (1.25 + 0.25) * 20) / 144 * 1.2;
    expect(cl.perSpecies[0].boardFeetRough).toBeCloseTo(expected, 10);
    expect(cl.perSpecies[0].boardFeetRough).toBeCloseTo(0.28125, 10);
    expect(cl.perSpecies[0].costEstimate).toBeCloseTo(0.28125 * 12, 10);
  });

  it('S4S stock drops the jointing allowances', () => {
    const board = stripsBoard({ roughStock: false, wasteFactor: 0 });
    const result = runPipeline(board);
    const cl = buildCutList(board, result, info);
    const expected = ((0.875 * 1.25 * 18.5) / 144) * 12;
    expect(cl.perSpecies[0].boardFeetRough).toBeCloseTo(expected, 9);
  });

  it('groups identical rips and reports the crosscut schedule', () => {
    const board = stripsBoard({
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
      stockThickness: inch(1.625),
      finishedThickness: inch(1.25),
    });
    const result = runPipeline(board);
    const cl = buildCutList(board, result, info);
    expect(cl.ripSchedule.length).toBe(2); // one group per species/width
    expect(cl.ripSchedule.every((g) => g.count === 4)).toBe(true);
    expect(cl.crosscut!.sliceCount).toBe(12);
    expect(cl.crosscut!.reversed).toEqual([2, 4, 6, 8, 10, 12]);
    expect(cl.crosscut!.mirrored).toEqual([]);
  });

  it('rounding report flags off-1/32 dimensions', () => {
    const board = stripsBoard({
      construction: {
        kind: 'edgeGrain',
        layers: [{ strips: [{ species: 'hard-maple', width: 25_400_000 / 3 }], repeat: 1 }], // 1/3″
      },
    });
    const result = runPipeline(board);
    const cl = buildCutList(board, result, info);
    expect(cl.rounding.entries.length).toBeGreaterThan(0);
    expect(cl.rounding.entries.some((e) => e.label.includes('Rip width'))).toBe(true);
  });
});
