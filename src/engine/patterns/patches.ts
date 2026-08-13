/**
 * Patch grid — the model behind the interactive pattern designer.
 *
 * Why a lattice and a fixed palette rather than free placement? Because the cut
 * list has to stay exact. Quilt design software (EQ8 and friends) works this
 * way for the same reason: if a patch is always one of a handful of known
 * shapes on a known grid, the cutting instructions are a formula, not a guess.
 * Drag a shape anywhere you like — it snaps to a cell, and every cell is still
 * something you can cut with a stop block and a miter gauge.
 *
 * Each patch kind divides its cell into regions. A patch with more than one
 * region is a *sub-assembly*: it gets glued and squared before it can join a
 * row, which is why designs made here usually need three glue-ups.
 */

import { IN, type Nm } from '../units';
import type { PolyCell, SpeciesId } from '../construction/types';
import type { PieceSpec } from './blocks';

export type PatchKind =
  | 'full'      // whole cell, one species
  | 'hst'       // half-square triangle: split on a diagonal
  | 'qst'       // quarter-square: both diagonals, 4 triangles
  | 'halfV'     // split down the middle, vertically
  | 'halfH'     // split across the middle, horizontally
  | 'quarters'  // four small squares
  | 'stripes3'  // three equal stripes
  | 'chevron';  // two triangles + two triangles meeting at a point

export interface Patch {
  kind: PatchKind;
  /** Quarter-turns clockwise, applied after `flip`. */
  rot: 0 | 1 | 2 | 3;
  /** Mirror across the cell's vertical centreline. */
  flip: boolean;
  /** One species per region, in the kind's canonical region order. */
  species: SpeciesId[];
}

export interface PatchGrid {
  cols: number;
  rows: number;
  /** Finished size of one cell (square). */
  cell: Nm;
  /** Row-major, length cols*rows; null = empty cell. */
  patches: (Patch | null)[];
}

/** How many species regions each kind needs. */
export const REGION_COUNT: Record<PatchKind, number> = {
  full: 1,
  hst: 2,
  qst: 4,
  halfV: 2,
  halfH: 2,
  quarters: 4,
  stripes3: 3,
  chevron: 4,
};

export const PATCH_LABEL: Record<PatchKind, string> = {
  full: 'Solid',
  hst: 'Half-square triangle',
  qst: 'Quarter-square',
  halfV: 'Split vertical',
  halfH: 'Split horizontal',
  quarters: 'Four squares',
  stripes3: 'Three stripes',
  chevron: 'Chevron',
};

/** Unit-cell region outlines, in a 0..1 square, before flip/rotate. */
const UNIT_REGIONS: Record<PatchKind, [number, number][][]> = {
  full: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
  hst: [
    [[0, 0], [1, 0], [0, 1]],
    [[1, 0], [1, 1], [0, 1]],
  ],
  qst: [
    [[0, 0], [1, 0], [0.5, 0.5]],
    [[1, 0], [1, 1], [0.5, 0.5]],
    [[1, 1], [0, 1], [0.5, 0.5]],
    [[0, 1], [0, 0], [0.5, 0.5]],
  ],
  halfV: [
    [[0, 0], [0.5, 0], [0.5, 1], [0, 1]],
    [[0.5, 0], [1, 0], [1, 1], [0.5, 1]],
  ],
  halfH: [
    [[0, 0], [1, 0], [1, 0.5], [0, 0.5]],
    [[0, 0.5], [1, 0.5], [1, 1], [0, 1]],
  ],
  quarters: [
    [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]],
    [[0.5, 0], [1, 0], [1, 0.5], [0.5, 0.5]],
    [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]],
    [[0, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]],
  ],
  stripes3: [
    [[0, 0], [1, 0], [1, 1 / 3], [0, 1 / 3]],
    [[0, 1 / 3], [1, 1 / 3], [1, 2 / 3], [0, 2 / 3]],
    [[0, 2 / 3], [1, 2 / 3], [1, 1], [0, 1]],
  ],
  chevron: [
    [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]].map(([x, y]) => [x, y]) as [number, number][],
    [[0.5, 0], [1, 0], [1, 0.5], [0.5, 0.5]] as [number, number][],
    [[0, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]] as [number, number][],
    [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]] as [number, number][],
  ],
};

// The chevron cell is really two mirrored HSTs stacked; override with triangles.
UNIT_REGIONS.chevron = [
  [[0, 0], [1, 0], [0.5, 0.5]],
  [[0, 0], [0.5, 0.5], [0, 1]],
  [[1, 0], [1, 1], [0.5, 0.5]],
  [[0.5, 0.5], [1, 1], [0, 1]],
];

/** Apply flip then `rot` quarter-turns to a unit-square point. */
function transformUnit(p: [number, number], rot: number, flip: boolean): [number, number] {
  let [x, y] = p;
  if (flip) x = 1 - x;
  for (let i = 0; i < rot; i++) {
    const nx = 1 - y;
    const ny = x;
    x = nx;
    y = ny;
  }
  return [x, y];
}

export function patchRegions(patch: Patch): [number, number][][] {
  return (UNIT_REGIONS[patch.kind] ?? UNIT_REGIONS.full).map((region) =>
    region.map((p) => transformUnit(p, patch.rot, patch.flip)),
  );
}

export function makePatch(kind: PatchKind, species: SpeciesId[]): Patch {
  const n = REGION_COUNT[kind];
  const filled = Array.from({ length: n }, (_, i) => species[i % Math.max(1, species.length)] ?? species[0]);
  return { kind, rot: 0, flip: false, species: filled };
}

export function emptyGrid(cols: number, rows: number, cell: Nm): PatchGrid {
  return { cols, rows, cell, patches: Array.from({ length: cols * rows }, () => null) };
}

/* ------------------------------------------------------------------ */
/* Field generation                                                    */
/* ------------------------------------------------------------------ */

export interface PatchField {
  polys: PolyCell[];
  pieces: PieceSpec[];
  notes: string[];
  /** Cells that are glued from more than one piece. */
  subAssemblies: number;
  /** Cells left empty — the design is not buildable until they are filled. */
  emptyCells: number;
}

/**
 * Cutting recipe for one region shape. Regions are always either the whole
 * cell, a rectangular fraction of it, or a triangle cut from a cell-sized
 * square — so every one of them reduces to "rip a strip, crosscut, maybe
 * cut a diagonal".
 */
interface RegionShape {
  /** Stable key for grouping in the cut list. */
  id: string;
  w: Nm;
  h: Nm;
  angleDeg?: number;
}

function regionShape(kind: PatchKind, cell: Nm): RegionShape {
  const c = cell;
  switch (kind) {
    case 'full':
      return { id: 'square', w: c, h: c };
    case 'hst':
      // half of a cell-sized square, cut corner to corner
      return { id: 'half-square triangle', w: c, h: c, angleDeg: 45 };
    case 'qst':
    case 'chevron':
      // quarter of a cell-sized square, cut on both diagonals
      return { id: 'quarter-square triangle', w: c, h: Math.round(c / 2), angleDeg: 45 };
    case 'halfV':
    case 'halfH':
      return { id: 'half rectangle', w: Math.round(c / 2), h: c };
    case 'quarters':
      return { id: 'quarter square', w: Math.round(c / 2), h: Math.round(c / 2) };
    case 'stripes3':
      return { id: 'stripe', w: Math.round(c / 3), h: c };
  }
}

/** How many of a shape come out of one cell-sized square of stock. */
function perSquare(kind: PatchKind): number {
  switch (kind) {
    case 'hst':
      return 2;
    case 'qst':
    case 'chevron':
      return 4;
    default:
      return 1;
  }
}

export function buildPatchField(grid: PatchGrid, L: Nm, W: Nm): PatchField {
  const polys: PolyCell[] = [];
  const counts = new Map<string, { spec: Omit<PieceSpec, 'count'>; n: number }>();
  let subAssemblies = 0;
  let emptyCells = 0;

  const cell = grid.cell;
  // centre the lattice in the finished board
  const originX = Math.round((L - grid.cols * cell) / 2);
  const originY = Math.round((W - grid.rows * cell) / 2);

  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const patch = grid.patches[j * grid.cols + i];
      if (!patch) {
        emptyCells++;
        continue;
      }
      const regions = patchRegions(patch);
      if (regions.length > 1) subAssemblies++;
      const shape = regionShape(patch.kind, cell);

      regions.forEach((region, ri) => {
        const species = patch.species[ri] ?? patch.species[0];
        polys.push({
          species,
          pieceId: shape.id,
          points: region.map(([ux, uy]) => ({
            x: originX + (i + ux) * cell,
            y: originY + (j + uy) * cell,
          })),
        });
        const key = `${shape.id}|${species}`;
        const e = counts.get(key);
        if (e) e.n++;
        else
          counts.set(key, {
            spec: { pieceId: shape.id, species, w: shape.w, h: shape.h, angleDeg: shape.angleDeg },
            n: 1,
          });
      });
    }
  }

  const pieces = [...counts.values()].map((e) => ({ ...e.spec, count: e.n }));

  const notes: string[] = [
    `${grid.cols} × ${grid.rows} cells of ${(cell / IN).toFixed(2)}″.`,
  ];
  const triangleKinds = new Set(
    grid.patches.filter((p): p is Patch => !!p).map((p) => p.kind).filter((k) => perSquare(k) > 1),
  );
  for (const k of triangleKinds) {
    const n = perSquare(k);
    notes.push(
      k === 'hst'
        ? `Half-square triangles: cut ${(cell / IN).toFixed(2)}″ squares and split each corner to corner — ${n} triangles per square.`
        : `Quarter-square triangles: cut ${(cell / IN).toFixed(2)}″ squares and cut both diagonals — ${n} triangles per square.`,
    );
  }
  if (subAssemblies > 0) {
    notes.push(
      `${subAssemblies} of the ${grid.cols * grid.rows} cells are split patches; each is glued and squared to ${(cell / IN).toFixed(2)}″ before it joins a row.`,
    );
  }

  return { polys, pieces, notes, subAssemblies, emptyCells };
}

/* ------------------------------------------------------------------ */
/* Whole-grid operations (the designer's flip / mirror / rotate)       */
/* ------------------------------------------------------------------ */

const clonePatch = (p: Patch | null): Patch | null => (p ? { ...p, species: [...p.species] } : null);

export function mirrorGridH(grid: PatchGrid): PatchGrid {
  const out = emptyGrid(grid.cols, grid.rows, grid.cell);
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const p = clonePatch(grid.patches[j * grid.cols + i]);
      if (p) p.flip = !p.flip;
      out.patches[j * grid.cols + (grid.cols - 1 - i)] = p;
    }
  }
  return out;
}

export function mirrorGridV(grid: PatchGrid): PatchGrid {
  const out = emptyGrid(grid.cols, grid.rows, grid.cell);
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const p = clonePatch(grid.patches[j * grid.cols + i]);
      // vertical mirror = horizontal mirror composed with a half-turn
      if (p) {
        p.flip = !p.flip;
        p.rot = ((p.rot + 2) % 4) as 0 | 1 | 2 | 3;
      }
      out.patches[(grid.rows - 1 - j) * grid.cols + i] = p;
    }
  }
  return out;
}

export function rotateGrid(grid: PatchGrid): PatchGrid {
  const out = emptyGrid(grid.rows, grid.cols, grid.cell);
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const p = clonePatch(grid.patches[j * grid.cols + i]);
      if (p) p.rot = ((p.rot + 1) % 4) as 0 | 1 | 2 | 3;
      // (i,j) → (rows-1-j, i) in the rotated grid
      out.patches[i * out.cols + (grid.rows - 1 - j)] = p;
    }
  }
  return out;
}

/** Quarter-turn a single patch in place. */
export function rotatePatch(p: Patch): Patch {
  return { ...p, rot: ((p.rot + 1) % 4) as 0 | 1 | 2 | 3, species: [...p.species] };
}

export function flipPatch(p: Patch): Patch {
  return { ...p, flip: !p.flip, species: [...p.species] };
}

/** Resize the lattice, keeping whatever still fits. */
export function resizeGrid(grid: PatchGrid, cols: number, rows: number): PatchGrid {
  const out = emptyGrid(cols, rows, grid.cell);
  for (let j = 0; j < Math.min(rows, grid.rows); j++) {
    for (let i = 0; i < Math.min(cols, grid.cols); i++) {
      out.patches[j * cols + i] = clonePatch(grid.patches[j * grid.cols + i]);
    }
  }
  return out;
}

/** Fill every empty cell with a solid patch of `species`. */
export function fillEmpty(grid: PatchGrid, species: SpeciesId): PatchGrid {
  return {
    ...grid,
    patches: grid.patches.map((p) => p ?? makePatch('full', [species])),
  };
}
