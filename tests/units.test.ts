import { describe, expect, it } from 'vitest';
import {
  IN,
  MM,
  formatCutDim,
  formatDim,
  formatFraction,
  inch,
  mm,
  parseDim,
  roundToDenom,
} from '../src/engine/units';

describe('units', () => {
  it('converts exactly', () => {
    expect(inch(1)).toBe(25_400_000);
    expect(mm(1)).toBe(1_000_000);
    expect(inch(1 / 64)).toBe(396_875);
    expect(inch(0.125)).toBe(3_175_000);
    expect(Number.isSafeInteger(inch(48))).toBe(true);
  });

  it('formats reduced fractions', () => {
    expect(formatFraction(inch(1.375))).toBe('1 3/8');
    expect(formatFraction(inch(0.5))).toBe('1/2');
    expect(formatFraction(inch(3))).toBe('3');
    expect(formatFraction(inch(2.09375))).toBe('2 3/32');
    expect(formatFraction(inch(0.75) + inch(0.125))).toBe('7/8');
    expect(formatFraction(-inch(1.25))).toBe('-1 1/4');
  });

  it('flags inexact roundings with ~', () => {
    const off = inch(1.376); // not on 1/32
    expect(formatFraction(off).startsWith('~')).toBe(true);
    const r = roundToDenom(off, 32);
    expect(r.exact).toBe(false);
    expect(Math.abs(r.error)).toBeLessThanOrEqual(IN / 64);
    expect(r.rounded % (IN / 32)).toBe(0);
  });

  it('formatCutDim shows exact decimal when rounded', () => {
    expect(formatCutDim(inch(1.375), 'in-frac')).toBe('1 3/8"');
    expect(formatCutDim(inch(1.376), 'in-frac')).toContain('exact');
    expect(formatCutDim(mm(44), 'mm')).toBe('44 mm');
  });

  it('parses shop-style input', () => {
    expect(parseDim('1 3/4')).toBe(inch(1.75));
    expect(parseDim('1-3/4')).toBe(inch(1.75));
    expect(parseDim('7/8')).toBe(inch(0.875));
    expect(parseDim('1.75')).toBe(inch(1.75));
    expect(parseDim('1.75"')).toBe(inch(1.75));
    expect(parseDim('44mm')).toBe(44 * MM);
    expect(parseDim('4.4 cm')).toBe(44 * MM);
    expect(parseDim('2 in')).toBe(inch(2));
    expect(parseDim('44', 'mm')).toBe(44 * MM);
    expect(parseDim('nonsense')).toBeNull();
    expect(parseDim('3/0')).toBeNull();
  });

  it('formats display units', () => {
    expect(formatDim(inch(1.5), 'in-frac')).toBe('1 1/2"');
    expect(formatDim(inch(1.5), 'in-dec')).toBe('1.5"');
    expect(formatDim(mm(44.5), 'mm')).toBe('44.5 mm');
  });
});
