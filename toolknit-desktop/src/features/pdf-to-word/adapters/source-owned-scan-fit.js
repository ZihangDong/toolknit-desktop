// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { contains, overlaps, validRect } from '../core/geometry.js';
import { inferDocument, leafBlocks } from '../core/layout.js';
import { ocrFrameLayout } from '../core/ocr-frame-layout.js';
import { compressedPunctuationChunks } from '../core/text-chunks.js';
import { positionedTextRuns, runOptions } from './text-layout.js';
const FONTS=new Set(['SimSun','SimHei','Microsoft YaHei','FangSong','KaiTi']);
function components(mask, width, height) {
  const seen = new Uint8Array(mask.length), result = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start]; seen[start] = 1;
    let x = width, y = height, right = 0, bottom = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const at = queue[cursor], xx = at % width, yy = Math.floor(at / width);
      x = Math.min(x, xx); y = Math.min(y, yy); right = Math.max(right, xx + 1); bottom = Math.max(bottom, yy + 1);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = xx + dx, ny = yy + dy, next = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[next] && !seen[next]) {
          seen[next] = 1; queue.push(next);
        }
      }
    }
    result.push({ box: [x, y, right, bottom], count: queue.length });
  }
  return result;
}

function ordered(parts, minimum) {
  return parts.filter(part => part.count >= minimum).map(part => part.box)
    .sort((a, b) => a[0] + a[2] - b[0] - b[2] || a[1] + a[3] - b[1] - b[3]);
}

// Disconnected dots and a body can exchange their x-centre order after
// rasterization. Require a complete bijection instead of pairing by that order.
function componentEdge(output, source, pad, sx, sy) {
  if (output.length !== source.length || source.length > 8) return Infinity;
  const states = new Float64Array(1 << source.length); states.fill(Infinity); states[0] = 0;
  for (let used = 0; used < states.length; used++) {
    if (!Number.isFinite(states[used])) continue;
    let index = 0; for (let bits = used; bits; bits &= bits - 1) index++;
    if (index >= output.length) continue;
    for (let next = 0; next < source.length; next++) if (!(used & 1 << next)) {
      const cost = Math.max(...output[index].map((n, j) => Math.abs(n - pad - source[next][j]) / (j % 2 ? sy : sx)));
      const state = used | 1 << next; states[state] = Math.min(states[state], Math.max(states[used], cost));
    }
  }
  return states.at(-1);
}

function independentItems(items,out=[]) {
  for(const item of items||[]) {
    if(item.type==='table'||item.type==='option-grid')continue;
    if(item.words?.length)out.push(item);
    for(const col of item.columns||[])independentItems(col.blocks,out);
    for(const line of item.lines||[])independentItems(line.items,out);
  }
  return out;
}
function allWords(items,out=[]) {
  for(const item of items||[]) {
    out.push(...item.words||[]);
    for(const cell of item.cells||[])allWords(cell.blocks,out);
    for(const col of item.columns||[])allWords(col.blocks,out);
    for(const line of item.lines||[])allWords(line.items,out);
  }
  return out;
}
function actualPlan(scene,owner,word,replacement,context) {
  const update=node=> {
    if(node===owner)return {...node,words:node.words.map(w=>w===word?{...replacement,sourceScanProbe:true}:w)};
    const copy={...node};
    for(const key of ['items','blocks','lines','cells','columns'])if(Array.isArray(node[key]))copy[key]=node[key].map(update);
    return copy;
  };
  const page=inferDocument([{...scene,items:scene.items.map(update)}],{preserveGeometry:true}).pages[0];
  const frames=ocrFrameLayout(page),runs=[];
  for(const block of leafBlocks([...page.header,...page.blocks,...page.footer]))for(const line of block.lines||[]) {
    const chunks=frames.get(line.id)||compressedPunctuationChunks(line);
    for(const chunk of chunks)for(const run of positionedTextRuns(chunk,context))if(run.kind==='text')runs.push(run);
  }
  const found=runs.flatMap((run,index)=>run.item.sourceScanProbe?[index]:[]);
  return found.length===1?{runs,index:found[0],run:runs[found[0]]}:null;
}
function sameOtherRuns(before,after) {
  return before&&after&&before.index===after.index&&before.runs.length===after.runs.length&&before.runs.every((r,i)=>i===before.index||(
    r.item.text===after.runs[i].item.text&&Math.abs(r.x-after.runs[i].x)<=.025+1e-8&&r.baseline===after.runs[i].baseline
    &&r.position===after.runs[i].position&&r.spacing===after.runs[i].spacing&&JSON.stringify(r.options)===JSON.stringify(after.runs[i].options)));
}
function paintRun(context,run) {
  const {item,x,baseline,spacing}=run,o=runOptions(item),horizontal=(o.scale||100)/100;
  context.font=`${o.italics?'italic ':''}${o.bold?'bold ':''}${o.size/2}px "${o.font.ascii.replaceAll('"','')}"`;
  context.fontKerning='none';context.fillStyle='#'+o.color;context.textBaseline='alphabetic';
  context.save();context.translate(x,baseline);context.scale(horizontal,1);
  if('letterSpacing'in context){context.letterSpacing=spacing/20/horizontal+'px';context.fillText(item.text,0,0);context.letterSpacing='0px';}
  else context.fillText(item.text,0,0);
  context.restore();
}

// Share the actual serialized run plan with spelling recovery. Its staged
// proposal must preserve every neighbouring run before binding a new glyph.
export { actualPlan as sourceOwnedWordPlan, sameOtherRuns as sameOtherSourceRuns, paintRun as paintSourceWordRun };
/** Source-owned independent scan fitting. It shares the unchanged edge-phase
 * remainder AFTER the established table fitter. It never enters ordinary cells,
 * generates fonts, changes spelling/confidence/family/baseline, or replaces an accepted fit.
 * An ordinary .98-.99 OCR glyph may use a bounded serialized size proposal;
 * this never authorizes the separate .99 generated-outline path.
 * The .75 raw criterion is the existing ordinary PHYSICAL-fit criterion; the
 * generated-outline .95 criterion and original formal1pt/.95 stay untouched.
 */
export function fitSourceOwnedScanGlyphs({scene,data,createCanvas,accepted,allowance,maxChanges,check,samples=null}) {
  const {pixels,width,height}=data,sx=width/scene.width,sy=height/scene.height;
  const sources=new Map((scene.sources||[]).map(s=>[s.id,s])),words=allWords(scene.items);
  const rules=(scene.rules||[]).filter(r=>['h','v'].includes(r.axis)&&Number.isFinite(r.at+r.from+r.to));
  const hitsRule=r=>rules.some(rule=>overlaps(r,rule.axis==='h'?{x:rule.from,y:rule.at-.25,width:rule.to-rule.from,height:.5}
    :{x:rule.at-.25,y:rule.from,width:.5,height:rule.to-rule.from},0));
  const spend=n=>{check();if(n>allowance.remaining)return false;allowance.remaining-=n;return true;};
  const work=[];
  for(const item of independentItems(scene.items))for(const word of item.words||[]) {
    const cached=samples?.get(word),tight=cached?.tight,r=word.rect;
    const priority=tight&&validRect(r)?Math.max(Math.abs(r.x-tight.x),Math.abs(r.y-tight.y),Math.abs(r.width-tight.width),Math.abs(r.height-tight.height)):0;
    work.push({item,word,cached,priority});
  }
  work.sort((a,b)=>b.priority-a.priority);
  for(const {item,word,cached}of work) {
    const supplementary=word.confidence>=.98&&word.confidence<.99;
    check();
    if(!item.ocr||item.ocrNative||item.raster||item.italic||item.fontAssetId||!item.preciseInk||!(item.ocrFontScore>=.65)
      ||!FONTS.has(item.font)||!validRect(item.rect)||item.sourceIds?.length!==1||item.words.length>96)continue;
    const source=sources.get(item.sourceIds[0]);
    if(!source||source.disposition!=='editable'||source.text!==item.text)continue;
      check();
      if(accepted.size>=maxChanges||allowance.remaining<1)return allowance;

      if(accepted.has(word)||word.ocrPhysicalFit||word.fontAssetId||word.italic||word.ocrRuling||!word.preciseInk
        ||!(word.confidence>=.98&&word.ocrGlyphScore>=0&&word.ocrGlyphScore<.9)
        ||!/^\p{Script=Han}$/u.test(word.text||'')||!FONTS.has(word.font)||!validRect(word.rect)
        ||word.rect.width<3||word.rect.height<3||word.rect.width>30||word.rect.height>30)continue;
      const r=word.rect,expanded={x:r.x-.4,y:r.y-.4,width:r.width+.8,height:r.height+.8};
      if(hitsRule(expanded)){continue;}
      // Legacy physical sampling excludes these ordinary lower-confidence
      // glyphs. Pay for a fresh sample from the SAME remaining allowance;
      // a cached sample whose source rectangle changed is still invalid.
      if(samples&&(!cached&&!supplementary||cached&&cached.rectKey!==JSON.stringify(word.rect)))continue;
      const x=cached?.x??Math.max(0,Math.floor(expanded.x*sx)),y=cached?.y??Math.max(0,Math.floor(expanded.y*sy));
      const w=cached?.w??Math.min(width,Math.ceil((expanded.x+expanded.width)*sx))-x,h=cached?.h??Math.min(height,Math.ceil((expanded.y+expanded.height)*sy))-y;
      if(w<3||h<3||w*h>20000||!cached&&!spend(w*h)){continue;}
      const mask=cached?.mask??new Uint8Array(w*h);let ink=cached?.ink??0,bx=cached?.bx??w,by=cached?.by??h,br=cached?.br??0,bb=cached?.bb??0,border=false,color=cached?.color??false;
      if(!cached)for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++) {
        const at=((y+yy)*width+x+xx)*4,low=Math.min(pixels[at],pixels[at+1],pixels[at+2]);
        if(low>=180)continue;
        mask[yy*w+xx]=1;ink++;bx=Math.min(bx,xx);by=Math.min(by,yy);br=Math.max(br,xx+1);bb=Math.max(bb,yy+1);
        if(Math.max(pixels[at],pixels[at+1],pixels[at+2])-low>30)color=true;
        if(!xx||!yy||xx===w-1||yy===h-1)border=true;
      }
      if(border||color||ink<10){continue;}
      const tight={x:(x+bx)/sx,y:(y+by)/sy,width:(br-bx)/sx,height:(bb-by)/sy};
      // Preserve the established high-confidence path. For supplemental
      // ordinary glyphs, a correct CTC box can still have a wrong painted
      // size; the actual Writer run below must independently prove the error.
      const geometryDiscrepancy=Math.max(Math.abs(r.x-tight.x),Math.abs(r.y-tight.y),Math.abs(r.width-tight.width),Math.abs(r.height-tight.height));
      if(geometryDiscrepancy<=1&&!supplementary)continue;
      if(!contains(item.rect,tight,.25)||!contains(source.rect,tight,.25)||hitsRule(tight)
        ||words.some(other=>other!==word&&validRect(other.rect)&&overlaps(tight,other.rect,.1))){continue;}
      const sourceParts=components(mask,w,h),minimum=Math.max(4,Math.floor(ink*.02));
      if(!sourceParts.length||sourceParts.length>8||sourceParts.some(p=>p.count<minimum)
        ||sourceParts.reduce((sum,p)=>sum+p.count,0)!==ink){continue;}
      const sourceBoxes=ordered(sourceParts,minimum);
      let canvas,measure;
      try {
        const pad=Math.ceil(Math.max(sx,sy)*2),pw=w+pad*2,ph=h+pad*2;
        canvas=createCanvas(pw,ph);measure=createCanvas(1,1);
        const context=canvas.getContext('2d',{willReadFrequently:true}),mc=measure.getContext('2d');
        const before=actualPlan(scene,item,word,word,mc);
        if(!before){continue;}
        const score=candidate=> {
          if(!spend(pw*ph))return null;
          const after=actualPlan(scene,item,word,candidate,mc);
          if(!sameOtherRuns(before,after))return null;
          context.setTransform(1,0,0,1,0,0);context.fillStyle='#fff';context.fillRect(0,0,pw,ph);
          context.setTransform(sx,0,0,sy,-x+pad,-y+pad);paintRun(context,after.run);
          const rgba=context.getImageData(0,0,pw,ph).data,out=new Uint8Array(pw*ph);let got=0,common=0,clipped=false;
          for(let yy=0;yy<ph;yy++)for(let xx=0;xx<pw;xx++) {
            const at=(yy*pw+xx)*4;if(Math.min(rgba[at],rgba[at+1],rgba[at+2])>=180)continue;
            out[yy*pw+xx]=1;got++;
            if(!xx||!yy||xx===pw-1||yy===ph-1)clipped=true;
            const rx=xx-pad,ry=yy-pad;if(rx>=0&&ry>=0&&rx<w&&ry<h)common+=mask[ry*w+rx];
          }
          const outputParts=components(out,pw,ph);
          const edge=clipped||outputParts.some(p=>p.count<minimum)?Infinity:componentEdge(ordered(outputParts,minimum),sourceBoxes,pad,sx,sy);
          return {f1:2*common/Math.max(1,ink+got),edge,sourcePixels:ink,sourceComponents:sourceParts.length};
        };
        const initial=score(word);
        if(!initial||!(initial.edge>.75)||initial.f1>=.9){continue;}
        const o=runOptions(word);mc.font=`${o.italics?'italic ':''}${o.bold?'bold ':''}1000px "${o.font.ascii.replaceAll('"','')}"`;mc.fontKerning='none';
        const m=mc.measureText(word.text),height=(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)/1000;
        const proposed=o.size/2;let winner=null,best=initial;
        const direct=Math.round(tight.height/height*2)/2;
        const sizes=[...new Set([proposed,...(supplementary&&Math.abs(direct-proposed)<=1?[direct-.5,direct,direct+.5]:[])])]
          .filter(size=>Math.abs(size-proposed)<=1);
        for(const size of sizes) {
          if(!(size>=4&&size<=120))continue;
          const center=Math.round(tight.width/((m.actualBoundingBoxLeft+m.actualBoundingBoxRight)/1000*size)*100);
          for(const scale of[center])for(const offset of[0]) {
            if(!(scale>=25&&scale<=400))continue;
            const candidate={...word,size:size===proposed?word.size:size,rect:{...tight,y:tight.y+offset},glyphScale:scale},value=score(candidate);
            if(value&&value.edge<=.75&&value.edge<=initial.edge-1/Math.max(sx,sy)+1e-8&&value.f1>=Math.max(.75,initial.f1+.05)
              &&(!winner||value.f1>best.f1||value.f1===best.f1&&value.edge<best.edge)){winner=candidate;best=value;}
          }
        }
        if(!winner){continue;}
        check();
        Object.assign(word,{rect:winner.rect,glyphScale:winner.glyphScale,size:winner.size,
          ocrPhysicalFit:{phase:'source-owned-independent',priorGlyphScore:word.ocrGlyphScore,before:initial.f1,after:best.f1,
            edgeBefore:Number.isFinite(initial.edge)?initial.edge:null,edgeAfter:best.edge,sourcePixels:ink,sourceComponents:sourceParts.length}});
        accepted.add(word);
      }finally{if(canvas)canvas.width=canvas.height=0;if(measure)measure.width=measure.height=0;}
  }
  return allowance;
}
