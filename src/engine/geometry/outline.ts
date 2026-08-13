/**
 * Board outlines (plan §4.4).
 *
 * Outlines are orthogonal to the glue-up: you always glue a rectangular blank
 * that bounds the outline, then cut the shape out of it. So an outline changes
 * (a) the preview, via clipping, (b) the required blank size, and (c) the CNC
 * profile path — never the strip widths or slice count.
 *
 * Every outline exposes two forms:
 *   segments() — lines and true arcs, for SVG/DXF/G-code (arcs stay arcs)
 *   toRing()   — a flattened polygon, for clipping and offsetting math
 */

import { IN, type Nm } from '../units';
import { arcSteps, bbox, densify, type Bbox, type Ring } from './polygon';
import type { Vec2 } from './vec';

export type Outline =
  | { kind: 'rect'; w: Nm; h: Nm; cornerRadius: Nm }
  | { kind: 'ellipse'; rx: Nm; ry: Nm }
  | { kind: 'paddle'; bodyW: Nm; bodyH: Nm; handleW: Nm; handleL: Nm; r: Nm }
  | { kind: 'polygon'; points: Vec2[] };

/**
 * What a *project* stores. Only the shape parameters live here — the overall
 * size always comes from the pattern's finished extents, because the outline is
 * inscribed in the blank you glue up. One source of truth for dimensions.
 */
export type OutlineSpec =
  | { kind: 'rect'; cornerRadius: Nm }
  | { kind: 'ellipse' }
  | { kind: 'paddle'; handleL: Nm; handleW: Nm; filletR: Nm }
  | { kind: 'polygon'; points: Vec2[] };

export const SQUARE_OUTLINE: OutlineSpec = { kind: 'rect', cornerRadius: 0 };

/** Resolve a stored spec against the finished blank size. */
export function resolveOutline(spec: OutlineSpec | undefined, w: Nm, h: Nm): Outline {
  const width = Math.max(1, w);
  const height = Math.max(1, h);
  switch (spec?.kind) {
    case undefined:
    case 'rect':
      return {
        kind: 'rect',
        w: width,
        h: height,
        cornerRadius: Math.max(0, Math.min(spec?.cornerRadius ?? 0, Math.min(width, height) / 2)),
      };
    case 'ellipse':
      return { kind: 'ellipse', rx: width / 2, ry: height / 2 };
    case 'paddle': {
      const handleL = Math.max(1, Math.min(spec.handleL, width * 0.6));
      const handleW = Math.max(1, Math.min(spec.handleW, height));
      return {
        kind: 'paddle',
        bodyW: width - handleL,
        bodyH: height,
        handleW,
        handleL,
        r: Math.max(0, Math.min(spec.filletR, Math.min(width - handleL, height) / 2)),
      };
    }
    case 'polygon':
      return { kind: 'polygon', points: spec.points };
  }
}

/** True when the outline is the plain full-size rectangle (no clipping needed). */
export function isPlainRect(o: Outline): boolean {
  return o.kind === 'rect' && o.cornerRadius <= 0;
}

/**
 * Board space is y-down (screen convention), so a *positive* angular sweep
 * appears clockwise on screen. `delta` is the signed sweep in radians from
 * `a0`, which removes every direction ambiguity — no ccw flag to misread.
 */
export type Seg =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'arc'; c: Vec2; r: number; a0: number; delta: number };

/** End angle of an arc segment. */
export const arcEnd = (s: Extract<Seg, { kind: 'arc' }>): number => s.a0 + s.delta;

/** Point on an arc at parameter t ∈ [0,1]. */
export function arcPoint(s: Extract<Seg, { kind: 'arc' }>, t: number): Vec2 {
  const a = s.a0 + s.delta * t;
  return { x: s.c.x + s.r * Math.cos(a), y: s.c.y + s.r * Math.sin(a) };
}

/** Default flattening tolerance: 0.001″, the plan's linearization spec. */
export const ARC_TOLERANCE: Nm = Math.round(0.001 * IN);

export const DEFAULT_OUTLINE = (w: Nm, h: Nm): Outline => ({ kind: 'rect', w, h, cornerRadius: 0 });

/** Overall size of the outline's bounding box — this is the blank you glue up. */
export function outlineSize(o: Outline): { w: number; h: number } {
  switch (o.kind) {
    case 'rect':
      return { w: o.w, h: o.h };
    case 'ellipse':
      return { w: o.rx * 2, h: o.ry * 2 };
    case 'paddle':
      return { w: o.bodyW + o.handleL, h: o.bodyH };
    case 'polygon': {
      const b = bbox(o.points);
      return { w: b.maxX - b.minX, h: b.maxY - b.minY };
    }
  }
}

export function outlineBbox(o: Outline): Bbox {
  const { w, h } = outlineSize(o);
  return { minX: 0, minY: 0, maxX: w, maxY: h };
}

const TAU = Math.PI * 2;

/**
 * Outline → segment list, in board space with (0,0) at the blank's top-left
 * and y increasing downward (matching the render/grid convention).
 */
export function outlineSegments(o: Outline): Seg[] {
  switch (o.kind) {
    case 'rect': {
      const r = Math.max(0, Math.min(o.cornerRadius, Math.min(o.w, o.h) / 2));
      if (r <= 0) {
        const pts = [
          { x: 0, y: 0 },
          { x: o.w, y: 0 },
          { x: o.w, y: o.h },
          { x: 0, y: o.h },
        ];
        return pts.map((a, i) => ({ kind: 'line' as const, a, b: pts[(i + 1) % 4] }));
      }
      // Corner centers, clockwise from top-left in screen space.
      const segs: Seg[] = [];
      const push = (a: Vec2, b: Vec2) => segs.push({ kind: 'line', a, b });
      push({ x: r, y: 0 }, { x: o.w - r, y: 0 });
      segs.push(cornerArc({ x: o.w - r, y: r }, r, -90));
      push({ x: o.w, y: r }, { x: o.w, y: o.h - r });
      segs.push(cornerArc({ x: o.w - r, y: o.h - r }, r, 0));
      push({ x: o.w - r, y: o.h }, { x: r, y: o.h });
      segs.push(cornerArc({ x: r, y: o.h - r }, r, 90));
      push({ x: 0, y: o.h - r }, { x: 0, y: r });
      segs.push(cornerArc({ x: r, y: r }, r, 180));
      return segs;
    }
    case 'ellipse': {
      // No true-arc form for a non-circular ellipse — emit a fine polyline.
      // (A circle still comes out as one arc pair, which DXF/G-code prefer.)
      if (Math.abs(o.rx - o.ry) < 1) {
        const c = { x: o.rx, y: o.ry };
        return [
          { kind: 'arc', c, r: o.rx, a0: 0, delta: Math.PI },
          { kind: 'arc', c, r: o.rx, a0: Math.PI, delta: Math.PI },
        ];
      }
      const ring = ellipseRing(o.rx, o.ry, ARC_TOLERANCE);
      return ring.map((a, i) => ({ kind: 'line' as const, a, b: ring[(i + 1) % ring.length] }));
    }
    case 'paddle':
      return paddleSegments(o);
    case 'polygon': {
      const pts = o.points;
      return pts.map((a, i) => ({ kind: 'line' as const, a, b: pts[(i + 1) % pts.length] }));
    }
  }
}

/**
 * Rounded-rect corner: the outline is traversed clockwise on screen, which in
 * y-down space is the direction of increasing angle — so every corner sweeps
 * +90°.
 */
function cornerArc(c: Vec2, r: number, a0Deg: number): Seg {
  return { kind: 'arc', c, r, a0: (a0Deg * Math.PI) / 180, delta: Math.PI / 2 };
}

function ellipseRing(rx: number, ry: number, tol: number): Ring {
  // round up to a multiple of 4 so the four extreme points land exactly on the
  // bounding box — otherwise the blank comes out a hair small
  const raw = Math.max(24, arcSteps(Math.max(rx, ry), TAU, tol));
  const steps = Math.ceil(raw / 4) * 4;
  const out: Ring = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * TAU;
    out.push({ x: rx + rx * Math.cos(t), y: ry + ry * Math.sin(t) });
  }
  return out;
}

/**
 * Paddle / cutting board with a handle: a rounded body on the left, a rounded
 * handle projecting right, blended with fillets where the handle meets the body.
 */
function paddleSegments(o: Extract<Outline, { kind: 'paddle' }>): Seg[] {
  const ring = paddleRing(o);
  return ring.map((a, i) => ({ kind: 'line' as const, a, b: ring[(i + 1) % ring.length] }));
}

function paddleRing(o: Extract<Outline, { kind: 'paddle' }>): Ring {
  const bodyR = Math.max(0, Math.min(o.r, Math.min(o.bodyW, o.bodyH) / 2));
  const handleH = Math.max(1, Math.min(o.handleW, o.bodyH));
  const handleR = Math.min(handleH / 2, o.handleL / 2);
  const cy = o.bodyH / 2;
  const yTop = cy - handleH / 2;
  const yBot = cy + handleH / 2;
  const xEnd = o.bodyW + o.handleL;
  const pts: Ring = [];
  const arc = (cx: number, cyy: number, r: number, from: number, to: number) => {
    const steps = Math.max(4, arcSteps(r, Math.abs(to - from), ARC_TOLERANCE));
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      pts.push({ x: cx + r * Math.cos(a), y: cyy + r * Math.sin(a) });
    }
  };

  // Fillet where the handle meets the body: a sharp inside corner there is a
  // stress riser and a pain to sand, so blend it like a real paddle.
  const fr = Math.max(0, Math.min(bodyR, o.handleL / 2, (o.bodyH - handleH) / 2 - 1));

  // body: top-left → top-right, down the right side is where the handle leaves
  arc(bodyR, bodyR, bodyR, Math.PI, 1.5 * Math.PI);          // top-left corner
  pts.push({ x: o.bodyW - bodyR, y: 0 });
  arc(o.bodyW - bodyR, bodyR, bodyR, -0.5 * Math.PI, 0);      // top-right corner
  pts.push({ x: o.bodyW, y: yTop - fr });
  if (fr > 0) arc(o.bodyW + fr, yTop - fr, fr, Math.PI, 0.5 * Math.PI); // upper junction fillet
  // handle: out along the top, round the end, back along the bottom
  pts.push({ x: xEnd - handleR, y: yTop });
  arc(xEnd - handleR, yTop + handleR, handleR, -0.5 * Math.PI, 0.5 * Math.PI);
  pts.push({ x: xEnd - handleR, y: yBot });
  if (fr > 0) arc(o.bodyW + fr, yBot + fr, fr, 1.5 * Math.PI, Math.PI); // lower junction fillet
  pts.push({ x: o.bodyW, y: yBot + fr });
  // back down the body
  pts.push({ x: o.bodyW, y: o.bodyH - bodyR });
  arc(o.bodyW - bodyR, o.bodyH - bodyR, bodyR, 0, 0.5 * Math.PI);
  pts.push({ x: bodyR, y: o.bodyH });
  arc(bodyR, o.bodyH - bodyR, bodyR, 0.5 * Math.PI, Math.PI);
  return pts;
}

/** Outline → flattened ring (screen space, y down), for clipping and offsetting. */
export function outlineToRing(o: Outline, tol: Nm = ARC_TOLERANCE): Ring {
  if (o.kind === 'paddle') return paddleRing(o);
  if (o.kind === 'ellipse') return ellipseRing(o.rx, o.ry, tol);
  const ring: Ring = [];
  for (const seg of outlineSegments(o)) {
    if (seg.kind === 'line') {
      ring.push(seg.a);
    } else {
      const steps = arcSteps(seg.r, Math.abs(seg.delta), tol);
      // exclude the endpoint — the next segment starts there
      for (let i = 0; i < steps; i++) ring.push(arcPoint(seg, i / steps));
    }
  }
  return ring;
}

/** Outline → SVG path, keeping true arcs so print output stays crisp. */
export function outlineToPath(o: Outline, s = 1, digits = 2): string {
  const f = (n: number) => (n * s).toFixed(digits);
  if (o.kind === 'rect') {
    const r = Math.max(0, Math.min(o.cornerRadius, Math.min(o.w, o.h) / 2));
    if (r <= 0) return `M0,0H${f(o.w)}V${f(o.h)}H0Z`;
    return (
      `M${f(r)},0H${f(o.w - r)}A${f(r)},${f(r)} 0 0 1 ${f(o.w)},${f(r)}` +
      `V${f(o.h - r)}A${f(r)},${f(r)} 0 0 1 ${f(o.w - r)},${f(o.h)}` +
      `H${f(r)}A${f(r)},${f(r)} 0 0 1 0,${f(o.h - r)}` +
      `V${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`
    );
  }
  if (o.kind === 'ellipse') {
    return (
      `M0,${f(o.ry)}A${f(o.rx)},${f(o.ry)} 0 0 1 ${f(o.rx * 2)},${f(o.ry)}` +
      `A${f(o.rx)},${f(o.ry)} 0 0 1 0,${f(o.ry)}Z`
    );
  }
  const ring = outlineToRing(o);
  return `M${ring.map((p) => `${f(p.x)},${f(p.y)}`).join('L')}Z`;
}

/** A densified ring is what the offsetter wants; 1/32″ segments are plenty. */
export function outlineToDenseRing(o: Outline): Ring {
  return densify(outlineToRing(o), IN / 32);
}
