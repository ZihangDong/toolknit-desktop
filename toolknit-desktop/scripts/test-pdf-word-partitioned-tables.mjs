import { recoverMathLetters } from '../src/features/pdf-to-word/adapters/math-text.js';
import { sceneLayoutBytes } from '../src/features/pdf-to-word/core/scene-budget.js';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { partitionedTextTables } from '../src/features/pdf-to-word/core/partitioned-text-tables.js';
import { nativeTableRowCandidate, nativeTableFunctionGlyphs, nativeTableNumericGlyphs } from '../src/features/pdf-to-word/core/native-table-row.js';
import { groupPageRegions } from '../src/features/pdf-to-word/core/regions.js';
import { inferDocument, validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes, tablesRequiringFallback } from '../src/features/pdf-to-word/adapters/docx.js';
import { measureLineBox } from '../src/features/pdf-to-word/adapters/text-layout.js';
import { resultTargets, applyResultEdits, layoutEditedText } from '../src/features/pdf-to-word/core/result-edit.js';
import { measureResultText } from '../src/features/pdf-to-word/result-preview.js';

const context = createCanvas(1, 1).getContext('2d');
function fixture() {
  const text = [], sources = [], bounds = { x: 0, y: 0, width: 430, height: 190 };
  for (let row = 0; row < 6; row++) for (let col = 0; col < 3; col++) {
    const value = row ? ['System ' + row, 'Training only', String(80 + row) + '.5'][col] : ['Parser', 'Training', 'Score'][col];
    const size = 10, baseline = 57.8 + row * 12, x = [20, 156, 318][col];
    context.font = `${row ? '' : 'bold '}1000px "Times New Roman"`; const m = context.measureText(value), k = .01;
    const id = 'native:' + row + ':' + col, rect = { x: x - m.actualBoundingBoxLeft * k, y: baseline - m.actualBoundingBoxAscent * k,
      width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * k, height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * k };
    // Actual native core leaves lack type before region/paragraph inference.
    text.push({ id, sourceIds: [id], text: value, rect, size, baseline, baselineX: x, advanceWidth: m.width * k,
      font: row ? 'ABCDEF+NimbusRomNo9L-Regu' : 'ABCDEF+NimbusRomNo9L-Medi', fontFamily: 'serif',
      bold: !row, italic: false, raster: false, preciseInk: true, horizontalScale: 1, color: '000000', order: text.length });
    sources.push({ id, text: value, rect: { ...rect }, disposition: 'editable', order: text.length - 1 });
  }
  const rules = [50, 62, 98, 122].map(at => ({ axis: 'h', at, from: 10, to: 400 }));
  for (const x of [140, 280]) for (let row = 0; row < 6; row++) rules.push({ axis: 'v', at: x, from: 50.2 + row * 12, to: 61.8 + row * 12 });
  return { text, sources, rules, bounds };
}
const prepare = f => partitionedTextTables(f.text, f.rules, f.sources, f.bounds);
const f = fixture(), before = structuredClone(f), tables = prepare(f);
assert.equal(tables.length, 1); const table = tables[0];
assert.equal(table.rows, 6); assert.equal(table.columnWidths.length, 3); assert.equal(table.cells.length, 18);
assert(table.borderless && table.nativeRowBaseline && table.cells.every(cell => cell.rowSpan === 1 && cell.colSpan === 1));
assert.deepEqual(f, before, 'original drawing segments, styles, glyph origins and ledger remain intact');
assert.deepEqual(tablesRequiringFallback({ items: [table] }, context), []);
const tooTight = structuredClone(table);
tooTight.cells[0].rect.height = 2; tooTight.rowHeights[0] = 2;
assert.deepEqual(tablesRequiringFallback({ items: [tooTight] }, context), [table.id], 'exact native leading never bypasses an impossible ink/baseline fit');
const first = table.cells[0], line = first.blocks[0].lines[0], fit = { top: first.rect.y, bottom: first.rect.y + first.rect.height };
const defaults = measureLineBox(line, context, false, fit), exact = measureLineBox(line, context, false, fit, false, true);
assert.equal(exact.baselineOffset, Math.round(exact.height * 20) / 20 * .8);
assert(line.baseline - exact.baselineOffset >= fit.top - .25 && line.baseline - exact.baselineOffset + exact.height <= fit.bottom + .25);
assert.deepEqual(measureLineBox(line, context, false, null, true, true), measureLineBox(line, context, false, null, true), 'ordinary positioned frames retain their established metric contract');
assert.deepEqual(measureLineBox(line, context, false, { top: NaN, bottom: 1 }, false, true), measureLineBox(line, context, false, { top: NaN, bottom: 1 }));
const foreign = structuredClone(line); foreign.items[0].font = 'UnknownFace';
assert.deepEqual(measureLineBox(foreign, context, false, fit, false, true), measureLineBox(foreign, context, false, fit), 'a boolean cannot bypass native font/ink evidence');
assert(!nativeTableRowCandidate({ ...line.items[0], ocr: true }));
assert(defaults.height > 0);
const grouped = groupPageRegions(f.text, [], f.rules, f.sources, { bounds: f.bounds });
assert.equal(grouped.items.filter(i => i.type === 'table').length, 1);
const scene = { number: 1, width: 430, height: 190, sources: f.sources, items: grouped.items, rules: [], risks: [], characters: 100 };
const document = inferDocument([scene], { preserveGeometry: true });
assert.equal(validateCoverage(document).imageCharacters, 0);
const bytes = await createWordBytes(document, [], { preserveGeometry: true, measurementContext: context });
const xml = await (await JSZip.loadAsync(bytes.bytes)).file('word/document.xml').async('string');
assert.equal((xml.match(/<w:tbl>/g) || []).length, 1); assert.equal((xml.match(/<w:tc>/g) || []).length, 18);
assert(!xml.includes('<w:drawing>') && !xml.includes('<m:oMath>'));
assert(!xml.includes('w:val="single"'), 'open side edges remain visually open; writer does not invent an exterior grid');
const target = resultTargets(document.pages[0]).find(t => t.type === 'text' && t.text === 'System 1');
assert(target); const edited = applyResultEdits(document, { [target.key]: { type: 'delete' } });
assert(!resultTargets(edited.pages[0]).some(t => t.key === target.key));
assert.equal(edited.pages[0].blocks.find(b => b.type === 'table').cells.length, 18);
const numeric = resultTargets(document.pages[0]).find(t => t.type === 'text' && t.text === '81.5');
const measure = (text, style) => measureResultText(text, style, context);
measure.metrics = (text, style) => measureResultText.metrics(text, style, context);
const append = layoutEditedText(numeric, '81.5123', measure, { page: document.pages[0] });
assert(append.lines.flatMap(line => line.items).every(item => item.font === numeric.items[0].font && item.size === numeric.items[0].size));
const amended = applyResultEdits(document, { [numeric.key]: append });
const amendedBytes = await createWordBytes(amended, [], { preserveGeometry: true, measurementContext: context });
const amendedXml = await (await JSZip.loadAsync(amendedBytes.bytes)).file('word/document.xml').async('string');
assert(amendedXml.includes('81.5123') && (amendedXml.match(/<w:tc>/g) || []).length === 18, 'app edit retains exact native leading, original font/size and all cells');
for (const [index, mutate] of [
  x => { x.rules = x.rules.filter(r => r.axis !== 'v' || r.at !== 280); },
  x => { x.rules.find(r => r.axis === 'v').to -= 2; },
  x => { x.rules = x.rules.filter(r => r.axis !== 'h' || r.at !== 50); },
  x => { x.rules = x.rules.filter(r => r.axis !== 'h' || r.at !== 122); },
  x => { x.text[4].ocr = true; },
  x => { x.text[4].raster = true; },
  x => { x.text[4].italic = true; },
  x => { x.text[4].font = 'OtherFace'; },
  x => { x.text[4].preciseInk = false; },
  x => { x.text[4].horizontalScale = .8; },
  x => { x.text[4].text = 'a=b'; x.sources[4].text = 'a=b'; },
  x => { x.sources[4].text = 'foreign'; },
  x => { x.sources[4].disposition = 'visible-image'; },
  x => { x.sources[4].rect.width += 1; },
  x => { x.sources.push(structuredClone(x.sources[4])); },
  x => { x.text[4].rect.x = 130; x.sources[4].rect.x = 130; },
  x => { x.bounds.width = 300; },
  x => { for (let i = 5; i < x.text.length; i += 3) { x.text[i].text = 'None'; x.sources[i].text = 'None'; } },
].entries()) {
  const value = fixture(); mutate(value); const saved = structuredClone(value);
  assert.equal(prepare(value).length, 0, 'reject incomplete partitions/unknown/foreign/scanned/math/outside input: ' + index);
  assert.deepEqual(value, saved);
}
const collision = fixture(), graphic = { id: 'foreign-image', type: 'image', sourceIds: [], rect: { x: 20, y: 65, width: 8, height: 6 } };
assert(!groupPageRegions(collision.text, [graphic], collision.rules, collision.sources, { bounds: collision.bounds }).items.some(i => i.type === 'table'), 'the common graphic-collision gate still applies');
console.log('Partitioned native tables: complete original closed rules, unchanged source/style, native exact row fit, actual DOCX/deletion and guarded source/font/scan/math/collision refusal passed.');


// Open top/bottom borders are proven from repeated complete internal strokes.
// Synthetic ordinary labels and a complete native function remain editable.
function openFixture() {
 const value={text:[],sources:[],rules:[],bounds:{x:0,y:0,width:430,height:220}};
 const add=(text,x,baseline,font='ABCDEF+NimbusRomNo9L-Regu',italic=false,size=10)=>{
  context.font=`${italic?'italic ':''}1000px "${font.includes('CMMI')?'Cambria':'Times New Roman'}"`;context.fontKerning='none';const m=context.measureText(text),k=size/1000;
  const id='open:'+value.text.length,rect={x:x-m.actualBoundingBoxLeft*k,y:baseline-m.actualBoundingBoxAscent*k,width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)*k,height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)*k};
  const item={id,sourceIds:[id],text,rect,baseline,baselineX:x,advanceWidth:m.width*k,font,fontFamily:'serif',size,italic,bold:false,raster:false,preciseInk:true,horizontalScale:1,color:'000000',order:value.text.length};value.text.push(item);value.sources.push({id,text,rect:{...rect},order:item.order,disposition:'editable'});return item;
 };
 for(let row=0;row<6;row++)for(let col=0;col<5;col++){
  if(row===0&&col===0)continue;
  const x=[18,100,180,260,340][col],y=50+row*22;
  if(row===4&&col===0){add('Field',x,y);let at=43;for(const[letter,font,italic]of[['p','CMMI9',true],['(','CMR9',false],['x','CMMI9',true],[')','CMR9',false]]){const g=add(letter,at,y,'ABCDEF+'+font,italic,9);at+=g.advanceWidth+.2;}}
  else add('Label '+row+col,x,y);
 }
 for(const at of[62,84,106,128,150])value.rules.push({axis:'h',at,from:10,to:400});
 for(const at of[90,170,250,330])for(let row=0;row<6;row++)value.rules.push({axis:'v',at,from:40.2+row*22,to:61.8+row*22});
 return value;
}
{
 const x=openFixture(),saved=structuredClone(x),t=prepare(x)[0];assert(t&&t.nativeOpenGrid&&t.cells.length===30&&t.rows===6&&t.columnWidths.length===5);assert.deepEqual(x,saved);
 const math=x.text.filter(g=>/CM(?:MI|R)9/.test(g.font));assert.equal(math.length,4);const src=new Map(x.sources.map(s=>[s.id,s]));assert.deepEqual(nativeTableFunctionGlyphs(x.text,src),math);
 assert.deepEqual(tablesRequiringFallback({items:[t]},context),[t.id],'uncalibrated source font cannot silently reach Word');
 const s={number:1,width:430,height:220,items:[t],sources:x.sources,rules:x.rules,risks:[],characters:x.sources.reduce((n,s)=>n+s.text.length,0)};recoverMathLetters(s,context);assert.deepEqual(tablesRequiringFallback(s,context),[]);
 const d=inferDocument([s],{preserveGeometry:true});assert.equal(validateCoverage(d).imageCharacters,0);
 const result=await createWordBytes(d,[],{preserveGeometry:true,measurementContext:context}),xml=await(await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');assert.equal((xml.match(/<w:tc>/g)||[]).length,30);assert(!xml.includes('CMMI9')&&!xml.includes('CMR9'));assert(xml.includes('Cambria'));
 const ordinary=structuredClone(s);delete ordinary.items[0].nativeOpenGrid;assert.equal(sceneLayoutBytes(s)-sceneLayoutBytes(ordinary),30*2048);
 const malformed=structuredClone(ordinary);malformed.items[0].nativeOpenGrid=false;assert.equal(sceneLayoutBytes(malformed)-sceneLayoutBytes(ordinary),30*2048);
 const raw=openFixture(),foreign=prepare(raw)[0],before=structuredClone(foreign);recoverMathLetters({items:[foreign],sources:raw.sources,rasterPage:false},{measureText(){return{width:0,actualBoundingBoxAscent:0,actualBoundingBoxDescent:0,actualBoundingBoxLeft:0,actualBoundingBoxRight:0}}});assert.deepEqual(foreign,before,'all4 font proposals remain unbound after failed metrics');
 const targets=resultTargets(d.pages[0]).filter(t=>t.type==='text'),clear=applyResultEdits(d,Object.fromEntries(targets.map(t=>[t.key,{type:'delete'}])));assert.equal(clear.pages[0].blocks.find(t=>t.nativeOpenGrid).cells.length,30);
 await createWordBytes(clear,[],{preserveGeometry:true,measurementContext:context});
}
for(const[name,mutate]of[
 ['missing-math',x=>{const i=x.text.findIndex(g=>g.text===')');x.sources.splice(i,1);x.text.splice(i,1)}],
 ['wrong-close',x=>{const g=x.text.find(g=>g.text===')');g.text=']';x.sources.find(s=>s.id===g.id).text=']'}],
 ['different-color',x=>x.text.find(g=>g.text==='p').color='ff0000'],['wrong-size',x=>x.text.find(g=>g.text==='p').size+=.2],
 ['unknown-math-font',x=>x.text.find(g=>g.text==='p').font='UnknownFace'],['bold-math',x=>x.text.find(g=>g.text==='p').bold=true],
 ['unproven-italic',x=>x.text.find(g=>g.text==='p').italic=false],['non-finite-transform',x=>x.text.find(g=>g.text==='p').horizontalScale=NaN],
 ['unknown-color',x=>x.text.find(g=>g.text==='p').color='unknown'],['math-child-group',x=>x.text.find(g=>g.text==='p').mathGlyphs=[{}]],
 ['incomplete-source',x=>x.sources.find(s=>s.text==='p').disposition='visible-image'],
 ['changed-source-box',x=>x.sources.find(s=>s.text==='p').rect.x+=.5],['broken-partition',x=>x.rules.find(r=>r.axis==='v').to-=2],
 ['unequal-endpoints',x=>x.rules.find(r=>r.axis==='v').from+=2],['bounds',x=>x.bounds.width=380],
 ['empty-required-cell',x=>{const index=x.text.findIndex(t=>t.text==='Label 23');x.sources.splice(index,1);x.text.splice(index,1)}]
]){const x=openFixture();mutate(x);const before=structuredClone(x);assert.equal(prepare(x).length,0,name);assert.deepEqual(x,before);}
assert.equal(nativeTableFunctionGlyphs([null],new Map()),null);
console.log('Open native tables: complete6x5 geometry/function/source/font preflight, memory, real DOCX and deletion/refusal checks passed.');

// Complete single-separator numeric values retain their original cells.
{
function numericFixture(){
 const v={text:[],sources:[],rules:[{axis:'h',at:53,from:20,to:310}],bounds:{x:0,y:0,width:340,height:180}};
 const add=(text,x,baseline,font='ABCDEF+NimbusRomNo9L-Regu',bold=false,italic=false)=>{
  const face=font.includes('CMSY')?'Cambria Math':'Times New Roman';context.font=`${italic?'italic ':''}${bold?'bold ':''}1000px "${face}"`;context.fontKerning='none';const m=context.measureText(text),size=10,k=size/1000,id='numeric:'+v.text.length;
  const rect={x:x-m.actualBoundingBoxLeft*k,y:baseline-m.actualBoundingBoxAscent*k,width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)*k,height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)*k};
  const g={id,sourceIds:[id],text,rect,baseline,baselineX:x,advanceWidth:m.width*k,font,size,italic,bold,raster:false,preciseInk:true,horizontalScale:1,color:'000000',order:v.text.length};v.text.push(g);v.sources.push({id,text,rect:{...rect},order:g.order,disposition:'editable'});return g;
 };
 for(const at of[130,220])for(let r=0;r<5;r++)v.rules.push({axis:'v',at,from:38+r*15+(r===1?.2:0),to:53+r*15-(r===0?.2:0)});
 for(let r=0;r<5;r++){
  const y=48+r*15;add(r?'Group '+r:'Item',25,y);
  for(let c=1;c<3;c++)if(!r)add(c===1?'First':'Second',c===1?145:235,y);
  else{let x=c===1?145:235;for(const[t,f,b,i]of[[String(300+r),'CMR10',false,false],['±','CMSY10',false,false],['2','CMBX10',true,false],['.','CMMI10',false,true],['5','CMBX10',true,false]]){const g=add(t,x,y,'ABCDEF+'+f,b,i);x+=g.advanceWidth+1;}}
 }
 return v;
}

const x=numericFixture(),before=structuredClone(x),t=prepare(x)[0];assert(t&&t.cells.length===15&&t.rows===5&&t.nativeOpenGrid);assert.deepEqual(x,before);
const src=new Map(x.sources.map(s=>[s.id,s]));const own=t.cells.find(c=>c.row===1&&c.col===1).sourceIds.map(id=>x.text.find(g=>g.id===id));assert.equal(nativeTableNumericGlyphs(own,src).length,5);
assert.equal(nativeTableNumericGlyphs([null,...own.slice(1)],src),null);
for(const mutate of[g=>g.type='image',g=>g.columns=[{}],g=>g.id=7]){const bad=structuredClone(own);mutate(bad[0]);assert.equal(nativeTableNumericGlyphs(bad,src),null);}
assert.deepEqual(tablesRequiringFallback({items:[t]},context),[t.id]);
const scene={number:1,width:340,height:180,items:[t],sources:x.sources,rules:x.rules,risks:[],characters:x.sources.reduce((n,s)=>n+s.text.length,0)};recoverMathLetters(scene,context);assert.deepEqual(tablesRequiringFallback(scene,context),[]);
const output=await createWordBytes(inferDocument([scene],{preserveGeometry:true}),[],{preserveGeometry:true,measurementContext:context});const xml=await(await JSZip.loadAsync(output.bytes)).file('word/document.xml').async('string');assert.equal((xml.match(/<w:tc>/g)||[]).length,15);assert(xml.includes('±'));assert(!/CM(?:R|MI|SY|BX)10/.test(xml));
for(const[name,mutate]of[
 ['no-separator',v=>v.rules=v.rules.filter(r=>r.axis!=='h')],['broken-column',v=>v.rules[3].to-=2],['unequal-end',v=>v.rules.at(-1).to+=2],
 ['source-text',v=>v.sources[4].text='foreign'],['source-geometry',v=>v.sources[4].rect.x+=.3],['source-ownership',v=>v.sources[4].disposition='visible-image'],
 ['unknown-font',v=>v.text[4].font='Foreign'],['scaled',v=>v.text[4].horizontalScale=.8],['nan-scale',v=>v.text[4].horizontalScale=NaN],
 ['unknown-color',v=>v.text[4].color='unknown'],['color-conflict',v=>v.text[4].color='ff0000'],['baseline-conflict',v=>v.text[4].baseline+=2],
 ['size-conflict',v=>v.text[4].size+=2],['raster',v=>v.text[4].raster=true],['ocr',v=>v.text[4].ocr=true],['nonprecise',v=>v.text[4].preciseInk=false],
 ['partial-number',v=>{v.text[4].text='301+';v.sources[4].text='301+'}],['missing-symbol',v=>{v.text.splice(5,1);v.sources.splice(5,1)}],
 ['empty-required',v=>{const ids=new Set(own.map(g=>g.id));v.text=v.text.filter(g=>!ids.has(g.id));v.sources=v.sources.filter(g=>!ids.has(g.id))}],
 ['bounds',v=>v.bounds.width=280],['nested-math',v=>v.text[4].mathGlyphs=[{}]],['wrong-weight',v=>v.text[4].bold=true],
 ['unrelated-math',v=>{v.text[5].text='=';v.sources[5].text='='}],['duplicate-source',v=>v.sources.push(structuredClone(v.sources[4]))]
]){const v=numericFixture();mutate(v);const copy=structuredClone(v);assert.equal(prepare(v).length,0,name);assert.deepEqual(v,copy);}
console.log('Synthetic single-separator numeric grids: geometry, complete ± values, font preflight, actual15-cell DOCX and24 refusal cases passed.');

}
