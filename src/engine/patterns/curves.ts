/**
 * Curves built from straight cuts.
 *
 * A parabola cannot be sawn. What *can* be sawn is a sequence of straight
 * crosscuts whose chords lie on the parabola — rip the panel into columns, make
 * one angled crosscut across each column, and the assembled boundary reads as a
 * smooth curve. More columns, smoother curve; each column is still one straight
 * cut at one miter setting.
 *
 * (The classic "curve stitching" construction — a parabola as the *envelope* of
 * its tangent lines — is beautiful on paper but not buildable as a panel: the
 * tangents cross inside the board, so the regions between them are not strips.
 * The chord construction below is the version that survives contact with a
 * table saw, and it is what this generator emits.)
 *
 * Every column is glued from 2–3 pieces before the columns are glued to each
 * other, so this is genuinely a multi-glue-up design — the build plan says so.
 */

import { IN, type Nm } from '../units';
import type { PolyCell, SpeciesId } from '../construction/types';
import type { PieceSpec } from './blocks';

export type CurvePattern = {
  kind: 'parabolic';
  /** Number of columns; each is one straight crosscut. */
  columns: number;
  /** Species below the curve, above the curve, and (optionally) the accent line. */
  speciesLow: SpeciesId;
  speciesHigh: SpeciesId;
  accent?: SpeciesId;
  /** Accent band thickness, measured perpendicular-ish (0 = no accent). */
  accentWidth: Nm;
  /** Peak height of the arch as a fraction of board width (0.1–0.9). */
  rise: number;
  /** 'arch' = one parabola; 'lens' = two mirrored parabolas forming an eye. */
  shape: 'arch' | 'lens';
  /** Flip the arch upside down. */
  inverted: boolean;
};

export interface CurveField {
  polys: PolyCell[];
  pieces: PieceSpec[];
  notes: string[];
  /** Each column is its own little glue-up. */
  subAssemblies: number;
  /** Per-column miter angles, for the instructions. */
  columnAngles: number[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Parabola through the board, in board space (y down).
 * `arch`: vertex at the top centre, meeting the bottom corners.
 * `lens`: two mirrored parabolas, meeting at the left and right edges.
 */
function curveY(pattern: CurvePattern, L: Nm, W: Nm): (x: number) => { lo: number; hi: number } {
  const rise = clamp(pattern.rise, 0.08, 0.92);
  if (pattern.shape === 'lens') {
    // two parabolas symmetric about the horizontal centreline
    const half = (W * rise) / 2;
    const k = half / Math.pow(L / 2, 2);
    return (x: number) => {
      const u = x - L / 2;
      const d = half - k * u * u; // half-thickness of the lens at x
      return { lo: W / 2 - d, hi: W / 2 + d };
    };
  }
  // arch: vertex height `rise` above the bottom edge, passing through the
  // bottom corners; a single boundary splits the board in two.
  const vertexY = W * (1 - rise);
  const k = (W - vertexY) / Math.pow(L / 2, 2);
  return (x: number) => {
    const u = x - L / 2;
    const y = vertexY + k * u * u;
    const yy = pattern.inverted ? W - y : y;
    return { lo: yy, hi: yy };
  };
}

const deg = (r: number) => (r * 180) / Math.PI;

export function parabolicField(pattern: CurvePattern, L: Nm, W: Nm): CurveField {
  const n = Math.max(2, Math.min(60, Math.floor(pattern.columns)));
  const colW = L / n;
  const f = curveY(pattern, L, W);
  const accent = pattern.accent && pattern.accentWidth > 0 ? pattern.accentWidth : 0;

  const polys: PolyCell[] = [];
  const pieces: PieceSpec[] = [];
  const columnAngles: number[] = [];
  const lens = pattern.shape === 'lens';

  for (let i = 0; i < n; i++) {
    const x0 = i * colW;
    const x1 = (i + 1) * colW;
    const a = f(x0);
    const b = f(x1);

    // The single (arch) or lower (lens) boundary
    const loA = clamp(a.lo, 0, W);
    const loB = clamp(b.lo, 0, W);
    const hiA = clamp(a.hi, 0, W);
    const hiB = clamp(b.hi, 0, W);

    const angle = deg(Math.atan2(loB - loA, colW));
    columnAngles.push(Math.round(angle * 10) / 10);

    const quad = (yTopA: number, yTopB: number, yBotA: number, yBotB: number) => [
      { x: x0, y: yTopA },
      { x: x1, y: yTopB },
      { x: x1, y: yBotB },
      { x: x0, y: yBotA },
    ];

    const push = (species: SpeciesId, pieceId: string, pts: { x: number; y: number }[]) => {
      // skip slivers that round away to nothing
      const h1 = Math.abs(pts[3].y - pts[0].y);
      const h2 = Math.abs(pts[2].y - pts[1].y);
      if (h1 + h2 < 1000) return;
      polys.push({ species, points: pts, pieceId });
      pieces.push({
        pieceId,
        species,
        w: Math.round(Math.max(h1, h2)),
        h: Math.round(colW),
        count: 1,
        angleDeg: Math.round(Math.abs(angle) * 10) / 10,
        tapered: Math.abs(h1 - h2) > 1000,
        w2: Math.round(Math.min(h1, h2)),
      });
    };

    if (!lens) {
      const accHalf = accent / 2;
      push(pattern.speciesHigh, 'above', quad(0, 0, loA - accHalf, loB - accHalf));
      if (accent > 0 && pattern.accent) {
        push(pattern.accent, 'accent', quad(loA - accHalf, loB - accHalf, loA + accHalf, loB + accHalf));
      }
      push(pattern.speciesLow, 'below', quad(loA + accHalf, loB + accHalf, W, W));
    } else {
      const accHalf = accent / 2;
      push(pattern.speciesHigh, 'above', quad(0, 0, loA - accHalf, loB - accHalf));
      if (accent > 0 && pattern.accent) {
        push(pattern.accent, 'accent-top', quad(loA - accHalf, loB - accHalf, loA + accHalf, loB + accHalf));
      }
      push(pattern.speciesLow, 'lens', quad(loA + accHalf, loB + accHalf, hiA - accHalf, hiB - accHalf));
      if (accent > 0 && pattern.accent) {
        push(pattern.accent, 'accent-bottom', quad(hiA - accHalf, hiB - accHalf, hiA + accHalf, hiB + accHalf));
      }
      push(pattern.speciesHigh, 'below', quad(hiA + accHalf, hiB + accHalf, W, W));
    }
  }

  const maxAngle = Math.max(...columnAngles.map((a) => Math.abs(a)));
  const notes = [
    `${n} columns of ${(colW / IN).toFixed(2)}″, each with one straight crosscut. The curve is the chord path — more columns means a smoother arc.`,
    `Miter angles run from 0° at the vertex to ${maxAngle.toFixed(1)}° at the steepest column; every column has its own setting, listed in the cut list.`,
    accent > 0 ? `A ${(accent / IN).toFixed(3)}″ accent line follows the curve, cut as its own tapered sliver in each column.` : '',
  ].filter(Boolean);

  return { polys, pieces: mergePieces(pieces), notes, subAssemblies: n, columnAngles };
}

/** Collapse identical pieces so the cut list groups them. */
function mergePieces(pieces: PieceSpec[]): PieceSpec[] {
  const map = new Map<string, PieceSpec>();
  for (const p of pieces) {
    const key = `${p.pieceId}|${p.species}|${p.w}|${p.w2}|${p.h}|${p.angleDeg}`;
    const e = map.get(key);
    if (e) e.count += p.count;
    else map.set(key, { ...p });
  }
  return [...map.values()];
}
