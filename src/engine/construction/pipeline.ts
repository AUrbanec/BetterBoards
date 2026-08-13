/**
 * The construction pipeline: rip → glue → crosscut → arrange → glue.
 * Pure integer-nm math. The cell grid produced here is the single source of
 * truth: previews, blueprints, and cut lists all derive from it.
 *
 * Geometry conventions (board space): x = length (slice-stacking axis for end
 * grain), y = width. Grid rows live in (u, v) space: v stacks rows, u runs
 * along a row. Cell u-coordinates are exact integers in *slab space*; angled
 * constructions carry a float `scale` (1/sinθ) and `shear` (±cotθ) applied
 * only at render time, so exactness is never lost in the engine.
 */

import { assertInt, type Nm } from '../units';
import {
  expandLayers,
  type BoardSpec,
  type CellGrid,
  type CrosscutPlan,
  type GlueUp1,
  type GridCell,
  type GridRow,
  type PerSliceOp,
  type PipelineIssue,
  type PipelineResult,
  type SliceTransform,
  type StripSpec,
} from './types';

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Cell sequence operations (pure, exact)                              */
/* ------------------------------------------------------------------ */

/** Build the base cell sequence from ordered strips. Run = Σ widths. */
export function baseSequence(strips: StripSpec[]): { cells: GridCell[]; run: Nm } {
  const cells: GridCell[] = [];
  let u = 0;
  for (const s of strips) {
    cells.push({ species: s.species, u0: u, u1: u + s.width });
    u += s.width;
  }
  return { cells, run: assertInt(u, 'sequence run') };
}

/** Reverse a cell sequence within its run (rotate the slice end-for-end). */
export function reverseCells(cells: GridCell[], run: Nm): GridCell[] {
  return cells
    .map((c) => ({ species: c.species, u0: run - c.u1, u1: run - c.u0 }))
    .reverse();
}

/**
 * Cyclic shift with kerf accounting: the slice is crosscut once and the end
 * piece moved to the front so the visible pattern offset is exactly `by`.
 * The cut destroys one kerf of material at the far end, so the returned run
 * is `run − kerf`. Straddling cells are split.
 */
export function cyclicShift(
  cells: GridCell[],
  run: Nm,
  by: Nm,
  kerf: Nm,
): { cells: GridCell[]; run: Nm } {
  if (by <= 0) return { cells, run };
  const cut = run - by - kerf; // cut position; material [cut, cut+kerf] destroyed
  if (cut <= 0) throw new Error('cyclicShift: shift too large for run');
  const front: GridCell[] = []; // piece B = [cut+kerf, run) → [0, by)
  const back: GridCell[] = [];  // piece A = [0, cut)      → [by, run−kerf)
  for (const c of cells) {
    // portion in A
    const a0 = Math.max(c.u0, 0);
    const a1 = Math.min(c.u1, cut);
    if (a1 > a0) back.push({ species: c.species, u0: a0 + by, u1: a1 + by });
    // portion in B
    const b0 = Math.max(c.u0, cut + kerf);
    const b1 = Math.min(c.u1, run);
    if (b1 > b0) front.push({ species: c.species, u0: b0 - (cut + kerf), u1: b1 - (cut + kerf) });
  }
  return { cells: [...front, ...back], run: run - kerf };
}

/** Resolve a SliceTransform into explicit per-slice ops. */
export function resolveTransform(
  transform: SliceTransform,
  sliceCount: number,
  angled: boolean,
): PerSliceOp[] {
  const ops: PerSliceOp[] = [];
  for (let i = 0; i < sliceCount; i++) {
    const odd = i % 2 === 1;
    switch (transform.kind) {
      case 'none':
        ops.push({});
        break;
      case 'flipAlternate':
        // Square slices: rotate alternate slices end-for-end (reverses the
        // stripe order → checkerboard). Angled slices: flip alternate slices
        // face-down about the cut line (mirrors the stripe angle → chevron).
        ops.push(odd ? (angled ? { mirror: true } : { reverse: true }) : {});
        break;
      case 'rotate180Alternate':
        ops.push(odd ? { reverse: true } : {});
        break;
      case 'reverseAlternate':
        ops.push(odd ? { reverse: true } : {});
        break;
      case 'shift':
        if (transform.alternate) ops.push(odd ? { shift: transform.by } : {});
        else ops.push(i === 0 ? {} : { shift: transform.by * i });
        break;
      case 'sequence':
        ops.push(transform.ops.length ? { ...transform.ops[i % transform.ops.length] } : {});
        break;
    }
  }
  return ops;
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

export function runPipeline(board: BoardSpec): PipelineResult {
  const issues: PipelineIssue[] = [];
  const err = (id: string, message: string) => issues.push({ id, level: 'error', message });
  const warn = (id: string, message: string) => issues.push({ id, level: 'warning', message });

  const strips = expandLayers(board.construction.layers);
  const { kerf, cleanup, stockThickness } = board;

  // -- basic sanity ---------------------------------------------------
  if (strips.length === 0) err('no-strips', 'Add at least one strip to the layer stack.');
  for (const s of strips) {
    if (s.width <= 0) {
      err('bad-strip-width', 'Every strip needs a positive width.');
      break;
    }
  }
  if (board.targetLength <= 0) err('bad-length', 'Finished length must be positive.');
  if (stockThickness <= 0) err('bad-thickness', 'Stock thickness must be positive.');
  if (kerf <= 0) err('bad-kerf', 'Kerf must be positive.');

  if (issues.some((i) => i.level === 'error')) {
    return emptyResult(issues);
  }

  const slabWidth = strips.reduce((t, s) => t + s.width, 0);
  const slabThicknessAfterPlaning = stockThickness - cleanup.planingLoss;
  if (slabThicknessAfterPlaning <= 0) {
    err('planing-exceeds-stock', 'Planing loss consumes the entire stock thickness.');
    return emptyResult(issues);
  }

  if (board.construction.kind === 'edgeGrain') {
    return edgeGrainPipeline(board, strips, slabWidth, issues);
  }
  return endGrainPipeline(board, strips, slabWidth, slabThicknessAfterPlaning, issues);
}

function emptyResult(issues: PipelineIssue[]): PipelineResult {
  return {
    ok: false,
    issues,
    grid: { map: { kind: 'rows-y' }, rows: [], boardLength: 0, boardWidth: 0 },
    finished: { length: 0, width: 0, thickness: 0 },
    glueUp1: {
      strips: [],
      slabWidth: 0,
      slabLength: 0,
      slabThickness: 0,
      slabThicknessAfterPlaning: 0,
      ripCount: 0,
    },
  };
}

/* -- Edge grain ------------------------------------------------------ */

function edgeGrainPipeline(
  board: BoardSpec,
  strips: StripSpec[],
  slabWidth: Nm,
  issues: PipelineIssue[],
): PipelineResult {
  const { cleanup } = board;
  const construction = board.construction as Extract<BoardSpec['construction'], { kind: 'edgeGrain' }>;
  const angle = construction.diagonalAngleDeg ?? 0;
  const thickness = board.stockThickness - cleanup.planingLoss;

  if (angle === 0) {
    // Straight stripes: board width is derived from the stack; length from target.
    const L = board.targetLength;
    const rows: GridRow[] = [];
    let v = 0;
    for (const s of strips) {
      rows.push({
        v0: v,
        v1: v + s.width,
        cells: [{ species: s.species, u0: 0, u1: L }],
        scale: 1,
        shear: 0,
        offset: 0,
        run: L,
      });
      v += s.width;
    }
    const stripLength = L + cleanup.lengthTrim;
    return {
      ok: !issues.some((i) => i.level === 'error'),
      issues,
      grid: { map: { kind: 'rows-y' }, rows, boardLength: L, boardWidth: slabWidth },
      finished: { length: L, width: slabWidth, thickness },
      glueUp1: glueUp1For(board, strips, slabWidth, stripLength),
    };
  }

  // Diagonal stripes: the rectangle L×W is cut at `angle` out of an oversized
  // striped panel. Panel size = bounding box of the rotated rectangle.
  const L = board.targetLength;
  const W = board.targetWidth;
  if (W <= 0) {
    issues.push({ id: 'bad-width', level: 'error', message: 'Finished width must be positive for diagonal boards.' });
    return emptyResult(issues);
  }
  const a = angle * DEG;
  const sinA = Math.abs(Math.sin(a));
  const cosA = Math.abs(Math.cos(a));
  const panelLength = Math.ceil(L * cosA + W * sinA);
  const panelWidth = Math.ceil(L * sinA + W * cosA);
  if (slabWidth < panelWidth) {
    issues.push({
      id: 'diag-coverage',
      level: 'error',
      message: `The strip stack (${(slabWidth / 25400000).toFixed(2)}") is narrower than the ${(panelWidth / 25400000).toFixed(2)}" panel needed to cut a ${angle}° rectangle. Add strips or repeats.`,
    });
  }

  const rows: GridRow[] = [];
  let v = 0;
  for (const s of strips) {
    rows.push({
      v0: v,
      v1: v + s.width,
      cells: [{ species: s.species, u0: 0, u1: panelLength }],
      scale: 1,
      shear: 0,
      offset: 0,
      run: panelLength,
    });
    v += s.width;
  }
  const stripLength = panelLength + cleanup.lengthTrim;
  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    grid: { map: { kind: 'diag', angleDeg: angle }, rows, boardLength: L, boardWidth: W },
    finished: { length: L, width: W, thickness },
    glueUp1: glueUp1For(board, strips, slabWidth, stripLength),
    diagonalPanel: { panelLength, panelWidth, angleDeg: angle },
  };
}

/* -- End grain ------------------------------------------------------- */

function endGrainPipeline(
  board: BoardSpec,
  strips: StripSpec[],
  slabWidth: Nm,
  slabThicknessAfterPlaning: Nm,
  issues: PipelineIssue[],
): PipelineResult {
  const construction = board.construction as Extract<BoardSpec['construction'], { kind: 'endGrain' }>;
  const { kerf, cleanup } = board;
  const angleDeg = construction.crosscut.angleDeg;
  const angled = angleDeg !== 90;
  const err = (id: string, message: string) => issues.push({ id, level: 'error', message });

  if (angleDeg < 20 || angleDeg > 90) {
    err('bad-angle', `Crosscut angle ${angleDeg}° is outside the safe 20–90° range.`);
    return emptyResult(issues);
  }

  // --- slice geometry ---
  let sliceWidth: Nm;
  let rowHeight: Nm; // board-space x consumed per slice
  let thickness: Nm;
  if (!angled) {
    // Slices are stood on end: crosscut width becomes the finished thickness.
    sliceWidth = board.finishedThickness + cleanup.planingLoss;
    rowHeight = slabThicknessAfterPlaning;
    thickness = board.finishedThickness;
  } else {
    // Angled slices stay face-up (chevron/herringbone): band width is a design
    // choice; thickness = slab thickness minus both glue-up flattenings.
    sliceWidth = construction.crosscut.sliceWidth ?? Math.round(2 * 25400000);
    rowHeight = sliceWidth;
    thickness = board.stockThickness - 2 * cleanup.planingLoss;
  }
  if (sliceWidth <= kerf) {
    err('slice-too-thin', 'Slice width must be greater than the kerf.');
    return emptyResult(issues);
  }
  if (thickness <= 0) {
    err('thickness-consumed', 'Planing allowances consume the entire board thickness.');
    return emptyResult(issues);
  }

  const sliceCount = construction.sliceCountOverride && construction.sliceCountOverride > 0
    ? Math.floor(construction.sliceCountOverride)
    : Math.max(1, Math.ceil(board.targetLength / rowHeight));
  const boardLength = sliceCount * rowHeight;

  // --- per-slice ops & cell rows ---
  const ops = resolveTransform(construction.transform, sliceCount, angled);
  const base = baseSequence(strips);
  const sinT = Math.sin(angleDeg * DEG);
  const cotT = angled ? Math.cos(angleDeg * DEG) / sinT : 0;
  const scale = angled ? 1 / sinT : 1;

  const rows: GridRow[] = [];
  let anyShiftCut = false;
  let minRun = base.run;
  // Offset chain: continuity at each shared cut edge (off_{j+1} = off_j − s_j·h).
  let offset = 0;
  const rawRows: { cells: GridCell[]; run: Nm; op: PerSliceOp; shear: number; offset: number; note?: string }[] = [];
  for (let i = 0; i < sliceCount; i++) {
    const op = ops[i];
    let cells = base.cells;
    let run = base.run;
    let note: string | undefined;
    if (op.reverse) cells = reverseCells(cells, run);
    if (op.shift && op.shift !== 0) {
      if (!angled) {
        // Physical re-cut: costs one kerf of run.
        if (op.shift >= run - kerf) {
          err('shift-too-big', `Slice ${i + 1}: shift is larger than the slice.`);
          return emptyResult(issues);
        }
        const shifted = cyclicShift(cells, run, op.shift, kerf);
        cells = shifted.cells;
        run = shifted.run;
        anyShiftCut = true;
        note = 'shifted (re-cut: −1 kerf)';
      }
      // Angled slices slide along the glue line instead of being re-cut;
      // handled via the offset below.
    }
    const shear = op.mirror ? -cotT : cotT;
    let rowOffset = offset;
    if (angled && op.shift) rowOffset += op.shift * scale;
    rawRows.push({ cells, run, op, shear, offset: rowOffset, note });
    minRun = Math.min(minRun, run);
    offset -= shear * rowHeight;
  }

  // --- finished width & window ---
  let boardWidth: Nm;
  if (!angled) {
    boardWidth = minRun; // shifted rows are one kerf short; trim all to match
  } else {
    const usable = base.run * scale - Math.abs(cotT) * rowHeight;
    boardWidth = board.targetWidth > 0 ? board.targetWidth : Math.floor(usable);
    if (boardWidth > usable + 1e-6) {
      err(
        'angled-coverage',
        `Finished width exceeds what the strip stack can cover at ${angleDeg}° ` +
          `(max ≈ ${(usable / 25400000).toFixed(2)}"). Add strips or reduce width.`,
      );
    }
  }

  // Base offset to center coverage for angled patterns (+ user pattern offset).
  let off0 = 0;
  if (angled) {
    // Feasible off0 window: max over rows of (offRel + max(0, s·h)) ≤ off0+offRel′ …
    // For each row: need  off0 + rel_j ≥ max(0, s_j·h)         (low edge covered)
    //               and   off0 + rel_j ≤ run·scale − W + min(0, s_j·h)  (high edge)
    let lo = -Infinity;
    let hi = Infinity;
    for (const r of rawRows) {
      lo = Math.max(lo, Math.max(0, r.shear * rowHeight) - r.offset);
      hi = Math.min(hi, r.run * scale - boardWidth + Math.min(0, r.shear * rowHeight) - r.offset);
    }
    if (lo > hi + 1e-6) {
      issues.push({
        id: 'angled-window',
        level: 'warning',
        message: 'Some slices cannot fully cover the board width with this transform; edges will show gaps in preview. Add strips or reduce width/shift.',
      });
      off0 = lo;
    } else {
      off0 = (lo + hi) / 2;
    }
    off0 += board.patternOffset;
  }

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    rows.push({
      v0: i * rowHeight,
      v1: (i + 1) * rowHeight,
      cells: r.cells,
      scale,
      shear: r.shear,
      offset: angled ? off0 + r.offset : 0,
      run: r.run,
      op: r.op,
      note: r.note,
    });
  }

  // --- slab length required (glue-up #1) ---
  let slabLength: Nm;
  let advancePerSlice: number;
  let endWaste = 0;
  if (!angled) {
    advancePerSlice = sliceWidth + kerf;
    slabLength = sliceCount * (sliceWidth + kerf) + cleanup.lengthTrim;
  } else {
    advancePerSlice = (sliceWidth + kerf) / sinT;
    endWaste = slabWidth * Math.abs(cotT); // triangular offcut where the first angled cut enters
    slabLength = Math.ceil(sliceCount * advancePerSlice + endWaste + cleanup.lengthTrim);
  }

  const crosscut: CrosscutPlan = {
    sliceCount,
    sliceWidth,
    angleDeg,
    advancePerSlice,
    endWaste,
    sliceOps: ops,
  };

  if (anyShiftCut) {
    issues.push({
      id: 'shift-kerf',
      level: 'warning',
      message: 'Shifted slices are re-cut once, losing one kerf of width; all slices are trimmed to match, so the board is one kerf narrower than the slab.',
    });
  }

  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    grid: {
      map: { kind: 'rows-x' },
      rows,
      boardLength,
      boardWidth: Math.round(boardWidth),
    },
    finished: { length: boardLength, width: Math.round(boardWidth), thickness },
    glueUp1: glueUp1For(board, strips, slabWidth, slabLength),
    crosscut,
    assembled: { length: boardLength, width: Math.round(boardWidth) },
  };
}

/* -- Shared glue-up #1 math ----------------------------------------- */

function glueUp1For(board: BoardSpec, strips: StripSpec[], slabWidth: Nm, stripLength: Nm): GlueUp1 {
  return {
    strips: strips.map((s) => ({
      species: s.species,
      width: s.width,
      thickness: board.stockThickness,
      length: stripLength,
    })),
    slabWidth,
    slabLength: stripLength,
    slabThickness: board.stockThickness,
    slabThicknessAfterPlaning: board.stockThickness - board.cleanup.planingLoss,
    ripCount: Math.max(0, strips.length - 1),
  };
}
