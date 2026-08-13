/**
 * 2-D vector helpers. Geometry works in *float* nanometers: outlines involve
 * circles and ellipses whose coordinates are irrational, so exactness stops at
 * the pattern grid (which stays integer nm) and resumes nowhere. Cut dimensions
 * never come from this module — only outlines, clipping, and toolpaths do.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function normalize(a: Vec2): Vec2 {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Left-hand normal (90° CCW in a y-down screen space = outward for CW rings). */
export const normal = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Closest point on segment [a,b] to p, and its distance. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; dist: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const point = add(a, scale(ab, t));
  return { point, dist: dist(p, point), t };
}

/**
 * Intersection of infinite lines (p + t·r) and (q + u·s).
 * Returns null when parallel within tolerance.
 */
export function lineIntersect(p: Vec2, r: Vec2, q: Vec2, s: Vec2): Vec2 | null {
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const t = cross(sub(q, p), s) / denom;
  return add(p, scale(r, t));
}
