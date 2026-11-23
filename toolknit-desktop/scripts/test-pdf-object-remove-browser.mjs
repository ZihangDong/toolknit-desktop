import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { createServer } from 'vite';
import { PDFDocument,PDFName,StandardFonts } from 'pdf-lib';
import fontkit from '../src/pdf-lib-fontkit.js';
import sharp from 'sharp';
import { pdfjsAssets } from './lib/pdfjs-assets.mjs';
const require=createRequire(process.env.TOOLKNIT_TEST_MODULES?path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json'):import.meta.url),{chromium}=require('playwright'),run=promisify(execFile),root=path.resolve('tmp/pdf-object-remove-browser');await mkdir(path.join(root,'outputs'),{recursive:true});
const source=await readFile('tmp/pdf-object-remove/source.pdf'),sourceMeta=JSON.parse(await readFile('tmp/pdf-object-remove/analysis.json','utf8')),first=sourceMeta.candidates.filter(item=>item.pageIndex===0),text=first.filter(item=>item.label==='DRAFT').at(-1),image=first.filter(item=>item.kind==='image').at(-1),form=first.find(item=>item.kind==='text-form');
await writeFile(path.join(root,'source.pdf'),source);await writeFile(path.join(root,'broken.pdf'),'broken PDF');const many=await PDFDocument.create();for(let i=0;i<101;i++)many.addPage([100,100]);await writeFile(path.join(root,'many.pdf'),await many.save());
const heavy=await PDFDocument.create(),heavyFont=await heavy.embedFont(StandardFonts.Helvetica),stream=heavy.context.register(heavy.context.flateStream('BT /F0 12 Tf 1 0 0 1 10 100 Tm\n'+'(SLOW) Tj\n'.repeat(5000)+'ET\n'));for(let i=0;i<80;i++){const page=heavy.addPage([200,200]);page.node.set(PDFName.of('Resources'),heavy.context.obj({Font:{F0:heavyFont.ref}}));page.node.set(PDFName.of('Contents'),stream);}await writeFile(path.join(root,'heavy.pdf'),await heavy.save());
const chinese=await PDFDocument.create();chinese.registerFontkit(fontkit);const chineseFont=await chinese.embedFont(await readFile('public/assets/fonts/NotoSansSC-Regular.ttf'),{subset:true}),chinesePage=chinese.addPage([400,300]);chinesePage.drawText('中文正文 2026',{x:30,y:250,size:18,font:chineseFont});chinesePage.drawText('内部水印',{x:100,y:140,size:30,font:chineseFont,opacity:.3});await writeFile(path.join(root,'chinese.pdf'),await chinese.save());
await run(path.resolve('src-tauri/resources/qpdf/qpdf.exe'),['--encrypt','secret','owner','256','--',path.join(root,'source.pdf'),path.join(root,'locked.pdf')],{windowsHide:true});
const originalHash=createHash('sha256').update(source).digest('hex'),report={checks:[],errors:[]},check=(value,message)=>{assert.ok(value,message);report.checks.push(message);},writes=[];
const server=await createServer({configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false,watch:{ignored:['**/tmp/**','**/src-tauri/**','**/cli/**']}},optimizeDeps:{entries:['scripts/fixtures/pdf-object-remove.html'],include:['lucide','pdf-lib','pdfjs-dist/legacy/build/pdf.mjs']},plugins:[pdfjsAssets(),{name:'isolated-pdf-object-output',configureServer(server){server.middlewares.use('/__pdf-remove-write',async(request,response)=>{try{const metadata=JSON.parse(Buffer.from(request.headers['x-toolknit-output'],'base64').toString()),chunks=[];for await(const chunk of request)chunks.push(chunk);const target=path.join(root,'outputs',`${writes.length}-${path.basename(metadata.fileName)}`);await writeFile(target,Buffer.concat(chunks));writes.push(target);response.setHeader('Content-Type','application/json');response.end(JSON.stringify({path:target}));}catch(error){response.statusCode=500;response.end(String(error));}});}}]});await server.listen();
if(process.env.TOOLKNIT_REMOVE_SERVE_ONLY){console.log(server.resolvedUrls.local[0]+'scripts/fixtures/pdf-object-remove.html?sample');await new Promise(()=>{});}
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(20000);page.on('pageerror',error=>report.errors.push(error.message));
const q=id=>page.locator('#pdfRemove'+id),idle=()=>page.waitForFunction(()=>window.pdfRemoveTest&&!window.pdfRemoveTest.controller.busy),notice=()=>q('Status').textContent();
async function start(params='native'){await page.goto(server.resolvedUrls.local[0]+'scripts/fixtures/pdf-object-remove.html?'+params);await page.waitForFunction(()=>window.pdfRemoveTest);await idle();}
async function load(file=path.join(root,'source.pdf')){await q('FileInput').setInputFiles(file);await idle();}
async function focus(id){await q('Objects').selectOption(id);}
async function preview(){await q('Preview').click();await idle();}
async function extractedPages(file){const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),pdf=await getDocument({data:new Uint8Array(await readFile(file)),isEvalSupported:false,useWorkerFetch:false,standardFontDataUrl:path.resolve('node_modules/pdfjs-dist/standard_fonts').replace(/\\/g,'/')+'/'}).promise;try{const pages=[];for(let i=1;i<=pdf.numPages;i++)pages.push((await(await pdf.getPage(i)).getTextContent()).items.map(item=>item.str).join(' '));return pages;}finally{await pdf.loadingTask.destroy();}}
try{
 await start();await load();check(await q('Page').locator('option').count()===3,'Real worker analyzes three pages');check(await q('Objects').locator('option').count()===first.length,'Candidate list matches actual stream analysis');check(await q('Export').isDisabled(),'Unreviewed removal cannot be exported');
 await focus(text.id);await q('Inspect').click();await idle();check((await notice()).includes('单项预览')&&await q('Difference').isVisible(),'Inspection renders actual one-object difference bounds');check(await q('Export').isDisabled(),'Inspection is separate from the exportable removal list');
 await q('Mark').click();check((await q('Selection').textContent()).includes('1')&&await q('After').isHidden(),'Marking invalidates the previous preview');await q('Range').fill('1-2');await q('Match').click();check((await q('Selection').textContent()).includes('2'),'Exact matches respect selected page ranges');await q('Range').fill('3-1');check(await q('Match').isDisabled(),'Invalid ranges block matching');await q('Range').fill('');await q('Match').click();check((await q('Selection').textContent()).includes('3'),'Exact text matching adds all three watermark instances');
 await focus(image.id);await q('Match').click();await focus(form.id);await q('Match').click();check((await q('Selection').textContent()).includes('9'),'Text/image/Form selections combine without selecting legitimate shared logos');await q('Undo').click();check((await q('Selection').textContent()).includes('6'),'Undo restores the preceding list');await q('Redo').click();check((await q('Selection').textContent()).includes('9'),'Redo restores the removal list');
 await preview();check(!await q('Export').isDisabled()&&(await q('PreviewMode').textContent()).includes('9'),'Generated list preview enables export for exactly the reviewed selection');await q('Highlight').uncheck();check(await q('Difference').isHidden(),'Difference overlay can be hidden without changing rendered pixels');await q('Highlight').check();
 await q('Zoom').selectOption('1');check(await q('Before').evaluate(canvas=>Math.abs(canvas.getBoundingClientRect().width-canvas.width)<1),'Preview supports native-pixel zoom');await q('Zoom').selectOption('2');check(await q('Before').evaluate(canvas=>Math.abs(canvas.getBoundingClientRect().width-canvas.width*2)<1),'Preview supports 200% inspection');await q('Zoom').selectOption('fit');
 await q('Page').selectOption('1');await idle();check(await q('Before').evaluate(canvas=>canvas.width>canvas.height),'Rotated page preview uses PDF geometry');check(!await q('Export').isDisabled(),'Page navigation retains the reviewed list result');await q('Page').selectOption('2');await idle();check((await q('Selection').textContent()).includes('9'),'Page navigation retains every selected object');await q('Page').selectOption('0');await idle();
 for(const width of [1440,1024,390])for(const theme of ['light','dark'])for(const lang of ['zh','en']){
  await page.setViewportSize({width,height:900});await page.evaluate(({theme,lang})=>{window.pdfRemoveTest.theme(theme);window.pdfRemoveTest.lang(lang);},{theme,lang});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}/${theme}/${lang}: no horizontal page overflow`);check(await q('Objects').evaluate(node=>node.clientWidth>200),`${width}/${theme}/${lang}: readable object list`);await page.screenshot({path:path.join(root,`${width}-${theme}-${lang}.png`),fullPage:true});
  if(width===390){await q('JumpPreview').click();check(await q('PreviewTitle').evaluate(node=>document.activeElement===node),'Mobile preview jump retains keyboard focus');await q('JumpControls').click();check(await q('Pick').evaluate(node=>document.activeElement===node),'Mobile controls remain reachable');}
 }
 await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>window.pdfRemoveTest.lang('zh'));await page.evaluate(()=>window.pdfRemoveTest.holdWrite=true);await q('Export').click();await page.waitForFunction(()=>document.getElementById('pdfRemoveCancel').disabled);check(await page.evaluate(()=>window.pdfRemoveTest.controller.close())===false,'Native write publication vetoes close');check(await q('Cancel').isDisabled(),'Publication cannot be cancelled');await page.evaluate(()=>window.pdfRemoveTest.holdWrite=false);await idle();check((await notice()).includes('已保存')&&writes.length===1,'Native byte transport writes a real PDF');
 const exported=writes.at(-1);await run(path.resolve('src-tauri/resources/qpdf/qpdf.exe'),['--check',exported],{windowsHide:true});const poppler=process.env.TOOLKNIT_PDFTOPPM||'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1119-907-0_26.1119.907.0_x64__3k8sg7r9htsxt/dependencies/native/poppler/Library/bin/pdftoppm.exe';await run(poppler,['-r','96','-png',exported,path.join(root,'exported')],{windowsHide:true});for(let i=1;i<=3;i++){const expected=await sharp(`tmp/pdf-object-remove/baseline-${i}.png`).raw().toBuffer(),actual=await sharp(path.join(root,`exported-${i}.png`)).raw().toBuffer();check(actual.equals(expected),`Exported page ${i} independently matches the clean reference pixel for pixel`);}
 check((await extractedPages(exported)).every((text,index)=>text.includes(`Body page ${index+1}`)&&text.includes('Amounts:')&&!text.includes('FORM-MARK')&&(text.match(/DRAFT/g)||[]).length===1),'Output retains searchable body text and the legitimate DRAFT reference without active watermark text');
 await q('Folder').click();check(await page.evaluate(()=>window.pdfRemoveTest.calls.some(call=>call.command==='open_path'&&call.args.path.includes('outputs'))),'Reveal uses the actual returned output path');await page.evaluate(()=>window.pdfRemoveTest.failWrite=true);await q('Export').click();await idle();check((await notice()).includes('处理失败')&&!await q('Export').isDisabled(),'Write failure retains the reviewed bytes for retry');await page.evaluate(()=>window.pdfRemoveTest.failWrite=false);await q('Export').click();await idle();check(writes.length===2,'Failed save can be retried');check(await page.evaluate(()=>!JSON.stringify(window.pdfRemoveTest.center.list()).includes('DRAFT')&&!JSON.stringify(window.pdfRemoveTest.center.list()).includes('FORM-MARK')),'Task history does not persist document text or object labels');
 await load(path.join(root,'broken.pdf'));check((await notice()).includes('无法读取')&&await q('Page').locator('option').count()===3,'Malformed input preserves the existing session');await focus(text.id);await q('Inspect').click();await idle();check((await notice()).includes('单项预览'),'Worker restores the previous source after a failed new analysis');await load(path.join(root,'locked.pdf'));check((await notice()).includes('解密'),'Encrypted inputs give a decrypt-first message');await load(path.join(root,'many.pdf'));check((await notice()).includes('100 页'),'Page limit is enforced before rendering');
 await page.evaluate(async()=>{window.pdfRemoveTest.nativeSize=25*1024*1024;await window.pdfRemoveTest.controller.importFile({path:'C:/Synthetic/large.pdf',name:'large.pdf'});});await idle();check(!await page.evaluate(()=>window.pdfRemoveTest.calls.some(call=>call.command==='read_file_bytes_limited')),'Oversized native input is rejected before reading file bytes');
 await page.evaluate(async size=>{window.pdfRemoveTest.nativeSize=size;window.pdfRemoveTest.nativeUrl='/tmp/pdf-object-remove/source.pdf';await window.pdfRemoveTest.controller.importFile({path:'C:/Synthetic/source.pdf',name:'source.pdf'});},source.length);await idle();check(await q('Objects').locator('option').count()===first.length,'Bounded native import uses actual synthetic PDF bytes');
 await load(path.resolve('tmp/pdf-object-remove/unsupported.pdf'));await q('Page').selectOption('1');await idle();check((await q('PageNote').textContent()).includes('内联图像')&&await q('Inspect').isDisabled(),'Inline-image pages explain why selection is unavailable');await q('Page').selectOption('3');await idle();check((await q('PageNote').textContent()).includes('压缩')&&await q('Before').isVisible(),'Unsupported filters retain a real original-page preview');await q('Page').selectOption('6');await idle();check(await q('Objects').locator('option').count()===1,'Other supported pages remain editable');
 for(const [encoding,name,folder='tmp/pdf-object-remove',reference='tmp/pdf-object-remove/inline-expected'] of [
  ['Raw','inline'],['ASCIIHex','inline-hex'],['ASCII85','inline-ascii85'],['Flate','inline-flate'],
  ['ASCIIHex and Flate','inline-hex-flate'],['ASCII85 and Flate','inline-ascii85-flate'],
  ['TIFF 8-bit and ASCIIHex','tiff2-hex-flate','tmp/pdf-inline-predictor'],
  ['PNG Paeth','png14-flate','tmp/pdf-inline-predictor'],
  ['PNG adaptive and ASCII85','png15-ascii85-flate','tmp/pdf-inline-predictor'],
  ['TIFF Gray 1-bit','tiff2-G-1-flate','tmp/pdf-inline-depths','tmp/pdf-inline-depths/G-1-reference-expected'],
  ['TIFF RGB 2-bit','tiff2-RGB-2-hex-flate','tmp/pdf-inline-depths','tmp/pdf-inline-depths/RGB-2-reference-expected'],
  ['TIFF CMYK 4-bit','tiff2-CMYK-4-ascii85-flate','tmp/pdf-inline-depths','tmp/pdf-inline-depths/CMYK-4-reference-expected'],
  ['PNG CMYK 16-bit','png15-CMYK-16-ascii85-flate','tmp/pdf-inline-depths','tmp/pdf-inline-depths/CMYK-16-reference-expected'],
  ['Raw RGB 16-bit','plain-RGB-16-raw','tmp/pdf-inline-depths','tmp/pdf-inline-depths/RGB-16-reference-expected'],
  ['RunLength','RGB-8-runlength','tmp/pdf-run-length','tmp/pdf-run-length/RGB-8-reference-expected'],
  ['ASCIIHex and RunLength','RGB-8-hex-runlength','tmp/pdf-run-length','tmp/pdf-run-length/RGB-8-reference-expected'],
  ['ASCII85 and RunLength','RGB-8-ascii85-runlength','tmp/pdf-run-length','tmp/pdf-run-length/RGB-8-reference-expected'],
  ...[0,1].flatMap(early=>['lzw','hex-lzw','ascii85-lzw'].map(encoding=>[
   `LZW EC${early} ${encoding}`,`RGB-8-ec${early}-${encoding}`,'tmp/pdf-lzw','tmp/pdf-lzw/RGB-8-reference-expected',
  ])),
  ['LZW long EC0','long-ec0-lzw','tmp/pdf-lzw','tmp/pdf-lzw/long-G-8-reference-expected'],
  ['LZW long EC1 ASCII85','long-ec1-ascii85-lzw','tmp/pdf-lzw','tmp/pdf-lzw/long-G-8-reference-expected'],
  ['LZW TIFF EC0','p2-ec0-lzw','tmp/pdf-lzw-predictor','tmp/pdf-lzw-predictor/RGB-8-reference-expected'],
  ['LZW TIFF EC1 ASCIIHex','p2-ec1-hex-lzw','tmp/pdf-lzw-predictor','tmp/pdf-lzw-predictor/RGB-8-reference-expected'],
  ['LZW PNG Paeth EC0 ASCII85','p14-ec0-ascii85-lzw','tmp/pdf-lzw-predictor','tmp/pdf-lzw-predictor/RGB-8-reference-expected'],
  ['LZW PNG adaptive EC1','p15-ec1-lzw','tmp/pdf-lzw-predictor','tmp/pdf-lzw-predictor/RGB-8-reference-expected'],
  ['LZW PNG long EC0 ASCII85','long-p15-ec0-ascii85-lzw','tmp/pdf-lzw-predictor','tmp/pdf-lzw-predictor/long-G-8-reference-expected'],
  ['LZW PNG CMYK16','depth-p15-CMYK-16-ec0-ascii85-lzw','tmp/pdf-lzw-predictor','tmp/pdf-lzw-predictor/CMYK-16-reference-expected'],
  ['LZW TIFF Gray1','depth-p2-G-1-ec0-lzw','tmp/pdf-lzw-predictor','tmp/pdf-lzw-predictor/G-1-reference-expected'],
 ]){
  await load(path.resolve(`${folder}/${name}-source.pdf`));
  const inlineOptions=q('Objects').locator('option').filter({hasText:'内联图像'});
  check(await inlineOptions.count()===3,`${encoding}: worker lists three inline drawing units`);
  await focus(await inlineOptions.last().getAttribute('value'));
  await q('Inspect').click();await idle();
  check(await q('Difference').isVisible()&&await q('Export').isDisabled(),`${encoding}: PDF.js previews actual inline removal and keeps single inspection separate from export`);
  await q('Match').click();
  check((await q('Selection').textContent()).includes('2'),`${encoding}: cross-page matching keeps different data and placements`);
  await preview();await q('Export').click();await idle();
  const inlineOutput=writes.at(-1);
  check((await extractedPages(inlineOutput)).every(value=>value.includes('Body after inline images')),`${encoding}: output retains the searchable body text`);
  await run(poppler,['-r','96','-png',inlineOutput,path.join(root,`${name}-export`)],{windowsHide:true});
  for(let i=1;i<=2;i++){
   const actual=await sharp(path.join(root,`${name}-export-${i}.png`)).raw().toBuffer();
   const expected=await sharp(`${reference}-${i}.png`).raw().toBuffer();
   check(actual.equals(expected),`${encoding}: browser export page ${i} matches the independently rendered reference`);
  }
 }
 await load(path.resolve('tmp/pdf-object-remove/inline-flate-mixed.pdf'));
 check((await q('PageNote').textContent()).includes('内联图像')&&await q('Inspect').isDisabled(),'Browser worker rejects trailing bytes after the zlib stream');
 await q('Page').selectOption('1');await idle();
 check(await q('Objects').locator('option').count()===1&&!await q('Inspect').isDisabled(),'The valid Flate image on the next page is still editable');
 await load(path.resolve('tmp/pdf-inline-predictor/mixed.pdf'));
 check((await q('PageNote').textContent()).includes('内联图像')&&await q('Inspect').isDisabled(),'Invalid PNG row tags preserve the original page and explain the unsupported image');
 await q('Page').selectOption('1');await idle();
 check(await q('Objects').locator('option').count()===1&&!await q('Inspect').isDisabled(),'A valid PNG predicted image on another page is still editable');
 await load(path.resolve('tmp/pdf-inline-depths/ambiguous-bpc-source.pdf'));
 check((await q('PageNote').textContent()).includes('内联图像')&&await q('Inspect').isDisabled(),'Ambiguous packed BPC parameters remain read-only in the browser worker');
 await load(path.resolve('tmp/pdf-inline-depths/tiff16-probe-source.pdf'));
 check((await q('PageNote').textContent()).includes('内联图像')&&await q('Inspect').isDisabled(),'TIFF 16-bit reader disagreement keeps its page read-only in the browser worker');
 await load(path.resolve('tmp/pdf-run-length/mixed.pdf'));
 check((await q('PageNote').textContent()).includes('内联图像')&&await q('Inspect').isDisabled(),'RunLength data after EOD keeps the original page read-only');
 await q('Page').selectOption('1');await idle();
 check(await q('Objects').locator('option').count()===1&&!await q('Inspect').isDisabled(),'A valid RunLength image on the adjacent page remains editable');
 await load(path.resolve('tmp/pdf-run-length/page-source.pdf'));
 const runTarget=q('Objects').locator('option').filter({hasText:'RUN LENGTH DRAFT'});
 check(await runTarget.count()===1,'Worker lists the watermark in a RunLength page stream');
 await focus(await runTarget.getAttribute('value'));await q('Match').click();
 check((await q('Selection').textContent()).includes('3'),'Matching spans RunLength and both ASCII-wrapped page streams');
 await q('Page').selectOption('2');await idle();await preview();
 check(await q('Difference').isVisible()&&!await q('Export').isDisabled(),'PDF.js previews the edited ASCII85/RunLength page');
 await q('Export').click();await idle();
 const runPageOutput=writes.at(-1),runPageText=await extractedPages(runPageOutput);
 check(runPageText.length===3&&runPageText.every(value=>value.includes('RunLength searchable body')&&!value.includes('RUN LENGTH DRAFT')),'RunLength page export retains all searchable body text');
 await run(poppler,['-r','96','-png',runPageOutput,path.join(root,'runlength-page-export')],{windowsHide:true});
 for(let i=1;i<=3;i++)check((await sharp(path.join(root,`runlength-page-export-${i}.png`)).raw().toBuffer()).equals(await sharp(`tmp/pdf-run-length/page-expected-${i}.png`).raw().toBuffer()),`RunLength browser page export ${i} matches the clean reference`);
 await load(path.resolve('tmp/pdf-run-length/form-source.pdf'));
 const runFormTarget=q('Objects').locator('option').filter({hasText:'RUN LENGTH FORM'});
 check(await runFormTarget.count()===2,'Worker lists two distinct invocations inside shared RunLength Forms');
 await focus(await runFormTarget.first().getAttribute('value'));await q('Match').click();
 check((await q('Selection').textContent()).includes('2'),'Nested RunLength matching keeps differently placed and repeated calls');
 await preview();check(await q('Difference').isVisible(),'PDF.js previews isolated edits in RunLength Forms');
 await q('Export').click();await idle();
 const runFormOutput=writes.at(-1),runFormText=await extractedPages(runFormOutput);
 check((runFormText.join(' ').match(/RUN LENGTH FORM/g)||[]).length===4&&runFormText.every(value=>value.includes('RunLength page body')&&value.includes('RunLength form body')),'Nested RunLength export retains four unselected marks and all body text');
 await run(poppler,['-r','96','-png',runFormOutput,path.join(root,'runlength-form-export')],{windowsHide:true});
 for(let i=1;i<=3;i++)check((await sharp(path.join(root,`runlength-form-export-${i}.png`)).raw().toBuffer()).equals(await sharp(`tmp/pdf-run-length/form-expected-${i}.png`).raw().toBuffer()),`RunLength browser Form export ${i} matches the clean reference`);
 await load(path.resolve('tmp/pdf-lzw/mixed.pdf'));
 check((await q('PageNote').textContent()).includes('内联图像')&&await q('Inspect').isDisabled(),'LZW trailing data keeps its original page read-only');
 await q('Page').selectOption('1');await idle();
 check(await q('Objects').locator('option').count()===1&&!await q('Inspect').isDisabled(),'Valid LZW image on an adjacent page remains editable');
 await load(path.resolve('tmp/pdf-lzw/page-source.pdf'));
 const lzwTarget=q('Objects').locator('option').filter({hasText:'LZW DRAFT'});
 check(await lzwTarget.count()===1,'Worker lists a watermark after long LZW dictionary-switch comment data');
 await focus(await lzwTarget.getAttribute('value'));await q('Match').click();
 check((await q('Selection').textContent()).includes('6'),'Matching spans both EarlyChange settings and all three LZW page encodings');
 await q('Page').selectOption('2');await idle();await preview();
 check(await q('Difference').isVisible()&&!await q('Export').isDisabled(),'PDF.js previews an edited long EarlyChange=0 ASCII85/LZW page');
 await q('Export').click();await idle();
 const lzwPageOutput=writes.at(-1),lzwPageText=await extractedPages(lzwPageOutput);
 check(lzwPageText.length===6&&lzwPageText.every(value=>value.includes('LZW searchable body')&&!value.includes('LZW DRAFT')),'LZW page output retains all six searchable body pages');
 await run(poppler,['-r','96','-png',lzwPageOutput,path.join(root,'lzw-page-export')],{windowsHide:true});
 for(let i=1;i<=6;i++)check((await sharp(path.join(root,`lzw-page-export-${i}.png`)).raw().toBuffer()).equals(await sharp(`tmp/pdf-lzw/page-expected-${i}.png`).raw().toBuffer()),`LZW browser page export ${i} matches the clean reference`);
 await load(path.resolve('tmp/pdf-lzw/form-source.pdf'));
 const lzwFormTarget=q('Objects').locator('option').filter({hasText:/\bLZW FORM$/});
 check(await lzwFormTarget.count()===2,'Worker lists separate nested LZW Form invocations');
 await focus(await lzwFormTarget.first().getAttribute('value'));await q('Match').click();
 check((await q('Selection').textContent()).includes('2'),'LZW Form matching isolates two selected invocations');
 await preview();check(await q('Difference').isVisible(),'PDF.js previews nested Form edits with mixed EarlyChange settings');
 await q('Export').click();await idle();
 const lzwFormOutput=writes.at(-1),lzwFormText=await extractedPages(lzwFormOutput);
 check((lzwFormText.join(' ').match(/LZW FORM/g)||[]).length===4&&lzwFormText.every(value=>value.includes('LZW page body')&&value.includes('LZW form body')),'LZW Form output retains four other marks and all body text');
 await run(poppler,['-r','96','-png',lzwFormOutput,path.join(root,'lzw-form-export')],{windowsHide:true});
 for(let i=1;i<=3;i++)check((await sharp(path.join(root,`lzw-form-export-${i}.png`)).raw().toBuffer()).equals(await sharp(`tmp/pdf-lzw/form-expected-${i}.png`).raw().toBuffer()),`LZW browser Form export ${i} matches the clean reference`);
 await load(path.resolve('tmp/pdf-lzw-predictor/mixed.pdf'));
 check((await q('PageNote').textContent()).includes('内联图像')&&await q('Inspect').isDisabled(),'Invalid LZW PNG row tags keep the source page read-only');
 await q('Page').selectOption('1');await idle();
 check(await q('Objects').locator('option').count()===1&&!await q('Inspect').isDisabled(),'Valid LZW predicted image on the next page remains editable');
 for(const name of ['form-p2-ec1','form-p15-ec0']){
  await load(path.resolve(`tmp/pdf-lzw-predictor/${name}-source.pdf`));
  const nestedImages=q('Objects').locator('option').filter({hasText:'内联图像'});
  check(await nestedImages.count()===2,`${name}: worker lists predicted images inside two nested Form calls`);
  await focus(await nestedImages.first().getAttribute('value'));await q('Inspect').click();await idle();
  check(await q('Difference').isVisible(),`${name}: PDF.js locates the actual predicted image change`);
  await q('Match').click();check((await q('Selection').textContent()).includes('2'),`${name}: matching isolates two calls across pages`);
  await preview();await q('Export').click();await idle();
  const result=writes.at(-1),texts=await extractedPages(result);
  check((texts.join(' ').match(/NESTED DRAFT/g)||[]).length===6&&texts.every(value=>value.includes('Shared form text')&&value.includes('Page text')),`${name}: image removal preserves all nested text and page bodies`);
  await run(poppler,['-r','96','-png',result,path.join(root,`${name}-export`)],{windowsHide:true});
  for(let i=1;i<=3;i++)check((await sharp(path.join(root,`${name}-export-${i}.png`)).raw().toBuffer()).equals(await sharp(`tmp/pdf-lzw-predictor/${name}-expected-${i}.png`).raw().toBuffer()),`${name}: browser export page ${i} matches its clean reference`);
 }
 await load(path.resolve('tmp/pdf-content-predictor/source.pdf'));
 const predictedMark=q('Objects').locator('option').filter({hasText:'PREDICTED CONTENT MARK'});
 check(await predictedMark.count()===1,'Worker lists the mark from a TIFF predicted drawing stream');
 await focus(await predictedMark.getAttribute('value'));
 await q('Match').click();
 check((await q('Selection').textContent()).includes('6'),'Predicted page marks match across six pages regardless of compression');
 await q('Page').selectOption('6');await idle();
 check(await predictedMark.count()===1,'Worker also lists the mark inside the predicted Form');
 await focus(await predictedMark.getAttribute('value'));await q('Mark').click();
 await preview();
 check(await q('Difference').isVisible()&&!await q('Export').isDisabled(),'PDF.js previews removal from a predicted Form drawing stream');
 await q('Export').click();await idle();
 const predictedOutput=writes.at(-1),predictedText=await extractedPages(predictedOutput);
 check(predictedText.length===7&&predictedText.every(value=>value.includes('Predictor retained body')&&!value.includes('PREDICTED CONTENT MARK'))&&predictedText[6].includes('Form retained body'),'Predicted stream export keeps all page and Form body text');
 await run(poppler,['-r','96','-png',predictedOutput,path.join(root,'predicted-content-export')],{windowsHide:true});
 for(let i=1;i<=7;i++)check((await sharp(path.join(root,`predicted-content-export-${i}.png`)).raw().toBuffer()).equals(await sharp(`tmp/pdf-content-predictor/clean-reference-${i}.png`).raw().toBuffer()),`Predicted content export page ${i} matches its clean reference`);
 await load(path.resolve('tmp/pdf-content-predictor/mixed.pdf'));
 check((await q('PageNote').textContent()).includes('内容流无法解码')&&await q('Inspect').isDisabled(),'Invalid predictor rows keep the original page read-only');
 await q('Page').selectOption('1');await idle();
 check(await predictedMark.count()===1,'A valid page after a broken predicted stream remains editable');
 for(const [space,fixture,knockout] of [
  ['DeviceRGB','tmp/pdf-transparency-group'],
  ['DeviceGray','tmp/pdf-transparency-group-colors/DeviceGray'],
  ['DeviceCMYK','tmp/pdf-transparency-group-colors/DeviceCMYK'],
  ...['DeviceRGB','DeviceGray','DeviceCMYK'].map(space=>[`${space} knockout`,`tmp/pdf-transparency-group-knockout/${space}`,true]),
 ]){
  const pagePixels=()=>q('Before').evaluate(canvas=>canvas.toDataURL());
  let controlPixels;
  if(knockout){
   await load(path.resolve(fixture,'without-knockout.pdf'));
   assert.ok(await q('Before').isVisible());
   controlPixels=await pagePixels();
  }
  await load(path.resolve(fixture,'source.pdf'));
  const groupTarget=q('Objects').locator('option').filter({hasText:'GROUP DRAFT'});
  check(await groupTarget.count()===2,`${space}: worker exposes both shared group calls`);
  if(knockout)check(await pagePixels()!==controlPixels,`${space}: browser preview distinguishes the knockout flag`);
  await focus(await groupTarget.first().getAttribute('value'));await q('Mark').click();
  await q('Page').selectOption('2');await idle();
  check(await groupTarget.count()===1,`${space}: worker exposes the target inside the nested call`);
  await focus(await groupTarget.getAttribute('value'));await q('Mark').click();
  await preview();
  check(await q('Difference').isVisible()&&!await q('Export').isDisabled(),`${space}: transparency group edit has a real preview and can be exported`);
  await q('Export').click();await idle();
  const groupOutput=writes.at(-1),groupText=await extractedPages(groupOutput);
  check(groupText.length===3&&groupText.every(text=>text.includes('Group retained text')&&text.includes('Page retained text'))&&
    groupText.map(text=>(text.match(/GROUP DRAFT/g)||[]).length).join(',')==='1,1,0',`${space}: only the chosen calls were changed`);
  const exportPrefix=path.join(root,`transparency-group-${space}-export`);
  await run(poppler,['-r','96','-png',groupOutput,exportPrefix],{windowsHide:true});
  for(let i=1;i<=3;i++)check((await sharp(`${exportPrefix}-${i}.png`).raw().toBuffer()).equals(await sharp(`${fixture}/reference-${i}.png`).raw().toBuffer()),`${space}: exported page ${i} matches the clean reference`);
 }
 for(const variant of ['backdrop','ordinary']){
  const backdropFixture=`tmp/pdf-transparency-group-${variant}`;
  await load(path.resolve(backdropFixture,'isolated-control.pdf'));
  const isolatedPixels=await q('Before').evaluate(canvas=>canvas.toDataURL());
  await load(path.resolve(backdropFixture,'source.pdf'));
  const backdropTarget=q('Objects').locator('option').filter({hasText:'BACKDROP DRAFT'});
  check(await backdropTarget.count()===2,`${variant}: worker exposes both non-isolated calls`);
  check(await q('Before').evaluate(canvas=>canvas.toDataURL())!==isolatedPixels,`${variant}: preview distinguishes the isolation control`);
  await focus(await backdropTarget.first().getAttribute('value'));await q('Match').click();
  check((await q('Selection').textContent()).includes('1'),`${variant}: exact match leaves other calls unselected`);
  await q('Page').selectOption('2');await idle();
  await focus(await backdropTarget.getAttribute('value'));await q('Mark').click();
  await preview();
  check(await q('Difference').isVisible()&&!await q('Export').isDisabled(),`${variant}: nested group edit can be previewed and exported`);
  await q('Export').click();await idle();
  const backdropOutput=writes.at(-1),backdropText=await extractedPages(backdropOutput);
  check(backdropText.length===3&&backdropText.every(text=>text.includes('Backdrop page body')&&text.includes('Backdrop group body'))&&
    backdropText.map(text=>(text.match(/BACKDROP DRAFT/g)||[]).length).join(',')==='1,1,0',`${variant}: export retains all unselected calls and body text`);
  const backdropPrefix=path.join(root,`transparency-${variant}-export`);
  await run(poppler,['-r','96','-png',backdropOutput,backdropPrefix],{windowsHide:true});
  for(let i=1;i<=3;i++)check((await sharp(`${backdropPrefix}-${i}.png`).raw().toBuffer()).equals(await sharp(`${backdropFixture}/reference-${i}.png`).raw().toBuffer()),`${variant}: export page ${i} matches the reference`);
 }
 await load(path.resolve('tmp/pdf-object-remove/filtered-source.pdf'));
 const filteredTarget=q('Objects').locator('option').filter({hasText:'FILTERED DRAFT'});
 check(await filteredTarget.count()===1,'Worker lists an object in an ASCII-encoded page stream');
 await focus(await filteredTarget.getAttribute('value'));
 await q('Match').click();
 check((await q('Selection').textContent()).includes('4'),'Exact matching spans four page stream filter variants');
 await q('Page').selectOption('3');await idle();
 await preview();
 check(await q('Difference').isVisible()&&!await q('Export').isDisabled(),'PDF.js shows the actual edited page when the original stream uses ASCII85 and Flate');
 await q('Export').click();await idle();
 const filteredOutput=writes.at(-1),filteredText=await extractedPages(filteredOutput);
 check(filteredText.length===4&&filteredText.every(value=>value.includes('Searchable filtered body')&&!value.includes('FILTERED DRAFT')),'All filter variants export searchable body text without the selected object');
 await run(poppler,['-r','96','-png',filteredOutput,path.join(root,'filtered-export')],{windowsHide:true});
 for(let i=1;i<=4;i++){
  const actual=await sharp(path.join(root,`filtered-export-${i}.png`)).raw().toBuffer();
  const expected=await sharp(`tmp/pdf-object-remove/filtered-expected-${i}.png`).raw().toBuffer();
  check(actual.equals(expected),`Filtered browser export page ${i} matches its rendered reference`);
 }
 await load(path.resolve('tmp/pdf-object-remove/stamp-source.pdf'));
 const stampOptions=q('Objects').locator('option').filter({hasText:'图章注释'});
 check(await stampOptions.count()===3,'Worker lists visible independent stamps with annotation numbers');
 await focus(await stampOptions.last().getAttribute('value'));
 await q('Inspect').click();await idle();
 check(await q('Difference').isVisible()&&await q('Export').isDisabled(),'PDF.js shows the actual stamp difference before it can be exported');
 await q('Match').click();
 check((await q('Selection').textContent()).includes('2'),'Exact stamp matching selects only two occurrences');
 await q('Page').selectOption('1');await idle();
 check((await q('PageNote').textContent()).includes('图章注释')&&(await q('PageNote').textContent()).includes('压缩')&&await stampOptions.count()===3,'Page with unsupported drawing content still exposes stamps and a partial status');
 await page.evaluate(()=>window.pdfRemoveTest.lang('en'));
 check((await q('PageNote').textContent()).includes('stamp annotations')&&(await q('Objects').textContent()).includes('Stamp annotation'),'English stamp and partial status are translated');
 await page.evaluate(()=>window.pdfRemoveTest.lang('zh'));
 await preview();
 check(await q('Difference').isVisible()&&!await q('Export').isDisabled(),'The actual preview also shows stamp removal on the page with an unsupported drawing filter');
 await q('Export').click();await idle();
 const stampOutput=writes.at(-1);
 check((await extractedPages(stampOutput)).every(value=>value.includes('Body on stamp page')),'Stamp removal keeps both pages searchable');
 await run(poppler,['-r','96','-png',stampOutput,path.join(root,'stamp-export')],{windowsHide:true});
 for(let i=1;i<=2;i++){
  const actual=await sharp(path.join(root,`stamp-export-${i}.png`)).raw().toBuffer();
  const expected=await sharp(`tmp/pdf-object-remove/stamp-expected-${i}.png`).raw().toBuffer();
  check(actual.equals(expected),`Stamp browser export page ${i} matches the independently rendered reference`);
 }
 await load(path.resolve('tmp/pdf-stamp-popup/source.pdf'));
 check(await stampOptions.count()===1,'Worker lists the stamp while its popup is part of the same selection');
 await focus(await stampOptions.getAttribute('value'));await q('Match').click();
 check((await q('Selection').textContent()).includes('1'),'Popup stamp matching stays on the current page');
 await preview();
 check(await q('Difference').isVisible()&&!await q('Export').isDisabled(),'Popup stamp removal renders a visible difference');
 await q('Export').click();await idle();
 const popupOutput=writes.at(-1);
 const popupPages=(await PDFDocument.load(await readFile(popupOutput))).getPages();
 const subtypes=page=>page.node.Annots().asArray().map(ref=>String(page.node.context.lookup(ref).get(PDFName.of('Subtype'))));
 check(subtypes(popupPages[0]).join(',')==='/Link'&&subtypes(popupPages[1]).join(',')==='/Popup,/Link,/Stamp','Export detaches both selected entries and keeps other page relationships');
 const popupPrefix=path.join(root,'stamp-popup-export');
 await run(poppler,['-r','96','-png',popupOutput,popupPrefix],{windowsHide:true});
 for(let i=1;i<=2;i++)check((await sharp(`${popupPrefix}-${i}.png`).raw().toBuffer()).equals(await sharp(`tmp/pdf-stamp-popup/reference-${i}.png`).raw().toBuffer()),`Popup stamp export page ${i} matches the reference`);
 await load(path.resolve('tmp/pdf-stamp-states/source.pdf'));
 check(await stampOptions.count()===1,'Worker lists the stamp with its explicitly selected appearance');
 await focus(await stampOptions.getAttribute('value'));await q('Match').click();
 check((await q('Selection').textContent()).includes('2'),'Exact matching selects only the matching appearance state');
 await preview();
 check(await q('Difference').isVisible()&&!await q('Export').isDisabled(),'PDF.js renders selected appearance removal before export');
 await q('Export').click();await idle();
 const statesOutput=writes.at(-1);
 const statesPages=(await PDFDocument.load(await readFile(statesOutput))).getPages();
 check(statesPages.map(page=>subtypes(page).join(',')).join(';')==='/Link;/Link;/Link,/Stamp;/Link,/Stamp;/Link,/Stamp','Export keeps links, other appearance states and direct appearances');
 const statesPrefix=path.join(root,'stamp-states-export');
 await run(poppler,['-r','96','-png',statesOutput,statesPrefix],{windowsHide:true});
 for(let i=1;i<=5;i++)check((await sharp(`${statesPrefix}-${i}.png`).raw().toBuffer()).equals(await sharp(`tmp/pdf-stamp-states/reference-${i}.png`).raw().toBuffer()),`Stateful stamp export page ${i} matches the reference`);
 await load(path.resolve('tmp/pdf-object-remove/nested-source.pdf'));
 const nestedOptions=q('Objects').locator('option').filter({hasText:'NESTED DRAFT'});
 check(await nestedOptions.count()===2&&(await nestedOptions.first().textContent()).includes('Form 内'),'Worker exposes the two nested Form occurrences separately');
 await focus(await nestedOptions.first().getAttribute('value'));
 await q('Inspect').click();await idle();
 check(await q('Difference').isVisible()&&await q('Export').isDisabled(),'Nested object has a real single-object preview');
 await page.evaluate(()=>window.pdfRemoveTest.lang('en'));
 check((await nestedOptions.first().textContent()).includes('In Form'),'Nested object label is translated');
 await page.evaluate(()=>window.pdfRemoveTest.lang('zh'));
 await q('Match').click();
 check((await q('Selection').textContent()).includes('2'),'Nested matching selects only the same invocation placement');
 await preview();await q('Export').click();await idle();
 const nestedOutput=writes.at(-1),nestedText=await extractedPages(nestedOutput);
 check(nestedText.every((value,index)=>value.includes(`Page text ${index+1}`)&&(value.match(/Shared form text/g)||[]).length===2)
  &&nestedText.map(value=>(value.match(/NESTED DRAFT/g)||[]).length).join(',')==='1,1,2','Nested export preserves searchable text and removes only the intended copies');
 await run(poppler,['-r','96','-png',nestedOutput,path.join(root,'nested-export')],{windowsHide:true});
 for(let i=1;i<=3;i++){
  const actual=await sharp(path.join(root,`nested-export-${i}.png`)).raw().toBuffer();
  const expected=await sharp(`tmp/pdf-object-remove/nested-expected-${i}.png`).raw().toBuffer();
  check(actual.equals(expected),`Nested browser export page ${i} matches its clean reference`);
 }
 await load(path.join(root,'chinese.pdf'));check((await q('Objects').textContent()).includes('字体编码'),'Encoded CJK fonts use an honest object label');await q('Objects').selectOption('0:1');await q('Inspect').click();await idle();check(await q('Difference').isVisible(),'Encoded Chinese watermark is visually locatable');await q('Mark').click();await preview();check(!await q('Export').isDisabled(),'Encoded Chinese text object can be removed and previewed');await q('Export').click();await idle();const chineseText=(await extractedPages(writes.at(-1))).join('').replace(/\s/g,'');check(chineseText.includes('中文正文2026')&&!chineseText.includes('内部水印'),'Export keeps searchable Chinese body text while removing Chinese watermark instructions');
 const beforeTerminations=await page.evaluate(()=>window.pdfRemoveTest.workers.filter(worker=>worker.terminated&&worker.url.includes('/pdf-object-remove/worker.js')).length);await q('FileInput').setInputFiles(path.join(root,'heavy.pdf'));await page.waitForFunction(()=>window.pdfRemoveTest.workers.some(worker=>worker.url.includes('/pdf-object-remove/worker.js')&&worker.pendingAction==='load'&&!worker.terminated));await q('Cancel').waitFor({state:'visible'});await q('Cancel').click();await idle();check((await notice()).includes('取消'),'Cancellation reports cancellation rather than a generic decode failure');check(await page.evaluate(()=>window.pdfRemoveTest.center.list()[0].state==='cancelled'),'Task Center records cancelled analysis correctly');check(await page.evaluate(count=>window.pdfRemoveTest.workers.filter(worker=>worker.terminated&&worker.url.includes('/pdf-object-remove/worker.js')).length>count,beforeTerminations),'Cancellation actually terminates the analysis worker');check(await q('Page').locator('option').count()===1,'Cancelled large analysis retains the existing Chinese session');
 await page.evaluate(()=>window.pdfRemoveTest.holdSize=true);const pending=page.evaluate(async()=>{window.pdfRemoveTest.nativeSize=100;await window.pdfRemoveTest.controller.importFile({path:'C:/Synthetic/late.pdf',name:'late.pdf'});});await q('Cancel').waitFor({state:'visible'});await page.evaluate(()=>{window.pdfRemoveTest.controller.close();window.pdfRemoveTest.controller.open();window.pdfRemoveTest.holdSize=false;});await pending;await idle();check(await q('Page').locator('option').count()===0&&await q('Before').isHidden(),'Late input response cannot fill a reopened session');
 await start('');await load();await focus(text.id);await q('Mark').click();await preview();const downloadPromise=page.waitForEvent('download');await q('Export').click();const download=await downloadPromise;await download.saveAs(path.join(root,'outputs','browser.pdf'));await idle();check((await PDFDocument.load(await readFile(path.join(root,'outputs','browser.pdf')))).getPageCount()===3,'Browser downloads a valid edited PDF');
 check(createHash('sha256').update(await readFile(path.join(root,'source.pdf'))).digest('hex')===originalHash,'Original input file hash stays unchanged');check(report.errors.length===0,'No unhandled browser errors');await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(`PDF object removal browser passed: ${report.checks.length} checks; real workers, actual PDF preview and independent output rendering.`);
}finally{await browser.close();await server.close();}
