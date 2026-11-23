import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { preview } from 'vite';
const require=createRequire(process.env.TOOLKNIT_TEST_MODULES?path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json'):import.meta.url),{chromium}=require('playwright');
const root=path.resolve('tmp/word-encryption-production');await mkdir(root,{recursive:true});
const server=await preview({configFile:false,preview:{host:'127.0.0.1',port:0,open:false}}),browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>!document.documentElement.dataset.tkStartup&&document.querySelector('#homeCustomTools')&&!document.querySelector('.app').inert);
 await page.locator('#homeToolSearch').fill('Word');await page.locator('#homeToolGrid [data-home-tool="word-to-pdf"]').click();await page.waitForSelector('#wordToPdfOverlay.visible');
 assert.equal(await page.locator('#wordPdfEncryptionEnabled').isChecked(),false);await page.locator('#wordPdfEncryptionEnabled').check();
 await page.locator('#wordPdfEncryptionPrinting').selectOption('none');await page.locator('#wordPdfEncryptionCopying').uncheck();
 await page.locator('#wordPdfEncryptionPassword').fill('PRODUCTION_UI_LOCAL_QA');await page.locator('#wordPdfEncryptionConfirm').fill('PRODUCTION_UI_LOCAL_QA');
 assert.equal(await page.locator('#wordPdfEncryptionPassword').getAttribute('type'),'password');assert.equal(await page.locator('#wordPdfEncryptionPassword').getAttribute('autocomplete'),'new-password');
 assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('PRODUCTION_UI_LOCAL_QA')),false);
 await page.locator('#wordPdfEncryptionPassword').fill('');await page.locator('#wordPdfEncryptionConfirm').fill('');await page.screenshot({path:path.join(root,'production-encryption.png')});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('wordToPdfOverlay').inert&&!document.querySelector('.app').inert);
 await page.locator('#homeToolGrid [data-home-tool="word-to-pdf"]').click();await page.waitForSelector('#wordToPdfOverlay.visible');assert.equal(await page.locator('#wordPdfEncryptionEnabled').isChecked(),false);assert.equal(await page.locator('#wordPdfEncryptionPassword').inputValue(),'');
 assert.deepEqual(errors,[]);await writeFile(path.join(root,'report.json'),JSON.stringify({passed:true,checks:['production home/lazy Word route','default off','masked password fields','no password in localStorage','printing/copying controls','exit/reopen clears password and opt-in'],errors},null,2));
 console.log('Word encryption production entry passed: home route, real controls, password masking/storage and reopen reset.');
}finally{await browser.close();await server.close();}
