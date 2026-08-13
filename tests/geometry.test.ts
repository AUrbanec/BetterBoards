import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { IN, inch } from '../src/engine/units';
import {
  area,
  bbox,
  centroid,
  clipByConvex,
  densify,
  distanceToRing,
  ensureCCW,
  intersectionArea,
  offsetRing,
  pointInRing,
  signedArea,
  type Ring,
} from '../src/engine/geometry/polygon';
import {
  outlineSize,
  outlineToDenseRing,
  outlineToPath,
  outlineToRing,
  outlineSegments,
  type Outline,
} from '../src/engine/geometry/outline';

const rect = (w: number, h: number): Ring => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

/**
 * Areas are in nm², so magnitudes run to ~1e16 and absolute tolerances are
 * meaningless. Compare relatively instead.
 */
function expectRelClose(got: number, want: number, relTol: number, label = '') {
  const rel = Math.abs(got - want) / Math.max(1, Math.abs(want));
  expect(rel, `${label} got ${got}, want ${want} (rel ${rel.toExponential(2)})`).toBeLessThan(relTol);
}

describe('polygon basics', () => {
  it('area, centroid, bbox', () => {
    const r = rect(inch(10), inch(4));
    expect(area(r)).toBe(inch(10) * inch(4));
    const c = centroid(r);
    expect(c.x).toBeCloseTo(inch(5), 3);
    expect(c.y).toBeCloseTo(inch(2), 3);
    expect(bbox(r)).toEqual({ minX: 0, minY: 0, maxX: inch(10), maxY: inch(4) });
  });

  it('ensureCCW normalizes winding without changing area', () => {
    const r = rect(100, 50);
    const cw = [...r].reverse();
    expect(signedArea(ensureCCW(cw))).toBeGreaterThan(0);
    expect(area(ensureCCW(cw))).toBe(area(r));
  });

  it('point containment', () => {
    const r = rect(100, 100);
    expect(pointInRing({ x: 50, y: 50 }, r)).toBe(true);
    expect(pointInRing({ x: 150, y: 50 }, r)).toBe(false);
    expect(pointInRing({ x: -1, y: -1 }, r)).toBe(false);
  });

  it('distanceToRing measures to the boundary, not the interior', () => {
    const r = rect(100, 100);
    expect(distanceToRing({ x: 50, y: 50 }, r)).toBeCloseTo(50, 6);
    expect(distanceToRing({ x: 10, y: 50 }, r)).toBeCloseTo(10, 6);
    expect(distanceToRing({ x: -10, y: 50 }, r)).toBeCloseTo(10, 6);
  });
});

describe('clipping', () => {
  it('clips a rect by an overlapping quad', () => {
    const subject = rect(100, 100);
    const clip = [
      { x: 50, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 150 },
      { x: 50, y: 150 },
    ];
    expect(intersectionArea(subject, clip)).toBeCloseTo(50 * 50, 6);
  });

  it('returns the full cell when the cell is inside the outline', () => {
    const subject = rect(100, 100);
    const cell = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ];
    expect(intersectionArea(subject, cell)).toBeCloseTo(100, 6);
  });

  it('returns empty for disjoint shapes', () => {
    const subject = rect(100, 100);
    const far = [
      { x: 500, y: 500 },
      { x: 600, y: 500 },
      { x: 600, y: 600 },
      { x: 500, y: 600 },
    ];
    expect(clipByConvex(subject, far)).toEqual([]);
    expect(intersectionArea(subject, far)).toBe(0);
  });

  it('handles a concave subject (paddle) correctly', () => {
    const paddle: Outline = {
      kind: 'paddle',
      bodyW: inch(10),
      bodyH: inch(8),
      handleW: inch(2),
      handleL: inch(4),
      r: inch(1),
    };
    const ring = outlineToRing(paddle);
    // A cell spanning the handle's vertical extent only intersects the handle.
    const x0 = inch(12);
    const cell = [
      { x: x0, y: 0 },
      { x: x0 + inch(1), y: 0 },
      { x: x0 + inch(1), y: inch(8) },
      { x: x0, y: inch(8) },
    ];
    const a = intersectionArea(ring, cell);
    // handle is 2" tall, cell is 1" wide → ~2 in² (allow for the rounded end)
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(inch(1) * inch(2) + 1);
  });

  it('sum of per-cell clipped areas equals the outline area', () => {
    const o: Outline = { kind: 'ellipse', rx: inch(6), ry: inch(4) };
    const ring = outlineToRing(o);
    const cols = 12;
    const rows = 8;
    const cw = inch(12) / cols;
    const ch = inch(8) / rows;
    let total = 0;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        total += intersectionArea(ring, [
          { x: i * cw, y: j * ch },
          { x: (i + 1) * cw, y: j * ch },
          { x: (i + 1) * cw, y: (j + 1) * ch },
          { x: i * cw, y: (j + 1) * ch },
        ]);
      }
    }
    expectRelClose(total, area(ring), 1e-12, 'clipped cell areas sum to outline area');
    // and the ellipse area is πab
    expect(area(ring) / (inch(6) * inch(4))).toBeCloseTo(Math.PI, 2);
  });
});

describe('offsetting', () => {
  it('offsets a square outward to the right size with rounded corners', () => {
    const r = densify(rect(inch(10), inch(10)), IN / 32);
    const d = inch(0.25);
    const out = offsetRing(r, d);
    expect(out.length).toBeGreaterThan(4);
    // every offset point sits ~d from the source boundary
    for (const p of out) {
      expect(Math.abs(distanceToRing(p, r) - d)).toBeLessThan(d * 0.02);
    }
    // area grows by perimeter·d + πd² (the four corner quarter-circles)
    const expected = area(r) + 4 * inch(10) * d + Math.PI * d * d;
    expectRelClose(area(out), expected, 1e-3, 'outward offset area');
  });

  it('offsets inward and shrinks by the same law', () => {
    const r = densify(rect(inch(10), inch(10)), IN / 32);
    const d = inch(1);
    const inner = offsetRing(r, -d);
    // sharp inner corners — an inward offset miters, it does not round
    expectRelClose(area(inner), inch(8) * inch(8), 1e-4, 'inward offset area');
    for (const p of inner) {
      expect(pointInRing(p, r)).toBe(true);
      expect(Math.abs(distanceToRing(p, r) - d)).toBeLessThan(d * 0.02);
    }
  });

  it('offsetting a circle gives a concentric circle', () => {
    const o: Outline = { kind: 'ellipse', rx: inch(5), ry: inch(5) };
    const ring = outlineToDenseRing(o);
    const out = offsetRing(ring, inch(0.5));
    const c = centroid(out);
    expect(c.x).toBeCloseTo(inch(5), -4);
    expect(c.y).toBeCloseTo(inch(5), -4);
    for (const p of out) {
      const r = Math.hypot(p.x - inch(5), p.y - inch(5));
      expect(Math.abs(r - inch(5.5))).toBeLessThan(inch(0.02));
    }
  });

  it('collapses when the inward offset exceeds the shape', () => {
    const r = densify(rect(inch(4), inch(4)), IN / 32);
    expect(offsetRing(r, -inch(3))).toEqual([]);
  });

  it('inward offsets never escape the source (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 14 }),
        fc.integer({ min: 4, max: 14 }),
        fc.integer({ min: 2, max: 16 }),
        (wIn, hIn, d32) => {
          const src = densify(rect(inch(wIn), inch(hIn)), IN / 32);
          const d = (d32 * IN) / 32;
          fc.pre(d < Math.min(inch(wIn), inch(hIn)) / 2 - inch(0.1));
          const inner = offsetRing(src, -d);
          expect(inner.length).toBeGreaterThan(3);
          for (const p of inner) expect(pointInRing(p, src)).toBe(true);
          expect(area(inner)).toBeLessThan(area(src));
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe('outlines', () => {
  it('rect size and path', () => {
    const o: Outline = { kind: 'rect', w: inch(18), h: inch(12), cornerRadius: 0 };
    expect(outlineSize(o)).toEqual({ w: inch(18), h: inch(12) });
    expect(outlineToPath(o, 1 / IN, 0)).toBe('M0,0H18V12H0Z');
    expect(area(outlineToRing(o))).toBe(inch(18) * inch(12));
  });

  it('rounded rect loses the corner area', () => {
    const r = inch(1);
    const o: Outline = { kind: 'rect', w: inch(10), h: inch(10), cornerRadius: r };
    const a = area(outlineToRing(o));
    const expected = inch(10) * inch(10) - (4 - Math.PI) * r * r;
    // chord flattening at 0.001" tolerance loses a hair of the corner arcs
    expectRelClose(a, expected, 1e-4, 'rounded rect area');
    expect(outlineToPath(o)).toContain('A');
  });

  it('circle emits true arcs; ellipse flattens', () => {
    expect(outlineSegments({ kind: 'ellipse', rx: inch(4), ry: inch(4) }).every((s) => s.kind === 'arc')).toBe(true);
    expect(outlineSegments({ kind: 'ellipse', rx: inch(6), ry: inch(4) }).every((s) => s.kind === 'line')).toBe(true);
  });

  it('paddle bounding box includes the handle', () => {
    const o: Outline = { kind: 'paddle', bodyW: inch(10), bodyH: inch(8), handleW: inch(2), handleL: inch(4), r: inch(1) };
    expect(outlineSize(o)).toEqual({ w: inch(14), h: inch(8) });
    const ring = outlineToRing(o);
    const b = bbox(ring);
    expect(b.maxX).toBeCloseTo(inch(14), -3);
    expect(b.maxY).toBeCloseTo(inch(8), -3);
    expect(b.minX).toBeCloseTo(0, -3);
    // area is less than the bbox (the handle is a narrow projection)
    expect(area(ring)).toBeLessThan(inch(14) * inch(8) * 0.85);
    // and the handle region really is outside the body span
    expect(pointInRing({ x: inch(13), y: inch(4) }, ring)).toBe(true);
    expect(pointInRing({ x: inch(13), y: inch(1) }, ring)).toBe(false);
  });

  it('all outline kinds produce closed, non-degenerate rings', () => {
    const outlines: Outline[] = [
      { kind: 'rect', w: inch(18), h: inch(12), cornerRadius: inch(0.5) },
      { kind: 'ellipse', rx: inch(7), ry: inch(5) },
      { kind: 'paddle', bodyW: inch(11), bodyH: inch(9), handleW: inch(2.5), handleL: inch(5), r: inch(1.5) },
      { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: inch(10), y: 0 }, { x: inch(10), y: inch(6) }, { x: inch(4), y: inch(9) }, { x: 0, y: inch(6) }] },
    ];
    for (const o of outlines) {
      const ring = outlineToRing(o);
      expect(ring.length).toBeGreaterThanOrEqual(3);
      expect(area(ring)).toBeGreaterThan(0);
      expect(outlineToPath(o)).toMatch(/^M.*Z$/);
      const b = bbox(ring);
      const size = outlineSize(o);
      expect(b.maxX - b.minX).toBeCloseTo(size.w, -4);
      expect(b.maxY - b.minY).toBeCloseTo(size.h, -4);
    }
  });
});
