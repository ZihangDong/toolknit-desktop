import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createOcrTypography } from '../src/features/pdf-to-word/adapters/ocr-typography.js';
import { trimOcrOwnedFragments } from '../src/features/pdf-to-word/core/ocr-fragment-ownership.js';

// A small area may use a different CJK face from the dominant line. A drifted
// comma must not inherit its neighbour's strokes merely because the otherwise
// strong line cannot be aligned using one uniform face.
for(const inner of ['FangSong','SimSun']){
  const phrase='请在此处核对材料名称、法律条款以及约定事项。',mark=[...phrase].indexOf('、');
  const canvas=createCanvas(1800,160),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,1800,160);ctx.fillStyle='black';ctx.fontKerning='none';
  const expected=[],words=[];let x=25;
  for(const [i,char]of [...phrase].entries()){
    ctx.font=`48px "${i>=mark-2&&i<=mark+2?inner:'SimHei'}"`;
    const m=ctx.measureText(char);ctx.fillText(char,x,110);
    expected.push({x:x-m.actualBoundingBoxLeft,y:110-m.actualBoundingBoxAscent,
      width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});
    words.push({text:char,x:x+m.width*.5-2+(i===mark?-30:0),y:50,width:4,height:60,confidence:.999});x+=m.width;
  }
  const left=Math.min(...expected.map(c=>c.x)),top=Math.min(...expected.map(c=>c.y));
  const right=Math.max(...expected.map(c=>c.x+c.width)),bottom=Math.max(...expected.map(c=>c.y+c.height));
  const pixels=ctx.getImageData(0,0,1800,160).data,line={text:phrase,x:left,y:top,width:right-left,height:bottom-top,words,confidence:.99};
  const before=structuredClone(line),options={line,pixels,width:1800,height:160,sx:3,sy:3,
    tight:{x:left/3,y:top/3,width:(right-left)/3,height:(bottom-top)/3},allowSymbolCorrection:true,
    inkAt:(x,y)=>pixels[(y*1800+x)*4]<220},fit=createOcrTypography(createCanvas);
  const control=fit({...options,alignmentBudget:{remaining:100000,punctuationFace:{remaining:0,pixelsRemaining:0},
    localMarks:{remaining:0,pixelsRemaining:0,anchorUpgrade:{remaining:0,pixelsRemaining:0}},
    localHan:{remaining:0,pixelsRemaining:0,anchorUpgrade:{remaining:0,pixelsRemaining:0}}}});
  const budget={remaining:100000},result=fit({...options,alignmentBudget:budget});
  const error=output=>Math.max(...output.words.flatMap((c,i)=>['x','y','width','height'].map(k=>Math.abs(c.rect[k]-expected[i][k]/3))));
  assert(error(control)>5,'the fixed-face control exposes the source ownership defect');
  assert(error(result)<1,'the independently rendered glyphs retain their actual ink bounds');
  assert.equal(result.words.map(c=>c.text).join(''),phrase);
  for(let i=0;i<words.length;i++)if(Math.abs(i-mark)>8)assert.deepEqual(result.words[i],control.words[i],'distant inferred styles remain exact');
  assert(budget.punctuationFace.remaining>=0&&budget.punctuationFace.remaining<20000);
  assert(budget.punctuationFace.pixelsRemaining>=0&&budget.punctuationFace.pixelsRemaining<1000000);
  assert.deepEqual(line,before,'font proposals do not rewrite OCR evidence');
  canvas.width=canvas.height=0;
}
const text='隐蔽工程验收，继续进入下道工序施工。2、如未经验收，甲方可以提出意见。';
{
  const word = (text, x, width = 12, score = .8, confidence = .999) => ({ text,
    rect: { x, y: 50, width, height: 14 }, baseline: 63, baselineX: x, preciseInk: true,
    ocrGlyphScore: score, confidence });
  const row = (id, words) => ({ id, sourceIds: [id], type: 'text', ocr: true, preciseInk: true,
    text: words.map(w => w.text).join(''), words, ocrFontScore: .8, ocrRecognitionConfidence: .98,
    rect: { x: words[0].rect.x, y: 50, width: words.at(-1).rect.x + words.at(-1).rect.width - words[0].rect.x, height: 14 } });
  const fixture = () => [row('complete', [word('甲', 10), word('乙', 24), word('在', 38)]),
    row('overlap', [word('三', 46, 4, .43, .9), word('年', 80), word('月', 110), word('日', 140)])];
  const input = fixture(), owner = structuredClone(input[0]), retained = structuredClone(input[1].words.slice(1));
  assert.equal(trimOcrOwnedFragments(input), input);
  assert.deepEqual(input[0], owner, 'complete source owner is unchanged');
  assert.equal(input[1].text, '年月日');
  assert.equal(input[1].ocrOriginalText, '三年月日');
  assert.deepEqual(input[1].words, retained, 'remaining glyph style and placement stay exact');
  assert.equal(input[1].rect.x, 80);
  assert.equal(input[1].ocrCorrections[0].ownerId, 'complete');
  assert.equal(input[1].ocrCorrections[0].ownerWord, 2);
  assert(!Object.hasOwn(input[1], 'ocrRecognitionConfidence'), 'a changed raw sequence cannot inherit its CTC mean');
  const corrected = structuredClone(input); trimOcrOwnedFragments(input); assert.deepEqual(input, corrected);
  for (const mutate of [
    a => { a[0].ocr = false; },
    a => { a[0].words[2].ocrGlyphScore = .69; },
    a => { a[0].words[2].confidence = .97; },
    a => { a[1].words[0].ocrGlyphScore = .65; },
    a => { a[1].words[0].confidence = .99; },
    a => { a[1].words[0].rect.x += 1; },
    a => { a[1].words[0].rect.width = 12; },
    a => { a[1].words[0].baseline += 2; },
    a => { a[1].words[0].preciseInk = false; },
    a => { a[1].sourceIds = ['unknown']; },
    a => { a[1].ocrOriginalText = a[1].text; },
    a => { a.push({ ...structuredClone(a[0]), id: 'competing', sourceIds: ['competing'] }); },
    a => { a[1].text = 'different-sequence'; },
  ]) {
    const rejected = fixture(); mutate(rejected); const before = structuredClone(rejected);
    trimOcrOwnedFragments(rejected); assert.deepEqual(rejected, before, 'uncertain ownership never deletes recognized text');
  }
  const suffix = [fixture()[0], row('suffix', [word('年', 0), word('月', 14), word('日', 28), word('三', 46, 4, .43, .9)])];
  trimOcrOwnedFragments(suffix); assert.equal(suffix[1].text, '年月日', 'the same proof can remove a trailing fragment');
  const interior = [fixture()[0], row('interior', [word('年', 20), word('三', 46, 4, .43, .9), word('月', 80), word('日', 110)])];
  const interiorBefore = structuredClone(interior); trimOcrOwnedFragments(interior); assert.deepEqual(interior, interiorBefore);
}
for(const [font,bold]of [['SimSun',false],['SimSun',true],['FangSong',false]]){
const canvas=createCanvas(2000,160),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
ctx.fillStyle='black';ctx.font=`${bold?'bold ':''}48px "${font}"`;ctx.fontKerning='none';let x=25;const expected=[],words=[];
for(const [index,char]of [...text].entries()){
 const m=ctx.measureText(char);ctx.fillText(char,x,100);
 expected.push({text:char,x:x-m.actualBoundingBoxLeft,y:100-m.actualBoundingBoxAscent,width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});
 // A late CTC peak drift must not move Chinese punctuation into a full glyph.
 words.push({text:char,x:x+m.width*.4-(index>=8?36:0),y:50,width:Math.max(3,m.width*.2),height:55,confidence:.99});x+=m.width;
}
const left=Math.min(...expected.map(w=>w.x)),top=Math.min(...expected.map(w=>w.y)),right=Math.max(...expected.map(w=>w.x+w.width)),bottom=Math.max(...expected.map(w=>w.y+w.height));
const line={text,x:left,y:top,width:right-left,height:bottom-top,words,confidence:.99},before=structuredClone(line),pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
const options={line,pixels,width:canvas.width,height:canvas.height,sx:3,sy:3,tight:{x:left/3,y:top/3,width:(right-left)/3,height:(bottom-top)/3},allowSymbolCorrection:true,inkAt:(x,y)=>pixels[(y*canvas.width+x)*4]<220};
const fit=createOcrTypography(createCanvas),budget={remaining:100000},result=fit({...options,alignmentBudget:budget});
if(!result?.ocrGlyphAlignment){let clusters=0,last=false;for(let xx=Math.floor(left);xx<Math.ceil(right);xx++){
 let ink=false;for(let yy=Math.floor(top);yy<Math.ceil(bottom);yy++)if(options.inkAt(xx,yy)){ink=true;break;}
 if(ink&&!last)clusters++;last=ink;
}console.error({font,bold,budget,clusters,characters:words.length,retainedFont:result?.font,retainedScore:result?.ocrFontScore});}
assert(result?.ocrGlyphAlignment,`${font}/${bold}: a suspicious ordered line is recovered from original glyph pixels`);
assert.equal(result.font,font);assert.equal(result.bold,bold,'scan antialias support preserves genuine emphasis');
assert.equal(result.words.map(w=>w.text).join(''),text);assert.equal(new Set(result.words.map(w=>w.font)).size,1);
for(const [i,word]of result.words.entries()){
 assert(Math.abs(word.rect.x-expected[i].x/3)<.7,`character${i} retains original horizontal ink position`);
 assert(Math.abs(word.rect.y-expected[i].y/3)<.7,`character${i} retains original vertical ink position`);
 assert(word.size>12&&word.size<20,'punctuation cannot inherit a full Chinese glyph and become oversized');
}
assert(budget.remaining>=0&&budget.remaining<100000);assert.deepEqual(line,before);
const tiny={remaining:1},bounded=fit({...options,alignmentBudget:tiny});assert(!bounded?.ocrGlyphAlignment);assert.equal(tiny.remaining,0,'exhausted search falls back without a negative budget');assert.deepEqual(line,before);
canvas.width=canvas.height=0;
}
// One malformed punctuation mark used to escape the multi-error trigger. Its
// CTC peak can steal the preceding glyph's right stroke without ruining the
// otherwise strong letters-only font score. Keep unrelated inferred styles.
for(const mixed of [false,true]){
  const phrase='五、材料、设备的供应',canvas=createCanvas(900,180),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,900,180);ctx.fillStyle='black';ctx.fontKerning='none';
  const words=[],expected=[];let x=25;
  for(const [i,char]of [...phrase].entries()){
    ctx.font=`${mixed&&i===6?'':'bold '}60px "SimHei"`;
    const m=ctx.measureText(char);ctx.fillText(char,x,115);
    expected.push({x:x-m.actualBoundingBoxLeft,y:115-m.actualBoundingBoxAscent,
      width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});
    const center=i===0?25+60*.35:i===1?25+60*.8:x+m.width*.5;
    words.push({text:char,x:center-6,y:50,width:12,height:70,confidence:.99});x+=m.width;
  }
  const left=Math.min(...expected.map(c=>c.x)),top=Math.min(...expected.map(c=>c.y));
  const right=Math.max(...expected.map(c=>c.x+c.width)),bottom=Math.max(...expected.map(c=>c.y+c.height));
  const line={text:phrase,x:left,y:top,width:right-left,height:bottom-top,words,confidence:.99},before=structuredClone(line);
  const pixels=ctx.getImageData(0,0,900,180).data,fit=createOcrTypography(createCanvas);
  const options={line,pixels,width:900,height:180,sx:3,sy:3,allowSymbolCorrection:true,
    tight:{x:left/3,y:top/3,width:(right-left)/3,height:(bottom-top)/3},inkAt:(x,y)=>pixels[(y*900+x)*4]<220};
  const control=fit({...options,alignmentBudget:{remaining:0}}),budget={remaining:100000};
  const result=fit({...options,alignmentBudget:budget});
  assert(result.ocrGlyphAlignment,'one corrupt comma with a strong neighbouring line still receives source ownership repair');
  assert(result.words[1].rect.height<control.words[1].rect.height*.6,'punctuation cannot retain the previous letter stroke');
  assert.equal(result.words.map(w=>w.text).join(''),phrase);
  for(const [i,word]of result.words.entries())for(const key of ['x','y','width','height'])
    assert(Math.abs(word.rect[key]-expected[i][key]/3)<.7,`single punctuation: original glyph${i}/${key}`);
  for(let i=2;i<result.words.length;i++){
    for(const key of ['font','bold','size','baseline','glyphScale'])assert.equal(result.words[i][key],control.words[i][key],`unaffected glyph${i}/${key}`);
  }
  assert.deepEqual(line,before);assert(budget.remaining>=0&&budget.remaining<100000);
  canvas.width=canvas.height=0;
}
// A punctuation peak may land beyond all of its ink, making one CTC cell
// completely empty. Recover the adjacent pair without averaging the whole line.
{
  const phrase='甲方支付预估总价，乙方按照双方约定开始工作。';
  const canvas=createCanvas(1600,170),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,1600,170);ctx.fillStyle='black';ctx.font='48px "SimSun"';ctx.fontKerning='none';
  const words=[],expected=[];let x=25;
  for(const char of phrase){
    const m=ctx.measureText(char);ctx.fillText(char,x,115);
    expected.push({x:x-m.actualBoundingBoxLeft,y:115-m.actualBoundingBoxAscent,
      width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});
    words.push({text:char,x:x+m.width*(char==='，'?.95:.5)-2,y:60,width:4,height:60,
      confidence:.99});x+=m.width;
  }
  const left=Math.min(...expected.map(c=>c.x)),top=Math.min(...expected.map(c=>c.y));
  const right=Math.max(...expected.map(c=>c.x+c.width)),bottom=Math.max(...expected.map(c=>c.y+c.height));
  const line={text:phrase,x:left,y:top,width:right-left,height:bottom-top,words,confidence:.9},before=structuredClone(line);
  const pixels=ctx.getImageData(0,0,1600,170).data,fit=createOcrTypography(createCanvas);
  const options={line,pixels,width:1600,height:170,sx:3,sy:3,allowSymbolCorrection:true,
    tight:{x:left/3,y:top/3,width:(right-left)/3,height:(bottom-top)/3},inkAt:(x,y)=>pixels[(y*1600+x)*4]<220};
  const control=fit({...options,alignmentBudget:{remaining:0}}),budget={remaining:100000};
  const result=fit({...options,alignmentBudget:budget});
  assert(!control?.words,'the misplaced comma really has an empty original CTC cell');
  assert.equal(result.words.map(w=>w.text).join(''),phrase);
  for(const [i,word]of result.words.entries())for(const key of ['x','y','width','height'])
    assert(Math.abs(word.rect[key]-expected[i][key]/3)<.7,`empty punctuation: original glyph${i}/${key}`);
  assert.deepEqual(line,before);assert(budget.remaining>=0);canvas.width=canvas.height=0;
}
{
  const phrase='1．甲方：按时付款，组织验收、确认方案。',canvas=createCanvas(1600,180),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,1600,180);ctx.fillStyle='black';ctx.font='48px "SimSun"';ctx.fontKerning='none';
  const words=[],expected=[];let x=25;
  for(const char of phrase){
    const m=ctx.measureText(char);ctx.fillText(char,x,115);
    expected.push({x:x-m.actualBoundingBoxLeft,y:115-m.actualBoundingBoxAscent,
      width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});
    const center=x+m.width*(char==='1'?.25:char==='．'?.05:/^[：，、]$/u.test(char)?.12:.5);
    words.push({text:char,x:center-2,y:60,width:4,height:60,confidence:.99});x+=m.width;
  }
  const left=Math.min(...expected.map(c=>c.x)),top=Math.min(...expected.map(c=>c.y));
  const right=Math.max(...expected.map(c=>c.x+c.width)),bottom=Math.max(...expected.map(c=>c.y+c.height));
  const line={text:phrase,x:left,y:top,width:right-left,height:bottom-top,words,confidence:.9},before=structuredClone(line);
  const pixels=ctx.getImageData(0,0,1600,180).data,fit=createOcrTypography(createCanvas);
  const options={line,pixels,width:1600,height:180,sx:3,sy:3,allowSymbolCorrection:true,
    tight:{x:left/3,y:top/3,width:(right-left)/3,height:(bottom-top)/3},inkAt:(x,y)=>pixels[(y*1600+x)*4]<220};
  const result=fit({...options,alignmentBudget:{remaining:100000}});
  assert.equal(result.words.map(w=>w.text).join(''),phrase);
  for(const [i,word]of result.words.entries())for(const key of ['x','y','width','height'])
    assert(Math.abs(word.rect[key]-expected[i][key]/3)<.7,`separate punctuation pairs: original glyph${i}/${key}`);
  assert.deepEqual(line,before);canvas.width=canvas.height=0;
}
for(const confidence of [.99,.5]){
  const phrase='一、工程概况',canvas=createCanvas(600,180),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,600,180);ctx.fillStyle='black';ctx.font='60px "SimSun"';ctx.fontKerning='none';
  const words=[],expected=[];let x=25;
  for(const char of phrase){
    const m=ctx.measureText(char);ctx.fillText(char,x,115);
    expected.push({x:x-m.actualBoundingBoxLeft,y:115-m.actualBoundingBoxAscent,
      width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});
    words.push({text:char,x:x+m.width*.5-3,y:50,width:6,height:75,confidence:char==='一'?confidence:.99});x+=m.width;
  }
  const left=expected[0].x+12,top=Math.min(...expected.map(c=>c.y));
  const right=Math.max(...expected.map(c=>c.x+c.width)),bottom=Math.max(...expected.map(c=>c.y+c.height));
  const line={text:phrase,x:left,y:top,width:right-left,height:75,words,confidence:.9},before=structuredClone(line);
  const pixels=ctx.getImageData(0,0,600,180).data;
  const fit=createOcrTypography(createCanvas),options={line,pixels,width:600,height:180,sx:3,sy:3,allowSymbolCorrection:true,
    tight:{x:left/3,y:top/3,width:(right-left)/3,height:(bottom-top)/3},inkAt:(x,y)=>pixels[(y*600+x)*4]<220};
  const result=fit(options);
  if(confidence>=.9){
    assert(result.words[0].ocrEdgeGlyphRecovery,'a proven continuous first stroke can extend beyond its clipped detector edge');
    assert(Math.abs(result.words[0].rect.x-expected[0].x/3)<.7);
    assert(Math.abs(result.words[0].rect.width-expected[0].width/3)<.7);
  }else assert(!result?.words?.some(w=>w.ocrEdgeGlyphRecovery),'weak first-character membership cannot own exterior ink');
  assert.deepEqual(line,before);canvas.width=canvas.height=0;
}
{
  const phrase='各部门严格执行基础设施维护管理规定24小时值班和领导带班制度';
  const canvas=createCanvas(2400,180),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,2400,180);
  ctx.fillStyle='black';ctx.fontKerning='none';let x=25;const expected=[],words=[];
  for(const char of phrase){
    ctx.font=`${char==='领'?'bold ':''}48px "Microsoft YaHei"`;
    const m=ctx.measureText(char);ctx.fillText(char,x,115);
    expected.push({x:x-m.actualBoundingBoxLeft,y:115-m.actualBoundingBoxAscent,
      width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});
    words.push({text:char,x:x+m.width*.5-2-(char==='时'?36:0),y:50,width:4,height:65,confidence:.99});x+=m.width;
  }
  const left=Math.min(...expected.map(c=>c.x)),top=Math.min(...expected.map(c=>c.y));
  const right=Math.max(...expected.map(c=>c.x+c.width)),bottom=Math.max(...expected.map(c=>c.y+c.height));
  const line={text:phrase,x:left,y:top,width:right-left,height:bottom-top,words,confidence:.99},before=structuredClone(line);
  const pixels=ctx.getImageData(0,0,2400,180).data,fit=createOcrTypography(createCanvas);
  const options={line,pixels,width:2400,height:180,sx:3,sy:3,allowSymbolCorrection:true,
    tight:{x:left/3,y:top/3,width:(right-left)/3,height:(bottom-top)/3},inkAt:(x,y)=>pixels[(y*2400+x)*4]<220};
  const control=fit({...options,alignmentBudget:{remaining:0}}),result=fit({...options,alignmentBudget:{remaining:100000}});
  const target=[...phrase].indexOf('时');
  assert(Math.abs(control.words[target].rect.x-expected[target].x/3)>1,'the original cell really assigned the wrong source strokes');
  for(const [i,word]of result.words.entries())for(const key of ['x','y','width','height'])
    assert(Math.abs(word.rect[key]-expected[i][key]/3)<.7,`one malformed Han glyph${i}/${key}`);
  for(let i=0;i<result.words.length;i++)if(Math.abs(i-target)>1)
    for(const key of ['font','bold','size','baseline','glyphScale'])assert.equal(result.words[i][key],control.words[i][key],`unaffected Han glyph${i}/${key}`);
  assert.deepEqual(line,before);canvas.width=canvas.height=0;
}
// The complete-line path must reject unrelated incorrect OCR spelling. A
// small punctuation window can still prove unchanged local glyph ownership.
for (const font of ['FangSong', 'SimSun']) {
  const phrase='双方约定、材料设备供应时间另行协商确定', canvas=createCanvas(1500,180), ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,1500,180);ctx.fillStyle='black';ctx.fontKerning='none';ctx.font=`bold 60px "${font}"`;
  const expected=[],words=[];let x=25;
  for(const [i,char]of [...phrase].entries()){
    const m=ctx.measureText(char);ctx.fillText(char,x,115);
    expected.push({x:x-m.actualBoundingBoxLeft,y:115-m.actualBoundingBoxAscent,
      width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});
    const peak=i===3?25+3*60+60*.35:i===4?25+4*60-60*.2:x+m.width*.5;
    words.push({text:i===phrase.length-1?'日':char,x:peak-6,y:50,width:12,height:70,confidence:.99});x+=m.width;
  }
  const line={text:words.map(w=>w.text).join(''),words,x:20,y:45,width:x-15,height:85,confidence:.99}, before=structuredClone(line);
  const pixels=ctx.getImageData(0,0,1500,180).data;
  const options={line,pixels,width:1500,height:180,sx:3,sy:3,allowSymbolCorrection:true,
    tight:{x:Math.min(...expected.map(c=>c.x))/3,y:Math.min(...expected.map(c=>c.y))/3,
      width:(Math.max(...expected.map(c=>c.x+c.width))-Math.min(...expected.map(c=>c.x)))/3,
      height:(Math.max(...expected.map(c=>c.y+c.height))-Math.min(...expected.map(c=>c.y)))/3},
    inkAt:(x,y)=>pixels[(y*1500+x)*4]<220,alignmentBudget:{remaining:100000,pixelsRemaining:4000000}};
  const fit=createOcrTypography(createCanvas),result=fit(options);
  assert(result?.ocrGlyphAlignment,`${font}: a distant spelling mismatch cannot block a completely proven local punctuation window`);
  assert.equal(result.words.map(w=>w.text).join(''),line.text,'local geometry repair never guesses the unrelated OCR spelling');
  for(const i of[3,4,5])for(const key of['x','y','width','height'])
    assert(Math.abs(result.words[i].rect[key]-expected[i][key]/3)<.7,`${font}: local boundary ${i}/${key}`);
  assert(result.words[4].size<25,'the comma-sized mark cannot inherit a full Han glyph height');
  const noBudget=fit({...options,alignmentBudget:{remaining:0,pixelsRemaining:0}});
  assert(!noBudget?.ocrGlyphAlignment,'local fallback respects exhausted work budgets');
  const last=expected.at(-1),missing=fit({...options,alignmentBudget:{remaining:100000,pixelsRemaining:4000000},
    inkAt:(x,y)=>x>=last.x-3?false:options.inkAt(x,y)});
  assert(!missing?.words,'a local repair cannot claim complete word geometry while a remote source cell is still empty');
  assert.deepEqual(line,before);canvas.width=canvas.height=0;
}
// A late recognition peak can clip the character used as an anchor as well as
// assign the following Han strokes to a punctuation mark. Recover the actual
// source glyph boundaries without guessing the distant incorrect OCR token.
{
  const phrase='双方确认登记名称代表人、主要负责人另行协商确定', canvas=createCanvas(1800,180),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,1800,180);ctx.fillStyle='black';ctx.font='bold 60px "FangSong"';ctx.fontKerning='none';
  const expected=[],centres=[];let x=25;
  for(const char of phrase){
    const m=ctx.measureText(char);ctx.fillText(char,x,115);centres.push(x+m.width*.5);
    expected.push({x:x-m.actualBoundingBoxLeft,y:115-m.actualBoundingBoxAscent,
      width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent});x+=m.width;
  }
  const target=[...phrase].indexOf('、'),words=[...phrase].map((text,i)=>({text:i===phrase.length-1?'日':text,
    x:centres[i]-6+(i===target-1?-45:i===target?-25:0),y:45,width:12,height:80,confidence:.999}));
  const line={text:words.map(w=>w.text).join(''),words,x:20,y:45,width:x-15,height:85,confidence:.99},before=structuredClone(line);
  const pixels=ctx.getImageData(0,0,1800,180).data,fit=createOcrTypography(createCanvas);
  const options={line,pixels,width:1800,height:180,sx:3,sy:3,allowSymbolCorrection:true,
    tight:{x:Math.min(...expected.map(c=>c.x))/3,y:Math.min(...expected.map(c=>c.y))/3,
      width:(Math.max(...expected.map(c=>c.x+c.width))-Math.min(...expected.map(c=>c.x)))/3,
      height:(Math.max(...expected.map(c=>c.y+c.height))-Math.min(...expected.map(c=>c.y)))/3},
    inkAt:(x,y)=>pixels[(y*1800+x)*4]<220};
  const control=fit({...options,alignmentBudget:{remaining:0,pixelsRemaining:0}});
  const result=fit({...options,alignmentBudget:{remaining:100000,pixelsRemaining:4000000}});
  assert(Math.abs(control.words[target-2].rect.width-expected[target-2].width/3)>2,'the old anchor is genuinely clipped');
  assert(control.words[target].size>30,'the original punctuation has inherited neighbouring Han strokes');
  assert(result?.ocrGlyphAlignment);
  for(let i=target-2;i<=target+2;i++)for(const key of ['x','y','width','height'])
    assert(Math.abs(result.words[i].rect[key]-expected[i][key]/3)<.7,`clipped anchor and punctuation ${i}/${key}`);
  assert.equal(result.words.map(w=>w.text).join(''),line.text,'source geometry cannot rewrite the distant spelling');
  assert.deepEqual(line,before);canvas.width=canvas.height=0;
}
// Mixed faces and an unrelated spelling error can prevent full-line recovery.
// A clipped Han stroke may still have a plausible width/height, so verify its
// complete local ink independently and leave all distant styles untouched.
{
  const phrase='各部门依照甲方要求共同履行合同保障合法权益',target=[...phrase].indexOf('方');
  const canvas=createCanvas(1800,180),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,1800,180);ctx.fillStyle='black';ctx.fontKerning='none';
  const expected=[],words=[];let x=25;
  for(const[i,char]of[...phrase].entries()){
    ctx.font=`48px "${Math.abs(i-target)<=2?'SimSun':'SimHei'}"`;
    const m=ctx.measureText(char);ctx.fillText(char,x,115);
    expected.push({x:(x-m.actualBoundingBoxLeft)/3,y:(115-m.actualBoundingBoxAscent)/3,
      width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)/3,height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/3});
    words.push({text:i===phrase.length-1?'日':char,x:x+m.width*.5-2+(i===target?24:0),y:50,width:4,height:65,confidence:.999});
    x+=m.width;
  }
  const left=Math.min(...expected.map(c=>c.x)),top=Math.min(...expected.map(c=>c.y));
  const right=Math.max(...expected.map(c=>c.x+c.width)),bottom=Math.max(...expected.map(c=>c.y+c.height));
  const pixels=ctx.getImageData(0,0,1800,180).data;
  const line={text:words.map(w=>w.text).join(''),words,x:left*3,y:top*3,width:(right-left)*3,height:(bottom-top)*3,confidence:.99};
  const before=structuredClone(line),fit=createOcrTypography(createCanvas),options={line,pixels,width:1800,height:180,sx:3,sy:3,
    tight:{x:left,y:top,width:right-left,height:bottom-top},allowSymbolCorrection:true,inkAt:(xx,yy)=>pixels[(yy*1800+xx)*4]<220};
  const disabled={remaining:0,pixelsRemaining:0,anchorUpgrade:{remaining:0,pixelsRemaining:0}};
  const control=fit({...options,alignmentBudget:{remaining:100000,pixelsRemaining:4000000,localHan:disabled}});
  const budget={remaining:100000,pixelsRemaining:4000000},result=fit({...options,alignmentBudget:budget});
  assert(Math.max(...control.words.flatMap((word,i)=>Math.abs(i-target)<=1
    ?['x','y','width','height'].map(k=>Math.abs(word.rect[k]-expected[i][k])):[]))>1,
    'plausible Han aspect ratios can still assign a source stroke to the wrong neighbour');
  assert(result.ocrGlyphAlignment);assert.equal(result.words.map(w=>w.text).join(''),line.text);
  for(let i=target-1;i<=target+1;i++)for(const key of['x','y','width','height'])
    assert(Math.abs(result.words[i].rect[key]-expected[i][key])<.7,`mixed-face Han ownership ${i}/${key}`);
  for(let i=0;i<result.words.length;i++)if(Math.abs(i-target)>2)
    assert.deepEqual(result.words[i],control.words[i],'local proposals preserve every remote glyph and style');
  assert(budget.localHan.remaining>=0&&budget.localHan.remaining<16000);
  assert(budget.localHan.pixelsRemaining>=0&&budget.localHan.pixelsRemaining<=800000);
  assert.equal(budget.localHan.anchorUpgrade.remaining,0,'the extra pass cannot start another anchor search');
  const exhausted={remaining:0,pixelsRemaining:0};fit({...options,alignmentBudget:exhausted});
  assert(!exhausted.localHan,'exhausted primary budgets cannot launch additional work');
  assert.deepEqual(line,before);canvas.width=canvas.height=0;
}
// After the established passes, another face can prove a punctuation pair
// whose neighbour was clipped. The far spelling error and styles stay exact.
for(const [font,shift] of [['SimSun',-24],['KaiTi',24]]){
  const phrase='各部门依照甲方要求共同履行合同，保障合法权益、主要负责人另行协商确定';
  const target=[...phrase].indexOf('、'),canvas=createCanvas(2600,180),ctx=canvas.getContext('2d');
  ctx.fillStyle='white';ctx.fillRect(0,0,2600,180);ctx.fillStyle='black';ctx.fontKerning='none';
  const expected=[],words=[];let x=25;
  for(const[i,char]of[...phrase].entries()){
    ctx.font=`48px "${Math.abs(i-target)<=4?font:'SimHei'}"`;
    const m=ctx.measureText(char);ctx.fillText(char,x,115);
    expected.push({x:(x-m.actualBoundingBoxLeft)/3,y:(115-m.actualBoundingBoxAscent)/3,
      width:(m.actualBoundingBoxLeft+m.actualBoundingBoxRight)/3,height:(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/3});
    words.push({text:i===phrase.length-1?'日':char,x:x+m.width*.5-2+(i===target?shift:0),y:50,width:4,height:65,confidence:.999});x+=m.width;
  }
  const left=Math.min(...expected.map(c=>c.x)),top=Math.min(...expected.map(c=>c.y));
  const right=Math.max(...expected.map(c=>c.x+c.width)),bottom=Math.max(...expected.map(c=>c.y+c.height));
  const pixels=ctx.getImageData(0,0,2600,180).data,line={text:words.map(w=>w.text).join(''),words,
    x:left*3,y:top*3,width:(right-left)*3,height:(bottom-top)*3,confidence:.99};
  const before=structuredClone(line),fit=createOcrTypography(createCanvas),disabled=()=>({remaining:0,pixelsRemaining:0,anchorUpgrade:{remaining:0,pixelsRemaining:0}});
  const options={line,pixels,width:2600,height:180,sx:3,sy:3,tight:{x:left,y:top,width:right-left,height:bottom-top},
    allowSymbolCorrection:true,inkAt:(xx,yy)=>pixels[(yy*2600+xx)*4]<220};
  const control=fit({...options,alignmentBudget:{remaining:100000,pixelsRemaining:4000000,localMarks:disabled()}});
  const budget={remaining:100000,pixelsRemaining:4000000},result=fit({...options,alignmentBudget:budget});
  const error=output=>Math.max(...output.words.flatMap((w,i)=>Math.abs(i-target)<=1
    ?['x','y','width','height'].map(k=>Math.abs(w.rect[k]-expected[i][k])):[]));
  assert(error(control)>2,'the established path exposes actual punctuation/anchor ownership error');
  assert(error(result)<.7,'all local glyph edges match the independently painted source');
  assert.equal(result.words.map(w=>w.text).join(''),line.text,'a geometric repair cannot guess a spelling');
  for(let i=0;i<words.length;i++)if(Math.abs(i-target)>1)
    assert.deepEqual(result.words[i],control.words[i],'every remote style and source edge is exact');
  for(const b of[budget.localMarks,budget.localMarks.anchorUpgrade]){
    assert(b.remaining>=0&&b.pixelsRemaining>=0,'the page and anchor allowances cannot go negative');
  }
  assert(budget.localMarks.remaining<20000&&budget.localMarks.pixelsRemaining<1000000);
  const exhausted={remaining:0,pixelsRemaining:0};fit({...options,alignmentBudget:exhausted});
  assert(!exhausted.localMarks,'an exhausted primary search cannot launch the retry');
  const explicit={remaining:100000,pixelsRemaining:4000000};fit({...options,fontHint:'SimHei',alignmentBudget:explicit});
  assert(!explicit.localMarks,'an explicit face hint cannot be replaced by the local retry');
  assert.deepEqual(line,before);canvas.width=canvas.height=0;
}
console.log('OCR glyph alignment: clipped anchors/strokes, mixed-face Han/mark ownership, unchanged remote spelling/styles and bounded fallback passed.');
