/**
 * Polygon math: area, containment, clipping, and offsetting.
 *
 * Two deliberate design choices keep this dependency-free and testable:
 *
 * 1. **Clipping** uses Sutherland–Hodgman with the *cell quad* as the clip
 *    window. That algorithm requires a convex clip polygon (a quad always is)
 *    but allows an arbitrary subject (the board outline, which may be concave —
 *    a paddle handle, say). Concave subjects can emit degenerate connecting
 *    edges, which is harmless here: we use the result for area and for a fill
 *    path, and both are correct under the even-odd/nonzero fill the degenerate
 *    edges preserve.
 *
 * 2. **Offsetting** walks the flattened ring, offsets each edge along its
 *    normal, arcs over convex corners, intersects at reflex corners, then
 *    prunes points that ended up closer to the source than |delta| — the
 *    standard practical fix for self-intersection on densely sampled rings.
 *    Verified by invariant tests rather than by trusting the construction.
 */

import { add, closestOnSegment, cross, dist, lineIntersect, normalize, scale, sub, type Vec2 } from './vec';

export type Ring = Vec2[]; // implicitly closed; no repeated last point

export interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Signed area; positive when the ring winds counter-clockwise in math axes. */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const area = (ring: Ring): number => Math.abs(signedArea(ring));

export function bbox(ring: Ring): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function centroid(ring: Ring): Vec2 {
  const a = signedArea(ring);
  if (Math.abs(a) < 1e-9) {
    // degenerate — fall back to the vertex average
    const s = ring.reduce((t, p) => add(t, p), { x: 0, y: 0 });
    return scale(s, 1 / Math.max(1, ring.length));
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Ensure counter-clockwise (positive signed area) winding. */
export function ensureCCW(ring: Ring): Ring {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

/** Even-odd ray cast. Points exactly on the boundary are unspecified. */
export function pointInRing(p: Vec2, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shortest distance from p to the ring's boundary (always non-negative). */
export function distanceToRing(p: Vec2, ring: Ring): number {
  let best = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const d = closestOnSegment(p, ring[i], ring[(i + 1) % n]).dist;
    if (d < best) best = d;
  }
  return best;
}

/** Signed distance: positive inside the ring, negative outside. */
export function signedDistanceToRing(p: Vec2, ring: Ring): number {
  const d = distanceToRing(p, ring);
  return pointInRing(p, ring) ? d : -d;
}

/**
 * Clip `subject` (arbitrary simple polygon) against `clip` (must be convex).
 * Returns [] when the intersection is empty.
 */
export function clipByConvex(subject: Ring, clip: Ring): Ring {
  if (subject.length < 3 || clip.length < 3) return [];
  const cw = ensureCCW(clip);
  let output: Ring = subject;

  for (let i = 0, n = cw.length; i < n; i++) {
    if (output.length === 0) return [];
    const a = cw[i];
    const b = cw[(i + 1) % n];
    const edge = sub(b, a);
    // CCW clip ring → inside is to the left of each directed edge
    const insideOf = (p: Vec2) => cross(edge, sub(p, a)) >= 0;

    const input = output;
    output = [];
    for (let j = 0, m = input.length; j < m; j++) {
      const cur = input[j];
      const prev = input[(j + m - 1) % m];
      const curIn = insideOf(cur);
      const prevIn = insideOf(prev);
      if (curIn) {
        if (!prevIn) {
          const x = lineIntersect(a, edge, prev, sub(cur, prev));
          if (x) output.push(x);
        }
        output.push(cur);
      } else if (prevIn) {
        const x = lineIntersect(a, edge, prev, sub(cur, prev));
        if (x) output.push(x);
      }
    }
  }
  return output;
}

/** Area of the intersection of an arbitrary polygon with a convex one. */
export function intersectionArea(subject: Ring, convexClip: Ring): number {
  return area(clipByConvex(subject, convexClip));
}

/** Drop consecutive duplicate points (within tol). */
export function dedupe(ring: Ring, tol = 1e-6): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > tol) out.push(p);
  }
  while (out.length > 1 && dist(out[0], out[out.length - 1]) <= tol) out.pop();
  return out;
}

/**
 * Resample a ring so no edge is longer than `maxSeg`. Dense sampling is what
 * makes the offset pruning step reliable.
 */
export function densify(ring: Ring, maxSeg: number): Ring {
  const out: Ring = [];
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    out.push(a);
    const d = dist(a, b);
    const steps = Math.floor(d / maxSeg);
    for (let s = 1; s <= steps; s++) {
      const t = (s * maxSeg) / d;
      if (t >= 1) break;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/**
 * Segment count for an arc of radius r sweeping `sweep` radians, such that the
 * chord sags no more than `tol` from the true arc.
 */
export function arcSteps(r: number, sweep: number, tol: number): number {
  if (r <= 0 || sweep <= 0) return 1;
  const ratio = Math.max(-1, Math.min(1, 1 - tol / r));
  const maxStep = 2 * Math.acos(ratio);
  if (!Number.isFinite(maxStep) || maxStep <= 1e-9) return Math.max(1, Math.ceil(sweep / (Math.PI / 32)));
  return Math.max(1, Math.ceil(sweep / maxStep));
}

/**
 * Offset a closed ring by `delta` (positive = outward, negative = inward).
 * `arcTolerance` controls how finely convex corner arcs are flattened.
 * Returns [] if the ring collapses (inward offset larger than the shape).
 */
export function offsetRing(ring: Ring, delta: number, arcTolerance = 25_400): Ring {
  const src = dedupe(ensureCCW(ring));
  if (src.length < 3) return [];
  if (delta === 0) return src;

  const n = src.length;
  const raw: Ring = [];

  for (let i = 0; i < n; i++) {
    const prev = src[(i + n - 1) % n];
    const cur = src[i];
    const next = src[(i + 1) % n];

    const dIn = normalize(sub(cur, prev));
    const dOut = normalize(sub(next, cur));
    // Outward normal for a CCW ring is the right-hand normal.
    const nIn = { x: dIn.y, y: -dIn.x };
    const nOut = { x: dOut.y, y: -dOut.x };

    // turn > 0 is a convex corner of a positively-wound ring. Offsetting
    // *away* from a convex corner opens a gap that must be arced over;
    // offsetting *into* it (and reflex corners either way) meets at a miter.
    const turn = cross(dIn, dOut);
    const needsArc = delta > 0 ? turn > 0 : turn < 0;

    const pIn = add(cur, scale(nIn, delta));
    const pOut = add(cur, scale(nOut, delta));

    if (Math.abs(turn) < 1e-12) {
      raw.push(pIn);
      continue;
    }

    if (needsArc) {
      // Round the corner: sweep from pIn to pOut around `cur`.
      const r = Math.abs(delta);
      const a0 = Math.atan2(pIn.y - cur.y, pIn.x - cur.x);
      const a1 = Math.atan2(pOut.y - cur.y, pOut.x - cur.x);
      let sweep = a1 - a0; // take the short way, in the direction the corner turns
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const steps = arcSteps(r, Math.abs(sweep), arcTolerance);
      for (let s = 0; s <= steps; s++) {
        const a = a0 + (sweep * s) / steps;
        raw.push({ x: cur.x + r * Math.cos(a), y: cur.y + r * Math.sin(a) });
      }
    } else {
      // Reflex: meet at the intersection of the two offset edges (miter),
      // falling back to the averaged point when they're near-parallel.
      const x = lineIntersect(pIn, dIn, pOut, dOut);
      raw.push(x ?? { x: (pIn.x + pOut.x) / 2, y: (pIn.y + pOut.y) / 2 });
    }
  }

  // Prune points that fall closer to the source than |delta| — these are the
  // self-intersection loops an offset creates on tight features.
  const tol = Math.abs(delta) * 1e-3 + 1e-6;
  const target = Math.abs(delta);
  const kept = raw.filter((p) => distanceToRing(p, src) >= target - tol);
  const cleaned = dedupe(kept, Math.abs(delta) * 1e-4 + 1e-9);
  if (cleaned.length < 3) return [];
  // An inward offset that inverted the winding has collapsed.
  if (delta < 0 && signedArea(cleaned) <= 0) return [];
  return cleaned;
}

/** Ring → SVG path data. */
export function ringToPath(ring: Ring, scaleFactor = 1, digits = 2): string {
  if (ring.length === 0) return '';
  const f = (n: number) => (n * scaleFactor).toFixed(digits);
  return `M${ring.map((p) => `${f(p.x)},${f(p.y)}`).join('L')}Z`;
}
