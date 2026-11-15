import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { snapshotPage, snapshotFonts, renderPage } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { createGlyphEncodingDecoder } from '../src/features/pdf-to-word/adapters/glyph-encoding.js';
import { buildPageScene } from '../src/features/pdf-to-word/core/scene.js';
import { sceneLayoutBytes } from '../src/features/pdf-to-word/core/scene-budget.js';

const systemFont=path.join(process.env.WINDIR||'C:/Windows','Fonts','arial.ttf');
if(process.platform!=='win32'||!await access(systemFont).then(()=>true,()=>false)){
  console.log('Native encoding font match: Windows Arial fixture unavailable; target-device test skipped.');
}else{
  const original='Local 123., identity',pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(await readFile(systemFont),{subset:true}),page=pdf.addPage([400,250]);
  page.drawText(original,{x:30,y:180,size:12,font});
  page.drawText(' ',{x:30,y:140,size:12,font}); // A whole text draw can become whitespace after repair.
  const task=getDocument({data:await pdf.save(),fontExtraProperties:true,verbosity:0,
    standardFontDataUrl:'node_modules/pdfjs-dist/standard_fonts/',cMapUrl:'node_modules/pdfjs-dist/cmaps/',cMapPacked:true,wasmUrl:'node_modules/pdfjs-dist/wasm/'});
  try{
    const loaded=await task.promise,p=await loaded.getPage(1),canvas=createCanvas(1,1),op={optionalContentConfig:await loaded.getOptionalContentConfig({intent:'display'})};
    const snapshot=await snapshotPage(p,OPS,()=>{},op.optionalContentConfig);await renderPage(p,canvas,op);snapshot.fonts=snapshotFonts(p,snapshot.fontIds);
    const broken=structuredClone(snapshot);let index=0;
    for(const operation of broken.operations)if(operation.name==='showText')for(const glyph of operation.args[0])if(glyph?.unicode)glyph.unicode=String.fromCodePoint(1+(index++%31));
    broken.textCharacters=broken.operations.filter(operation=>operation.name==='showText').flatMap(operation=>operation.args[0]).filter(glyph=>glyph?.unicode)
      .reduce((sum,glyph)=>sum+glyph.unicode.replace(/\s/g,'').length,0);
    const decode=createGlyphEncodingDecoder(createCanvas),resolver=decode(broken);assert(resolver);
    const repaired=buildPageScene(broken,{resolveGlyph:resolver});assert(!repaired.rasterPage,'verified control-to-space repairs do not fake a missing-text failure');
    assert(repaired.sources.some(source=>source.text===original),'actual embedded glyphs recover the known text without an AI or OCR transcript: '+JSON.stringify(repaired.sources.map(s=>({text:s.text,count:s.encodingCorrections?.length}))));
    const corrections=repaired.sources.flatMap(source=>source.encodingCorrections||[]);assert(corrections.length>10);
    for(const source of repaired.sources)for(const correction of source.encodingCorrections||[]){
      assert.equal(source.text.slice(...correction.textRange),correction.to,'real repaired glyphs retain exact UTF-16 source ranges');
    }
    assert(corrections.every(c=>c.rule==='local-font-outline'&&c.evidence.similarity>=.97&&c.evidence.margin>=.05));
    const mixed=structuredClone(snapshot),slots=new Map();
    for(const operation of mixed.operations)if(operation.name==='showText')for(const glyph of operation.args[0])if(glyph?.unicode){
      if(!slots.has(glyph.fontChar))slots.set(glyph.fontChar,slots.size);
      glyph.unicode=slots.get(glyph.fontChar)<3?String.fromCodePoint(1+slots.get(glyph.fontChar)):'!';
    }
    mixed.textCharacters=mixed.operations.filter(operation=>operation.name==='showText').flatMap(operation=>operation.args[0]).filter(glyph=>glyph?.unicode).reduce((sum,glyph)=>sum+glyph.unicode.replace(/\s/g,'').length,0);
    const mixedResult=buildPageScene(mixed,{resolveGlyph:decode(mixed)});
    assert(mixedResult.sources.some(source=>source.text===original),'a proven broken font map is repaired beyond its control-code slots');
    assert(!snapshot.operations.some(operation=>operation.name==='showText'&&operation.args[0].some(glyph=>glyph?.unicode&&/\p{Cc}/u.test(glyph.unicode))),'the source display list is immutable');
    const malformed=structuredClone(broken);for(const item of Object.values(malformed.fonts))item.data=new Uint8Array([1,2,3]);assert.equal(decode(malformed),null);
    const unknown=structuredClone(broken);for(const item of Object.values(unknown.fonts))item.name='UnverifiedCustomFace';assert.equal(decode(unknown),null);
    const unavailable=structuredClone(broken);for(const item of Object.values(unavailable.fonts))item.missingFile=true;assert.equal(decode(unavailable),null);
    const badAdvance=structuredClone(broken);for(const operation of badAdvance.operations)if(operation.name==='showText')for(const glyph of operation.args[0])if(glyph?.unicode)glyph.width=100000;
    assert.equal(decode(badAdvance),null,'a matching-looking shape cannot override contradictory advances');
    const ambiguous=structuredClone(mixed);
    const firstDraw=ambiguous.operations.find(operation=>operation.name==='showText');
    firstDraw.args[0].find(glyph=>glyph?.unicode).width=100000;
    const uncertain=buildPageScene(ambiguous,{resolveGlyph:decode(ambiguous)});
    assert(uncertain.sources.some(source=>source.disposition==='visible-image'), 'an unverified slot in a proven broken map remains an image, including misleading printable bytes');
    assert(sceneLayoutBytes(repaired)>=corrections.length*384,'encoding evidence is charged to the existing memory budget');
    canvas.width=canvas.height=0;
  }finally{await task.destroy();}
  console.log('Native encoding: embedded outline/advance evidence, real recovered text, whitespace draws, immutable input and uncertain fallback passed.');
}
