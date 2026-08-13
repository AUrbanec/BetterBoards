/**
 * Stock optimizer (plan §3, V2): fit the required pieces onto boards you
 * actually own, using first-fit-decreasing 1-D bin packing.
 *
 * This is a *length* packing per rip width — the honest model for a woodworker
 * who rips a board to width and then crosscuts parts out of the resulting
 * stick. It does not pretend to solve 2-D nesting, which would need a real
 * guillotine-cut solver and would mislead about yield.
 */

import { IN, type Nm } from '../units';
import type { SpeciesId } from '../construction/types';
import type { RipGroup } from './cutlist';

export interface StockBoard {
  species: SpeciesId;
  /** Usable length of one board. */
  length: Nm;
  /** How many boards of this size are on hand. */
  count: number;
  label?: string;
}

export interface PackedPart {
  width: Nm;
  length: Nm;
  species: SpeciesId;
}

export interface PackedBoard {
  species: SpeciesId;
  length: Nm;
  parts: PackedPart[];
  /** Length consumed including a kerf between parts. */
  used: Nm;
  offcut: Nm;
  label?: string;
}

export interface PackResult {
  boards: PackedBoard[];
  /** Parts that did not fit on any available board. */
  unplaced: PackedPart[];
  /** Extra boards the packer had to assume, by species and length. */
  shortfall: { species: SpeciesId; length: Nm; count: number }[];
  utilization: number; // 0..1 across all used boards
  /** Total offcut length that is long enough to be worth keeping. */
  usableOffcut: Nm;
}

const KEEP_OFFCUT = IN * 6; // shorter than this goes in the stove

/**
 * Pack the rip schedule onto stock. Parts are placed longest-first onto the
 * first board with room (first-fit-decreasing), which is within ~22% of
 * optimal for bin packing and is what a person does at the lumber rack anyway.
 *
 * `allowExtraBoards` lets the packer invent more boards of the largest
 * available size for a species, reporting them as shortfall rather than
 * silently failing.
 */
export function packStock(
  ripSchedule: RipGroup[],
  stock: StockBoard[],
  kerf: Nm,
  opts: { allowExtraBoards?: boolean } = {},
): PackResult {
  const allowExtra = opts.allowExtraBoards ?? true;

  // explode groups into individual parts, longest first
  const parts: PackedPart[] = [];
  for (const g of ripSchedule) {
    for (let i = 0; i < g.count; i++) {
      parts.push({ width: g.width, length: g.length, species: g.species });
    }
  }
  parts.sort((a, b) => b.length - a.length || b.width - a.width);

  // available bins, longest first so long parts find a home
  const bins: PackedBoard[] = [];
  for (const s of stock) {
    for (let i = 0; i < s.count; i++) {
      bins.push({ species: s.species, length: s.length, parts: [], used: 0, offcut: s.length, label: s.label });
    }
  }
  bins.sort((a, b) => b.length - a.length);

  const shortfallMap = new Map<string, { species: SpeciesId; length: Nm; count: number }>();
  const unplaced: PackedPart[] = [];

  const longestFor = (species: SpeciesId): Nm => {
    const lengths = stock.filter((s) => s.species === species).map((s) => s.length);
    return lengths.length ? Math.max(...lengths) : 0;
  };

  for (const part of parts) {
    // first fit: the first board of the right species with room
    let placed = false;
    for (const bin of bins) {
      if (bin.species !== part.species) continue;
      const need = part.length + (bin.parts.length > 0 ? kerf : 0);
      if (bin.used + need <= bin.length) {
        bin.parts.push(part);
        bin.used += need;
        bin.offcut = bin.length - bin.used;
        placed = true;
        break;
      }
    }
    if (placed) continue;

    if (!allowExtra) {
      unplaced.push(part);
      continue;
    }
    const boardLen = longestFor(part.species);
    if (boardLen <= 0 || part.length > boardLen) {
      // no stock of this species at all, or the part is longer than any board
      unplaced.push(part);
      continue;
    }
    const fresh: PackedBoard = {
      species: part.species,
      length: boardLen,
      parts: [part],
      used: part.length,
      offcut: boardLen - part.length,
    };
    bins.push(fresh);
    const key = `${part.species}|${boardLen}`;
    const e = shortfallMap.get(key);
    if (e) e.count++;
    else shortfallMap.set(key, { species: part.species, length: boardLen, count: 1 });
  }

  const used = bins.filter((b) => b.parts.length > 0);
  const totalLen = used.reduce((t, b) => t + b.length, 0);
  const totalUsed = used.reduce((t, b) => t + b.used, 0);
  const usableOffcut = used.reduce((t, b) => t + (b.offcut >= KEEP_OFFCUT ? b.offcut : 0), 0);

  return {
    boards: used,
    unplaced,
    shortfall: [...shortfallMap.values()],
    utilization: totalLen > 0 ? totalUsed / totalLen : 0,
    usableOffcut,
  };
}
