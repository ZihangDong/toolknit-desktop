import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';
const require=createRequire(process.env.TOOLKNIT_TEST_MODULES?path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json'):import.meta.url),{chromium}=require('playwright');await mkdir('tmp/disk-space-production',{recursive:true});
const server=await preview({configFile:false,preview:{host:'127.0.0.1',port:0,open:false}}),browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>!document.documentElement.dataset.tkStartup&&document.querySelector('#homeCustomTools')&&!document.querySelector('.app').inert);
 await page.locator('#homeToolSearch').fill('磁盘');await page.locator('#homeToolGrid [data-home-tool="disk-space"]').click();await page.waitForFunction(()=>document.getElementById('diskSpaceOverlay')?.classList.contains('visible')&&!document.getElementById('diskSpaceOverlay').inert);
 assert(await page.locator('#diskSpaceChoose').isDisabled());assert.match(await page.locator('#diskSpaceStatus').textContent(),/桌面版/);assert(await page.locator('#diskSpaceResults').isHidden());await page.screenshot({path:'tmp/disk-space-production/browser-entry.png'});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('diskSpaceOverlay').inert&&!document.querySelector('.app').inert);assert.deepEqual(errors,[]);console.log('Disk space production entry passed: home discovery, lazy page, truthful desktop requirement and home return.');
}finally{await browser.close();await server.close();}
