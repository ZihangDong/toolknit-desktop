import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { PDFDocument, degrees } from 'pdf-lib';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import { pdfjsAssets } from './lib/pdfjs-assets.mjs';
const require=createRequire(process.env.TOOLKNIT_TEST_MODULES?path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json'):import.meta.url),{chromium}=require('playwright');
const root=path.resolve('tmp/ocr-editor-browser');await mkdir(root,{recursive:true});await mkdir(path.join(root,'outputs'),{recursive:true});
GlobalFonts.registerFromPath('public/assets/fonts/NotoSansSC-Regular.ttf','OCR Fixture');
const canvas=createCanvas(800,400),ctx=canvas.getContext('2d');ctx.fillStyle='#fff6df';ctx.fillRect(0,0,800,400);ctx.fillStyle='#111111';ctx.font='32px "OCR Fixture"';ctx.textBaseline='top';ctx.fillText('项目验收 2026',40,40);ctx.fillText('Invoice 123',40,140);ctx.fillStyle='#1d64b4';ctx.fillRect(600,260,100,60);
const source=canvas.toBuffer('image/png');await writeFile(path.join(root,'source.png'),source);const hash=value=>createHash('sha256').update(value).digest('hex'),originalHash=hash(source);
const pdf=await PDFDocument.create(),image=await pdf.embedPng(source);for(let i=0;i<2;i++){const sheet=pdf.addPage([400,200]);sheet.drawImage(image,{x:0,y:0,width:400,height:200});if(i)sheet.setRotation(degrees(90));}await writeFile(path.join(root,'scan.pdf'),await pdf.save());
const many=await PDFDocument.create();for(let i=0;i<21;i++)many.addPage([100,100]);await writeFile(path.join(root,'many.pdf'),await many.save());
const huge=await PDFDocument.create();huge.addPage([3000,3000]);await writeFile(path.join(root,'huge.pdf'),await huge.save());await writeFile(path.join(root,'broken.pdf'),'broken pdf');
if(process.env.TOOLKNIT_OCR_EDITOR_GENERATE_ONLY){console.log('Synthetic OCR fixtures generated.');process.exit(0);}
const report={checks:[],errors:[]},check=(value,message)=>{assert.ok(value,message);report.checks.push(message);};
const writes=[];
const server=await createServer({configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/tmp/**','**/src-tauri/**','**/cli/**']}},optimizeDeps:{entries:['scripts/fixtures/ocr-editor.html'],include:['lucide','pdf-lib','pdfjs-dist/legacy/build/pdf.mjs']},plugins:[pdfjsAssets(),{name:'ocr-output-fixture',configureServer(server){server.middlewares.use('/__ocr-write',async(req,res)=>{try{const metadata=JSON.parse(Buffer.from(req.headers['x-toolknit-output'],'base64').toString());const chunks=[];for await(const chunk of req)chunks.push(chunk);const name=path.basename(metadata.fileName),target=path.join(root,'outputs',`${writes.length}-${name}`);await writeFile(target,Buffer.concat(chunks));writes.push(target);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:target}));}catch(error){res.statusCode=500;res.end(String(error));}});}}]});await server.listen();
if(process.env.TOOLKNIT_OCR_EDITOR_SERVE_ONLY){console.log(server.resolvedUrls.local[0]+'scripts/fixtures/ocr-editor.html?sample');await new Promise(()=>{});}
const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',error=>report.errors.push(error.message));page.setDefaultTimeout(15000);
await page.route('**/*',route=>{const host=new URL(route.request().url()).hostname;return host==='127.0.0.1'||host==='localhost'?route.continue():route.abort();});
const q=id=>page.locator('#ocrEdit'+id),idle=()=>page.waitForFunction(()=>window.ocrEditTest&&!window.ocrEditTest.controller.busy),notice=()=>q('Status').textContent();
async function start(params='native') {await page.goto(`${server.resolvedUrls.local[0]}scripts/fixtures/ocr-editor.html?${params}`);await page.waitForFunction(()=>window.ocrEditTest);await idle();}
async function load(name='source.png'){await q('FileInput').setInputFiles(path.join(root,name));await idle();}
async function ocr(){await q('Recognize').click();await idle();}
async function output(extension){const pending=page.waitForEvent('download');await q(extension==='png'?'Png':'Pdf').click();const download=await pending;await download.saveAs(path.join(root,'outputs',download.suggestedFilename()));await idle();return path.join(root,'outputs',download.suggestedFilename());}
async function inspectPdf(file, render = false) {
 const task = getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: false, disableFontFace: true });
 try {
   const document = await task.promise;
   const pages = [];
   for (let index = 1; index <= document.numPages; index++) {
     const sheet = await document.getPage(index);
     const items = (await sheet.getTextContent()).items.filter(item => item.str?.trim());
     let pixels;
     if (render) {
       const viewport = sheet.getViewport({ scale: 2 });
       const canvas = createCanvas(viewport.width, viewport.height);
       const context = canvas.getContext('2d');
       await sheet.render({ canvasContext: context, viewport }).promise;
       pixels = Buffer.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
     }
     pages.push({ items, pixels });
   }
   return pages;
 } finally { await task.destroy(); }
}
try {
 await start();await load();check((await notice()).includes('1'),'Image loaded');
 check(!await q('Searchable').isChecked(),'Image-only remains the default');
 await q('Searchable').check();await q('Pdf').click();await idle();
 check(!writes.length && (await notice()).includes('没有可导出'),'Empty searchable export reports missing text and writes no file');
 await ocr();check(await q('Boxes').locator('button').count()===2,'OCR result becomes two selectable boxes');
 check(await q('Background').inputValue()==='#fff6df','Solid background estimated from source boundary');
 check(await q('Text').inputValue()==='项目验收 2026','Chinese OCR result editable');
 await q('Text').fill('x'.repeat(500));await q('Apply').click();check((await notice()).includes('放不下'),'Overflow rejected without discarding the original region');
 for(const text of ['', ' \u200b ']){
  await q('Text').fill(text);await q('Apply').click();
  check((await notice()).includes('请输入替换文字'),'Blank replacement is rejected');
 }
 await q('Png').click();await idle();
 const decoded=await sharp(writes.at(-1)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 check(decoded.info.width===800&&decoded.info.height===400,'PNG retains source resolution');
 check(decoded.data.equals(await sharp(source).ensureAlpha().raw().toBuffer()),'Rejected replacement preserves every source pixel');
 await q('Text').fill('新版 2027');await q('Size').fill('28');await q('Apply').click();check((await notice()).includes('已应用'),'Chinese and numbers redraw with bundled font');
 await q('Searchable').check();await q('Text').fill('Unapplied draft');
 await q('Pdf').click();await idle();
 const editedText=await inspectPdf(writes.at(-1));
 check(editedText[0].items.map(item=>item.str).join(' ') === '新版 2027 Invoice 123','Searchable text follows current applied CJK and Latin lines in reading order');
 await q('Text').fill('\u{10FFFD}');await q('Apply').click();
 const beforeUnsupported=writes.length;
 await q('Pdf').click();await idle();
 check(writes.length===beforeUnsupported && (await notice()).includes('不支持部分字符'),'Unsupported Unicode fails searchable export before writing');
 await q('Undo').click();
 await q('Text').fill('新版 2027');
 await q('Searchable').uncheck();
 await q('X').fill('-3');await q('Apply').click();check((await notice()).includes('坐标'),'Invalid coverage rejected');await q('X').fill('38');
 await q('Compare').check();await q('Png').click();await idle();const replacement=writes.at(-1);check(hash(await readFile(replacement))!==originalHash,'Export uses edited pixels while original comparison is shown');await q('Compare').uncheck();
 await q('Rotate').click();const bounds=await q('Boxes').locator('button').first().evaluate(node=>({left:node.style.left,top:node.style.top,width:node.style.width,height:node.style.height}));check(bounds.left==='75.5%'&&bounds.top==='4.75%'&&bounds.width==='15%'&&bounds.height==='41.25%','OCR overlay maps correctly after 90 degree rotation');
 await q('Searchable').check();await q('Pdf').click();await idle();
 const rotatedText=(await inspectPdf(writes.at(-1)))[0].items[0];
 check(rotatedText.str === '新版 2027' && Math.abs(rotatedText.transform[0]) < .01 && rotatedText.transform[1] < 0 &&
   rotatedText.transform[4] > 151 && rotatedText.transform[4] < 181 && Math.abs(rotatedText.transform[5] - 381) < .1,
   '90 degree searchable baseline follows the rotated OCR box');
 await q('Searchable').uncheck();
 await q('Png').click();await idle();const rotated=await sharp(writes.at(-1)).metadata();check(rotated.width===400&&rotated.height===800,'PNG rotation changes physical pixel dimensions');
 await q('Folder').click();check(await page.evaluate(()=>window.ocrEditTest.calls.some(row=>row.command==='open_path'&&row.args.path.includes('outputs'))),'Reveal uses returned output path');
 await q('Undo').click();check(await q('Folder').isHidden(),'Editing invalidates prior output link');
 for(const width of [1440,1024,390])for(const theme of ['light','dark'])for(const lang of ['zh','en']){
   await page.setViewportSize({width,height:900});await page.evaluate(({theme,lang})=>{window.ocrEditTest.theme(theme);window.ocrEditTest.lang(lang);},{theme,lang});
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}/${theme}/${lang}: no horizontal page overflow`);
   check((await q('Stage').boundingBox()).height>=220,`${width}/${theme}/${lang}: preview remains usable`);
   check(!await q('Fields').locator('input').evaluateAll(nodes=>nodes.some(node=>node.scrollWidth>node.clientWidth+2)),`${width}/${theme}/${lang}: controls fit`);
   await page.screenshot({path:path.join(root,`${width}-${theme}-${lang}.png`),fullPage:true});
   if(width===390){await q('JumpPreview').click();check(await q('Stage').evaluate(node=>node===document.activeElement),'Narrow screen jumps to preview');await q('JumpSettings').click();check(await q('Pick').evaluate(node=>node===document.activeElement),'Narrow screen returns to editing controls');}
 }
 await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>window.ocrEditTest.lang('zh'));
 for(const name of ['broken.pdf','many.pdf','huge.pdf']){await load(name);check((await notice()).length>0&&await q('Boxes').locator('button').count()===2,`${name}: invalid import retains previous edits`);}
 await load('scan.pdf');check(await q('Page').locator('option').count()===2,'Scanned PDF has two pages');await ocr();await q('Text').fill('PDF 2027');await q('Size').fill('28');await q('Apply').click();
 await q('Page').selectOption('1');check(await q('Source').textContent().then(text=>text.includes('400 × 800')),'PDF source page rotation is respected');
 await q('Add').click();await q('Text').fill('Second page');await q('Width').fill('300');await q('Apply').click();await q('Page').selectOption('0');await q('Regions').selectOption('0');check(await q('Text').inputValue()==='PDF 2027','Applied edits survive page changes');
 await q('Pdf').click();await idle();const imageOnlyPath=writes.at(-1);
 const exported=await PDFDocument.load(await readFile(imageOnlyPath));check(exported.getPageCount()===2,'Exported PDF reopens with every page');check(exported.getPage(0).getWidth()===400&&exported.getPage(1).getHeight()===400,'PDF page dimensions preserve 144 DPI raster geometry');
 await q('Searchable').check();await q('Pdf').click();await idle();const searchablePath=writes.at(-1);
 await writeFile(path.join(root,'searchable.pdf'),await readFile(searchablePath));
 await writeFile(path.join(root,'image-only.pdf'),await readFile(imageOnlyPath));
 const searchable=await inspectPdf(searchablePath,true), imageOnly=await inspectPdf(imageOnlyPath,true);
 check(searchable.map(value=>value.items.map(item=>item.str).join(' ')).join('|') === 'PDF 2027 Invoice 123|Second page','Searchable PDF retains all pages and isolates text by page');
 check(imageOnly.every((value,index)=>!value.items.length&&value.pixels.equals(searchable[index].pixels)),'Searchable and image-only PDFs render identical pixels on each page');
 await q('Add').click();await q('X').fill('38');await q('Y').fill('138');await q('Width').fill('60');await q('Apply').click();
 await q('Pdf').click();await idle();
 const covered=await inspectPdf(writes.at(-1));
 check(covered[0].items.map(item=>item.str).join(' ') === 'PDF 2027 Invoice 123','A blank overlapping box cannot suppress recognized text');
 // Reopen the exported PDF through the actual PDF.js input path.
 await q('FileInput').setInputFiles(writes.at(-1));await idle();check(await q('Page').locator('option').count()===2,'Exported PDF reopens in the editor');
 await q('Add').click();await q('Text').fill('保持编辑');await q('Apply').click();await page.evaluate(()=>{window.ocrEditTest.failSave=true;});await q('Png').click();await idle();check((await notice()).includes('处理失败')&&await q('Text').inputValue()==='保持编辑','Disk failure retains applied edits');await page.evaluate(()=>{window.ocrEditTest.failSave=false;window.ocrEditTest.holdSave=true;});
 await q('Png').click();await page.waitForFunction(()=>document.getElementById('ocrEditCancel').disabled);check(await page.evaluate(()=>window.ocrEditTest.controller.close())===false,'Close vetoed while native write commits');check(await q('Cancel').isDisabled(),'Cancellation disabled during publication');await page.evaluate(()=>window.ocrEditTest.holdSave=false);await idle();check((await notice()).includes('已保存'),'Committed output reports final path');
 await start();await page.evaluate(async()=>{const state=window.ocrEditTest;state.nativeFileSize=25*1024*1024;state.nativeFileUrl='/tmp/ocr-editor-browser/source.png';await state.controller.importFile({path:'C:/Synthetic/source.png',name:'source.png'});});await idle();check(!await page.evaluate(()=>window.ocrEditTest.calls.some(row=>row.command==='read_file_bytes_limited')),'Oversized native source rejected before reading bytes');
 await page.evaluate(async size=>{window.ocrEditTest.nativeFileSize=size;await window.ocrEditTest.controller.importFile({path:'C:/Synthetic/source.png',name:'source.png'});},source.length);await idle();check(await q('Source').textContent().then(text=>text.includes('800 × 400')),'Desktop import uses bounded native file reading');
 await page.evaluate(()=>window.ocrEditTest.mode='missing');await ocr();check((await notice()).includes('尚未安装'),'Missing model gives actionable message');
 await page.evaluate(()=>window.ocrEditTest.mode='bad');await ocr();check((await notice()).includes('格式无效'),'Invalid OCR coordinates rejected');
 await page.evaluate(()=>window.ocrEditTest.mode='hold');await q('Recognize').click();await page.waitForFunction(()=>!!window.ocrEditTest.resolveOcr);await q('Cancel').click();await idle();check(await q('Boxes').locator('button').count()===0,'Cancelled OCR adds no stale text boxes');check(await page.evaluate(()=>window.ocrEditTest.center.list()[0].state==='cancelled'),'Task Center records cancellation as cancelled');
 await page.evaluate(()=>window.ocrEditTest.mode='late');await q('Recognize').click();await page.waitForFunction(()=>!!window.ocrEditTest.resolveOcr);await page.evaluate(()=>{window.ocrEditTest.controller.close();window.ocrEditTest.controller.open();window.ocrEditTest.resolveOcr();});await idle();check(await q('Boxes').locator('button').count()===0&&await q('Source').textContent()==='','Late OCR result cannot modify a reopened editor');
 await start('');await load();await q('Add').click();await q('Text').fill('Browser 123');await q('Width').fill('300');await q('Apply').click();const browserPng=await output('png');check((await sharp(browserPng).metadata()).width===800,'Browser manual editing downloads a valid PNG');const browserPdf=await output('pdf');check((await PDFDocument.load(await readFile(browserPdf))).getPageCount()===1,'Browser download produces a valid PDF');
 if(process.env.TOOLKNIT_OCR_EDITOR_REAL){await start('native&adapter');await load();await ocr();check(await q('Boxes').locator('button').count()>=2,'Real local ONNX response becomes editable boxes');check((await q('Regions').textContent()).includes('2026'),'Real local OCR recognizes sample numbers');check(await page.evaluate(()=>window.ocrEditTest.calls.some(row=>row.command==='local_ocr'&&row.args.request.action==='recognize'&&row.args.request.image.startsWith('data:image/png;base64,'))),'Production OCR adapter sends PNG data with a scoped request ID');await q('Text').fill('本地改字 2027');await q('Width').fill('350');await q('Height').fill('65');await q('Size').fill('28');await q('Apply').click();check((await notice()).includes('已应用'),'Real OCR region accepts Chinese replacement');await q('Png').click();await idle();await writeFile(path.join(root,'real-edited.png'),await readFile(writes.at(-1)));await q('Pdf').click();await idle();check((await PDFDocument.load(await readFile(writes.at(-1)))).getPageCount()===1,'Real OCR edited PDF reopens');}
 check(hash(await readFile(path.join(root,'source.png')))===originalHash,'Original source file hash unchanged');
 await page.evaluate(()=>{for(const sheet of document.styleSheets)for(let index=sheet.cssRules.length-1;index>=0;index--){const rule=sheet.cssRules[index];if(rule.type===CSSRule.FONT_FACE_RULE&&rule.style.fontFamily.includes('ToolKnit OCR Sans'))sheet.deleteRule(index);}});await q('Png').click();await idle();check((await notice()).includes('字体'),'Missing bundled font blocks export with a font message');
 check(report.errors.length===0,'No unhandled browser errors');
 await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(`OCR editor browser passed: ${report.checks.length} checks; synthetic fixtures, actual canvas/PNG/PDF, isolated native transport.`);
} finally {await browser.close();await server.close();}
