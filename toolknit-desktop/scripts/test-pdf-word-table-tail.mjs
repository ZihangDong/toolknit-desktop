import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { inferDocument } from '../src/features/pdf-to-word/core/layout.js';
import { createWordBytes } from '../src/features/pdf-to-word/adapters/docx.js';

const context = createCanvas(1, 1).getContext('2d');
context.font = '1000px "SimSun"';
const items = [...'甲乙（元）'].map((text, index) => {
  const m = context.measureText(text), x = [30, 46, 60, 76, 90][index];
  return { id: 'g' + index, type: 'text', sourceIds: ['g' + index], text, font: 'SimSun', size: 16,
    baseline: 50, baselineX: x, advanceWidth: 16, preciseInk: true, raster: false, color: '000000',
    rect: { x: x - m.actualBoundingBoxLeft * .016, y: 50 - m.actualBoundingBoxAscent * .016,
      width: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * .016,
      height: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * .016 } };
});
const cell = { x: 20, y: 20, width: 83, height: 50 };
const scene = { number: 1, width: 300, height: 200, characters: 5, risks: [], rules: [],
  sources: items.map(item => ({ id: item.id, text: item.text, rect: item.rect, disposition: 'editable' })),
  items: [{ id: 'table', type: 'table', rows: 1, columnWidths: [cell.width], rowHeights: [cell.height],
    rect: cell, sourceIds: items.flatMap(item => item.sourceIds), cells: [{ row: 0, col: 0, rowSpan: 1, colSpan: 1,
      rect: cell, sourceIds: items.flatMap(item => item.sourceIds), blocks: [{ id: 'text', type: 'paragraph', role: 'body',
        rect: cell, align: 'left', size: 16, column: cell, sourceIds: items.flatMap(item => item.sourceIds),
        lines: [{ id: 'line', type: 'line', rect: cell, baseline: 50, size: 16, text: '甲乙（元）', items }] }] }] }] };
const document = inferDocument([scene], { preserveGeometry: true });
const original = structuredClone(document);
const write = async document => {
  const result = await createWordBytes(document, [], { preserveGeometry: true, measurementContext: context });
  return (await JSZip.loadAsync(result.bytes)).file('word/document.xml').async('string');
};
const xml = await write(document);
assert.match(xml, /<w:ind[^>]*w:right="-\d+"/);
assert(xml.includes('<w:trHeight w:val="1000" w:hRule="exact"/>'));
assert(xml.includes('<w:tcW w:type="dxa" w:w="1660"/>'));
assert(!xml.includes('w:fitText') && !xml.includes('w:tcFitText'), 'the writer must not shrink source text');
assert.equal((xml.match(/<w:sz w:val="32"\/>/g) || []).length, 6);
assert.deepEqual(document, original, 'serialization cannot mutate the source scene or editing geometry');
const wide = structuredClone(document), table = wide.pages[0].blocks.find(block => block.type === 'table');
table.rect.width = table.cells[0].rect.width = table.columnWidths[0] = 100;
assert(!/<w:ind[^>]*w:right="-/.test(await write(wide)), 'no allowance when the ordinary text advance fits');
const uncertain = structuredClone(document);
uncertain.pages[0].blocks.find(block => block.type === 'table').cells[0].blocks[0].lines[0].items[0].preciseInk = false;
assert(!/<w:ind[^>]*w:right="-/.test(await write(uncertain)), 'uncertain geometry cannot authorize overhang');
context.font='1000px "Arial"';
const metric=context.measureText('USA,'),scale=.011;
const tail={id:'tail',type:'text',sourceIds:['tail'],text:'USA,',font:'Arial',size:11,baseline:50,baselineX:30,
  advanceWidth:metric.width*scale+3.25,preciseInk:true,raster:false,color:'000000',
  rect:{x:30-metric.actualBoundingBoxLeft*scale,y:50-metric.actualBoundingBoxAscent*scale,
    width:(metric.actualBoundingBoxLeft+metric.actualBoundingBoxRight)*scale,height:(metric.actualBoundingBoxAscent+metric.actualBoundingBoxDescent)*scale}};
const sourceSpaced=structuredClone(scene),grid=sourceSpaced.items[0],box={x:20,y:20,width:30+metric.width*scale+2-20,height:50};
grid.rect=box;grid.columnWidths=[box.width];grid.sourceIds=['tail'];grid.cells[0].rect=box;grid.cells[0].sourceIds=['tail'];
const block=grid.cells[0].blocks[0];block.rect=tail.rect;block.column=box;block.size=11;block.sourceIds=['tail'];
Object.assign(block.lines[0],{rect:tail.rect,size:11,text:tail.text,items:[tail],sourceIds:['tail']});
sourceSpaced.sources=[{id:'tail',text:tail.text,rect:tail.rect,disposition:'editable'}];sourceSpaced.characters=4;
const spacedDocument=inferDocument([sourceSpaced],{preserveGeometry:true}),spacedBefore=structuredClone(spacedDocument),spacedXml=await write(spacedDocument);
assert(/<w:ind[^>]*w:right="-/.test(spacedXml),'explicit trailing PDF advance is checked against the serialized run plan, even when natural font width fits');
assert(spacedXml.includes('<w:sz w:val="22"/>')&&!spacedXml.includes('w:fitText')&&!spacedXml.includes('w:tcFitText'));
assert(spacedXml.includes(`<w:tcW w:type="dxa" w:w="${Math.round(box.width*20)}"/>`),'cell width stays fixed');
assert.deepEqual(spacedDocument,spacedBefore);
const natural=structuredClone(spacedDocument);natural.pages[0].blocks[0].cells[0].blocks[0].lines[0].items[0].advanceWidth=metric.width*scale;
assert(!/<w:ind[^>]*w:right="-/.test(await write(natural)),'a truly fitting serialized advance needs no extra allowance');
console.log('Table tails: source-fitting ink stays native without wrapping, resizing, source mutation or relaxed vertical fit.');
