// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { ruledTables, ruledTableGrids } from './tables.js';
import { groupLines } from './text.js';
import { contains, overlaps } from './geometry.js';
import { wordError, LIMITS } from './input.js';
import { withoutTextStrokeRules, localOcrWritingRules, extendIsolatedWritingRules, provenTextStrokeRules } from './ocr-rule-ownership.js';
import { planOcrLineBands } from './ocr-line-bands.js';
import { nativeCaptionedFigureIds, retainUnverifiedImageSources } from './ocr-figure-ownership.js';
import {splitOcrTableCells} from './ocr-table-cells.js';
import {ocrRecognitionConfidence} from './ocr-math.js';
import {trimOcrOwnedFragments} from './ocr-fragment-ownership.js';
import {ocrSignatureFormGrids} from './ocr-signature-forms.js';
import { photographicOcrRegions } from './ocr-photo-regions.js';
import { scanFigureRegions } from './scan-figure-regions.js';

export function needsPageOcr(scene) {
  const size = scene.width * scene.height;
  const sources=new Map((scene.sources||[]).map(source=>[source.id,source]));
  const figures=nativeCaptionedFigureIds(scene);
  return scene.rasterPage || scene.risks.includes('image-page') || scene.items.some(item => item.type === 'image'
    && item.rect.width * item.rect.height > size * .18 && !figures.has(item.id) && !readableNativeImage(item,sources));
}
function readableNativeImage(item,sources) {
  return Boolean(item.sourceIds?.length&&item.sourceIds.every(id=>typeof sources.get(id)?.text==='string'
    &&!/\p{Cc}|\ufffd/u.test(sources.get(id).text)));
}
const plain = text => String(text).normalize('NFKC').replace(/[\s\p{P}]/gu, '').toLowerCase();
function nativeText(items) {
  return items.flatMap(item => item.type === 'text' ? [item] : item.type === 'table' ? item.cells.flatMap(cell => cell.blocks.flatMap(block => (block.lines || []).flatMap(line => line.items.filter(item => item.type === 'text')))) : []);
}
function pixelRect(rect, sx, sy, width, height) {
  const x = Math.max(0, Math.floor(rect.x * sx)), y = Math.max(0, Math.floor(rect.y * sy));
  return { x, y, right: Math.min(width, Math.ceil((rect.x + rect.width) * sx)), bottom: Math.min(height, Math.ceil((rect.y + rect.height) * sy)) };
}
function glyphBox(rect, sx, sy, width, height) {
  const box=pixelRect(rect,sx,sy,width,height),pad=Math.max(2,Math.min(8,Math.ceil((box.bottom-box.y)*.18)));
  return {x:Math.max(0,box.x-pad),y:Math.max(0,box.y-pad),right:Math.min(width,box.right+pad),bottom:Math.min(height,box.bottom+pad)};
}
function background(pixels, width, height) {
  const colors = [];
  for (const [x,y] of [[.02,.02],[.98,.02],[.02,.98],[.98,.98],[.5,.02],[.02,.5]]) {
    const offset = (Math.min(height-1,Math.floor(y*height))*width + Math.min(width-1,Math.floor(x*width)))*4;
    colors.push([pixels[offset],pixels[offset+1],pixels[offset+2]]);
  }
  return [0,1,2].map(c => colors.map(p=>p[c]).sort((a,b)=>a-b)[Math.floor(colors.length/2)]);
}
function localPaper(pixels, width, height, box) {
  const colors=[];
  for(const [a,b]of [[0,0],[.5,0],[1,0],[0,.5],[1,.5],[0,1],[.5,1],[1,1]]){
    const x=Math.max(0,Math.min(width-1,Math.round(box.x+(box.right-box.x)*a))),y=Math.max(0,Math.min(height-1,Math.round(box.y+(box.bottom-box.y)*b))),o=(y*width+x)*4;
    colors.push([pixels[o],pixels[o+1],pixels[o+2]]);
  }
  const fill=[0,1,2].map(c=>colors.map(p=>p[c]).sort((a,b)=>a-b)[4]);
  return colors.filter(color=>color.every((c,i)=>Math.abs(c-fill[i])<30)).length>=5?fill:null;
}
const provenColorTypography=item=>Boolean(item?.words?.length&&item.ocrFontScore>=.7&&item.ocrColorInkError<=.15);
// An isolated weak recognizer token can be a window/photograph texture. A
// guessed default font is not evidence that the source actually contains it.
// Detection-capped line confidence must not veto a confident CTC sequence.
const unprovenShortToken = item => item.ocr && !item.ocrNative && /^[\p{L}\p{N}]{1,2}$/u.test(item.text)
  && (item.ocrRecognitionConfidence ?? item.confidence) < .7
  && !(item.ocrFontScore >= .8 && item.words?.length
    && item.words.map(word => word.text).join('') === item.text
    && item.words.every(word => word.ocrGlyphScore >= .8));
/** Reconstruct editable sources and remove only their neutral raster ink.
 * Coloured stamps/illustrations remain visible. Unknown ink is never discarded.
 */
export function prepareOcrScene({ scene, result, pixels, width, height, preserveGeometry = false, preserveScanFigures = false, measurementContext = null, fitTypography = null, check = () => {} }) {
  if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== width*height*4 || !width || !height || width*height > 16_000_000
    || !Array.isArray(result?.lines) || result.lines.length > 1000 || result.width !== width || result.height !== height) throw wordError('image');
  const sx=width/scene.width, sy=height/scene.height, paper=background(pixels,width,height), clean=pixels.slice();
  const figures=preserveGeometry&&preserveScanFigures?scanFigureRegions({scene,result,pixels,width,height,check}):[];
  const figureOwner=new Map(figures.flatMap(figure=>figure.lineIndexes.map(index=>[index,figure.id])));
  const figureSources=new Map(figures.map(figure=>[figure.id,[]]));
  const dark=paper.reduce((a,b)=>a+b,0)<384;
  const neutral=offset=>Math.max(pixels[offset],pixels[offset+1],pixels[offset+2])-Math.min(pixels[offset],pixels[offset+1],pixels[offset+2])<45;
  const red=offset=>pixels[offset]>pixels[offset+1]*1.3+20&&pixels[offset]>pixels[offset+2]*1.3+20;
  const detectedRules=(result.rules||[]).slice(0,3000).filter(r=>r&&['h','v'].includes(r.axis)&&[r.at,r.from,r.to].every(Number.isFinite)&&r.to>r.from);
  const rasterRules=withoutTextStrokeRules(detectedRules,result.lines);
  const scanRules=rasterRules
    .map(rule=>({axis:rule.axis,at:rule.at/(rule.axis==='h'?sy:sx),from:rule.from/(rule.axis==='h'?sx:sy),to:rule.to/(rule.axis==='h'?sx:sy)}));
  const rasterOwners=new Set(scanRules),glyphOwnedRules=new Set();
  const rules=[...(scene.rules||[]),...scanRules].filter((rule,index,list)=>list.findIndex(other=>other.axis===rule.axis&&Math.abs(other.at-rule.at)<.5&&Math.abs(other.from-rule.from)<1&&Math.abs(other.to-rule.to)<1)===index)
    .filter(rule=>!figures.some(figure=>overlaps(figure.rect,rule.axis==='h'
      ?{x:rule.from,y:rule.at-.25,width:rule.to-rule.from,height:.5}
      :{x:rule.at-.25,y:rule.from,width:.5,height:rule.to-rule.from},0))).slice(0,3000);
  const onRule=(x,y,list)=>list?.some(r=>r.axis==='h'?Math.abs(y/sy-r.at)<=1&&x/sx>=r.from&&x/sx<=r.to:Math.abs(x/sx-r.at)<=1&&y/sy>=r.from&&y/sy<=r.to);
  const lineBands=planOcrLineBands(result.lines,{width,height,
    rules:rules.map(rule=>({axis:rule.axis,at:rule.at*(rule.axis==='h'?sy:sx),from:rule.from*(rule.axis==='h'?sx:sy),to:rule.to*(rule.axis==='h'?sx:sy)})),
    inkAt:(x,y)=>{const offset=(y*width+x)*4;
      return (neutral(offset)||!red(offset))&&(dark?Math.max(pixels[offset],pixels[offset+1],pixels[offset+2])>Math.max(...paper)+35
        :Math.min(pixels[offset],pixels[offset+1],pixels[offset+2])<Math.max(30,Math.min(...paper)-35));}});
  let text=nativeText(scene.items).filter(item=>!item.raster).map(item=>({...item,ocrNative:true}));
  // A native fallback already owns its exact text/graphics. Whole-page OCR
  // must not turn a diagram, digit illustration or rejected table into prose.
  const nativeSources=new Map(scene.sources.map(source=>[source.id,source]));
  const nativeFigures=nativeCaptionedFigureIds(scene);
  const protectedImages=scene.rasterPage?[]:scene.items.filter(item=>item.type==='image'
    &&(nativeFigures.has(item.id)||readableNativeImage(item,nativeSources)||!item.sourceIds?.length&&text.length&&item.rect.width*item.rect.height<scene.width*scene.height*.18));
  const retainedRasterIds=new Set(protectedImages.flatMap(item=>item.sourceIds||[]));
  const retainedOcrSources=new Map(), insidePhotograph=photographicOcrRegions(scene,pixels,width,height);
  for(const [index,owner]of figureOwner){
    const line=result.lines[index],id=`p${scene.number}:ocr${index}`;
    const rect={x:line.x/sx,y:line.y/sy,width:line.width/sx,height:line.height/sy};
    retainedRasterIds.add(id);figureSources.get(owner).push(id);
    retainedOcrSources.set(id,{id,text:line.text.trim(),rect,order:index,disposition:'visible-image',ocrUnverified:true});
  }
  const erase=[],unresolved=[],lineFitBudget={remaining:4_000_000},alignmentBudget={remaining:100_000,pixelsRemaining:4_000_000},writingLineBudget={remaining:500_000};
  const writingExtensionBudget={remaining:250_000};
  const measuringBaseRules=[...rules,...extendIsolatedWritingRules(rasterRules,{width,height,budget:writingExtensionBudget,
    inkAt:(x,y)=>{const offset=(y*width+x)*4;return neutral(offset)&&(dark
      ?Math.max(pixels[offset],pixels[offset+1],pixels[offset+2])>Math.max(...paper)+35
      :Math.min(pixels[offset],pixels[offset+1],pixels[offset+2])<Math.max(30,Math.min(...paper)-35));}})
    .map(rule=>({axis:rule.axis,at:rule.at/sy,from:rule.from/sx,to:rule.to/sx}))];
  for (const [index,line] of result.lines.entries()) {
    if(figureOwner.has(index))continue;
    if (typeof line.text!=='string'||!line.text.trim()||line.text.length>8000||![line.x,line.y,line.width,line.height,line.confidence].every(Number.isFinite)
      ||line.width<=0||line.height<=0||line.confidence<.5) continue;
    if(line.height>line.width*1.5&&[...line.text.trim()].length>2)continue; // Preserve vertical type until the Word writer can express its direction.
    const band=lineBands.get(index),bandTop=Math.max(line.y,band?.top??line.y),end=Math.min(line.y+line.height,band?.bottom??line.y+line.height);
    const rect={x:Math.max(0,line.x/sx),y:Math.max(0,bandTop/sy),width:Math.min(scene.width,line.width/sx),height:Math.min(scene.height,(end-bandTop)/sy)};
    if (!contains({x:0,y:0,width:scene.width,height:scene.height},rect,1)) continue;
    if(protectedImages.some(image=>contains(image.rect,rect,2)))continue;
    const recognized=plain(line.text);
    // A spelling difference in OCR must never create a second copy over
    // genuine native text. Keep ambiguous mixed-line remainder in the image.
    if(text.some(item=>item.ocrNative&&Math.min(item.rect.x+item.rect.width,rect.x+rect.width)-Math.max(item.rect.x,rect.x)>Math.min(item.rect.width,rect.width)*.45
      &&Math.min(item.rect.y+item.rect.height,rect.y+rect.height)-Math.max(item.rect.y,rect.y)>Math.min(item.rect.height,rect.height)*.5))continue;
    const matches=text.filter(item=>item.ocrNative&&overlaps(item.rect,rect)&&plain(item.text)&&recognized.includes(plain(item.text)));
    if(matches.reduce((n,item)=>n+plain(item.text).length,0)>=recognized.length*.65)continue;
    // Native text takes precedence. A partially matching OCR line is retained
    // only where it does not spatially duplicate a real editable text run.
    if (text.some(item=>overlaps(item.rect,rect)&&plain(item.text).includes(plain(line.text)))) continue;
    if (insidePhotograph(rect)) {
      const id=`p${scene.number}:ocr${index}`;
      retainedRasterIds.add(id);
      retainedOcrSources.set(id,{id,text:line.text.trim(),rect,order:index,disposition:'visible-image',ocrUnverified:true});
      continue;
    }
    const box=glyphBox(rect,sx,sy,width,height);
    if(band){box.y=Math.max(box.y,Math.ceil(band.top));box.bottom=Math.min(box.bottom,Math.floor(band.bottom));}
    const fill=localPaper(pixels,width,height,box);
    if(!fill)continue; // Keep text embedded in complex photographic backgrounds as an image.
    const lineDark=fill.reduce((a,b)=>a+b,0)<384;
    const ink=offset=>lineDark?Math.max(pixels[offset],pixels[offset+1],pixels[offset+2])>Math.max(...fill)+35:Math.min(pixels[offset],pixels[offset+1],pixels[offset+2])<Math.max(30,Math.min(...fill)-35);
    const colored=line.confidence>=.85;
    // A lower OCR spelling score must not make blue/green body text disappear
    // from measurement while its pale antialias fringe becomes a second line.
    // Inspect its full ink, then require local glyph proof before erasing it.
    const inspectColor=colored||Boolean(fitTypography&&line.confidence>=.7);
    const localRules=[...(band?.rules||[]),...localOcrWritingRules(line,{width,height,budget:writingLineBudget,
      inkAt:(x,y)=>{const offset=(y*width+x)*4;return ink(offset)&&(neutral(offset)||inspectColor&&!red(offset));}})];
    const localExtensions=extendIsolatedWritingRules(localRules,{width,height,budget:writingExtensionBudget,
      inkAt:(x,y)=>{const offset=(y*width+x)*4;return ink(offset)&&(neutral(offset)||inspectColor&&!red(offset));}});
    const protectedLocalRules=localRules.map(rule=>localExtensions.find(extra=>extra.axis===rule.axis&&extra.at===rule.at
      &&extra.from<=rule.from&&extra.to>=rule.to)||rule);
    const measuringRules=protectedLocalRules.length?[...measuringBaseRules,...protectedLocalRules.map(rule=>({axis:rule.axis,at:rule.at/(rule.axis==='h'?sy:sx),from:rule.from/(rule.axis==='h'?sx:sy),to:rule.to/(rule.axis==='h'?sx:sy),...(rule.isolatedWriting?{isolatedWriting:true}:{})}))]:measuringBaseRules;
    let nearbyRules=measuringRules.filter(r=>!glyphOwnedRules.has(r)&&(r.axis==='h'
      ?r.at>=box.y/sy-1&&r.at<=box.bottom/sy+1&&r.to>=box.x/sx-1&&r.from<=box.right/sx+1
      :r.at>=box.x/sx-1&&r.at<=box.right/sx+1&&r.to>=box.y/sy-1&&r.from<=box.bottom/sy+1));
    let left=box.right,top=box.bottom,right=box.x,bottom=box.y, count=0,chromatic=0;
    const channels=Array.from({length:3},()=>new Uint32Array(256));
    // Measure within the detector region. Padding is for erasure only; adjacent
    // captions and cell fills outside it must not inflate the inferred font.
    const measureBox=pixelRect(rect,sx,sy,width,height);
    for(let y=measureBox.y;y<measureBox.bottom;y++)for(let x=measureBox.x;x<measureBox.right;x++){
      const offset=(y*width+x)*4;
      if(!ink(offset)||!neutral(offset)&&(!inspectColor||red(offset)))continue;
      // Do not count the table's long borders as a glyph's ink bounds.
      if(onRule(x,y,nearbyRules))continue;
      left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);
      count++;if(!neutral(offset))chromatic++;for(let c=0;c<3;c++)channels[c][pixels[offset+c]]++;
    }
    if(right<=left||bottom<=top)continue;
    let tight={x:left/sx,y:top/sy,width:(right-left)/sx,height:(bottom-top)/sy};
    let size=Math.max(4,Math.min(120,tight.height*1.13));
    let baseline=tight.y+tight.height*.94;
    if(measurementContext){
      measurementContext.font='100px "Microsoft YaHei"';
      const metrics=measurementContext.measureText(line.text.trim()),inkHeight=metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent;
      if(inkHeight>0){size=Math.max(4,Math.min(120,tight.height*100/inkHeight));baseline=tight.y+metrics.actualBoundingBoxAscent*size/100;}
    }
    const id=`p${scene.number}:ocr${index}`;
    const needsColorProof=!colored&&chromatic>Math.max(1,count*.25);
    const typographyInput={line,pixels,width,height,sx,sy,tight,allowLineFit:true,lineFitBudget,alignmentBudget,allowSymbolCorrection:true,
      protectedRules:nearbyRules.map(rule=>({axis:rule.axis,at:rule.at*(rule.axis==='h'?sy:sx),from:rule.from*(rule.axis==='h'?sx:sy),to:rule.to*(rule.axis==='h'?sx:sy),...(rule.isolatedWriting?{isolatedWriting:true}:{})})),
      ruleInkAt:(x,y)=>{const offset=(y*width+x)*4;return ink(offset)&&(neutral(offset)||inspectColor&&!red(offset));},requireColorEvidence:needsColorProof,inkAt:(x,y)=>{const offset=(y*width+x)*4;
      return ink(offset)&&(neutral(offset)||inspectColor&&!red(offset))&&!onRule(x,y,nearbyRules);}};
    let typography=fitTypography?.(typographyInput);
    const suspect=nearbyRules.filter(rule=>rasterOwners.has(rule));
    const proofPixels=(measureBox.right-measureBox.x)*(measureBox.bottom-measureBox.y);
    if(fitTypography&&line.confidence>=.85&&suspect.length&&proofPixels<=alignmentBudget.pixelsRemaining){
      alignmentBudget.pixelsRemaining-=proofPixels;
      const raw=fitTypography({...typographyInput,tight:rect,protectedRules:[],inkAt:typographyInput.ruleInkAt,glyphOwnershipEvidence:true});
      const proven=raw?.ocrFontScore>=.8?provenTextStrokeRules(suspect.map(rule=>({original:rule,axis:rule.axis,
        at:rule.at*(rule.axis==='h'?sy:sx),from:rule.from*(rule.axis==='h'?sx:sy),to:rule.to*(rule.axis==='h'?sx:sy)})),raw.words,{sx,sy}):new Set();
      if(proven.size){
        const owned=new Set([...proven].map(rule=>rule.original)),remaining=nearbyRules.filter(rule=>!owned.has(rule));
        const protectedRules=remaining.map(rule=>({axis:rule.axis,at:rule.at*(rule.axis==='h'?sy:sx),from:rule.from*(rule.axis==='h'?sx:sy),to:rule.to*(rule.axis==='h'?sx:sy),...(rule.isolatedWriting?{isolatedWriting:true}:{})}));
        const fitted=fitTypography({...typographyInput,tight:rect,protectedRules,
          inkAt:(x,y)=>typographyInput.ruleInkAt(x,y)&&!onRule(x,y,remaining)});
        if(fitted?.words?.length&&fitted.ocrFontScore>=.8&&(!needsColorProof||provenColorTypography(fitted))){
          typography=fitted;nearbyRules=remaining;for(const rule of owned)glyphOwnedRules.add(rule);
          const xs=fitted.words.map(word=>word.rect.x),ys=fitted.words.map(word=>word.rect.y);
          const right=Math.max(...fitted.words.map(word=>word.rect.x+word.rect.width)),bottom=Math.max(...fitted.words.map(word=>word.rect.y+word.rect.height));
          tight={x:Math.min(...xs),y:Math.min(...ys),width:right-Math.min(...xs),height:bottom-Math.min(...ys)};
          Object.assign(typographyInput,{tight,protectedRules});
        }
      }
    }
    for(const word of typography?.words||[])if(word.ocrEdgeGlyphRecovery){
      const edge=glyphBox(word.rect,sx,sy,width,height);
      box.x=Math.min(box.x,edge.x);box.right=Math.max(box.right,edge.right);
    }
    const color=dark&&!preserveGeometry?'000000':channels.map(histogram=>{let sum=0;for(let c=0;c<256;c++){sum+=histogram[c];if(sum>=Math.max(1,count*(lineDark?.8:.2)))return c.toString(16).padStart(2,'0');}return '00';}).join('').toUpperCase();
    text.push({id,type:'text',sourceIds:[id],text:line.text.trim(),rect:tight,advanceRect:{...tight},advanceWidth:tight.width,baseline,
      baselineX:tight.x,size,font:'ocr-yahei',fontFamily:'Microsoft YaHei',color,bold:false,italic:false,horizontalScale:1,order:index,raster:false,preciseInk:true,ocr:true,confidence:line.confidence,
      ocrRecognitionConfidence:ocrRecognitionConfidence(line),...typography});
    if(fitTypography&&(!typography?.words?.length||needsColorProof&&!provenColorTypography(typography)))unresolved.push({item:text.at(-1),input:typographyInput,needsColorProof});
    erase.push({box,fill,colored:colored||needsColorProof,rules:nearbyRules,item:text.at(-1)});
  }
  const calibrated=text.filter(item=>item.ocr&&item.words?.length&&item.ocrFontScore>=.7);
  for(const {item,input}of unresolved){
    const peers=calibrated.filter(peer=>Math.abs(peer.baseline-item.baseline)<scene.height*.12
      &&Math.min(peer.size,item.size)/Math.max(peer.size,item.size)>.6);
    peers.sort((a,b)=>(Math.abs(a.baseline-item.baseline)+Math.abs(a.rect.x-item.rect.x)*.1)/a.size
      -(Math.abs(b.baseline-item.baseline)+Math.abs(b.rect.x-item.rect.x)*.1)/b.size);
    if(peers[0]){const fitted=fitTypography({...input,fontHint:{font:peers[0].font,bold:peers[0].bold}});if(fitted)Object.assign(item,fitted);}
  }
  // A repeated-digit label cannot replace a proven neighbouring font hint.
  // Retry only still-unfitted short labels after all established hint paths;
  // the adapter separately checks complete ink, CTC and shape evidence.
  for(const {item,input,needsColorProof}of unresolved){
    if(item.words?.length||needsColorProof)continue;
    const token=input.line.text.replace(/\s/g,'');
    if(token.length<2||token.length>8||!/^(?:[0-9]{1,6}|[-–—][0-9]{1,6}[-–—])$/u.test(token)
      ||new Set(token.replace(/[^0-9]/g,'')).size!==1)continue;
    const fitted=fitTypography({...input,allowSingleNumeric:true});
    if(fitted?.words?.length&&fitted.ocrFontScore>=.75)Object.assign(item,fitted);
  }
  const unproven=new Set(unresolved.filter(({item,needsColorProof})=>needsColorProof
    &&!provenColorTypography(item)).map(({item})=>item));
  for (const item of text) if (unprovenShortToken(item)) unproven.add(item);
  if(preserveGeometry)for(const item of unproven)for(const id of item.sourceIds){
    retainedRasterIds.add(id);
    retainedOcrSources.set(id,{id,text:item.text,rect:item.rect,order:item.order,
      disposition:'visible-image',ocrUnverified:true});
  }
  text=text.filter(item=>!unproven.has(item));
  if(preserveGeometry)trimOcrOwnedFragments(text);
  if(preserveGeometry&&typeof fitTypography?.recoverWritingPunctuation==='function'){
    const marks=fitTypography.recoverWritingPunctuation({rules:rasterRules,text,pixels,width,height,sx,sy,
      budget:lineFitBudget,protectedRects:[...protectedImages.map(item=>item.rect),...figures.map(figure=>figure.rect)]});
    const ids=new Set([...scene.sources.map(s=>s.id),...text.map(t=>t.id)]);
    for(const [index,mark]of marks.entries()){
      if(text.length>=LIMITS.itemsPerPage)break;
      const box=glyphBox(mark.rect,sx,sy,width,height),fill=localPaper(pixels,width,height,box);if(!fill)continue;
      const {replaces,...measured}=mark;
      const old=replaces?text.find(t=>t.id===replaces&&t.ocr&&!t.ocrNative&&t.text==='0'):null;
      if(replaces&&!old)continue;
      let item;
      if(old){
        const original=old.ocrOriginalText??old.text;
        Object.assign(old,measured,{ocrOriginalText:original,ocrFontScore:mark.confidence,
          ocrCorrections:[...(old.ocrCorrections||[]),{original:old.text,text:mark.text,rule:mark.ocrRecoveredMark.rule}]});
        delete old.ocrRecognitionConfidence;delete old.words;item=old;
      }else{
        const id=`p${scene.number}:ocr-mark:${index}`;if(ids.has(id))continue;ids.add(id);
        const hints=text.filter(t=>mark.ocrRecoveredMark.hintIds.includes(t.id));
        const order=Math.max(-1,...hints.map(t=>Number.isFinite(t.order)?t.order:-1))+.5;
        item={...measured,id,type:'text',sourceIds:[id],order,raster:false,ocr:true,ocrFontScore:mark.confidence};text.push(item);
      }
      erase.push({box,fill,colored:false,rules,item});
    }
  }
  // Even when every OCR hypothesis is uncertain, retain its image ownership
  // and low-confidence status. Returning the untouched source scene here used
  // to drop those hypotheses from the quality denominator altogether.
  if (!text.some(item=>item.ocr)&&!figures.length) {
    if (!retainedOcrSources.size) return {scene, pixels:clean, changed:false};
    const retained = retainUnverifiedImageSources(scene, [...retainedOcrSources.values()]);
    if (retained) return {scene:retained, pixels:clean, changed:false};
  }
  // Remove native text from a scan background too, so a mixed page cannot
  // display its old glyphs underneath the editable replacement.
  for(const item of text.filter(item=>item.ocrNative)){const box=glyphBox(item.rect,sx,sy,width,height);erase.push({box,fill:localPaper(pixels,width,height,box)||paper,colored:true,native:true});}
  for(const {box,fill,colored,native,rules,item} of erase){
    if(unproven.has(item))continue;
    for(let y=box.y;y<box.bottom;y++)for(let x=box.x;x<box.right;x++){
    if(onRule(x,y,rules))continue;
    const offset=(y*width+x)*4;
    if(neutral(offset)||colored&&(native||!red(offset))){clean[offset]=fill[0];clean[offset+1]=fill[1];clean[offset+2]=fill[2];clean[offset+3]=255;}
    }
  }
  const semanticRules=rules.filter(rule=>!glyphOwnedRules.has(rule));
  const grids=ruledTableGrids(semanticRules);
  if(preserveGeometry)grids.push(...ocrSignatureFormGrids(text,semanticRules,{x:0,y:0,width:scene.width,height:scene.height}));
  const partition=splitOcrTableCells(text,grids,{maxExtra:LIMITS.itemsPerPage-Math.max(scene.sources.length,text.length)});
  text=partition.text;
  const tables=ruledTables(groupLines(text),semanticRules,grids),owned=new Set(tables.flatMap(table=>table.sourceIds));
  for(const rule of semanticRules){
    if(!tables.some(table=>!table.borderless&&(rule.axis==='h'?rule.at>=table.rect.y-1&&rule.at<=table.rect.y+table.rect.height+1:rule.at>=table.rect.x-1&&rule.at<=table.rect.x+table.rect.width+1)))continue;
    const rect=rule.axis==='h'?{x:rule.from,y:rule.at-1.5,width:rule.to-rule.from,height:3}:{x:rule.at-1.5,y:rule.from,width:3,height:rule.to-rule.from};
    const box=pixelRect(rect,sx,sy,width,height);
    for(let y=box.y;y<box.bottom;y++)for(let x=box.x;x<box.right;x++){const off=(y*width+x)*4;if(neutral(off)){clean[off]=paper[0];clean[off+1]=paper[1];clean[off+2]=paper[2];}}
  }
  if(dark&&!preserveGeometry){for(let o=0;o<clean.length;o+=4){clean[o]=255-clean[o];clean[o+1]=255-clean[o+1];clean[o+2]=255-clean[o+2];}for(let c=0;c<3;c++)paper[c]=255-paper[c];}
  // A diagram has one visible owner. Its PNG is collected from the still-raw
  // page canvas by the processor, then this background footprint is cleared.
  // Deleting that PNG cannot reveal a second diagram or label layer.
  for(const figure of figures){
    const r=figure.pixelRect;
    for(let y=r.y;y<r.y+r.height;y++){
      check();for(let x=r.x;x<r.x+r.width;x++){const o=(y*width+x)*4;clean[o]=paper[0];clean[o+1]=paper[1];clean[o+2]=paper[2];clean[o+3]=255;}
    }
  }
  const figureIds=new Set([...figureSources.values()].flat());
  const images=preserveGeometry?[{id:`p${scene.number}:ocr-background`,type:'image',role:'figure',sourceIds:[...retainedRasterIds].filter(id=>!figureIds.has(id)),rect:{x:0,y:0,width:scene.width,height:scene.height},order:-1,ocrBackground:true,reasons:['image']},
    ...figures.map(figure=>({id:figure.id,type:'image',role:'figure',sourceIds:figureSources.get(figure.id),rect:figure.rect,order:figure.pixelRect.y,
      scanFigure:{pixelRect:figure.pixelRect,width,height,version:figure.version,evidence:figure.evidence},reasons:['scan-figure']}))]
    :residualFigures(clean,width,height,sx,sy,paper,scene.number);
  const originalSources=new Map([...scene.sources.map(source=>[source.id,source]),...retainedOcrSources,...partition.sources.map(source=>[source.id,source])]);
  const sources=text.flatMap(item=>item.sourceIds.map(id=>originalSources.get(id)||{id,text:item.text,rect:item.rect,order:item.order,disposition:'editable'}));
  if(preserveGeometry)for(const id of retainedRasterIds){const source=originalSources.get(id);if(source)sources.push({...source,disposition:'visible-image'});}
  const prepared={scene:{...scene,sources,items:[...images,...text.filter(item=>!owned.has(item.id)),...tables],rules:semanticRules,risks:['ocr',...(result.lowConfidenceLines||unproven.size?['ocr-low-confidence']:[])],characters:sources.reduce((n,s)=>n+s.text.length,0),rasterPage:false,backgroundTextLayers:preserveGeometry?1:0,ocr:true},pixels:clean,changed:true};
  const refined=typeof fitTypography?.refineLatinPunctuation==='function'
    ?fitTypography.refineLatinPunctuation(prepared,{pixels,width,height,budget:alignmentBudget,check})
    :prepared;
  const literal=typeof fitTypography?.refineLiteralLabels==='function'
    ?fitTypography.refineLiteralLabels(refined,{pixels,width,height,budget:alignmentBudget,check}):refined;
  return preserveGeometry&&typeof fitTypography?.refineLatinCharacters==='function'
    ?fitTypography.refineLatinCharacters(literal,{pixels,width,height,budget:alignmentBudget,check}):literal;
}
function residualFigures(pixels,width,height,sx,sy,paper,page) {
  const step=16,cols=Math.ceil(width/step),rows=Math.ceil(height/step),mask=new Uint8Array(cols*rows),threshold=Math.max(20,Math.min(...paper)-40);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const o=(y*width+x)*4;if(Math.min(pixels[o],pixels[o+1],pixels[o+2])<threshold)mask[Math.floor(y/step)*cols+Math.floor(x/step)]=1;}
  const figures=[];
  for(let i=0;i<mask.length;i++)if(mask[i]){
    mask[i]=0;const queue=[i];let left=i%cols,right=left,top=Math.floor(i/cols),bottom=top;
    for(let q=0;q<queue.length;q++){const cell=queue[q],x=cell%cols,y=Math.floor(cell/cols);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||nx>=cols||ny<0||ny>=rows)continue;const n=ny*cols+nx;if(mask[n]){mask[n]=0;queue.push(n);}}}
    const rect={x:left*step/sx,y:top*step/sy,width:(Math.min(width,(right+1)*step)-left*step)/sx,height:(Math.min(height,(bottom+1)*step)-top*step)/sy};
    figures.push({id:`p${page}:ocr-figure${figures.length}`,type:'image',role:'figure',sourceIds:[],rect,order:top*cols+left,reasons:['image']});
    if(figures.length>=256)return [{id:`p${page}:ocr-background`,type:'image',role:'figure',sourceIds:[],rect:{x:0,y:0,width:width/sx,height:height/sy},order:-1,reasons:['image']}];
  }
  return figures;
}
