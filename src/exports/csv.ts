/**
 * Cut-list CSV export (§11): Excel-friendly, fractions quoted as text so
 * they survive as strings ("1 3/8" would otherwise become a date).
 */

import { IN, formatFraction, type Nm } from '../engine/units';
import type { CutList, SpeciesInfoLookup } from '../engine/cutlist/cutlist';
import type { BoardSpec, PipelineResult } from '../engine/construction/types';

function cell(v: string | number): string {
  if (typeof v === 'number') return String(v);
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Fraction as Excel text formula so it isn't mangled into a date. */
function fracCell(nm: Nm): string {
  return `"=""${formatFraction(nm)}"""`;
}

function decIn(nm: Nm): string {
  return (nm / IN).toFixed(4);
}

export function cutListToCsv(
  board: BoardSpec,
  result: PipelineResult,
  cl: CutList,
  info: SpeciesInfoLookup,
): string {
  const lines: string[] = [];
  const push = (...cells: (string | number)[]) => lines.push(cells.map((c) => (typeof c === 'string' && c.startsWith('"=') ? c : cell(c))).join(','));

  push(`BetterBoards cut list`, board.name);
  push('Finished size', `${decIn(result.finished.length)} x ${decIn(result.finished.width)} x ${decIn(result.finished.thickness)} in`);
  push('');

  push('RIP SCHEDULE');
  push('Species', 'Qty', 'Width (frac)', 'Width (in)', 'Thickness (frac)', 'Thickness (in)', 'Length (frac)', 'Length (in)');
  for (const g of cl.ripSchedule) {
    push(
      info(g.species)?.name ?? g.species,
      g.count,
      fracCell(g.width),
      decIn(g.width),
      fracCell(g.thickness),
      decIn(g.thickness),
      fracCell(g.length),
      decIn(g.length),
    );
  }
  push('');

  push('MATERIALS BY SPECIES');
  push('Species', 'Strips', 'Raw rip width (in)', 'Board feet (rough)', 'Est cost (USD)');
  for (const s of cl.perSpecies) {
    push(
      info(s.species)?.name ?? s.species,
      s.stripCount,
      decIn(s.rawWidthNeeded),
      s.boardFeetRough.toFixed(2),
      s.costEstimate !== undefined ? s.costEstimate.toFixed(2) : '',
    );
  }
  push('Total', '', '', cl.totals.boardFeetRough.toFixed(2), cl.totals.costEstimate?.toFixed(2) ?? '');
  push('');

  if (cl.crosscut) {
    push('CROSSCUT SCHEDULE');
    push('Slices', cl.crosscut.sliceCount);
    push('Slice width (in)', decIn(cl.crosscut.sliceWidth));
    push('Angle (deg)', cl.crosscut.angleDeg);
    if (cl.crosscut.reversed.length) push('Rotate 180 deg', cl.crosscut.reversed.join(' '));
    if (cl.crosscut.mirrored.length) push('Flip face-down', cl.crosscut.mirrored.join(' '));
    if (cl.crosscut.shifted.length) push('Shifted', cl.crosscut.shifted.map((s) => `#${s.slice} by ${decIn(s.by)} in`).join('; '));
    push('');
  }

  push('ALLOWANCES');
  push('Kerf (in)', decIn(cl.allowances.kerf));
  push('Edge cleanup (in)', decIn(cl.allowances.widthTrim));
  push('End trim (in)', decIn(cl.allowances.lengthTrim));
  push('Planing loss (in)', decIn(cl.allowances.planingLoss));
  push('Waste factor', `${Math.round(cl.allowances.wasteFactor * 100)}%`);
  push('Stock', cl.allowances.roughStock ? 'rough' : 'S4S');
  push('');

  if (cl.rounding.entries.length) {
    push('ROUNDING REPORT');
    push('Dimension', 'Rounded (frac)', 'Exact (in)', 'Error (in)');
    for (const e of cl.rounding.entries) {
      push(e.label, fracCell(e.rounded), decIn(e.exact), (e.error / IN).toFixed(4));
    }
  }

  return lines.join('\r\n');
}
