/**
 * Render blueprint pages for a template to PNGs so they can be eyeballed.
 * Run: node scripts/blueprint-preview.mjs [templateId] [outDir]
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const templateId = process.argv[2] ?? 'checkerboard';
const OUT = process.argv[3] ?? '/tmp/bb-blueprint';
await mkdir(OUT, { recursive: true });

const { runPipeline } = await import('../src/engine/construction/pipeline.ts');
const { buildCutList } = await import('../src/engine/cutlist/cutlist.ts');
const { validateBoard } = await import('../src/engine/validate/rules.ts');
const { renderBlueprint } = await import('../src/exports/blueprint.ts');
const { TEMPLATE_BY_ID } = await import('../src/engine/patterns/templates.ts');
const { makeSpeciesInfoLookup, SPECIES_BY_ID } = await import('../src/data/species.ts');
const { speciesLetters } = await import('../src/exports/shared.ts');

const board = TEMPLATE_BY_ID.get(templateId).build();
const result = runPipeline(board);
const info = makeSpeciesInfoLookup();
const cutlist = buildCutList(board, result, info);
const meta = (id) => {
  const s = SPECIES_BY_ID.get(id);
  return s && { id: s.id, commonName: s.commonName, janka_lbf: s.janka_lbf, foodSafe: s.foodSafe, porosity: s.porosity, cautions: s.cautions, movement: s.movement };
};
const lints = validateBoard(board, result, meta, cutlist);
const letters = speciesLetters(board);
const visual = (id) => {
  const s = SPECIES_BY_ID.get(id);
  return { hex: s.displayHex, tint: s.textureTint, letter: letters.get(id) ?? '?', name: s.commonName };
};

const pages = renderBlueprint(board, result, cutlist, lints, visual, info, 'in-frac', 'letter');
console.log(`${templateId}: ${pages.length} pages, ${lints.length} lints`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
for (let i = 0; i < pages.length; i++) {
  const file = join(OUT, `${templateId}-p${i + 1}.svg`);
  await writeFile(file, pages[i]);
  await page.goto(pathToFileURL(file).href);
  await page.screenshot({ path: join(OUT, `${templateId}-p${i + 1}.png`) });
}
await browser.close();
console.log(`wrote ${OUT}/${templateId}-p*.png`);
