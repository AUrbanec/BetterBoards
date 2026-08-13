import { runPipeline } from '../src/engine/construction/pipeline';
import { buildCutList } from '../src/engine/cutlist/cutlist';
import { buildPlan } from '../src/exports/stages';
import { TEMPLATE_BY_ID } from '../src/engine/patterns/templates';
import { makeSpeciesInfoLookup } from '../src/data/species';

const info = makeSpeciesInfoLookup();
for (const id of process.argv.slice(2)) {
  const board = TEMPLATE_BY_ID.get(id)!.build();
  const result = runPipeline(board);
  const plan = buildPlan(board, result, buildCutList(board, result, info), info);
  console.log(`\n=== ${id} — ${plan.glueUps} glue-ups, ${plan.cuttingStages} machining stages`);
  for (const s of plan.stages) console.log(`  ${s.index}. [${s.kind}]${s.glueUp ? ` (glue ${s.glueUp})` : ''} ${s.title}`);
}
