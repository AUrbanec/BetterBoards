/**
 * Exact dimensions for the BetterBoards engine.
 *
 * Internal unit: integer nanometers (nm), stored in a plain JS number.
 *   1 inch = 25_400_000 nm (exact)
 *   1 mm   =  1_000_000 nm (exact)
 *   1/64"  =     396_875 nm (exact integer)
 * A 1 m board is ~1e9 nm — far inside Number.MAX_SAFE_INTEGER (9e15), so all
 * engine arithmetic stays on exact integers. Floats appear only in display
 * conversion, color science, and rendering.
 */

export type Nm = number; // integer nanometers

export const IN: Nm = 25_400_000;
export const MM: Nm = 1_000_000;

/** Convert (possibly fractional) inches to integer nm. */
export const inch = (x: number): Nm => Math.round(x * IN);
/** Convert millimeters to integer nm. */
export const mm = (x: number): Nm => Math.round(x * MM);

export const nmToIn = (nm: Nm): number => nm / IN;
export const nmToMm = (nm: Nm): number => nm / MM;

/** Assert a value is an exact integer nm (guards against float leakage). */
export function assertInt(nm: Nm, label = 'dimension'): Nm {
  if (!Number.isSafeInteger(nm)) {
    throw new Error(`Engine invariant violated: ${label} is not an integer nm: ${nm}`);
  }
  return nm;
}

export type Denom = 8 | 16 | 32 | 64;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Round an exact nm value to the nearest 1/denom inch.
 * IN is divisible by 64, so the result is always an exact integer nm.
 */
export function roundToDenom(nm: Nm, denom: Denom = 32): { rounded: Nm; error: Nm; exact: boolean } {
  const step = IN / denom; // integer for denom ≤ 64
  const rounded = Math.round(nm / step) * step;
  const error = nm - rounded;
  return { rounded, error, exact: error === 0 };
}

/**
 * Format an exact nm value as a reduced imperial fraction string, e.g. `1 3/8`.
 * If the value does not land exactly on 1/denom, it is rounded to the nearest
 * 1/denom and (by default) flagged with a leading `~`.
 */
export function formatFraction(nm: Nm, denom: Denom = 32, opts: { markApprox?: boolean } = {}): string {
  const markApprox = opts.markApprox ?? true;
  const neg = nm < 0;
  const abs = Math.abs(nm);
  const step = IN / denom;
  const units = Math.round(abs / step); // number of 1/denom units
  const exact = units * step === abs;
  const whole = Math.floor(units / denom);
  let num = units - whole * denom;
  let den: number = denom;
  if (num > 0) {
    const g = gcd(num, den);
    num /= g;
    den /= g;
  }
  let s: string;
  if (num === 0) s = `${whole}`;
  else if (whole === 0) s = `${num}/${den}`;
  else s = `${whole} ${num}/${den}`;
  if (neg) s = `-${s}`;
  if (!exact && markApprox) s = `~${s}`;
  return s;
}

export type UnitMode = 'in-frac' | 'in-dec' | 'mm';

export interface FormatOptions {
  denom?: Denom;       // fraction resolution for 'in-frac'
  showUnit?: boolean;  // append " or mm
  markApprox?: boolean;
}

/** Display-format a dimension in the chosen unit mode. */
export function formatDim(nm: Nm, mode: UnitMode, opts: FormatOptions = {}): string {
  const showUnit = opts.showUnit ?? true;
  switch (mode) {
    case 'in-frac': {
      const s = formatFraction(nm, opts.denom ?? 32, { markApprox: opts.markApprox ?? true });
      return showUnit ? `${s}"` : s;
    }
    case 'in-dec': {
      const v = nmToIn(nm);
      const s = trimZeros(v.toFixed(3));
      return showUnit ? `${s}"` : s;
    }
    case 'mm': {
      const v = nmToMm(nm);
      const s = trimZeros(v.toFixed(1));
      return showUnit ? `${s} mm` : s;
    }
  }
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/**
 * Cut-list formatting: value rounded to nearest 1/32 (or given denom) with the
 * exact decimal in parentheses whenever rounding occurred.
 * e.g.  "1 3/8""  or  "~1 3/8" (1.3702" exact)"
 */
export function formatCutDim(nm: Nm, mode: UnitMode, denom: Denom = 32): string {
  if (mode === 'mm') return formatDim(nm, 'mm');
  if (mode === 'in-dec') return formatDim(nm, 'in-dec');
  const { exact } = roundToDenom(nm, denom);
  const frac = formatFraction(nm, denom, { markApprox: true });
  if (exact) return `${frac}"`;
  return `${frac}" (${trimZeros(nmToIn(nm).toFixed(4))}" exact)`;
}

/**
 * Parse a human-entered dimension. Accepts:
 *   `1 3/4`, `1-3/4`, `7/8`, `1.75`, `1.75"`, `1 3/4 in`, `44mm`, `4.4 cm`, `0.5in`
 * Returns integer nm, or null if unparseable. `defaultUnit` applies when no
 * unit suffix is given ('in' | 'mm').
 */
export function parseDim(input: string, defaultUnit: 'in' | 'mm' = 'in'): Nm | null {
  let s = input.trim().toLowerCase();
  if (s === '') return null;
  let unit: 'in' | 'mm' | 'cm' = defaultUnit;
  const unitMatch = s.match(/(mm|cm|in|inch|inches|")\s*$/);
  if (unitMatch) {
    const u = unitMatch[1];
    unit = u === 'mm' ? 'mm' : u === 'cm' ? 'cm' : 'in';
    s = s.slice(0, s.length - unitMatch[0].length).trim();
  }
  if (s === '') return null;

  let neg = false;
  if (s.startsWith('-')) {
    // could be a negative number, but "1-3/4" style is handled below (digit before '-')
    neg = true;
    s = s.slice(1).trim();
  }

  // whole + fraction: "1 3/4" or "1-3/4"
  let value: number | null = null;
  let m = s.match(/^(\d+)[\s-]+(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const den = parseInt(m[3], 10);
    if (den === 0) return null;
    value = parseInt(m[1], 10) + parseInt(m[2], 10) / den;
  }
  if (value === null) {
    // bare fraction "3/4"
    m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m) {
      const den = parseInt(m[2], 10);
      if (den === 0) return null;
      value = parseInt(m[1], 10) / den;
    }
  }
  if (value === null) {
    // decimal or integer
    m = s.match(/^(\d+(?:\.\d+)?|\.\d+)$/);
    if (m) value = parseFloat(m[1]);
  }
  if (value === null) return null;
  if (neg) value = -value;

  switch (unit) {
    case 'in': return inch(value);
    case 'mm': return mm(value);
    case 'cm': return mm(value * 10);
  }
}

/** Board feet from exact nm dims (display/estimation only — floats are fine here). */
export function boardFeet(thickness: Nm, width: Nm, length: Nm): number {
  return (nmToIn(thickness) * nmToIn(width) * nmToIn(length)) / 144;
}

/** Sum helper that asserts integer results. */
export function sumNm(values: Nm[]): Nm {
  let t = 0;
  for (const v of values) t += v;
  return assertInt(t, 'sum');
}
