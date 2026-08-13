/**
 * Cut list & materials engine (§7 of the plan).
 * Everything is derived from the pipeline result — never from the picture.
 */

import { IN, boardFeet, roundToDenom, type Nm } from '../units';
import type { BoardSpec, PipelineResult, SpeciesId } from '../construction/types';

export interface RipGroup {
  species: SpeciesId;
  count: number;
  width: Nm;
  thickness: Nm;
  length: Nm;
}

export interface SpeciesSummary {
  species: SpeciesId;
  stripCount: number;
  groups: RipGroup[];
  /** Total linear length of strip stock (no allowances beyond lengthTrim already in strip length). */
  linearLength: Nm;
  /** Raw board width to rip from: Σ widths + (n−1)·kerf + widthTrim. */
  rawWidthNeeded: Nm;
  /** Rough board feet including jointing allowances and waste factor. */
  boardFeetRough: number;
  costEstimate?: number;
  purchaseSuggestion: string;
}

export interface CrosscutScheduleOut {
  sliceCount: number;
  sliceWidth: Nm;
  angleDeg: number;
  /** 1-based slice numbers per op class, for "flip slices 2, 4, 6…". */
  reversed: number[];
  mirrored: number[];
  shifted: { slice: number; by: Nm }[];
}

export interface RoundingEntry {
  label: string;
  exact: Nm;
  rounded: Nm;
  error: Nm;
}

export interface GlueMath {
  glueUp1JointArea: number;  // in²
  glueUp2JointArea: number;  // in²
  glueUp1Clamps: number;
  glueUp2Clamps: number;
  glueOzEstimate: number;
}

export interface CutList {
  perSpecies: SpeciesSummary[];
  ripSchedule: RipGroup[];
  crosscut?: CrosscutScheduleOut;
  allowances: {
    kerf: Nm;
    widthTrim: Nm;
    lengthTrim: Nm;
    planingLoss: Nm;
    wasteFactor: number;
    roughStock: boolean;
    kerfConvention: string;
  };
  glue: GlueMath;
  rounding: { entries: RoundingEntry[]; totalAbsError: Nm; driftWarning: boolean };
  totals: { boardFeetRough: number; costEstimate?: number };
}

export interface SpeciesInfoLookup {
  (id: SpeciesId): { name: string; pricePerBF?: number } | undefined;
}

const CLAMP_SPACING = 7 * IN; // one clamp per ~7" of joint

export function buildCutList(
  board: BoardSpec,
  result: PipelineResult,
  speciesInfo: SpeciesInfoLookup,
): CutList {
  const { kerf, cleanup, wasteFactor, roughStock } = board;
  const g1 = result.glueUp1;

  // ---- group strips by (species, width) -----------------------------
  const groupMap = new Map<string, RipGroup>();
  for (const s of g1.strips) {
    const key = `${s.species}|${s.width}`;
    const g = groupMap.get(key);
    if (g) g.count++;
    else groupMap.set(key, { species: s.species, count: 1, width: s.width, thickness: s.thickness, length: s.length });
  }
  const ripSchedule = [...groupMap.values()].sort(
    (a, b) => a.species.localeCompare(b.species) || b.width - a.width,
  );

  // ---- per-species summaries ---------------------------------------
  const bySpecies = new Map<SpeciesId, RipGroup[]>();
  for (const g of ripSchedule) {
    const arr = bySpecies.get(g.species) ?? [];
    arr.push(g);
    bySpecies.set(g.species, arr);
  }

  const jointAllow = roughStock ? Math.round(0.25 * IN) : 0;
  const perSpecies: SpeciesSummary[] = [];
  let totalBF = 0;
  let totalCost: number | undefined = undefined;
  let anyPrice = false;

  for (const [species, groups] of bySpecies) {
    const stripCount = groups.reduce((t, g) => t + g.count, 0);
    const widthSum = groups.reduce((t, g) => t + g.width * g.count, 0);
    const linearLength = groups.reduce((t, g) => t + g.length * g.count, 0);
    const rawWidthNeeded = widthSum + Math.max(0, stripCount - 1) * kerf + cleanup.widthTrim;

    let bf = 0;
    for (const g of groups) {
      const roughT = g.thickness + jointAllow;
      const roughW = g.width + jointAllow;
      bf += boardFeet(roughT, roughW, g.length) * g.count;
    }
    bf *= 1 + wasteFactor;
    totalBF += bf;

    const info = speciesInfo(species);
    let cost: number | undefined;
    if (info?.pricePerBF !== undefined) {
      cost = bf * info.pricePerBF;
      totalCost = (totalCost ?? 0) + cost;
      anyPrice = true;
    }

    const maxLen = Math.max(...groups.map((g) => g.length));
    const lenFt = Math.ceil(maxLen / IN / 12);
    const rawWidthIn = Math.ceil(rawWidthNeeded / IN);
    perSpecies.push({
      species,
      stripCount,
      groups,
      linearLength,
      rawWidthNeeded,
      boardFeetRough: bf,
      costEstimate: cost,
      purchaseSuggestion: `≈ ${bf.toFixed(1)} bf — e.g. 4/4, ${rawWidthIn}″ wide × ${lenFt}′`,
    });
  }
  perSpecies.sort((a, b) => b.boardFeetRough - a.boardFeetRough);

  // ---- crosscut schedule -------------------------------------------
  let crosscut: CrosscutScheduleOut | undefined;
  if (result.crosscut) {
    const reversed: number[] = [];
    const mirrored: number[] = [];
    const shifted: { slice: number; by: Nm }[] = [];
    result.crosscut.sliceOps.forEach((op, i) => {
      if (op.reverse) reversed.push(i + 1);
      if (op.mirror) mirrored.push(i + 1);
      if (op.shift) shifted.push({ slice: i + 1, by: op.shift });
    });
    crosscut = {
      sliceCount: result.crosscut.sliceCount,
      sliceWidth: result.crosscut.sliceWidth,
      angleDeg: result.crosscut.angleDeg,
      reversed,
      mirrored,
      shifted,
    };
  }

  // ---- glue math ----------------------------------------------------
  const nStrips = g1.strips.length;
  const ju1Area =
    Math.max(0, nStrips - 1) *
    (g1.slabLength / IN) *
    (g1.slabThickness / IN); // in² per joint face
  let ju2Area = 0;
  let ju2Clamps = 0;
  if (result.crosscut) {
    const joints = Math.max(0, result.crosscut.sliceCount - 1);
    ju2Area = joints * (result.finished.width / IN) * (result.crosscut.sliceWidth / IN);
    ju2Clamps = Math.ceil(result.finished.width / CLAMP_SPACING) || 0;
  }
  const glue: GlueMath = {
    glueUp1JointArea: ju1Area,
    glueUp2JointArea: ju2Area,
    glueUp1Clamps: Math.max(1, Math.ceil(g1.slabLength / CLAMP_SPACING)),
    glueUp2Clamps: ju2Clamps,
    glueOzEstimate: (ju1Area + ju2Area) / 250, // ~250 in²/fl-oz spread, rough
  };

  // ---- rounding report ----------------------------------------------
  const entries: RoundingEntry[] = [];
  const consider = (label: string, nm: Nm) => {
    const r = roundToDenom(nm, 32);
    if (!r.exact) entries.push({ label, exact: nm, rounded: r.rounded, error: r.error });
  };
  for (const g of ripSchedule) {
    consider(`Rip width ${(speciesInfo(g.species)?.name ?? g.species)}`, g.width);
    consider(`Strip length ${(speciesInfo(g.species)?.name ?? g.species)}`, g.length);
  }
  consider('Finished length', result.finished.length);
  consider('Finished width', result.finished.width);
  consider('Finished thickness', result.finished.thickness);
  if (result.crosscut) consider('Slice width', result.crosscut.sliceWidth);
  const totalAbsError = entries.reduce((t, e) => t + Math.abs(e.error), 0);

  return {
    perSpecies,
    ripSchedule,
    crosscut,
    allowances: {
      kerf,
      widthTrim: cleanup.widthTrim,
      lengthTrim: cleanup.lengthTrim,
      planingLoss: cleanup.planingLoss,
      wasteFactor,
      roughStock,
      kerfConvention: 'n − 1 kerfs per n strips of a species, plus one width-trim allowance',
    },
    glue,
    rounding: {
      entries,
      totalAbsError,
      driftWarning: totalAbsError > kerf / 2,
    },
    totals: { boardFeetRough: totalBF, costEstimate: anyPrice ? totalCost : undefined },
  };
}
