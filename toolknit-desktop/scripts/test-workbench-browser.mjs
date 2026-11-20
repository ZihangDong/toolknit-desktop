import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {preview} from 'vite';
import {PDFDocument} from 'pdf-lib';
import JSZip from 'jszip';
const require=createRequire(import.meta.url),browserRequire=process.env.TOOLKNIT_TEST_MODULES?createRequire(path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json')):require;
const {chromium}=browserRequire('playwright');
const output=path.resolve('tmp/workbench-browser');await mkdir(output,{recursive:true});
const server=await preview({configFile:false,preview:{host:'127.0.0.1',port:0,open:false}});
const browser=await chromium.launch({headless:true,...(process.env.TOOLKNIT_TEST_BROWSER?{executablePath:process.env.TOOLKNIT_TEST_BROWSER}:{channel:'msedge'})});
const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true}),errors=[];
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
const ready=()=>page.waitForFunction(()=>!document.getElementById('appStartupMask')&&!document.querySelector('.app')?.inert);
const settle=()=>page.waitForFunction(()=>{const veil=document.querySelector('[data-tk-page-transition-veil]');return (!veil||getComputedStyle(veil).visibility==='hidden')&&!document.getAnimations().some(animation=>animation.playState==='running'&&animation.effect?.getTiming().iterations!==Infinity);});
const root=page.locator('#documentWorkbenchOverlay');
try{
 await page.goto(server.resolvedUrls.local[0]);await ready();
 await page.keyboard.press('Control+k');await page.locator('#quickLauncherOverlay').waitFor({state:'visible'});
 await page.locator('[data-launcher-query]').fill('文件.srt');assert.equal(await page.locator('[data-launcher-tool]').first().getAttribute('data-launcher-tool'),'subtitle-workbench');
 await page.keyboard.press('Enter');await root.waitFor({state:'visible'});await settle();
 assert.equal(await root.locator('h1:visible').innerText(),'字幕工作台');
 const srt='1\n00:00:01,000 --> 00:00:03,000\n第一句\n\n2\n00:00:04,000 --> 00:00:06,000\n第二句\n';
 await root.locator('[data-subtitle-file]').setInputFiles({name:'sample.srt',mimeType:'text/plain',buffer:Buffer.from(srt)});
 await page.waitForFunction(()=>document.querySelectorAll('.wb-cue-row').length===2);
 await root.locator('[data-cue-text]').fill('修改后的字幕');await root.locator('[data-cue-offset]').fill('500');await root.locator('[data-wb-action="shift-cues"]').click();
 let download=page.waitForEvent('download');await root.locator('[data-wb-action="export-vtt"]').click();let file=await download;const vttPath=path.join(output,'edited.vtt');await file.saveAs(vttPath);
 const vtt=await readFile(vttPath,'utf8');assert.match(vtt,/00:00:01.500 --> 00:00:03.500/);assert.match(vtt,/修改后的字幕/);
 await page.screenshot({path:path.join(output,'subtitles-desktop.png')});
 await root.locator('[data-wb-tab="document-compare"]').click();
 await root.locator('[data-before]').fill('标题\n原来的句子\n保留');await root.locator('[data-after]').fill('标题\n修改后的句子\n保留');await root.locator('[data-wb-action="compare"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-diff-result] [data-kind="add"]').length===1);
 assert.equal(await root.locator('[data-kind="delete"]').count(),1);
 await root.locator('[data-changes-only]').check();assert.equal(await root.locator('[data-kind="equal"]').count(),0);
 download=page.waitForEvent('download');await root.locator('[data-wb-action="export-diff"]').click();file=await download;const diffPath=path.join(output,'diff.txt');await file.saveAs(diffPath);assert.match(await readFile(diffPath,'utf8'),/\+ 修改后的句子/);
 await page.screenshot({path:path.join(output,'comparison-desktop.png')});
 await root.locator('[data-wb-tab="content-search"]').click();
 const pdf=await PDFDocument.create();pdf.addPage().drawText('Searchable PDF alpha');
 const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>合同内容 DOCX beta</w:t></w:r></w:p></w:body></w:document>');
 await root.locator('[data-content-files]').setInputFiles([{name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('本地文字索引 gamma')},{name:'sample.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())},{name:'contract.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:await zip.generateAsync({type:'nodebuffer'})}]);
 await page.waitForFunction(()=>document.querySelector('[data-index-status]').textContent.includes('3 份文档'));
 for(const query of ['alpha','合同内容','gamma']){await root.locator('[data-content-query]').fill(query);await root.locator('[data-wb-action="search"]').click();await page.waitForFunction(()=>document.querySelectorAll('.wb-result').length===1);assert.equal(await root.locator('.wb-result mark').first().innerText(),query);}
 await page.screenshot({path:path.join(output,'search-desktop.png')});
 await root.locator('[data-wb-tab="folder-automation"]').click();assert.equal(await root.locator('[name="name"]').isDisabled(),true);
 await page.screenshot({path:path.join(output,'folders-desktop.png')});
 for(const width of [768,390]){await page.setViewportSize({width,height:900});for(const tab of ['content-search','document-compare','subtitle-workbench','folder-automation']){await root.locator(`[data-wb-tab="${tab}"]`).click();assert.equal(await root.locator('.workbench-sheet').evaluate(node=>node.scrollWidth>node.clientWidth+2),false,`${tab} at ${width}`);await page.screenshot({path:path.join(output,`${tab}-${width}.png`)});}}
 await page.setViewportSize({width:1440,height:900});await page.keyboard.press('Escape');await ready();await page.keyboard.press('Control+k');await page.locator('[data-launcher-query]').fill('文档对比');await page.screenshot({path:path.join(output,'launcher-desktop.png')});await page.keyboard.press('Enter');await root.waitFor({state:'visible'});await settle();assert.equal(await root.locator('h1:visible').innerText(),'文档对比');
 await page.waitForTimeout(250);await page.reload();await ready();await page.keyboard.press('Control+k');await page.locator('[data-launcher-query]').fill('字幕工作台');await page.keyboard.press('Enter');await root.waitFor({state:'visible'});assert.equal(await root.locator('[data-cue-text]').inputValue(),'修改后的字幕','draft survives reload');
 await page.evaluate(()=>{localStorage.setItem('toolknit-lang','en');const config=JSON.parse(localStorage.getItem('toolknit.appearance.v1'));localStorage.setItem('toolknit.appearance.v1',JSON.stringify({...config,mode:'dark'}));});await page.reload();await ready();await page.keyboard.press('Control+k');await page.locator('[data-launcher-query]').fill('Document comparison');await page.keyboard.press('Enter');await root.waitFor({state:'visible'});await settle();assert.equal(await root.locator('h1:visible').innerText(),'Document comparison');await page.screenshot({path:path.join(output,'comparison-dark-english.png')});
 assert.deepEqual(errors,[]);console.log(`Workbench browser passed: launcher, real PDF/DOCX/text extraction, comparison export, SRT/VTT edits, persisted draft, dark English and responsive layouts. ${output}`);
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});console.error({errors,message:await page.locator('[data-wb-message]').textContent().catch(()=>''),index:await page.locator('[data-index-status]').textContent().catch(()=>'')});throw error;}
finally{await browser.close();await server.close();}
