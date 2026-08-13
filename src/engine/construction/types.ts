import type { Nm } from '../units';
import type { Outline, OutlineSpec } from '../geometry/outline';
import type { CncOptions } from '../cnc/types';
import type { BlockPattern, PieceSpec } from '../patterns/blocks';
import type { CurvePattern } from '../patterns/curves';
import type { PatchGrid } from '../patterns/patches';

export type SpeciesId = string;

/** One rip-cut stick in glue-up #1 (width = visible stripe width, finished). */
export interface StripSpec {
  species: SpeciesId;
  width: Nm;
}

/** UI concept: N repeats of an ordered strip sequence. */
export interface LayerGroup {
  strips: StripSpec[];
  repeat: number;
}

/** Explicit per-slice operation (slice arranger sets these). */
export interface PerSliceOp {
  /** Reverse the cell order (rotate the slice end-for-end). */
  reverse?: boolean;
  /** Mirror the slice face-down (negates shear on angled slices). */
  mirror?: boolean;
  /** Cyclic shift: visible pattern offset (front piece width). Costs one kerf. */
  shift?: Nm;
}

export type SliceTransform =
  | { kind: 'none' }
  | { kind: 'flipAlternate' }        // classic checkerboard (square) / chevron (angled)
  | { kind: 'rotate180Alternate' }
  | { kind: 'reverseAlternate' }     // mirror slice order
  | { kind: 'shift'; by: Nm; alternate: boolean } // brick / running bond
  | { kind: 'sequence'; ops: PerSliceOp[] };      // fully explicit per-slice list

export interface Crosscut {
  /** Miter angle from the slab edge in degrees. 90 = square; 45/60 = chevron. */
  angleDeg: number;
  /**
   * Visible band width for angled (flat-slice) constructions.
   * Ignored for square crosscuts, where slice width = finished thickness + planing loss.
   */
  sliceWidth?: Nm;
}

export type Construction =
  | {
      /** 2-D block assembly: pieces cut to size and glued up as a flat panel. */
      kind: 'blocks';
      pattern: BlockPattern;
      /** Kept so switching back to a strip construction preserves the stack. */
      layers: LayerGroup[];
    }
  | {
      /** Curves approximated by one straight crosscut per column. */
      kind: 'curve';
      pattern: CurvePattern;
      layers: LayerGroup[];
    }
  | {
      /** Interactive patch designer: a lattice of preset shapes. */
      kind: 'patch';
      grid: PatchGrid;
      layers: LayerGroup[];
    }
  | {
      kind: 'edgeGrain';
      layers: LayerGroup[];
      /** 0/undefined = straight stripes. Otherwise stripes run at this angle (deg) to the length axis; the rectangle is cut from an oversized striped panel. */
      diagonalAngleDeg?: number;
    }
  | {
      kind: 'endGrain';
      layers: LayerGroup[];
      crosscut: Crosscut;
      transform: SliceTransform;
      /** Explicit override of the derived slice count. */
      sliceCountOverride?: number;
    };

export interface CleanupAllowances {
  /** Extra raw width per source board for jointing/edge cleanup (default 1/4"). */
  widthTrim: Nm;
  /** Extra slab/strip length for end trimming (default 1/2"). */
  lengthTrim: Nm;
  /** Thickness lost flattening each glue-up (default 1/8"). */
  planingLoss: Nm;
}

export interface BoardSpec {
  name: string;
  construction: Construction;
  /** Finished length target along the slice-stacking axis (end grain) or strip direction (edge grain). */
  targetLength: Nm;
  /** Finished width target — used by diagonal & angled constructions where width is a free choice. Otherwise derived from strips. */
  targetWidth: Nm;
  /** Milled stock thickness entering glue-up #1. */
  stockThickness: Nm;
  /** Finished thickness target — drives slice width for square end grain. */
  finishedThickness: Nm;
  kerf: Nm;
  cleanup: CleanupAllowances;
  /** Fractional waste factor for board-feet estimates (0.15 = 15%). */
  wasteFactor: number;
  /** Buying rough lumber (adds 1/4" jointing allowances) vs S4S. */
  roughStock: boolean;
  /** Shifts which part of the stripe run is visible (angled/diagonal patterns). */
  patternOffset: Nm;
  /**
   * Finished shape, inscribed in the blank. Omitted = plain rectangle.
   * The outline never changes the glue-up — only the preview, the blank-size
   * check, and the CNC profile.
   */
  outline?: OutlineSpec;
  /** CNC operations, when the user has enabled the module. */
  cnc?: CncOptions;
}

/* ------------------------------------------------------------------ */
/* Pipeline output                                                     */
/* ------------------------------------------------------------------ */

/** A cell interval in slab (u) space. u is exact integer nm. */
export interface GridCell {
  species: SpeciesId;
  u0: Nm;
  u1: Nm;
}

/** One row of the cell grid = one strip (edge grain) or one slice (end grain). */
export interface GridRow {
  v0: Nm;
  v1: Nm;
  cells: GridCell[];
  /** u-space → board-space stretch (1 for square, 1/sinθ for angled). */
  scale: number;
  /** Lateral drift of the pattern per unit of v (±cotθ for angled slices). */
  shear: number;
  /** Board-space offset subtracted from u·scale to position the pattern. */
  offset: number;
  /** Physical run of this row in u-space (before scale). */
  run: Nm;
  /** The per-slice op that produced this row (end grain). */
  op?: PerSliceOp;
  note?: string;
}

export type GridMap =
  | { kind: 'rows-y' }                    // v→y (across width), u→x (along length): edge grain
  | { kind: 'rows-x' }                    // v→x (along length), u→y (across width): end grain
  | { kind: 'diag'; angleDeg: number }    // bands at angle in board space: diagonal edge grain
  | { kind: 'poly' };                     // explicit polygons: 2-D block assembly (§5)

/**
 * A piece placed as an explicit polygon — pinwheel arms, basket-weave slats,
 * tumbling-block rhombi. Row/interval algebra cannot express these, so they
 * carry their own board-space geometry.
 */
export interface PolyCell {
  species: SpeciesId;
  points: { x: number; y: number }[];
  /** Groups identical pieces in the cut list, e.g. "arm" or "center". */
  pieceId: string;
}

export interface CellGrid {
  map: GridMap;
  rows: GridRow[];
  /** Populated instead of `rows` when map.kind === 'poly'. */
  polys?: PolyCell[];
  /** Finished board extents (board space). */
  boardLength: Nm; // x
  boardWidth: Nm;  // y
}

export interface StripCut {
  species: SpeciesId;
  width: Nm;      // finished rip width
  thickness: Nm;  // milled stock thickness
  length: Nm;     // required length incl. trim allowance
  /**
   * Shape of the piece for piece-based constructions ("square",
   * "half-square triangle", …). Two pieces can share a species and a size and
   * still need completely different cuts, so this is part of the cut-list
   * identity, not decoration.
   */
  pieceId?: string;
  /** Cut angle where the piece is not a plain rectangle. */
  angleDeg?: number;
  /** Width at the narrow end of a tapered piece. */
  width2?: Nm;
}

export interface GlueUp1 {
  strips: StripCut[];
  slabWidth: Nm;       // Σ strip widths
  slabLength: Nm;      // required strip/slab length
  slabThickness: Nm;   // stock thickness
  slabThicknessAfterPlaning: Nm;
  ripCount: number;    // interior rip cuts (n − 1 convention, per golden case)
}

export interface CrosscutPlan {
  sliceCount: number;
  /** Perpendicular slice width (square: finished thickness + planing loss; angled: visible band width). */
  sliceWidth: Nm;
  angleDeg: number;
  /** Slab length consumed per slice incl. kerf (along the slab axis). Float nm for angled. */
  advancePerSlice: number;
  /** Triangular end waste along the slab for angled cuts (float nm). */
  endWaste: number;
  /** Human plan: which slices get which ops. */
  sliceOps: PerSliceOp[];
}

export interface FinishedDims {
  length: Nm;    // x — may be float nm for angled (reported rounded)
  width: Nm;     // y
  thickness: Nm;
}

export interface PipelineIssue {
  id: string;
  level: 'error' | 'warning';
  message: string;
}

export interface PipelineResult {
  ok: boolean;
  issues: PipelineIssue[];
  grid: CellGrid;
  finished: FinishedDims;
  glueUp1: GlueUp1;
  crosscut?: CrosscutPlan;
  /** For diagonal edge grain: the oversized striped panel required. */
  diagonalPanel?: { panelLength: Nm; panelWidth: Nm; angleDeg: number };
  /** Assembled (pre-trim) dims when they differ from target. */
  assembled?: { length: Nm; width: Nm };
  /** Finished shape resolved against the blank (always present). */
  outline: Outline;
  /** Piece schedule for 2-D block constructions. */
  pieces?: PieceSpec[];
  /** Shop notes specific to the block pattern. */
  blockNotes?: string[];
  /** Patches/columns that are themselves glued from 2+ pieces and cure first. */
  subAssemblies?: number;
  /** What those sub-assemblies are called, for the build plan. */
  subAssemblyLabel?: string;
  /** Finished patch cell size, for the sub-assembly trim instruction. */
  patchCell?: Nm;
}

/** Expand layer groups into the flat ordered strip list. */
export function expandLayers(layers: LayerGroup[]): StripSpec[] {
  const out: StripSpec[] = [];
  for (const g of layers) {
    for (let r = 0; r < Math.max(0, Math.floor(g.repeat)); r++) {
      for (const s of g.strips) out.push({ species: s.species, width: s.width });
    }
  }
  return out;
}
