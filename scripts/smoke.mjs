/**
 * Browser smoke test: boots the built app, exercises the core flow, and
 * screenshots each step. Run: node scripts/smoke.mjs [outDir]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const OUT = process.argv[2] ?? '/tmp/bb-shots';
const ROOT = new URL('../dist/', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  try {
    const url = (req.url ?? '/').split('?')[0];
    const path = join(ROOT, normalize(url === '/' ? '/index.html' : url));
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const step = async (name) => {
  await page.waitForTimeout(220);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
};

await page.goto(base, { waitUntil: 'networkidle' });

// 1. gallery opens on first run
await page.waitForSelector('.gallery-card');
const templateCount = await page.locator('.gallery-card').count();
console.log(`gallery: ${templateCount} templates`);
await step('01-gallery');

// 2. pick the checkerboard
await page.locator('.gallery-card:has(b:text-is("Checkerboard"))').click();
await page.waitForSelector('.board-svg svg');
await step('02-checkerboard');

const dims = await page.locator('.totals-dims').textContent();
const bf = await page.locator('.totals-cost').textContent();
console.log(`checkerboard: ${dims} · ${bf}`);

// 3. edit a strip width -> board updates
const before = await page.locator('.canvas-dims').textContent();
const widthInput = page.locator('.strip-row .dim-input input').first();
await widthInput.click();
await widthInput.fill('2');
await widthInput.press('Enter');
await page.waitForTimeout(200);
const after = await page.locator('.canvas-dims').textContent();
console.log(`edit width: "${before}" -> "${after}"`);
if (before === after) errors.push('editing a strip width did not change the board');
await step('03-edited');

// 4. undo restores
await page.locator('.topbar-tools button[title^="Undo"]').click();
await page.waitForTimeout(200);
const undone = await page.locator('.canvas-dims').textContent();
if (undone !== before) errors.push(`undo did not restore dims: "${undone}" != "${before}"`);
console.log(`undo: -> "${undone}"`);

// 5. slice arranger toggles a slice
await page.locator('.slice-chip').nth(2).click();
await page.waitForTimeout(200);
const onCount = await page.locator('.slice-chip-on').count();
console.log(`slice arranger: ${onCount} slices carry an op`);
await step('04-arranger');

// 6. cut list tab
await page.locator('.right-tabs button', { hasText: 'Cut list' }).click();
await page.waitForSelector('.cutlist table');
const rows = await page.locator('.cutlist tbody tr').count();
console.log(`cut list: ${rows} rows`);
await step('05-cutlist');

// 7. steps tab
await page.locator('.right-tabs button', { hasText: 'Steps' }).click();
await page.waitForSelector('.instructions li');
const steps = await page.locator('.instructions > ol > li').count();
console.log(`instructions: ${steps} steps`);
await step('06-steps');

// 8. species match tab
await page.locator('.right-tabs button', { hasText: 'Species' }).click();
await page.locator('.species-panel .seg button', { hasText: 'Match a color' }).click();
await page.waitForSelector('.badge');
const top = await page.locator('.species-row').first().textContent();
console.log(`color match top hit: ${top?.replace(/\s+/g, ' ').trim().slice(0, 70)}`);
await step('07-match');

// 9. lint popover
await page.locator('.totals-lint').click();
await page.waitForSelector('.lint-popover');
await step('08-lints');
await page.locator('.lint-head button').click();

// 10. chevron template (angled math end to end)
await page.locator('.topbar-tools button', { hasText: 'Templates' }).click();
await page.locator('.gallery-card:has(b:text-is("Chevron"))').click();
await page.waitForSelector('.board-svg svg');
console.log(`chevron: ${await page.locator('.totals-dims').textContent()}`);
await step('09-chevron');

// 11. crosscut view
await page.locator('.canvas-tabs button', { hasText: 'Crosscut' }).click();
await page.waitForTimeout(250);
await step('10-crosscut');

// 11b. outline shaping: switch to a paddle and confirm the clip path appears
await page.locator('.canvas-tabs button', { hasText: 'Top' }).click();
const outlineSelect = page.locator('.left select').filter({ hasText: 'Paddle (handle)' });
await outlineSelect.selectOption('paddle');
await page.waitForTimeout(250);
const hasPaddlePath = await page.locator('.board-svg svg clipPath path').count();
if (hasPaddlePath === 0) errors.push('paddle outline did not produce a clip path');
console.log(`outline: paddle clip paths = ${hasPaddlePath}`);
await step('11a-paddle');
await outlineSelect.selectOption('ellipse');
await page.waitForTimeout(250);
await step('11b-ellipse');
await outlineSelect.selectOption('rect');
await page.waitForTimeout(200);

// 12. export drawer
await page.locator('.topbar-tools button', { hasText: 'Export' }).click();
await page.waitForSelector('.export-grid');
await step('11-export');

// 13. project download round-trip
const dl = page.waitForEvent('download');
await page.locator('.export-grid button', { hasText: 'Project' }).click();
const file = await dl;
console.log(`download: ${file.suggestedFilename()}`);

// 14. reload -> autosave restores the chevron
await page.locator('.modal-head button').click();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.board-svg svg');
const restored = await page.locator('.project-name').inputValue();
console.log(`after reload: "${restored}"`);
if (restored !== 'Chevron') errors.push(`autosave did not restore the project (got "${restored}")`);
await step('12-restored');

await browser.close();
server.close();

if (errors.length) {
  console.error('\nFAILURES:\n' + errors.map((e) => ' ✖ ' + e).join('\n'));
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
