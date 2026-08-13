/**
 * 2-D block assembly (plan §5, "it's just topology" — the V2 extension).
 *
 * Row/interval algebra covers everything you can build by ripping, crosscutting,
 * and flipping slices. Pinwheels, basket weave, and tumbling blocks cannot be
 * expressed that way: they are tilings placed by a function of (i, j). So these
 * generators emit explicit polygons, and the cut list counts *pieces* rather
 * than strips and slices.
 *
 * All three are assembled the way a butcher-block panel is: cut every piece to
 * size, then glue the field up flat. The instructions say so explicitly.
 */

import { IN, type Nm } from '../units';
import type { PolyCell, SpeciesId } from '../construction/types';
import { clipByConvex, type Ring } from '../geometry/polygon';

export type BlockPattern =
  | { kind: 'pinwheel'; unit: Nm; speciesA: SpeciesId; speciesB: SpeciesId }
  | { kind: 'basketweave'; unit: Nm; slats: number; speciesA: SpeciesId; speciesB: SpeciesId }
  | { kind: 'tumbling'; side: Nm; speciesA: SpeciesId; speciesB: SpeciesId; speciesC: SpeciesId };

export interface PieceSpec {
  pieceId: string;
  species: SpeciesId;
  /** Nominal finished size of one piece. `w` is the width at the wide end. */
  w: Nm;
  h: Nm;
  count: number;
  /** Non-90° pieces (tumbling rhombi, patch triangles) carry their cut angle. */
  angleDeg?: number;
  /** True when the piece is trimmed by the field edge (a partial). */
  partial?: boolean;
  /** Tapered strips: width at the narrow end. Cut on a taper jig. */
  w2?: Nm;
  tapered?: boolean;
}

export interface BlockField {
  polys: PolyCell[];
  pieces: PieceSpec[];
  notes: string[];
}

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** Field rectangle used to clip pieces that overhang the board. */
function fieldRing(L: Nm, W: Nm): Ring {
  return rect(0, 0, L, W);
}

const areaOf = (pts: { x: number; y: number }[]): number => {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
};

/**
 * Place one piece, clipping it to the field. Returns null when it falls
 * entirely outside. Pieces trimmed by the edge are marked partial so the cut
 * list can say "cut oversize and trim".
 */
function place(
  pts: { x: number; y: number }[],
  field: Ring,
  species: SpeciesId,
  pieceId: string,
  out: PolyCell[],
): 'full' | 'partial' | 'none' {
  const full = areaOf(pts);
  const clipped = clipByConvex(field, pts);
  if (clipped.length < 3) return 'none';
  const a = areaOf(clipped);
  if (a <= full * 1e-9) return 'none';
  out.push({ species, points: clipped, pieceId });
  return a >= full * 0.999 ? 'full' : 'partial';
}

/* ------------------------------------------------------------------ */
/* Pinwheel                                                            */
/* ------------------------------------------------------------------ */

/**
 * The classic pinwheel: a 3u square tiled by four 1u×2u rectangles rotating
 * around a 1u center. Adjacent units swap species so the field reads as a run
 * of pinwheels rather than stripes.
 */
export function pinwheelField(
  pattern: Extract<BlockPattern, { kind: 'pinwheel' }>,
  L: Nm,
  W: Nm,
): BlockField {
  const unit = Math.max(1, pattern.unit); // full 3u square
  const u = unit / 3;
  const field = fieldRing(L, W);
  const polys: PolyCell[] = [];
  const counts = new Map<string, { spec: Omit<PieceSpec, 'count'>; n: number }>();

  const tally = (pieceId: string, species: SpeciesId, w: number, h: number, partial: boolean) => {
    const key = `${pieceId}|${species}|${Math.round(w)}|${Math.round(h)}|${partial}`;
    const e = counts.get(key);
    if (e) e.n++;
    else counts.set(key, { spec: { pieceId, species, w: Math.round(w), h: Math.round(h), partial }, n: 1 });
  };

  const cols = Math.ceil(L / unit);
  const rows = Math.ceil(W / unit);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = i * unit;
      const y = j * unit;
      // alternate which species forms the arms, checkerboard by unit
      const swap = (i + j) % 2 === 1;
      const arm = swap ? pattern.speciesB : pattern.speciesA;
      const hub = swap ? pattern.speciesA : pattern.speciesB;

      const parts: [{ x: number; y: number }[], SpeciesId, string, number, number][] = [
        [rect(x, y, 2 * u, u), arm, 'arm', 2 * u, u], // top
        [rect(x + 2 * u, y, u, 2 * u), arm, 'arm', u, 2 * u], // right
        [rect(x + u, y + 2 * u, 2 * u, u), arm, 'arm', 2 * u, u], // bottom
        [rect(x, y + u, u, 2 * u), arm, 'arm', u, 2 * u], // left
        [rect(x + u, y + u, u, u), hub, 'center', u, u], // hub
      ];
      for (const [pts, species, pieceId, w, h] of parts) {
        const r = place(pts, field, species, pieceId, polys);
        if (r !== 'none') tally(pieceId, species, w, h, r === 'partial');
      }
    }
  }

  return {
    polys,
    pieces: [...counts.values()].map((e) => ({ ...e.spec, count: e.n })),
    notes: [
      `Each pinwheel is a ${(unit / IN).toFixed(2)}″ square: four ${(u / IN).toFixed(2)}″ × ${((2 * u) / IN).toFixed(2)}″ arms around a ${(u / IN).toFixed(2)}″ centre.`,
      'Alternate units swap the two species, which is what makes the wheels read as wheels.',
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Basket weave                                                        */
/* ------------------------------------------------------------------ */

/**
 * Basket weave: square units of n slats, alternating horizontal and vertical
 * in a checkerboard, each orientation in its own species.
 */
export function basketWeaveField(
  pattern: Extract<BlockPattern, { kind: 'basketweave' }>,
  L: Nm,
  W: Nm,
): BlockField {
  const unit = Math.max(1, pattern.unit);
  const n = Math.max(2, Math.min(6, Math.floor(pattern.slats)));
  const slat = unit / n;
  const field = fieldRing(L, W);
  const polys: PolyCell[] = [];
  const counts = new Map<string, { spec: Omit<PieceSpec, 'count'>; n: number }>();

  const tally = (species: SpeciesId, w: number, h: number, partial: boolean) => {
    const key = `${species}|${Math.round(w)}|${Math.round(h)}|${partial}`;
    const e = counts.get(key);
    if (e) e.n++;
    else counts.set(key, { spec: { pieceId: 'slat', species, w: Math.round(w), h: Math.round(h), partial }, n: 1 });
  };

  const cols = Math.ceil(L / unit);
  const rows = Math.ceil(W / unit);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = i * unit;
      const y = j * unit;
      const horizontal = (i + j) % 2 === 0;
      const species = horizontal ? pattern.speciesA : pattern.speciesB;
      for (let k = 0; k < n; k++) {
        const pts = horizontal
          ? rect(x, y + k * slat, unit, slat)
          : rect(x + k * slat, y, slat, unit);
        const r = place(pts, field, species, 'slat', polys);
        if (r !== 'none') {
          tally(species, horizontal ? unit : slat, horizontal ? slat : unit, r === 'partial');
        }
      }
    }
  }

  return {
    polys,
    pieces: [...counts.values()].map((e) => ({ ...e.spec, count: e.n })),
    notes: [
      `${n} slats of ${(slat / IN).toFixed(2)}″ × ${(unit / IN).toFixed(2)}″ per ${(unit / IN).toFixed(2)}″ unit.`,
      'Units alternate horizontal and vertical; every slat is the same piece, so rip one long strip per species and crosscut.',
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Tumbling blocks                                                     */
/* ------------------------------------------------------------------ */

/**
 * Rhombille tiling — the 3-D cube illusion. Three 60°/120° rhombi meet at every
 * hexagon centre, one species per orientation, which is what reads as light,
 * shadow, and top face.
 *
 * Shop method (encoded in the cut list): rip each species into strips
 * `side·sin60` wide, then crosscut at 60° every `side` to get the rhombi.
 */
export function tumblingField(
  pattern: Extract<BlockPattern, { kind: 'tumbling' }>,
  L: Nm,
  W: Nm,
): BlockField {
  const s = Math.max(1, pattern.side);
  const field = fieldRing(L, W);
  const polys: PolyCell[] = [];
  const species = [pattern.speciesA, pattern.speciesB, pattern.speciesC];
  const counts = new Map<string, number>();

  // Hexagon vertices at 30° + 60k, circumradius s; centres on a triangular
  // lattice with spacing √3·s.
  const vert = (k: number) => ({
    x: s * Math.cos(((30 + 60 * k) * Math.PI) / 180),
    y: s * Math.sin(((30 + 60 * k) * Math.PI) / 180),
  });
  const dx = Math.sqrt(3) * s;
  const dy = 1.5 * s;

  const cols = Math.ceil(L / dx) + 2;
  const rows = Math.ceil(W / dy) + 2;
  for (let j = -1; j < rows; j++) {
    for (let i = -1; i < cols; i++) {
      const cx = i * dx + (j % 2 === 0 ? 0 : dx / 2);
      const cy = j * dy;
      // three rhombi sharing the centre, each spanning two adjacent vertices
      for (let r = 0; r < 3; r++) {
        const a = vert(2 * r);
        const b = vert(2 * r + 1);
        const pts = [
          { x: cx, y: cy },
          { x: cx + a.x, y: cy + a.y },
          { x: cx + a.x + b.x, y: cy + a.y + b.y },
          { x: cx + b.x, y: cy + b.y },
        ];
        const res = place(pts, field, species[r], `face-${r}`, polys);
        if (res !== 'none') {
          const key = `${species[r]}|${res === 'partial'}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  }

  const stripWidth = Math.round(s * Math.sin(Math.PI / 3));
  const pieces: PieceSpec[] = [...counts.entries()].map(([key, count]) => {
    const [sp, partial] = key.split('|');
    return {
      pieceId: 'rhombus',
      species: sp,
      w: stripWidth,
      h: Math.round(s),
      count,
      angleDeg: 60,
      partial: partial === 'true',
    };
  });

  return {
    polys,
    pieces,
    notes: [
      `Every piece is a 60°/120° rhombus with ${(s / IN).toFixed(2)}″ sides.`,
      `Rip each species ${(stripWidth / IN).toFixed(2)}″ wide, then crosscut at 60° every ${(s / IN).toFixed(2)}″ — each cut yields one rhombus.`,
      'Three species, one per rhombus orientation: that mapping is what produces the cube illusion. Keep them consistent across the whole field.',
    ],
  };
}

/* ------------------------------------------------------------------ */

export function buildBlockField(pattern: BlockPattern, L: Nm, W: Nm): BlockField {
  switch (pattern.kind) {
    case 'pinwheel':
      return pinwheelField(pattern, L, W);
    case 'basketweave':
      return basketWeaveField(pattern, L, W);
    case 'tumbling':
      return tumblingField(pattern, L, W);
  }
}

export function blockPatternName(p: BlockPattern): string {
  switch (p.kind) {
    case 'pinwheel':
      return 'Pinwheel';
    case 'basketweave':
      return 'Basket weave';
    case 'tumbling':
      return 'Tumbling blocks';
  }
}
