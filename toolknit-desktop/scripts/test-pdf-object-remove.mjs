import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { inflateSync,deflateSync } from 'node:zlib';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { PDFDocument,PDFName,PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';
import { analyzeRemovalPdf,buildRemovalPdf } from '../src/features/pdf-object-remove/processor.js';
import { parsePdfInstructions,pdfLatin } from '../src/features/pdf-object-remove/lexer.js';
import { decodeRemovalStream,validateInlineImageSamples } from '../src/features/pdf-object-remove/content-stream.js';
import { REMOVE_LIMITS,removalPages,exactRemovalMatches,removalHistory,validateRemoveFile } from '../src/features/pdf-object-remove/core.js';
import { removalFixture,rawRemovalFixture,sharedRemovalFixture,unsupportedRemovalFixture,inlineRemovalFixture,stampRemovalFixture,nestedFormRemovalFixture,filteredContentFixture } from './lib/pdf-object-fixtures.mjs';
const run=promisify(execFile),root=path.resolve('tmp/pdf-object-remove');await mkdir(root,{recursive:true});const checks=[];const check=(value,label)=>{assert.ok(value,label);checks.push(label);};
function content(document,index){const page=document.getPage(index),contents=page.node.Contents(),refs=contents?.asArray?.()||[contents];return refs.map(ref=>{const stream=document.context.lookup(ref);const bytes=stream.getContents();try{return inflateSync(bytes).toString('latin1');}catch{return pdfLatin(bytes);}}).join('\n');}
const literal=new TextEncoder().encode('q % Q BT Tj\nBT /F0 12 Tf (Literal \\( q Q BT Do % text\\)) Tj [<514254> -20 (more)] TJ ET Q\n');const parsed=parsePdfInstructions(literal);check(parsed.filter(op=>op.name==='Tj').length===1&&parsed.filter(op=>op.name==='TJ').length===1,'Lexer preserves operators inside strings/comments as operands');
assert.throws(()=>parsePdfInstructions(new TextEncoder().encode('BI /W 1 ID abc EI')));assert.throws(()=>parsePdfInstructions(new TextEncoder().encode('(unterminated')));check(true,'Malformed literals and incomplete inline image dictionaries rejected');
const binaryHeader='BI /W 5 /H 2 /CS /G /BPC 1 ID\n';
const pixels=Buffer.concat([Buffer.from(binaryHeader),Buffer.from([0xff,0x00]),Buffer.from('\nEI\nq Q\n')]);
const inlineOps=parsePdfInstructions(pixels);
check(inlineOps[0].image.data.equals(Buffer.from([0xff,0x00]))&&inlineOps[1].name==='q','One-bit rows are individually padded and parsing resumes after the exact binary range');
for(const bytes of [
 Buffer.from('BI /W 2 /H 1 /BPC 8 /CS /RGB ID\nabc\nEI\n'),
 Buffer.from('BI /W 2 /H 1 /BPC 8 /CS /RGB ID\nEI abc\nEI\n'),
 Buffer.from('BI /W 1 /Width 1 /H 1 /BPC 8 /CS /G ID\na\nEI\n'),
])assert.throws(()=>parsePdfInstructions(bytes),/pdf-remove:inline/);
assert.throws(()=>parsePdfInstructions(pixels,{streamEnds:[binaryHeader.length+1,pixels.length]}),/pdf-remove:inline/);
check(true,'Truncated, ambiguous, duplicate-key and split-stream inline images are refused');
const asciiImage=(width,filter,data,tail='\nEI\nq Q\n')=>Buffer.from(`BI /W ${width} /H 1 /CS /G /BPC 8 /F ${filter} ID\n${data}${tail}`);
for(const [width,filter,data,encoding] of [
 [2,'/AHx','0 a 1>','ASCIIHexDecode'],
 [4,'/A85','EI !!!~>','ASCII85Decode'],
 [5,'[/ASCII85Decode]','z !!~>','ASCII85Decode'],
]){
 const ops=parsePdfInstructions(asciiImage(width,filter,data));
 assert.equal(ops[0].image.encoding,encoding);
 assert.equal(ops[0].image.data.toString(),data);
 assert.equal(ops[1].name,'q');
}
check(true,'ASCII inline parsing handles hex nibble padding, ASCII85 zero groups, partial tuples and embedded EI text');
for(const input of [
 asciiImage(2,'/AHx','aa>'), asciiImage(1,'/AHx','00 11>'),
 asciiImage(1,'/AHx','00'), asciiImage(1,'/AHx','G0>'),
 asciiImage(4,'/A85','z'), asciiImage(4,'/A85','uuuuu~>'),
 asciiImage(4,'/A85','!!!z!!~>'), asciiImage(4,'/A85','z !~>'),
 asciiImage(4,'/A85','zz~>'), asciiImage(1,'[/AHx /DCT]','00>'),
 asciiImage(1,'[/Fl /AHx]','00>'), asciiImage(1,'[/AHx /Fl /Fl]','00>'),
 asciiImage(1,'/AHx','00>','\nBT EI\n'),
])assert.throws(()=>parsePdfInstructions(input),/pdf-remove:inline/);
const asciiSplit=asciiImage(4,'/A85','z~>');
assert.throws(()=>parsePdfInstructions(asciiSplit,{streamEnds:[asciiSplit.indexOf('~')+1,asciiSplit.length]}),/pdf-remove:inline/);
check(true,'ASCII inline parsing rejects bad lengths, tuples, terminators, filter chains and split data');
const {context}=await PDFDocument.create();
const hexName=PDFName.of('ASCIIHexDecode'), ascii85Name=PDFName.of('ASCII85Decode'), flateName=PDFName.of('FlateDecode');
const filteredStream=(dict,bytes)=>PDFRawStream.of(context.obj(dict),Buffer.from(bytes));
const packed=deflateSync(Buffer.from('q Q\n'));
const binaryImage=(width,data,filter='/Fl')=>Buffer.concat([
 Buffer.from(`BI /W ${width} /H 1 /CS /G /BPC 8 /F ${filter} ID\n`),data,Buffer.from('\nEI\nq Q\n'),
]);
const flateInline=(width,data)=>parsePdfInstructions(asciiImage(width,'[/AHx /Fl]',data.toString('hex')+'>'));
const flateInstructions=flateInline(4,packed);
const inlineBudget={bytes:0};
await validateInlineImageSamples(flateInstructions,context,inlineBudget);
check(flateInstructions[0].image.encoding==='ASCIIHexDecode/FlateDecode'&&inlineBudget.bytes===packed.length+4,
 'Inline Flate validation counts both decoded stages and recognizes the complete image');
for(const [width,data] of [[4,Buffer.from([0,1,2])],[4,packed.subarray(0,-1)],[4,Buffer.concat([packed,Buffer.from([0])])],[3,packed],[5,packed]]){
 await assert.rejects(()=>validateInlineImageSamples(flateInline(width,data),context,{bytes:0}),/pdf-remove:inline/);
}
await assert.rejects(()=>validateInlineImageSamples(flateInstructions,context,{bytes:REMOVE_LIMITS.decodedBytes-packed.length-3}),/pdf-remove:decoded/);
check(true,'Inline Flate rejects invalid, truncated, trailing and wrong-length output and enforces budget');
const stored=deflateSync(Buffer.from('aEIx'),{level:0});
for(const filter of ['/Fl','/FlateDecode','[/FlateDecode]']){
 const instructions=parsePdfInstructions(binaryImage(4,stored,filter));
 const budget={bytes:0};
 await validateInlineImageSamples(instructions,context,budget);
 assert.equal(instructions[0].image.encoding,'FlateDecode');
 assert.deepEqual(instructions[0].image.data,stored);
 assert.equal(instructions[1].name,'q');
 assert.equal(budget.bytes,4);
}
check(stored.includes('EI'),'Single Flate accepts aliases and counts samples, with a non-marker EI in the compressed data');
const ambiguous=Buffer.from('xEI Q\n1234567890abcdef');
assert.throws(()=>parsePdfInstructions(binaryImage(ambiguous.length,deflateSync(ambiguous,{level:0}))),/pdf-remove:inline/);
const splitBinary=binaryImage(4,packed);
for(const end of [splitBinary.indexOf('ID\n')+4,splitBinary.lastIndexOf('EI\n')+2]){
 assert.throws(()=>parsePdfInstructions(splitBinary,{streamEnds:[end,splitBinary.length]}),/pdf-remove:inline/);
}
check(true,'Single Flate rejects an early apparent EI and an EI or separator in another stream');
const badChecksum=Buffer.from(packed);badChecksum[badChecksum.length-1]^=1;
const trailing=Buffer.concat([packed,Buffer.from([0])]);
for(const [width,data] of [[4,badChecksum],[4,packed.subarray(0,-1)],[4,trailing],[3,packed],[5,packed]]){
 await assert.rejects(()=>validateInlineImageSamples(parsePdfInstructions(binaryImage(width,data)),context,{bytes:0}),/pdf-remove:inline/);
}
await assert.rejects(()=>validateInlineImageSamples(parsePdfInstructions(binaryImage(4,packed)),context,{bytes:REMOVE_LIMITS.decodedBytes-3}),/pdf-remove:decoded/);
check(true,'Single Flate rejects checksum errors, truncation, trailing bytes and wrong sample counts, and respects the budget');
for(const [kind,mixedStreams] of [
 ['chained',[asciiImage(4,'[/AHx /Fl]','001122>'),asciiImage(4,'[/AHx /Fl]',packed.toString('hex')+'>')]],
 ['single Flate',[binaryImage(4,trailing),binaryImage(4,packed)]],
]){
const mixedInline=await PDFDocument.create();
for(const bytes of mixedStreams){
 const page=mixedInline.addPage([100,100]);
 page.node.set(PDFName.of('Contents'),mixedInline.context.register(mixedInline.context.flateStream(bytes)));
}
const mixedSource=await mixedInline.save();
if(kind==='single Flate')await writeFile(path.join(root,'inline-flate-mixed.pdf'),mixedSource);
const mixedAnalysis=await analyzeRemovalPdf(mixedSource);
assert.deepEqual(mixedAnalysis.summary.pages.map(page=>[page.reason,page.count]),[['inline',0],[null,1]]);
const mixedExport=await PDFDocument.load(await buildRemovalPdf(mixedAnalysis,[mixedAnalysis.candidates[0].id]));
check(content(mixedExport,0)===mixedStreams[0].toString('latin1')&&!content(mixedExport,1).includes('BI'),
 `${kind}: a broken image keeps its original page while a valid image on another page can be removed`);
}
const chain={Filter:[hexName,flateName],DecodeParms:[null,{Predictor:1}]};
const chained=filteredStream(chain,packed.toString('hex')+'>');
const budget={bytes:0};
check(Buffer.from(await decodeRemovalStream(chained,budget)).toString()==='q Q\n'
 &&budget.bytes===packed.length+4,'Each stage of an ASCII and Flate chain is counted in the decoding budget');
await assert.rejects(()=>decodeRemovalStream(chained,{bytes:REMOVE_LIMITS.decodedBytes-packed.length-3}),/pdf-remove:decoded/);
await assert.rejects(()=>decodeRemovalStream(filteredStream({Filter:ascii85Name},'zz~>'),{bytes:REMOVE_LIMITS.decodedBytes-4}),/pdf-remove:decoded/);
check(true,'ASCII and Flate stages enforce the remaining budget independently');
for(const dict of [
 {Filter:[flateName,hexName]},
 {Filter:[hexName,flateName,flateName]},
 {Filter:[hexName,flateName],DecodeParms:[null]},
 {Filter:[hexName,flateName],DecodeParms:[{},null]},
 {Filter:flateName,DecodeParms:{Predictor:PDFName.of('None')}},
 {Filter:flateName,DecodeParms:{Predictor:12,Colors:5}},
])await assert.rejects(()=>decodeRemovalStream(filteredStream(dict,'00>'),{bytes:0}),/pdf-remove:filter/);
check(true,'Unsupported filter orders, malformed parameter arrays and predictors are rejected');
for(const [dict,data] of [[{Filter:hexName},'12'],[{Filter:ascii85Name},'z~>junk'],[chain,'001122>']]){
 await assert.rejects(()=>decodeRemovalStream(filteredStream(dict,data),{bytes:0}),/pdf-remove:stream/);
}
check(true,'Malformed ASCII and invalid inner Flate data are rejected');
for(const file of [{name:'a.txt',size:1},{name:'a.pdf',size:0},{name:'a.pdf',size:REMOVE_LIMITS.inputBytes+1}])assert.throws(()=>validateRemoveFile(file));assert.deepEqual([...removalPages('1, 3-4',4)],[0,2,3]);assert.throws(()=>removalPages('4-2',4));
const source=await removalFixture(),baseline=await removalFixture(false);await writeFile(path.join(root,'source.pdf'),source);await writeFile(path.join(root,'baseline.pdf'),baseline);
const analysis=await analyzeRemovalPdf(source);check(analysis.summary.pages.every(page=>!page.reason),'Ordinary text/image/Form content streams are supported');
await writeFile(path.join(root,'analysis.json'),JSON.stringify(analysis.summary,null,2));
const first=analysis.candidates.filter(item=>item.pageIndex===0),text=first.filter(item=>item.label==='DRAFT').at(-1),image=first.filter(item=>item.kind==='image').at(-1),form=first.find(item=>item.kind==='text-form');check(!!text&&!!image&&form?.label==='FORM-MARK','Independent text, reused image invocation and simple Form detected');
const removals=[text,image,form].flatMap(item=>exactRemovalMatches(analysis.candidates,item,removalPages('',3)));check(removals.length===9,'Exact matching finds three watermark instances of each type');check(!removals.includes(first.find(item=>item.label==='DRAFT').id),'Same text in another location is not matched');check(!removals.includes(first.find(item=>item.kind==='image').id),'Shared image used as a body logo is not matched');
const output=await buildRemovalPdf(analysis,removals);await writeFile(path.join(root,'removed.pdf'),output);const reopened=await PDFDocument.load(output),original=await PDFDocument.load(source);check(reopened.getPageCount()===3,'Output retains page count');
for(let i=0;i<3;i++){assert.deepEqual(reopened.getPage(i).getCropBox(),original.getPage(i).getCropBox());assert.equal(reopened.getPage(i).getRotation().angle,original.getPage(i).getRotation().angle);const ops=parsePdfInstructions(new Uint8Array(Buffer.from(content(reopened,i),'latin1')));check(ops.filter(op=>op.name==='Tj').length===4,`Page ${i+1}: body text remains while watermark show operation is removed`);check(ops.filter(op=>op.name==='Do').length===1,`Page ${i+1}: legitimate shared logo remains after stamp and Form removal`);}
const raw=await rawRemovalFixture();await writeFile(path.join(root,'state-source.pdf'),raw.source);await writeFile(path.join(root,'state-expected.pdf'),raw.expected);const rawAnalysis=await analyzeRemovalPdf(raw.source),stateObject=rawAnalysis.candidates.find(item=>item.label.includes('DRAFT_STATE')),rawOutput=await buildRemovalPdf(rawAnalysis,[stateObject.id]);await writeFile(path.join(root,'state-removed.pdf'),rawOutput);const rawText=content(await PDFDocument.load(rawOutput),0);check(rawText.includes('3 Tw')&&rawText.includes('7 Tc')&&!rawText.includes('DRAFT_STATE'),'Quote operators retain inherited spacing while removing their strings');
const inlineSource=await inlineRemovalFixture(),inlineBaseline=await inlineRemovalFixture(false);
const inlineAnalysis=await analyzeRemovalPdf(inlineSource);
const inlineImages=inlineAnalysis.candidates.filter(item=>item.kind==='inline-image'&&item.pageIndex===0);
check(inlineImages.length===3&&inlineImages.every(item=>item.width===2&&item.height===2),'Raw inline image candidates are listed with pixel dimensions');
const inlineIds=exactRemovalMatches(inlineAnalysis.candidates,inlineImages[2],removalPages('',2));
check(inlineIds.length===2&&!inlineIds.includes(inlineImages[0].id)&&!inlineIds.includes(inlineImages[1].id),'Inline matching normalizes dictionary aliases and respects position and sample bytes');
const inlineOutput=await buildRemovalPdf(inlineAnalysis,inlineIds);
for(const [name,data]of [['inline-source',inlineSource],['inline-expected',inlineBaseline],['inline-removed',inlineOutput]])await writeFile(path.join(root,name+'.pdf'),data);
const reopenedInline=await analyzeRemovalPdf(inlineOutput);
check(reopenedInline.summary.pages.every(page=>page.count===3&&!page.reason)
 &&reopenedInline.candidates.filter(item=>item.label==='Body after inline images').length===2,'Remaining inline images and text after binary data survive export');
for(const encoding of ['hex','ascii85','flate','hex-flate','ascii85-flate']){
 const bytes=await inlineRemovalFixture(true,encoding);
 const analyzed=await analyzeRemovalPdf(bytes);
 const images=analyzed.candidates.filter(item=>item.pageIndex===0&&item.kind==='inline-image');
 check(images.length===3&&analyzed.summary.pages.every(page=>!page.reason),`${encoding}: sample images are listed alongside body content`);
 const ids=exactRemovalMatches(analyzed.candidates,images[2],removalPages('',2));
 check(ids.length===2&&!ids.includes(images[0].id)&&!ids.includes(images[1].id),`${encoding}: filter aliases match without selecting other data or positions`);
 const result=await buildRemovalPdf(analyzed,ids);
 await writeFile(path.join(root,`inline-${encoding}-source.pdf`),bytes);
 await writeFile(path.join(root,`inline-${encoding}-removed.pdf`),result);
}
const stampSource=await stampRemovalFixture(),stampExpected=await stampRemovalFixture(false);
const stampAnalysis=await analyzeRemovalPdf(stampSource);
const stampCandidates=stampAnalysis.candidates.filter(item=>item.kind==='stamp');
check(stampCandidates.length===6&&stampCandidates.map(item=>item.annotationNumber).join(',')==='2,3,7,2,3,7','Independent stamps are selectable while linked, locked and non-stamp annotations are preserved');
check(stampAnalysis.summary.pages[1].reason==='filter'&&stampAnalysis.summary.pages[1].count===3,'Stamp analysis remains available on a page with an unsupported drawing filter');
const stampIds=exactRemovalMatches(stampCandidates,stampCandidates[2],removalPages('',2));
check(stampIds.length===2&&stampIds.every(id=>stampCandidates.find(item=>item.id===id).annotationNumber===7),'Matching selects the same stamp appearance and placement across pages');
const stampOutput=await buildRemovalPdf(stampAnalysis,stampIds);
for(const [name,data] of [['stamp-source',stampSource],['stamp-expected',stampExpected],['stamp-removed',stampOutput]])await writeFile(path.join(root,name+'.pdf'),data);
const stampBefore=await PDFDocument.load(stampSource),stampAfter=await PDFDocument.load(stampOutput);
for(let index=0;index<2;index++){
 const originalPage=stampBefore.getPage(index),outputPage=stampAfter.getPage(index);
 assert.deepEqual(outputPage.node.Annots().asArray().map(String), originalPage.node.Annots().asArray().slice(0,-1).map(String));
 assert.equal(String(outputPage.node.get(PDFName.of('Contents'))),String(originalPage.node.get(PDFName.of('Contents'))));
}
check(true,'Only selected annotation entries are detached; drawing streams, links, replies and other stamps remain');
const bothKinds=await PDFDocument.load(await buildRemovalPdf(stampAnalysis,[stampIds[0],stampAnalysis.candidates.find(item=>item.kind==='text').id]));
check(bothKinds.getPage(0).node.Annots().size()===6&&!content(bothKinds,0).includes('Body on stamp page 1')&&bothKinds.getPage(1).node.Annots().size()===7,'A single export supports stamp removal together with content edits while leaving other pages alone');
const sharedAnnots=await PDFDocument.load(stampSource);
sharedAnnots.getPage(1).node.set(PDFName.of('Annots'),sharedAnnots.getPage(0).node.get(PDFName.of('Annots')));
const sharedAnnotationAnalysis=await analyzeRemovalPdf(await sharedAnnots.save());
const changedShared=await PDFDocument.load(await buildRemovalPdf(sharedAnnotationAnalysis,[sharedAnnotationAnalysis.candidates.filter(item=>item.kind==='stamp')[2].id]));
check(changedShared.getPage(0).node.Annots().size()===6&&changedShared.getPage(1).node.Annots().size()===7,'Removing from a page does not mutate a shared annotation array');
const formSource=await nestedFormRemovalFixture();
const formAnalysis=await analyzeRemovalPdf(formSource);
const formTargets=formAnalysis.candidates.filter(item=>item.label==='NESTED DRAFT');
check(formTargets.length===6&&formTargets.every(item=>item.formDepth===2),'Nested Form content exposes distinct occurrences inside repeated invocations');
const nestedMatches=exactRemovalMatches(formAnalysis.candidates,formTargets[0],removalPages('',3));
check(nestedMatches.length===2&&nestedMatches[0]===formTargets[0].id&&nestedMatches[1]===formTargets[2].id,'Nested matching respects the callers and effective position');
const nestedSingle=await buildRemovalPdf(formAnalysis,[formTargets[0].id]);
const nestedMulti=await buildRemovalPdf(formAnalysis,nestedMatches);
const nestedAfter=await analyzeRemovalPdf(nestedSingle);
check(nestedAfter.candidates.filter(item=>item.label==='NESTED DRAFT').length===5&&nestedAfter.candidates.filter(item=>item.label==='Shared form text').length===6,'Only the selected nested text is removed; other Form occurrences remain');
const nestedImage=formAnalysis.candidates.find(item=>item.kind==='inline-image');
check(nestedImage?.formDepth===2,'Inline images within a nested invocation are independently selectable');
const nestedCombined=await buildRemovalPdf(formAnalysis,[formTargets[0].id,nestedImage.id]);
const combinedAfter=await analyzeRemovalPdf(nestedCombined);
check(combinedAfter.candidates.filter(item=>item.kind==='inline-image').length===5&&combinedAfter.candidates.filter(item=>item.label==='NESTED DRAFT').length===5,'Multiple edits to the same nested invocation survive the combined rewrite');
const [formBefore,formAfter]=await Promise.all([PDFDocument.load(formSource),PDFDocument.load(nestedSingle)]);
check([1,2].every(i=>String(formBefore.getPage(i).node.get(PDFName.of('Resources')))===String(formAfter.getPage(i).node.get(PDFName.of('Resources')))&&String(formBefore.getPage(i).node.get(PDFName.of('Contents')))===String(formAfter.getPage(i).node.get(PDFName.of('Contents')))),'Unedited pages keep their original shared resources and content references');
for(const [name,data] of [['nested-source',formSource],['nested-expected-one',await nestedFormRemovalFixture([0])],['nested-expected',await nestedFormRemovalFixture([0,1])],['nested-one',nestedSingle],['nested-removed',nestedMulti]])await writeFile(path.join(root,name+'.pdf'),data);
await writeFile(path.join(root,'nested-combined.pdf'),nestedCombined);
await writeFile(path.join(root,'nested-expected-combined.pdf'),await nestedFormRemovalFixture([0],[0]));
const shared=await analyzeRemovalPdf(await sharedRemovalFixture()),sharedOutput=await PDFDocument.load(await buildRemovalPdf(shared,[shared.candidates[0].id]));check(!content(sharedOutput,0).includes('SHARED_STAMP')&&content(sharedOutput,1).includes('SHARED_STAMP'),'Removing from one page never mutates a shared content stream on another page');
const repeatedPage=await PDFDocument.create(),repeatedLeaf=repeatedPage.addPage([200,200]),tree=repeatedPage.catalog.Pages();tree.Kids().push(repeatedLeaf.ref);tree.set(PDFName.of('Count'),repeatedPage.context.obj(2));await assert.rejects(async()=>analyzeRemovalPdf(await repeatedPage.save()),/pdf-remove:structure/);check(true,'Repeated page dictionaries are rejected before page-local rewrites');
const symbolDoc=await PDFDocument.create(),symbolFont=await symbolDoc.embedFont('Symbol');symbolDoc.addPage([100,100]).drawText('ΑΒ',{font:symbolFont,x:10,y:50});const symbolAnalysis=await analyzeRemovalPdf(await symbolDoc.save());check(symbolAnalysis.candidates[0].label==='','Symbol glyph codes are not mislabeled as Latin text');
const unsupported=await unsupportedRemovalFixture();await writeFile(path.join(root,'unsupported.pdf'),unsupported);const partial=await analyzeRemovalPdf(unsupported);check(partial.summary.pages[1].reason==='inline'&&partial.summary.pages[2].reason==='syntax'&&partial.summary.pages[3].reason==='filter','Unsupported inline, malformed and unsupported-filter pages explain their limits');check(partial.summary.pages[4].count===0&&partial.summary.pages[5].count===0,'Clipping text and external ActualText are not offered for glyph-only deletion');check(partial.summary.pages[6].count===1,'Artifact-marked text remains selectable');
const filteredSource=await filteredContentFixture();
const filteredAnalysis=await analyzeRemovalPdf(filteredSource);
const filteredTarget=filteredAnalysis.candidates.find(item=>item.label==='FILTERED DRAFT');
const filteredIds=exactRemovalMatches(filteredAnalysis.candidates,filteredTarget,removalPages('',4));
check(filteredAnalysis.summary.pages.every(page=>!page.reason&&page.count===2)&&filteredIds.length===4,'Four filter variants analyze together and match the same drawing operation');
const filteredOutput=await buildRemovalPdf(filteredAnalysis,filteredIds);
const filteredReopened=await analyzeRemovalPdf(filteredOutput);
check(filteredReopened.candidates.length===4&&filteredReopened.candidates.every(item=>item.label==='Searchable filtered body'),'Export keeps text after removing the target from each filter variant');
for(const [name,data] of [['filtered-source',filteredSource],['filtered-removed',filteredOutput],['filtered-expected',await filteredContentFixture(false)]]){
 await writeFile(path.join(root,name+'.pdf'),data);
}
const history=removalHistory();history.push(new Set(['a']));history.push(new Set(['a','b']));assert.deepEqual([...history.undo()],['a']);history.push(new Set(['c']));check(!history.canRedo,'Undo branch resets redo');
const bomb=await PDFDocument.create(),bombPage=bomb.addPage([100,100]);bombPage.node.set(PDFName.of('Contents'),bomb.context.register(PDFRawStream.of(bomb.context.obj({Filter:PDFName.of('FlateDecode')}),deflateSync(Buffer.alloc(REMOVE_LIMITS.streamBytes+1,32)))));
await assert.rejects(async()=>analyzeRemovalPdf(await bomb.save()),/pdf-remove:decoded/);check(true,'Content decompression exceeding 8 MiB is rejected');
if(process.platform==='win32'&&!process.env.TOOLKNIT_REMOVE_SKIP_NATIVE){
 const poppler=process.env.TOOLKNIT_PDFTOPPM||'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1119-907-0_26.1119.907.0_x64__3k8sg7r9htsxt/dependencies/native/poppler/Library/bin/pdftoppm.exe';
 const qpdf=path.resolve('src-tauri/resources/qpdf/qpdf.exe');for(const name of ['removed','state-removed','inline-removed','stamp-removed','nested-one','nested-removed'])await run(qpdf,['--check',path.join(root,name+'.pdf')],{windowsHide:true});
 for(const name of ['baseline','removed','state-expected','state-removed','inline-source','inline-expected','inline-removed','stamp-source','stamp-expected','stamp-removed','nested-expected-one','nested-expected','nested-one','nested-removed'])await run(poppler,['-r','96','-png',path.join(root,name+'.pdf'),path.join(root,name)],{windowsHide:true});
 for(const [a,b,count]of[['baseline','removed',3],['state-expected','state-removed',1],['inline-expected','inline-removed',2],['stamp-expected','stamp-removed',2],['nested-expected-one','nested-one',3],['nested-expected','nested-removed',3]])for(let i=1;i<=count;i++){const before=await sharp(path.join(root,`${a}-${i}.png`)).raw().toBuffer(),after=await sharp(path.join(root,`${b}-${i}.png`)).raw().toBuffer();check(before.equals(after),`Independent Poppler render: ${a} page ${i} matches the clean reference pixel for pixel`);}
 for(const name of ['nested-combined','nested-expected-combined'])await run(poppler,['-f','1','-l','1','-r','96','-png',path.join(root,name+'.pdf'),path.join(root,name)],{windowsHide:true});
 check((await sharp(path.join(root,'nested-combined-1.png')).raw().toBuffer()).equals(await sharp(path.join(root,'nested-expected-combined-1.png')).raw().toBuffer()),'Nested combined text and image removal matches the independent reference');
 check(!(await sharp(path.join(root,'inline-source-1.png')).raw().toBuffer()).equals(await sharp(path.join(root,'inline-removed-1.png')).raw().toBuffer()),'Inline removal changes visible pixels');
 for(const encoding of ['hex','ascii85','flate','hex-flate','ascii85-flate']){
  await run(qpdf,['--check',path.join(root,`inline-${encoding}-removed.pdf`)],{windowsHide:true});
  for(const [variant,reference] of [['source','inline-source'],['removed','inline-expected']]){
   const name=`inline-${encoding}-${variant}`;
   await run(poppler,['-r','96','-png',path.join(root,name+'.pdf'),path.join(root,name)],{windowsHide:true});
   for(let i=1;i<=2;i++){
    const actual=await sharp(path.join(root,`${name}-${i}.png`)).raw().toBuffer();
    const expected=await sharp(path.join(root,`${reference}-${i}.png`)).raw().toBuffer();
    check(actual.equals(expected),`Independent Poppler render: ${name} page ${i} matches the raw reference`);
   }
  }
 }
 await run(qpdf,['--check',path.join(root,'filtered-removed.pdf')],{windowsHide:true});
 for(const name of ['filtered-expected','filtered-removed']){
  await run(poppler,['-r','96','-png',path.join(root,name+'.pdf'),path.join(root,name)],{windowsHide:true});
 }
 for(let i=1;i<=4;i++){
  const actual=await sharp(path.join(root,`filtered-removed-${i}.png`)).raw().toBuffer();
  const expected=await sharp(path.join(root,`filtered-expected-${i}.png`)).raw().toBuffer();
  check(actual.equals(expected),`Filtered page ${i} matches the independent Poppler reference`);
 }
 check(!(await sharp(path.join(root,'stamp-source-1.png')).raw().toBuffer()).equals(await sharp(path.join(root,'stamp-removed-1.png')).raw().toBuffer()),'Stamp removal changes visible pixels');
 check(true,'Bundled qpdf accepts generated outputs');
}
await writeFile(path.join(root,'report.json'),JSON.stringify({checks},null,2));console.log(`PDF object removal core passed: ${checks.length} checks; actual drawing removal, shared resources, preserved state and independent rendering.`);
