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
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',e=>errors.push('pageerror: '+e.message));
page.on('console',m=>m.type()==='error'&&!m.text().includes('favicon')&&errors.push('console: '+m.text()));
await page.goto(base,{waitUntil:'networkidle'});
for (const [tpl,shot] of [['Tumbling Blocks','tumbling'],['Pinwheel','pinwheel'],['Basket Weave','weave']]) {
  if (!(await page.locator('.gallery-grid').isVisible())) {
    await page.locator('.topbar-tools button',{hasText:'Templates'}).click();
    await page.waitForSelector('.gallery-grid');
  }
  await page.locator(`.gallery-card:has(b:text-is("${tpl}"))`).click();
  await page.waitForSelector('.board-svg svg');
  await page.waitForTimeout(300);
  await page.screenshot({path:`/tmp/bb-v2/app-${shot}.png`});
  console.log(`${tpl}: ${await page.locator('.totals-dims').textContent()} · ${await page.locator('.totals-cost').textContent()}`);
}
// 3D preview
await page.locator('.canvas-tabs button',{hasText:'3D'}).click();
await page.waitForSelector('.preview3d svg');
await page.waitForTimeout(400);
await page.screenshot({path:'/tmp/bb-v2/app-3d.png'});
console.log('3d faces:', await page.locator('.preview3d svg path').count());
// rotate
const slider = page.locator('.preview3d-controls input[type=range]').first();
await slider.fill('40'); await page.waitForTimeout(300);
await page.screenshot({path:'/tmp/bb-v2/app-3d-rot.png'});
console.log('3d after rotate:', await page.locator('.preview3d svg path').count());
await browser.close();server.close();
if(errors.length){console.error('\nFAILURES:\n'+errors.join('\n'));process.exit(1);}
console.log('\nno console errors');
