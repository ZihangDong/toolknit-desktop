import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { preview } from 'vite';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const require=createRequire(process.env.TOOLKNIT_TEST_MODULES?path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json'):import.meta.url),{chromium}=require('playwright');
const root=path.resolve('tmp/ocr-editor-production');await mkdir(root,{recursive:true});
const canvas=createCanvas(500,200),context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,500,200);context.fillStyle='black';context.font='24px sans-serif';context.fillText('Original scan 2026',20,40);const input=path.join(root,'sample.png');await writeFile(input,canvas.toBuffer('image/png'));
const server=await preview({configFile:false,preview:{host:'127.0.0.1',port:0,open:false}});const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
 await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>!document.documentElement.dataset.tkStartup&&document.querySelector('#homeCustomTools')&&!document.querySelector('.app').inert);
 await page.locator('#homeToolSearch').fill('OCR');await page.locator('#homeToolGrid [data-home-tool="ocr-editor"]').click();await page.waitForFunction(()=>document.getElementById('ocrEditOverlay')?.classList.contains('visible')&&!document.getElementById('ocrEditOverlay').inert);
 await page.locator('#ocrEditFileInput').setInputFiles(input);await page.waitForFunction(()=>!document.getElementById('ocrEditAdd').disabled);
 assert(await page.locator('#ocrEditRecognize').isDisabled(),'browser mode explains desktop OCR requirement');
 await page.locator('#ocrEditAdd').click();await page.locator('#ocrEditText').fill('Production 2027');await page.locator('#ocrEditWidth').fill('300');await page.locator('#ocrEditApply').click();
 await page.locator('#ocrEditSearchable').check();
 const pending=page.waitForEvent('download');await page.locator('#ocrEditPdf').click();const download=await pending,target=path.join(root,download.suggestedFilename());await download.saveAs(target);assert.equal((await PDFDocument.load(await readFile(target))).getPageCount(),1);
 const task=getDocument({data:new Uint8Array(await readFile(target))});
 try {
   const pdf=await task.promise;
   const page=await pdf.getPage(1);
   const content=await page.getTextContent();
   assert.equal(content.items.map(item=>item.str).join(''), 'Production 2027');
 } finally { await task.destroy(); }
 await page.screenshot({path:path.join(root,'production-editor.png')});await page.waitForFunction(()=>document.getElementById('ocrEditCancel').hidden);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('ocrEditOverlay').inert&&!document.querySelector('.app').inert);
 assert.deepEqual(errors,[]);console.log('OCR editor production entry passed: home search, lazy page, local manual editing, bundled font, PDF download and home return.');
}finally{await browser.close();await server.close();}
