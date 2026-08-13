/**
 * Toolpath generation (plan §8.3). 2.5-D only.
 *
 *   outline/paths → offset (tool compensation) → depth passes → moves
 *
 * A toolpath is a flat list of moves in board space with an explicit Z. The
 * emitters (G-code, DXF, SVG, the visualizer) all consume this one structure,
 * so what you preview is exactly what you post.
 */

import { IN, type Nm } from '../units';
import {
  area,
  bbox,
  densify,
  ensureCCW,
  offsetRing,
  pointInRing,
  signedArea,
  type Ring,
} from '../geometry/polygon';
import { dist, type Vec2 } from '../geometry/vec';
import { outlineToRing, type Outline } from '../geometry/outline';
import { hersheyText } from './hershey';
import type { CncOptions, EngraveOp, GrooveOp, PocketOp, ProfileOp, Tool } from './types';

export type MoveKind = 'rapid' | 'feed' | 'plunge';

export interface Move {
  kind: MoveKind;
  to: Vec2;
  z: Nm;
  /** Feed rate in nm/min; absent on rapids. */
  feed?: number;
}

export type OperationKind = 'profile' | 'groove' | 'pocket' | 'engrave';

export interface Operation {
  kind: OperationKind;
  name: string;
  tool: Tool;
  rpm: number;
  moves: Move[];
  /** Paths as generated, before depth stepping — for the visualizer & DXF. */
  paths: Ring[];
  maxDepth: Nm;
  warnings: string[];
}

export interface ToolpathResult {
  operations: Operation[];
  /** Board-space bounding box of everything cut. */
  extent: { minX: number; minY: number; maxX: number; maxY: number } | null;
  warnings: string[];
  errors: string[];
}

/* ------------------------------------------------------------------ */
/* Depth stepping                                                      */
/* ------------------------------------------------------------------ */

/** Depths for successive passes: never deeper than `stepdown` at a time. */
export function depthPasses(total: Nm, stepdown: Nm): Nm[] {
  const step = Math.max(1, stepdown);
  const passes: Nm[] = [];
  let z = 0;
  while (z < total - 1) {
    z = Math.min(total, z + step);
    passes.push(z);
  }
  return passes.length ? passes : [total];
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

interface TabSpan {
  /** Distance along the path where the tab starts/ends. */
  start: number;
  end: number;
}

function ringPerimeter(ring: Ring): number {
  let p = 0;
  for (let i = 0; i < ring.length; i++) p += dist(ring[i], ring[(i + 1) % ring.length]);
  return p;
}

/** Evenly spaced tab spans around a closed path. */
export function tabSpans(ring: Ring, count: number, width: Nm): TabSpan[] {
  if (count <= 0 || width <= 0) return [];
  const per = ringPerimeter(ring);
  const spans: TabSpan[] = [];
  for (let i = 0; i < count; i++) {
    const center = (per * i) / count;
    spans.push({ start: center - width / 2, end: center + width / 2 });
  }
  return spans;
}

const inTab = (d: number, spans: TabSpan[], per: number): boolean =>
  spans.some((s) => {
    // spans can wrap past the seam
    const a = ((s.start % per) + per) % per;
    const b = ((s.end % per) + per) % per;
    return a <= b ? d >= a && d <= b : d >= a || d <= b;
  });

/* ------------------------------------------------------------------ */
/* Path → moves                                                        */
/* ------------------------------------------------------------------ */

interface ContourOptions {
  depth: Nm;
  stepdown: Nm;
  feedXY: number;
  feedZ: number;
  safeZ: Nm;
  travelZ: Nm;
  /** Tabs are only meaningful on a through-cut profile. */
  tabs?: { count: number; width: Nm; height: Nm };
  /** Reverse the path direction (climb vs conventional). */
  reverse?: boolean;
  closed?: boolean;
}

/**
 * Cut one contour to depth in stepped passes. Z is negative-down: z = 0 is the
 * top of the stock, so a 0.2″ deep pass ends at z = −0.2″.
 */
export function contourMoves(path: Ring, o: ContourOptions): Move[] {
  const closed = o.closed ?? true;
  const ring = o.reverse ? [...path].reverse() : path;
  if (ring.length < 2) return [];

  const moves: Move[] = [];
  const per = ringPerimeter(ring);
  const spans = o.tabs ? tabSpans(ring, o.tabs.count, o.tabs.width) : [];
  const tabZ = o.tabs ? -(o.depth - o.tabs.height) : 0;

  // approach
  moves.push({ kind: 'rapid', to: ring[0], z: o.safeZ });

  for (const d of depthPasses(o.depth, o.stepdown)) {
    const z = -d;
    moves.push({ kind: 'plunge', to: ring[0], z, feed: o.feedZ });
    let travelled = 0;
    const n = closed ? ring.length : ring.length - 1;
    for (let i = 1; i <= n; i++) {
      const from = ring[(i - 1) % ring.length];
      const to = ring[i % ring.length];
      const segLen = dist(from, to);
      // Tabs lift the cutter over a span; only on the pass that reaches them.
      if (spans.length && z < tabZ) {
        const steps = Math.max(1, Math.ceil(segLen / (IN / 16)));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
          const d2 = travelled + segLen * t;
          const zz = inTab(d2 % per, spans, per) ? tabZ : z;
          moves.push({ kind: 'feed', to: p, z: zz, feed: o.feedXY });
        }
      } else {
        moves.push({ kind: 'feed', to, z, feed: o.feedXY });
      }
      travelled += segLen;
    }
  }
  moves.push({ kind: 'rapid', to: ring[0], z: o.safeZ });
  return moves;
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

function profileOperation(outlineRing: Ring, op: ProfileOp, cnc: CncOptions): Operation | null {
  if (!op.enabled) return null;
  const warnings: string[] = [];
  const r = op.tool.diameter / 2;
  // cut outside the line so the finished board keeps its dimensions
  const path = offsetRing(densify(outlineRing, IN / 32), r);
  if (path.length < 3) return null;

  const depth = cnc.stockThickness + op.throughDepth;
  if (op.tabs.count > 0 && op.tabs.width < op.tool.diameter * 1.5) {
    warnings.push(
      `Tabs are ${(op.tabs.width / IN).toFixed(2)}″ wide but the cutter is ${(op.tool.diameter / IN).toFixed(2)}″ — make tabs at least 1.5× the tool diameter or they will be cut away.`,
    );
  }

  // A CCW ring cut on its outside runs conventional; reverse it for climb.
  // Reverse the *path* rather than only the moves, so the stored path (which
  // drives the visualizer and DXF) shows the direction actually cut.
  const directed = op.direction === 'climb' ? [...path].reverse() : path;

  const moves = contourMoves(directed, {
    depth,
    stepdown: op.feeds.stepdown,
    feedXY: op.feeds.feedXY,
    feedZ: op.feeds.feedZ,
    safeZ: cnc.machine.safeZ,
    travelZ: cnc.machine.travelZ,
    tabs: op.tabs.count > 0 ? op.tabs : undefined,
  });

  return {
    kind: 'profile',
    name: 'Perimeter profile',
    tool: op.tool,
    rpm: op.feeds.rpm,
    moves,
    paths: [directed],
    maxDepth: depth,
    warnings,
  };
}

function grooveOperation(outlineRing: Ring, op: GrooveOp, cnc: CncOptions): Operation | null {
  if (!op.enabled) return null;
  const warnings: string[] = [];
  const path = offsetRing(densify(outlineRing, IN / 32), -op.margin);
  if (path.length < 3) {
    return {
      kind: 'groove',
      name: 'Juice groove',
      tool: op.tool,
      rpm: op.feeds.rpm,
      moves: [],
      paths: [],
      maxDepth: 0,
      warnings: ['The groove margin is larger than the board — no groove path exists.'],
    };
  }
  if (op.depth > cnc.stockThickness * 0.4) {
    warnings.push(
      `Groove depth ${(op.depth / IN).toFixed(2)}″ is more than 40% of the ${(cnc.stockThickness / IN).toFixed(2)}″ board — it will weaken it badly.`,
    );
  }
  const moves = contourMoves(path, {
    depth: op.depth,
    stepdown: op.feeds.stepdown,
    feedXY: op.feeds.feedXY,
    feedZ: op.feeds.feedZ,
    safeZ: cnc.machine.safeZ,
    travelZ: cnc.machine.travelZ,
  });
  return {
    kind: 'groove',
    name: 'Juice groove',
    tool: op.tool,
    rpm: op.feeds.rpm,
    moves,
    paths: [path],
    maxDepth: op.depth,
    warnings,
  };
}

/** Stadium (rounded-rectangle) outline for the handle recess. */
function stadiumRing(cx: number, cy: number, w: number, h: number): Ring {
  const r = Math.min(w, h) / 2;
  const ring: Ring = [];
  const steps = 24;
  const x0 = cx - w / 2 + r;
  const x1 = cx + w / 2 - r;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / steps;
    ring.push({ x: x1 + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / steps;
    ring.push({ x: x0 + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return ring;
}

function pocketOperation(outlineRing: Ring, op: PocketOp, cnc: CncOptions): Operation | null {
  if (!op.enabled) return null;
  const warnings: string[] = [];
  const b = bbox(outlineRing);
  const cx = b.minX + (b.maxX - b.minX) * op.placement.cx;
  const cy = b.minY + (b.maxY - b.minY) * op.placement.cy;
  const boundary = stadiumRing(cx, cy, op.placement.w, op.placement.h);

  // every pocket ring must stay inside the board
  if (!boundary.every((p) => pointInRing(p, outlineRing))) {
    warnings.push('The pocket extends past the board outline — move or shrink it.');
  }

  // contour-parallel: successive inward offsets by the stepover
  const step = Math.max(1, op.tool.diameter * op.stepover);
  const rings: Ring[] = [];
  let inset = op.tool.diameter / 2;
  for (let guard = 0; guard < 200; guard++) {
    const r = offsetRing(densify(boundary, IN / 32), -inset);
    if (r.length < 3 || area(r) <= 0) break;
    rings.push(r);
    inset += step;
  }
  if (rings.length === 0) {
    return {
      kind: 'pocket',
      name: 'Handle recess',
      tool: op.tool,
      rpm: op.feeds.rpm,
      moves: [],
      paths: [],
      maxDepth: 0,
      warnings: [...warnings, 'The pocket is smaller than the tool — nothing to cut.'],
    };
  }
  if (op.depth > cnc.stockThickness * 0.5) {
    warnings.push('The pocket is deeper than half the board thickness.');
  }

  // Cut inside-out so the tool is never fully buried in new material.
  const ordered = [...rings].reverse();
  const moves: Move[] = [];
  for (const d of depthPasses(op.depth, op.feeds.stepdown)) {
    for (const ring of ordered) {
      moves.push(
        ...contourMoves(ring, {
          depth: d,
          stepdown: d, // this pass only — outer loop handles stepping
          feedXY: op.feeds.feedXY,
          feedZ: op.feeds.feedZ,
          safeZ: cnc.machine.safeZ,
          travelZ: cnc.machine.travelZ,
        }),
      );
    }
  }
  return {
    kind: 'pocket',
    name: 'Handle recess',
    tool: op.tool,
    rpm: op.feeds.rpm,
    moves,
    paths: ordered,
    maxDepth: op.depth,
    warnings,
  };
}

function engraveOperation(outlineRing: Ring, op: EngraveOp, cnc: CncOptions): Operation | null {
  if (!op.enabled || !op.text.trim()) return null;
  const warnings: string[] = [];
  const b = bbox(outlineRing);
  const cx = b.minX + (b.maxX - b.minX) * op.placement.cx;
  const cy = b.minY + (b.maxY - b.minY) * op.placement.cy;
  const strokes = hersheyText(op.text, op.size, { cx, cy });
  if (strokes.length === 0) {
    return null;
  }
  if (!strokes.every((s) => s.every((p) => pointInRing(p, outlineRing)))) {
    warnings.push('Some of the engraving falls outside the board — reduce the size or move it.');
  }

  const moves: Move[] = [];
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    moves.push({ kind: 'rapid', to: stroke[0], z: cnc.machine.safeZ });
    moves.push({ kind: 'plunge', to: stroke[0], z: -op.depth, feed: op.feeds.feedZ });
    for (let i = 1; i < stroke.length; i++) {
      moves.push({ kind: 'feed', to: stroke[i], z: -op.depth, feed: op.feeds.feedXY });
    }
    moves.push({ kind: 'rapid', to: stroke[stroke.length - 1], z: cnc.machine.safeZ });
  }
  return {
    kind: 'engrave',
    name: `Engrave “${op.text}”`,
    tool: op.tool,
    rpm: op.feeds.rpm,
    moves,
    paths: strokes,
    maxDepth: op.depth,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function generateToolpaths(outline: Outline, cnc: CncOptions): ToolpathResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const ring = ensureCCW(outlineToRing(outline));
  if (signedArea(ring) <= 0 || ring.length < 3) {
    return { operations: [], extent: null, warnings, errors: ['The outline is degenerate.'] };
  }

  const operations: Operation[] = [];
  for (const op of [
    engraveOperation(ring, cnc.engrave, cnc),
    pocketOperation(ring, cnc.pocket, cnc),
    grooveOperation(ring, cnc.groove, cnc),
    profileOperation(ring, cnc.profile, cnc), // profile last: it frees the part
  ]) {
    if (op) operations.push(op);
  }

  for (const op of operations) warnings.push(...op.warnings);

  // Chipload math happily returns feeds no hobby router can reach. Say so,
  // rather than letting a user paste 250 ipm into a machine that maxes at 150.
  const FAST_IPM = 200;
  for (const [label, feeds] of [
    ['Profile', cnc.profile],
    ['Groove', cnc.groove],
    ['Pocket', cnc.pocket],
    ['Engraving', cnc.engrave],
  ] as const) {
    if (!feeds.enabled) continue;
    const ipm = feeds.feeds.feedXY / IN;
    if (ipm > FAST_IPM) {
      warnings.push(
        `${label} feed is ${Math.round(ipm)} ipm — that is the chipload-derived number, but most hobby routers top out near ${FAST_IPM} ipm. Lower the RPM (which lowers the feed) or cap the feed to what your machine can actually hold.`,
      );
    }
  }

  // hard errors that must block export
  if (cnc.profile.enabled && cnc.profile.tabs.count > 0) {
    if (cnc.profile.tabs.width < cnc.profile.tool.diameter * 1.5) {
      errors.push('Holding tabs must be at least 1.5× the cutter diameter.');
    }
  }
  if (cnc.groove.enabled && cnc.groove.depth > cnc.stockThickness * 0.4) {
    errors.push('Juice groove is deeper than 40% of the board thickness.');
  }

  let extent: ToolpathResult['extent'] = null;
  for (const op of operations) {
    for (const p of op.paths) {
      const b = bbox(p);
      extent = extent
        ? {
            minX: Math.min(extent.minX, b.minX),
            minY: Math.min(extent.minY, b.minY),
            maxX: Math.max(extent.maxX, b.maxX),
            maxY: Math.max(extent.maxY, b.maxY),
          }
        : b;
    }
  }

  return { operations, extent, warnings, errors };
}

/** Total cutting distance, for a rough time estimate. */
export function estimateMinutes(op: Operation): number {
  let minutes = 0;
  let prev: Move | null = null;
  for (const m of op.moves) {
    if (prev) {
      const d = Math.hypot(m.to.x - prev.to.x, m.to.y - prev.to.y) + Math.abs(m.z - prev.z);
      if (m.kind === 'rapid') minutes += d / (200 * IN); // assume 200 ipm rapids
      else minutes += d / (m.feed ?? op.rpm);
    }
    prev = m;
  }
  return minutes;
}
