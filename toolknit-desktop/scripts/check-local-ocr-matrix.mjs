// Explicit local QA. Never uploads images or stores private sample text in reports.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { prepareOcrScene } from '../src/features/pdf-to-word/core/ocr-scene.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { collectPageAssets } from '../src/features/pdf-to-word/adapters/pdfjs.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: check-local-ocr-matrix.mjs fixture-directory output-directory');
await mkdir(output, { recursive: true });
const truth = await readFile(join(input, 'truth.json'), 'utf8').then(JSON.parse).catch(() => ({}));
const normalize = value => [...String(value).replace(/\s/g, '')];
function distance(a,b) { let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+Number(a[i]!==b[j])));row=next;}return row[b.length]; }
const reports=[];
for (const name of (await readdir(input)).filter(name=>name.endsWith('.ocr.json'))) {
  const id=basename(name,'.ocr.json'),result=JSON.parse(await readFile(join(input,name),'utf8'));
  const image=await loadImage(join(input,`${id}.png`));
  const canvas=createCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);
  const reference=context.getImageData(0,0,image.width,image.height).data;
  const pageWidth=Math.min(595.3,1500*image.width/image.height),pageHeight=pageWidth*image.height/image.width;
  const scene={number:1,width:pageWidth,height:pageHeight,sources:[],items:[],rules:[],risks:['image-page'],rasterPage:false,characters:0};
  const quality={id,width:image.width,height:image.height,lines:result.lines.length,nativeMs:result.elapsedMs,modes:[]};
  if(truth[id]){const expected=normalize(truth[id].join('\n')),actual=normalize(result.text);quality.referenceCharacters=expected.length;quality.characterErrors=distance(expected,actual);quality.characterAccuracy=1-quality.characterErrors/Math.max(1,expected.length);}
  for(const faithful of [true,false]) {
    const prepared=prepareOcrScene({scene,result,pixels:reference,width:image.width,height:image.height,preserveGeometry:faithful});
    assert(prepared.changed,`${id}: OCR produces editable scene`);
    const clean=createCanvas(image.width,image.height),ctx=clean.getContext('2d');ctx.putImageData(new ImageData(prepared.pixels,image.width,image.height),0,0);
    const assets=await collectPageAssets(prepared.scene,clean,createCanvas);
    const document=inferDocument([prepared.scene],{preserveGeometry:faithful,continuous:!faithful});
    const coverage=validateCoverage(document);
    const packed=await createWordBytes(document,assets,{preserveGeometry:faithful,continuous:!faithful,measurementContext:createCanvas(1,1).getContext('2d')});
    const zip=await JSZip.loadAsync(packed.bytes),xml=await zip.file('word/document.xml').async('string');
    assert(xml.includes('<w:t'),`${id}: actual Word text`);
    assert.equal(coverage.imageCharacters,0,`${id}: recognized text is editable`);
    const mode=faithful?'faithful':'flow';await writeFile(join(output,`${id}-${mode}.docx`),packed.bytes);
    if(faithful)await writeFile(join(output,`${id}-clean.png`),clean.toBuffer('image/png'));
    quality.modes.push({mode,bytes:packed.bytes.length,editableCharacters:coverage.editableCharacters,tables:(xml.match(/<w:tbl>/g)||[]).length,images:assets.length});
    clean.width=clean.height=0;
  }
  canvas.width=canvas.height=0;reports.push(quality);
}
await writeFile(join(output,'metrics.json'),JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports,null,2));
