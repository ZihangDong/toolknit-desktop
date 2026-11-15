import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createOcrTypography } from '../src/features/pdf-to-word/adapters/ocr-typography.js';
import { prepareOcrScene } from '../src/features/pdf-to-word/core/ocr-scene.js';
import { recoverOcrPermille } from '../src/features/pdf-to-word/core/ocr-symbols.js';

const fit = createOcrTypography(createCanvas);
function sample(symbol, font, size = 60, confidence = .99, writingLine = false) {
  const canvas = createCanvas(1200, 160), context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'black'; context.font = `${size}px "${font}"`; context.fontKerning = 'none';
  const original = font.startsWith('Sim') ? `约定1${writingLine ? '_' : ''}${symbol}每日` : `Rate1${symbol}daily`, words = []; let x = 25;
  for (const char of original) {
    context.font = `${writingLine && char === '_' ? size * 2 : size}px "${font}"`;
    const metrics = context.measureText(char); context.fillText(char, x, 100);
    words.push({ text: char === '‰' ? '%' : char, x: x - metrics.actualBoundingBoxLeft,
      y: 100 - metrics.actualBoundingBoxAscent, width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
      height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent, confidence });
    x += metrics.width;
  }
  const left = Math.min(...words.map(w => w.x)), top = Math.min(...words.map(w => w.y));
  const right = Math.max(...words.map(w => w.x + w.width)), bottom = Math.max(...words.map(w => w.y + w.height));
  const line = { text: words.map(w => w.text).join(''), words, confidence, x: left, y: top, width: right - left, height: bottom - top };
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const options = { line, pixels, width: canvas.width, height: canvas.height, sx: 3, sy: 3, allowSymbolCorrection: true,
    tight: { x: left / 3, y: top / 3, width: (right - left) / 3, height: (bottom - top) / 3 },
    inkAt: (x, y) => pixels[(y * canvas.width + x) * 4] < 150 };
  return { canvas, context, options, original };
}
for (const font of ['SimSun', 'SimHei', 'Arial', 'Times New Roman']) {
  for (const size of [36, 60]) for (const symbol of ['%', '‰']) {
    const { canvas, options, original } = sample(symbol, font, size);
    const before = structuredClone(options.line), result = fit(options);
    assert(result, `${font}/${size}/${symbol} typography`);
    assert.equal(result.words.map(w => w.text).join(''), original, `${font}/${size} retains the visible rate symbol`);
    assert.deepEqual(options.line, before, 'recognizer output remains unmodified');
    if (symbol === '‰') {
      assert.equal(result.text, original);
      assert.equal(result.ocrOriginalText, before.text);
      assert.equal(result.ocrCorrections.length, 1);
      assert.equal(result.ocrCorrections[0].rule, 'source-ink-permille');
    } else assert.equal(result.ocrCorrections, undefined, 'actual percent never acquires a third ring');
    canvas.width = canvas.height = 0;
  }
}
{
  const { canvas, options } = sample('‰', 'SimSun');
  const nativeInput = { ...options }; delete nativeInput.allowSymbolCorrection;
  const result = fit(nativeInput);
  assert(result?.words?.length);
  assert.equal(result.words.map(word => word.text).join(''), options.line.text,
    'native known-text calibration cannot opt into OCR spelling corrections');
  assert.equal(result.text, undefined); assert.equal(result.ocrCorrections, undefined);
  canvas.width = canvas.height = 0;
}
{
  const { canvas, context, options, original } = sample('‰', 'SimSun');
  const result = prepareOcrScene({ scene: { number: 1, width: 400, height: 160 / 3,
    sources: [], items: [], rules: [], risks: ['image-page'], characters: 0 },
  result: { width: canvas.width, height: canvas.height, lines: [options.line] },
  pixels: options.pixels, width: canvas.width, height: canvas.height,
  preserveGeometry: true, fitTypography: fit, measurementContext: context });
  const item = result.scene.items.find(item => item.type === 'text');
  assert.equal(item.text, original, 'corrected scene text agrees with child glyphs');
  assert.equal(item.words.map(word => word.text).join(''), original);
  assert.equal(result.scene.sources[0].text, original, 'source ledger uses the same proven symbol');
  assert.equal(result.scene.sources[0].text.length, options.line.text.length);
  const symbol = options.line.words.find(word => word.text === '%');
  let oldInk = 0;
  for (let y = Math.ceil(symbol.y); y < Math.floor(symbol.y + symbol.height); y++)
    for (let x = Math.ceil(symbol.x); x < Math.floor(symbol.x + symbol.width); x++)
      if (result.pixels[(y * canvas.width + x) * 4] < 150) oldInk++;
  assert.equal(oldInk, 0, 'old source symbol is erased, rather than left under the editable replacement');
  canvas.width = canvas.height = 0;
}
{
  for (const symbol of ['%', '‰']) {
    const { canvas, options, original } = sample(symbol, 'SimSun', 36, .99, true);
    const peak = options.line.words.find(word => word.text === '%');
    peak.x -= 20;
    options.line.height *= 1.5; // Detector boxes include vertical paper padding.
    for (const word of options.line.words) word.width = 4;
    const before = structuredClone(options.line), result = fit(options);
    if (symbol === '‰') {
      assert.equal(result?.text, original, 'a misplaced CTC peak on a writing line still needs three proven source rings');
      assert.equal(result.words, undefined, 'nearby ink proof does not invent full-line word geometry');
      assert.equal(result.ocrCorrections[0].ctcFallback, true);
    } else assert.equal(result?.ocrCorrections, undefined, 'a nearby writing line cannot turn a real percent into per-mille');
    assert.deepEqual(options.line, before);
    canvas.width = canvas.height = 0;
  }
}
{
  const { canvas, options, original } = sample('‰', 'SimSun');
  const first = options.line.words[0], before = structuredClone(options.line);
  const result = fit({ ...options, inkAt: (x, y) => x <= first.x + first.width + 1 ? false : options.inkAt(x, y) });
  assert.equal(result?.text, original, 'an independently proven rate survives an unrelated empty CTC cell');
  assert.equal(result.words, undefined, 'partial symbol proof does not claim whole-line font or word calibration');
  assert.deepEqual(options.line, before);
  canvas.width = canvas.height = 0;
}
{
  const { canvas, options } = sample('‰', 'SimSun', 60, .5);
  const result = fit(options);
  assert.equal(result?.ocrCorrections, undefined, 'weak recognizer membership cannot authorize a replacement');
  canvas.width = canvas.height = 0;
}
for(const symbol of ['%','‰']){
  const canvas=createCanvas(1200,170),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,1200,170);ctx.fillStyle='black';ctx.font='36px "SimSun"';ctx.fontKerning='none';
  const words=[],expected=[];let x=25,barStart;
  for(const token of [...'按双方约定合同总价','_',symbol,...'支付违约金']){
    if(token==='_'){
      barStart=x+22;ctx.fillRect(barStart,125,29,1);ctx.fillRect(barStart-2,126,32,1);
      words.push({text:'_',x:barStart-7,y:80,width:4,height:50,confidence:.99});x=barStart+34;continue;
    }
    const m=ctx.measureText(token);ctx.fillText(token,x,120);
    const rect={x:(x-m.actualBoundingBoxLeft)/3,y:(120-m.actualBoundingBoxAscent)/3,
      width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)/3,height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/3};
    expected.push({text:token,rect});
    words.push({text:token==='‰'?'%':token,x:token===symbol?barStart+15:x+m.width*.5-2,y:80,width:4,height:50,confidence:.99});
    x+=m.width;
  }
  const line={text:words.map(w=>w.text).join(''),words,x:20,y:80,width:x-15,height:50,confidence:.8},before=structuredClone(line);
  const pixels=ctx.getImageData(0,0,1200,170).data;
  const result=prepareOcrScene({scene:{number:1,width:400,height:170/3,items:[],sources:[],rules:[],risks:['image-page'],characters:0},
    result:{width:1200,height:170,lines:[line],rules:[]},pixels,width:1200,height:170,preserveGeometry:true,
    fitTypography:createOcrTypography(createCanvas),measurementContext:ctx});
  const item=result.scene.items.find(item=>item.type==='text');
  assert.equal(item.text.replace(/\s/gu,''),expected.map(c=>c.text).join(''),'rate spelling and writing-line ownership agree');
  assert.equal(item.words.length,expected.length,'every visible character retains proven source geometry');
  assert.equal(item.ocrRuleTokens.length,1);
  assert.equal(item.words.map(w=>w.text).join('').replace(/\s/gu,''),item.text.replace(/\s/gu,''));
  for(const [index,word]of item.words.entries()){
    assert(Math.abs(word.rect.x-expected[index].rect.x)<.7,'the source rate and neighbouring letters keep their horizontal positions');
    assert(Math.abs(word.rect.y-expected[index].rect.y)<.7,'source baselines do not fall back to average line geometry');
  }
  for(let xx=barStart-2;xx<barStart+30;xx++)assert.equal(result.pixels[(126*1200+xx)*4],0,'the full original line, including its ends, survives');
  assert.equal(result.scene.rules.length,0);assert.deepEqual(line,before);canvas.width=canvas.height=0;
}
for (const mask of [new Uint8Array(1024), new Uint8Array(1024).fill(1), new Uint8Array(32), null]) {
  let calls = 0;
  assert.equal(recoverOcrPermille({ text: '%', mask, width: 40, height: 40, confidence: .99,
    score: () => { calls++; return 1; } }), null);
  assert.equal(calls, 0, 'blank, solid, open and malformed masks do not request local glyph matching');
}
console.log('OCR rate symbols: independent source raster, percent/per-mille distinction, source ledger, erasure and conservative fallback passed.');
