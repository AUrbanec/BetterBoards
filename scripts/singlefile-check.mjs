import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => m.type() === 'error' && !m.text().includes('favicon') && errors.push('console: ' + m.text()));
await page.goto(pathToFileURL('/home/user/BetterBoards/dist-single/index.html').href, { waitUntil: 'load' });
await page.waitForSelector('.gallery-card', { timeout: 15000 });
console.log('templates in gallery:', await page.locator('.gallery-card').count());
await page.locator('.gallery-card:has(b:text-is("Tumbling Blocks"))').click();
await page.waitForSelector('.board-svg svg');
console.log('board:', await page.locator('.totals-dims').textContent());
await page.screenshot({ path: '/tmp/bb-v2/singlefile.png' });
await browser.close();
if (errors.length) { console.error('FAILURES:\n' + errors.join('\n')); process.exit(1); }
console.log('single-file build runs from file:// with no server, no console errors');
