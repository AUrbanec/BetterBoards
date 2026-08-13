import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const ROOT='/home/user/BetterBoards/dist/';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const u=(req.url??'/').split('?')[0];
const p=join(ROOT,normalize(u==='/'?'/index.html':u));
res.writeHead(200,{'content-type':MIME[extname(p)]??'application/octet-stream'});res.end(await readFile(p));
}catch{res.writeHead(404).end('nf');}});
await new Promise(r=>server.listen(0,r));
const base=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await browser.newPage({viewport:{width:1500,height:940}});
const errors=[];page.on('pageerror',e=>errors.push('pageerror: '+e.message));
page.on('console',m=>m.type()==='error'&&!m.text().includes('favicon')&&errors.push('console: '+m.text()));
await page.goto(base,{waitUntil:'networkidle'});

const pick = async (name) => {
  if (!(await page.locator('.gallery-grid').isVisible())) {
    await page.locator('.topbar-tools button',{hasText:'Templates'}).click();
    await page.waitForSelector('.gallery-grid');
  }
  await page.locator(`.gallery-card:has(b:text-is("${name}"))`).click();
  await page.waitForTimeout(400);
};

// 1. stages bar on a simple board
await pick('Classic Stripes');
await page.waitForSelector('.stages');
console.log('stripes stages:', (await page.locator('.stages-head').textContent())?.replace(/\s+/g,' ').trim());

// 2. multi glue-up board
await pick('Checkerboard');
console.log('checkerboard stages:', (await page.locator('.stages-head').textContent())?.replace(/\s+/g,' ').trim());
await page.locator('.stage-chip').nth(2).click();
await page.waitForSelector('.stage-detail');
console.log('stage detail:', (await page.locator('.stage-detail b').textContent()));
await page.screenshot({path:'/tmp/bb-v3/stages.png'});

// 3. parabolic arch
await pick('Parabolic Arch');
await page.waitForSelector('.board-svg svg');
console.log('parabolic:', (await page.locator('.stages-head').textContent())?.replace(/\s+/g,' ').trim(),
            '·', await page.locator('.totals-dims').textContent());
await page.screenshot({path:'/tmp/bb-v3/parabolic.png'});
// change column count live
const colInput = page.locator('.left .row', {hasText:'Columns'}).locator('input');
await colInput.fill('30'); await colInput.blur(); await page.waitForTimeout(400);
console.log('after 30 columns:', (await page.locator('.stages-head').textContent())?.replace(/\s+/g,' ').trim());
await page.screenshot({path:'/tmp/bb-v3/parabolic-30.png'});

// 4. lens
await page.locator('.left .row', {hasText:'Curve'}).locator('select').selectOption('lens');
await page.waitForTimeout(400);
await page.screenshot({path:'/tmp/bb-v3/lens.png'});

// 5. patch studio
await pick('Patch Studio — Star');
await page.waitForSelector('.studio-grid');
console.log('studio cells:', await page.locator('.studio-grid polygon').count(),
            '·', (await page.locator('.stages-head').textContent())?.replace(/\s+/g,' ').trim());
await page.screenshot({path:'/tmp/bb-v3/studio.png'});

// paint by dragging with the HST tool
const gridBox = await page.locator('.studio-grid').boundingBox();
const cell = gridBox.width / 6;
await page.locator('.palette-chip').nth(1).click();  // HST
await page.mouse.move(gridBox.x + cell*0.5, gridBox.y + cell*0.5);
await page.mouse.down();
await page.mouse.move(gridBox.x + cell*2.5, gridBox.y + cell*0.5, {steps: 8});
await page.mouse.up();
await page.waitForTimeout(300);
console.log('after painting:', await page.locator('.studio-grid polygon').count(), 'regions');
await page.screenshot({path:'/tmp/bb-v3/studio-painted.png'});

// mirror the whole design
await page.locator('.studio-actions button', {hasText:'Mirror H'}).click();
await page.waitForTimeout(300);
await page.screenshot({path:'/tmp/bb-v3/studio-mirrored.png'});
console.log('after mirror:', await page.locator('.studio-grid polygon').count(), 'regions');

// rotate whole design
await page.locator('.studio-actions button', {hasText:'Rotate'}).click();
await page.waitForTimeout(300);
console.log('after rotate:', await page.locator('.totals-dims').textContent());

// check the cut list reflects the design
await page.locator('.right-tabs button', {hasText:'Cut list'}).click();
await page.waitForSelector('.cutlist table');
const rows = await page.locator('.cutlist tbody tr').count();
console.log('cut list rows:', rows);
await page.screenshot({path:'/tmp/bb-v3/studio-cutlist.png'});

// steps tab reflects 3 glue-ups
await page.locator('.right-tabs button', {hasText:'Steps'}).click();
await page.waitForSelector('.instructions li');
const intro = await page.locator('.instructions .hint').first().textContent();
console.log('steps intro:', intro?.slice(0, 140));

await browser.close();server.close();
if(errors.length){console.error('\nFAILURES:\n'+errors.join('\n'));process.exit(1);}
console.log('\nno console errors');
