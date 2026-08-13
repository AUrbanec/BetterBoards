import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const ROOT = '/home/user/BetterBoards/dist/';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml' };
const server = createServer(async (req,res)=>{try{
  const url=(req.url??'/').split('?')[0];
  const p=join(ROOT,normalize(url==='/'?'/index.html':url));
  res.writeHead(200,{'content-type':MIME[extname(p)]??'application/octet-stream'});
  res.end(await readFile(p));
}catch{res.writeHead(404).end('nf');}});
await new Promise(r=>server.listen(0,r));
const base=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[]; page.on('pageerror',e=>errors.push('pageerror: '+e.message));
page.on('dialog',async d=>{console.log('DIALOG:',d.type(),d.message());await d.dismiss();});
page.on('console',m=>m.type()==='error'&&!m.text().includes('favicon')&&errors.push('console: '+m.text()));
await page.goto(base,{waitUntil:'networkidle'});
await page.locator('.gallery-card:has(b:text-is("Paddle Serving Board"))').click();
await page.waitForSelector('.board-svg svg');
// enable groove + engraving in the CNC panel
await page.locator('.right-tabs button', {hasText:'CNC'}).click();
await page.waitForSelector('.cnc-panel');
await page.locator('.cnc-panel h3 .chk', {hasText:'Juice groove'}).locator('input').check();
await page.locator('.cnc-panel h3 .chk', {hasText:'Engraving'}).locator('input').check();
const textInput = page.locator('.cnc-panel .row', {hasText:'Text'}).locator('input');
await textInput.fill('BETTERBOARDS');
await page.waitForTimeout(400);
await page.screenshot({path:'/tmp/bb-v2/cnc-panel.png'});
// view the toolpaths
await page.locator('.canvas-tabs button', {hasText:'CNC'}).click();
await page.waitForSelector('.cnc-svg');
await page.waitForTimeout(600);
await page.screenshot({path:'/tmp/bb-v2/cnc-view.png'});
const legend = await page.locator('.cnc-legend-item').allTextContents();
console.log('operations:\n  '+legend.join('\n  '));
const warn = await page.locator('.cnc-warnings div').allTextContents();
console.log('warnings:', warn.length? warn : 'none');
// export g-code
await page.locator('.topbar-tools button',{hasText:'Export'}).click();
await page.waitForSelector('.export-grid');
await page.screenshot({path:'/tmp/bb-v2/cnc-export.png'});
const btn = page.locator('.export-grid button', {hasText:'G-code'});
console.log('gcode button disabled:', await btn.isDisabled());
const dl = page.waitForEvent('download');
await btn.click();
const f = await dl;
const path = await f.path();
const text = await readFile(path,'utf8');
console.log('gcode file:', f.suggestedFilename(), text.split('\n').length, 'lines');
console.log(text.split('\n').slice(0,10).join('\n'));
await browser.close(); server.close();
if(errors.length){console.error('\nFAILURES:\n'+errors.join('\n'));process.exit(1);}
console.log('\nno console errors');
