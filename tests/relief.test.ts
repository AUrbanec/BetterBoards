import { describe, expect, it } from 'vitest';
import { createReliefPlan, reliefGridCsv, sampleReliefGrid } from '../src/engine/relief/relief';

const settings = { maxDepthMm: 6, levels: 4, blurRadius: 0, contrast: 1, invert: false };

describe('photo relief planning', () => {
  it('maps black to maximum removal and white to the original face', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    const plan = createReliefPlan(pixels, 2, 1, settings);
    expect([...plan.depths]).toEqual([6, 0]);
    expect(plan.levelDepths).toEqual([0, 2, 4, 6]);
    expect(plan.removedPercent).toBe(50);
  });

  it('supports inverted relief and quantizes intermediate tones', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    const plan = createReliefPlan(pixels, 3, 1, { ...settings, invert: true });
    expect([...plan.depths]).toEqual([0, 4, 6]);
  });

  it('samples an evenly spaced checkpoint grid and exports CSV', () => {
    const pixels = new Uint8ClampedArray(3 * 3 * 4);
    for (let i = 0; i < 9; i++) pixels.set([i * 31, i * 31, i * 31, 255], i * 4);
    const plan = createReliefPlan(pixels, 3, 3, settings);
    expect(sampleReliefGrid(plan, 2, 2)).toEqual([[6, 4], [2, 0]]);
    expect(reliefGridCsv(plan, 2, 2)).toBe('Row/Column,1,2\r\n1,6.00,4.00\r\n2,2.00,0.00');
  });

  it('rejects malformed pixel data', () => {
    expect(() => createReliefPlan(new Uint8ClampedArray(3), 1, 1, settings)).toThrow('Invalid image data');
  });
});
