/**
 * Phase-1 acceptance demo: print a correct cut list for a striped board.
 *   npm run demo
 */

import { runPipeline } from '../src/engine/construction/pipeline';
import { buildCutList } from '../src/engine/cutlist/cutlist';
import { validateBoard } from '../src/engine/validate/rules';
import { generateInstructions, instructionsToMarkdown } from '../src/exports/instructions';
import { TEMPLATE_BY_ID } from '../src/engine/patterns/templates';
import { makeSpeciesInfoLookup, SPECIES_BY_ID } from '../src/data/species';
import { formatCutDim } from '../src/engine/units';

const board = TEMPLATE_BY_ID.get('classic-stripes')!.build();
const result = runPipeline(board);
const info = makeSpeciesInfoLookup();
const cutlist = buildCutList(board, result, info);
const lints = validateBoard(board, result, (id) => {
  const s = SPECIES_BY_ID.get(id);
  return s && { id: s.id, commonName: s.commonName, janka_lbf: s.janka_lbf, foodSafe: s.foodSafe, porosity: s.porosity, cautions: s.cautions, movement: s.movement };
}, cutlist);

const f = (nm: number) => formatCutDim(nm, 'in-frac');

console.log(`\n=== ${board.name} ===`);
console.log(`Finished: ${f(result.finished.length)} × ${f(result.finished.width)} × ${f(result.finished.thickness)}\n`);

console.log('RIP SCHEDULE');
for (const g of cutlist.ripSchedule) {
  console.log(`  ${String(g.count).padStart(2)}× ${(info(g.species)?.name ?? g.species).padEnd(28)} ${f(g.width).padStart(9)} × ${f(g.thickness)} × ${f(g.length)}`);
}

console.log('\nMATERIALS');
for (const s of cutlist.perSpecies) {
  console.log(`  ${(info(s.species)?.name ?? s.species).padEnd(28)} ${s.stripCount} strips  raw width ${f(s.rawWidthNeeded).padStart(9)}  ${s.boardFeetRough.toFixed(2)} bf  $${s.costEstimate?.toFixed(0) ?? '—'}`);
}
console.log(`  TOTAL ${cutlist.totals.boardFeetRough.toFixed(2)} bf ≈ $${cutlist.totals.costEstimate?.toFixed(0) ?? '—'}`);

console.log('\nALLOWANCES');
console.log(`  kerf ${f(cutlist.allowances.kerf)} · edge cleanup ${f(cutlist.allowances.widthTrim)} · end trim ${f(cutlist.allowances.lengthTrim)} · planing loss ${f(cutlist.allowances.planingLoss)} · waste ${Math.round(cutlist.allowances.wasteFactor * 100)}%`);

if (lints.length) {
  console.log('\nLINT');
  for (const l of lints) console.log(`  ${l.level === 'error' ? '✖' : '⚠'} ${l.message}`);
}

console.log('\n' + instructionsToMarkdown(generateInstructions(board, result, cutlist, info)).split('\n').slice(0, 24).join('\n'));
console.log('…\n');
