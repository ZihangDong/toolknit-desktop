// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
// Font evidence comes from the original visible pixels, never a language model.
import { recoverOcrPermille, recoverOcrSquareMetre } from '../core/ocr-symbols.js';
import { fitOcrLineTypography, fitOcrBracketedLabel, fitOcrWritingPunctuation } from './ocr-line-typography.js';
import { alignOcrGlyphs, alignOcrGlyphWindows } from './ocr-glyph-alignment.js';
import { coincidentWritingRules } from '../core/ocr-rule-ownership.js';
import { fitOcrNumericLabel } from '../core/ocr-numeric-label.js';
import { refinePreparedLatinPunctuation } from './ocr-small-punctuation.js';
import { refineOcrLatinCharacters } from './ocr-latin-recovery.js';
import { fitLiteralLabelPlacement } from './ocr-literal-placement.js';
const SIDE = 32;
const CJK_FONTS = ['SimSun','SimHei','Microsoft YaHei','FangSong','KaiTi'];
function normalized(mask, width, height) {
  const out = new Uint8Array(SIDE * SIDE);
  for (let y=0;y<SIDE;y++) for(let x=0;x<SIDE;x++) {
    const x1=Math.floor(x*width/SIDE),x2=Math.max(x1+1,Math.ceil((x+1)*width/SIDE));
    const y1=Math.floor(y*height/SIDE),y2=Math.max(y1+1,Math.ceil((y+1)*height/SIDE));
    let ink=0,total=0;
    for(let yy=y1;yy<Math.min(height,y2);yy++)for(let xx=x1;xx<Math.min(width,x2);xx++){ink+=mask[yy*width+xx];total++;}
    out[y*SIDE+x]=ink/Math.max(1,total)>.3?1:0;
  }
  return out;
}
function similarity(a,b) {
  let first=0,second=0,intersection=0;
  for(let i=0;i<a.length;i++){first+=a[i];second+=b[i];intersection+=a[i]&b[i];}
  return 2*intersection/Math.max(1,first+second);
}
export function createOcrTypography(createCanvas, { nativeEvidence = false } = {}) {
  const cache=new Map();
  const cjkFamilies=nativeEvidence?[...CJK_FONTS,'DengXian']:CJK_FONTS;
  function glyph(text,font,bold,signatureAlpha=100,signatureEm=100,signatureBudget=null) {
    const key=JSON.stringify([text,font,bold,signatureAlpha,signatureEm]); if(cache.has(key))return cache.get(key);
    if(signatureBudget){
      if(signatureBudget.remaining<220*160)return null;
      signatureBudget.remaining-=220*160;
    }
    const canvas=createCanvas(220,160),context=canvas.getContext('2d');
    try {
      context.font=`${bold?'bold ':''}${signatureEm}px "${font}"`;context.fontKerning='none';
      const metrics=context.measureText(text),left=Math.ceil(metrics.actualBoundingBoxLeft),ascent=Math.ceil(metrics.actualBoundingBoxAscent),descent=Math.ceil(metrics.actualBoundingBoxDescent);
      const width=Math.ceil(metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight),height=ascent+descent;
      if(width<1||height<1||width>200||height>140)return null;
      context.fillStyle='black';context.fillText(text,left,ascent);
      const data=context.getImageData(0,0,width,height).data,mask=new Uint8Array(width*height);
      for(let i=0;i<mask.length;i++)mask[i]=data[i*4+3]>signatureAlpha?1:0;
      // The small raster is only a shape signature. Its rounded pixel bounds
      // must not define physical size/baseline: the writer measures outlines
      // at 1000px, and rounding this template can shift small labels by >1pt.
      context.font=`${bold?'bold ':''}1000px "${font}"`;
      const fine=context.measureText(text),outline={width:(fine.actualBoundingBoxLeft+fine.actualBoundingBoxRight)/10,
        height:(fine.actualBoundingBoxAscent+fine.actualBoundingBoxDescent)/10,ascent:fine.actualBoundingBoxAscent/10,descent:fine.actualBoundingBoxDescent/10};
      if(![outline.width,outline.height,outline.ascent,outline.descent].every(Number.isFinite)
        ||!(outline.width>0&&outline.height>0))return null;
      const result={mask:normalized(mask,width,height),width,height,ascent,descent,outline};
      if(cache.size>=2048)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
    } finally {canvas.width=canvas.height=0;}
  }
  function nearbyPermille(index,ordered,line,y1,y2,inkAt,width,sx,sy,verify){
    const center=ordered[index].center,next=ordered[index+1]?.center;
    if(!(y2-y1>=12&&y2-y1<=128&&Number.isFinite(next)&&Number.isFinite(line.height)&&line.height>0))return null;
    const radius=Math.min(72,line.height*1.2),left=Math.max(0,Math.floor(center-radius)),end=Math.min(width,Math.ceil(Math.min(center+radius,next+line.height*.15)));
    const span=end-left,rows=y2-y1,probe=new Uint8Array(span*rows),seen=new Uint8Array(probe.length);
    for(let y=0;y<rows;y++)for(let x=0;x<span;x++)probe[y*span+x]=inkAt(left+x,y1+y)?1:0;
    // A blank writing line may touch the symbol's x projection while remaining
    // a separate component below it. Ignore that shallow component only in
    // this probe; it must not become one of the symbol's rings or its size.
    for(let start=0;start<probe.length;start++){
      if(!probe[start]||seen[start])continue;
      const queue=[start];seen[start]=1;let minX=span,maxX=0,minY=rows,maxY=0;
      for(let cursor=0;cursor<queue.length;cursor++){
        const at=queue[cursor],x=at%span,y=Math.floor(at/span);
        minX=Math.min(minX,x);maxX=Math.max(maxX,x+1);minY=Math.min(minY,y);maxY=Math.max(maxY,y+1);
        for(const next of[x?at-1:-1,x<span-1?at+1:-1,y?at-span:-1,y<rows-1?at+span:-1]){
          if(next>=0&&probe[next]&&!seen[next]){seen[next]=1;queue.push(next);}
        }
      }
      if(maxY-minY<=Math.max(3,rows*.15)&&maxX-minX>=(maxY-minY)*5&&minY>=rows*.8)
        for(const at of queue)probe[at]=0;
    }
    const hasInk=(x,y)=>probe[(y-y1)*span+x-left]===1;
    const columns=[];
    for(let x=left;x<end;x++){let ink=0;for(let y=y1;y<y2;y++)if(hasInk(x,y))ink++;columns.push(ink);}
    const clusters=[];
    for(let x=0;x<columns.length;){if(!columns[x]){x++;continue;}const start=x;while(x<columns.length&&columns[x])x++;clusters.push({start,end:x});}
    if(clusters.length>12)return null;
    const accepted=[];
    for(let first=0;first<clusters.length;first++)for(let last=first;last<Math.min(first+3,clusters.length);last++){
      if(last>first&&clusters[last].start-clusters[last-1].end>Math.max(2,(y2-y1)*.15))break;
      const x1=left+clusters[first].start,x2=left+clusters[last].end;
      if(x1<=left||x2>=end||(x1+x2)/2<center-line.height*.35||(x1+x2)/2>=next-line.height*.1)continue;
      let top=y2,bottom=y1;
      for(let y=y1;y<y2;y++)for(let x=x1;x<x2;x++)if(hasInk(x,y)){top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
      const w=x2-x1,h=bottom-top;if(!(w>=12&&h>=12&&w/h>=.9&&w/h<=1.7))continue;
      const mask=new Uint8Array(w*h);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++)mask[y*w+x]=hasInk(x1+x,top+y)?1:0;
      const candidate={text:'%',rect:{x:x1/sx,y:top/sy,width:w/sx,height:h/sy},mask:normalized(mask,w,h),pixelWidth:w,pixelHeight:h};
      const correction=verify(candidate);if(correction)accepted.push({candidate,correction});
    }
    return accepted.length===1?accepted[0]:null;
  }
  const fit=({line,pixels,width,height,sx,sy,tight,inkAt,fontHint=null,requireColorEvidence=false,allowSymbolCorrection=false,allowLineFit=false,lineFitBudget=null,alignmentBudget=null,protectedRules=[],ruleInkAt=null,glyphOwnershipEvidence=false,allowSingleNumeric=false}) => {
    const raw=line.words?.filter(word=>typeof word.text==='string'&&word.text.trim()&&Number.isFinite(word.x)&&Number.isFinite(word.width));
    if(!raw?.length||raw.length>200||raw.map(word=>word.text).join('').replace(/\s/g,'')!==line.text.replace(/\s/g,''))return null;
    const ordered=raw.map(word=>({...word,center:word.x+word.width/2}));
    if(ordered.some((word,i)=>i&&word.center<=ordered[i-1].center))return null;
    if(allowLineFit&&!requireColorEvidence){
      const fitted=fitOcrLineTypography(createCanvas,{line,tight,inkAt,sx,sy,width,height,lineFitBudget});
      if(fitted)return fitted;
    }
    const y1=Math.max(0,Math.floor(tight.y*sy)),y2=Math.min(height,Math.ceil((tight.y+tight.height)*sy));
    const writingRules=coincidentWritingRules(protectedRules,{inkAt:ruleInkAt,width,height});
    const rulings=ordered.map(word=>{
      // A narrow CTC cell can straddle a neighbour's stroke. Prove an explicit
      // underscore's protected line before assigning the surrounding cell ink.
      const matches=allowSymbolCorrection&&ruleInkAt&&word.text==='_'?writingRules.filter(rule=>rule?.axis==='h'
          &&word.center>=rule.from-Math.min(12,line.height*.15)&&word.center<=rule.to+Math.min(12,line.height*.15)
          &&rule.to-rule.from>=Math.max(12,line.height*.45)
          &&(rule.to-rule.from>=line.height*.8||rule.at>=line.y+line.height*.75
            &&(word.confidence>=.75||rule.isolatedWriting===true&&line.confidence>=.75))
          &&rule.at>=line.y+line.height*.45&&rule.at<=line.y+line.height+Math.max(2,line.height*.15)
          &&[-2,-1,0,1,2].filter(step=>{
            const stride=Math.min((rule.to-rule.from)/10,line.height*.15);
            const center=word.center>=rule.from&&word.center<=rule.to
              ?rule.isolatedWriting?Math.max(rule.from+stride*2,Math.min(rule.to-stride*2,word.center)):word.center
              :(rule.from+rule.to)/2;
            const x=Math.round(center+step*stride);
            return x>=0&&x<width&&[-2,-1,0,1,2].some(offset=>{
              const y=Math.round(rule.at)+offset;return y>=0&&y<height&&ruleInkAt(x,y);
            });
          }).length>=4):[];
      return matches.length===1?matches[0]:null;
    });
    // Once an underscore owns a proven writing line, its displaced CTC peak
    // cannot split the neighbouring letter. Partition all remaining source
    // ink between the retained tokens; ordinary glyph/line gates still apply.
    const measured=ordered.filter((_,i)=>!rulings[i]);
    const boundaries=[Math.max(0,Math.floor(tight.x*sx))];
    for(let i=1;i<measured.length;i++){
      const middle=(measured[i-1].center+measured[i].center)/2,range=Math.max(1,(measured[i].center-measured[i-1].center)*.3);
      let selected=Math.round(middle),best=Infinity;
      for(let x=Math.max(boundaries.at(-1)+1,Math.floor(middle-range));x<=Math.min(width-1,Math.ceil(middle+range));x++){
        let ink=0;for(let y=y1;y<y2;y++)if(inkAt(x,y))ink++;
        const cost=ink+Math.abs(x-middle)/Math.max(1,range)*.2;
        if(cost<best){best=cost;selected=x;}
      }
      boundaries.push(selected);
    }
    boundaries.push(Math.min(width,Math.ceil((tight.x+tight.width)*sx)));
    const chars=[];let cell=0;
    for(let i=0;i<ordered.length;i++){
      const word=ordered[i],rule=rulings[i];
      if(rule){chars.push({text:word.text,ruling:{...rule}});continue;}
      const x1=boundaries[cell],x2=boundaries[++cell];
      let left=x2,right=x1,top=y2,bottom=y1;
      for(let y=y1;y<y2;y++)for(let x=x1;x<x2;x++)if(inkAt(x,y)){left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);}
      if(right<=left||bottom<=top){chars.push({text:word.text});continue;}
      const columns=[];let totalInk=0;
      for(let x=left;x<right;x++){let amount=0;for(let y=top;y<bottom;y++)if(inkAt(x,y))amount++;columns.push(amount);totalInk+=amount;}
      const clusters=[];
      for(let x=0;x<columns.length;){if(!columns[x]){x++;continue;}const start=x;let area=0;while(x<columns.length&&columns[x])area+=columns[x++];clusters.push({start,end:x,area});}
      // CTC peaks are approximate. A tiny neighbouring edge stroke must not
      // enlarge a character's font or be carried into its editable replacement.
      while(clusters.length>1&&clusters[0].area<totalInk*.04&&clusters[1].start-clusters[0].end>2)clusters.shift();
      while(clusters.length>1&&clusters.at(-1).area<totalInk*.04&&clusters.at(-1).start-clusters.at(-2).end>2)clusters.pop();
      if(clusters.length){const start=left;left=start+clusters[0].start;right=start+clusters.at(-1).end;top=y2;bottom=y1;
        for(let y=y1;y<y2;y++)for(let x=left;x<right;x++)if(inkAt(x,y)){top=Math.min(top,y);bottom=Math.max(bottom,y+1);}}
      const w=right-left,h=bottom-top,mask=new Uint8Array(w*h);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++)mask[y*w+x]=inkAt(left+x,top+y)?1:0;
      chars.push({text:word.text,rect:{x:left/sx,y:top/sy,width:w/sx,height:h/sy},mask:normalized(mask,w,h),pixelWidth:w,pixelHeight:h});
    }
    const han=/[\p{Script=Han}]/u.test(line.text);
    // A detector can start inside the long first stroke of Chinese numeral
    // one. Its thin, continuous source component can prove the missing end;
    // arbitrary exterior ink and intersecting borders cannot expand a glyph.
    const first=chars[0];
    if(allowSymbolCorrection&&first?.text==='一'&&ordered[0].confidence>=.9&&first.rect
      &&Math.abs(first.rect.x*sx-line.x)<=1&&first.rect.height*sy<=line.height*.15){
      const limit=Math.min(24,Math.floor(line.height*.45)),right=Math.ceil((first.rect.x+first.rect.width)*sx);
      const originalLeft=Math.floor(first.rect.x*sx),top=Math.max(2,Math.floor(first.rect.y*sy)-2);
      const bottom=Math.min(height-2,Math.ceil((first.rect.y+first.rect.height)*sy)+2);
      const column=x=>{
        let a=bottom,b=top;
        for(let y=top;y<bottom;y++)if(inkAt(x,y)){a=Math.min(a,y);b=Math.max(b,y+1);}
        if(b<=a||b-a>Math.min(8,line.height*.15))return null;
        if([a-2,a-1,b,b+1].some(y=>y>=0&&y<height&&inkAt(x,y)))return null;
        return {top:a,bottom:b};
      };
      let left=originalLeft,valid=true;
      for(let x=originalLeft;x<right;x++)if(!column(x)){valid=false;break;}
      if(valid){
        while(left>0&&originalLeft-left<limit&&column(left-1))left--;
        if(left<originalLeft&&originalLeft-left<limit){
          let a=bottom,b=top;
          for(let x=left;x<right;x++){const c=column(x);a=Math.min(a,c.top);b=Math.max(b,c.bottom);}
          const mask=new Uint8Array((right-left)*(b-a));
          for(let y=a;y<b;y++)for(let x=left;x<right;x++)mask[(y-a)*(right-left)+x-left]=inkAt(x,y)?1:0;
          Object.assign(first,{rect:{x:left/sx,y:a/sy,width:(right-left)/sx,height:(b-a)/sy},
            mask:normalized(mask,right-left,b-a),pixelWidth:right-left,pixelHeight:b-a,ocrEdgeGlyphRecovery:true});
          tight={...tight,x:left/sx,width:tight.x+tight.width-left/sx};
        }
      }
    }
    // Numeric footers in Chinese scans can use a CJK face without a Han code
    // point. Bound these extra source-font candidates to short OCR labels;
    // native typography and ordinary Latin prose keep their existing policy.
    const numericLabel=allowSymbolCorrection&&!nativeEvidence&&/^[\s0-9\-–—]+$/u.test(line.text)
      &&line.text.replace(/\s/g,'').length<=16;
    const fonts=fontHint?[fontHint.font]:han?cjkFamilies:[...new Set(['Arial','Times New Roman','Calibri','Cambria','Microsoft YaHei',
      ...(numericLabel?cjkFamilies:[])])];
    const weights=fontHint?[Boolean(fontHint.bold)]:[false,true];
    const numericFallback=()=>allowLineFit&&!requireColorEvidence&&numericLabel
      ?fitOcrNumericLabel({line,tight,pixels,width,height,sx,sy,fonts,weights,
        glyph:(text,font,bold,pixelHeight)=>{
          // Small digit hinting can differ from a 100px signature. Match the
          // observed pixel height with at most three bounded raster probes;
          // physical size/baseline still come from the unchanged 1000px outline.
          const measured=glyph(text,font,bold,75,100,lineFitBudget);
          if(!measured)return null;
          let em=Math.max(24,Math.min(100,Math.round(pixelHeight*100/measured.outline.height))),best=measured;
          const tried=new Set();
          for(let attempt=0;attempt<3&&!tried.has(em);attempt++){
            tried.add(em);
            const candidate=glyph(text,font,bold,75,em,lineFitBudget);
            if(!candidate)break;
            if(Math.abs(candidate.height-pixelHeight)<Math.abs(best.height-pixelHeight))best=candidate;
            if(candidate.height===pixelHeight)break;
            let next=Math.round(em*pixelHeight/candidate.height);
            if(next===em)next+=candidate.height<pixelHeight?1:-1;
            em=Math.max(24,Math.min(100,next));
          }
          return best;
        },normalized,similarity,budget:lineFitBudget}):null;
    if(allowLineFit&&!requireColorEvidence){
      const short=fitOcrBracketedLabel(createCanvas,{line,chars,ordered,tight,inkAt,sx,sy,width,height,fonts,weights,lineFitBudget});
      if(short)return short;
    }
    const symbolFace=(c,text)=>{
      let best={score:-1};
      for(const font of new Set(['SimSun','SimHei','Arial','Times New Roman',...fonts]))for(const bold of weights){
        const g=glyph(text,font,bold);
        if(g){const score=similarity(c.mask,g.mask)-Math.min(.2,Math.abs(Math.log(c.rect.width/c.rect.height/(g.width/g.height)))*.15);
          if(score>best.score)best={font,bold,score};}
      }
      return best;
    };
    const corrections=[];let probeBudget=4,unitBudget=4,probeOnly=false;
    if(allowSymbolCorrection)for(const [index,c]of chars.entries()){
      if(c.text==='m'&&c.mask&&unitBudget>0){
        unitBudget--;
        const correction=recoverOcrSquareMetre({text:c.text,mask:c.mask,width:c.pixelWidth,height:c.pixelHeight,
          confidence:ordered[index].confidence,score:text=>symbolFace(c,text).score});
        if(correction){corrections.push({word:index,original:c.text,...correction});c.text=correction.text;c.symbolFace=symbolFace(c,c.text);}
        continue;
      }
      if(c.text!=='%')continue;
      const verify=c=>recoverOcrPermille({text:c.text,mask:c.mask,width:c.pixelWidth,height:c.pixelHeight,
        confidence:ordered[index].confidence,score:text=>symbolFace(c,text).score});
      let correction=c.mask?verify(c):null;
      // Bad CTC peaks can place a rate symbol on the preceding writing line.
      // Search only a shallow/empty cell, bounded before the next token peak.
      // A normal, two-ring percent never triggers this wider search.
      if(!correction&&ordered[index].confidence>=.75&&(!c.mask||c.pixelHeight<12||c.pixelHeight<line.height*.3)&&probeBudget>0){
        probeBudget--;
        const found=nearbyPermille(index,ordered,line,y1,y2,inkAt,width,sx,sy,verify);
        if(found){correction={...found.correction,ctcFallback:true};probeOnly=true;}
      }
      if(correction){corrections.push({word:index,original:c.text,...correction});c.text=correction.text;}
    }
    let correctionResult=null;
    if(corrections.length){
      const corrected=[...chars.map(c=>c.text).join('')].filter(char=>!/\s/u.test(char));let next=0;
      correctionResult={text:[...line.text].map(char=>/\s/u.test(char)?char:corrected[next++]).join('').trim(),
        ocrOriginalText:line.text,ocrCorrections:corrections};
    }
    const partial=()=>{
      const tokens=chars.flatMap((c,index)=>c.ruling?[{text:c.text,word:index,rule:c.ruling}]:[]);
      if(!tokens.length)return correctionResult;
      const offsets=new Set();let offset=0;
      for(const c of chars)for(const character of c.text){if(!character.trim())continue;if(c.ruling)offsets.add(offset);offset++;}
      let position=0;
      return {...correctionResult,text:[...(correctionResult?.text??line.text)].map(c=>!c.trim()?c:offsets.has(position++)?' ':c).join('').trim(),
        ocrOriginalText:line.text,ocrRuleTokens:tokens};
    };
    // A neighbouring bad CTC cell cannot invalidate a separately proven symbol
    // or writing line. Keep the line-style fallback until a complete ink path
    // proves word geometry; partial source evidence cannot invent those boxes.
    const missing=chars.some(c=>!c.mask&&!c.ruling);
    if(missing&&!allowSymbolCorrection)return partial();
    const samples=()=>chars.filter(c=>c.mask&&/[\p{L}\p{N}]/u.test(c.text)&&c.rect.height>2).filter((c,i,a)=>a.findIndex(other=>other.text===c.text)===i).slice(0,12);
    let sample=samples();
    // A page label such as -11- has several complete glyphs but only one
    // DISTINCT digit. It still provides physical ink evidence; unrelated short
    // text, bare singleton runs and uncertain/partial OCR keep the old minimum.
    const singleNumeric=allowSingleNumeric===true&&!fontHint&&!requireColorEvidence&&numericLabel&&!missing
      &&chars.length>=2&&chars.length<=8&&sample.length===1
      &&/^(?:[0-9]{1,6}|[-–—][0-9]{1,6}[-–—])$/u.test(line.text.replace(/\s/g,''))
      &&chars.every(c=>c.mask&&!c.ruling)&&ordered.every(word=>word.confidence>=.9);
    if(sample.length<(fontHint||singleNumeric?1:2))return allowSingleNumeric?numericFallback()||partial():partial();
    let best=null; const scoresByFace=new Map();
    for(const font of fonts)for(const bold of weights){
      const scores=sample.map(c=>{const g=glyph(c.text,font,bold);return g?similarity(c.mask,g.mask)-Math.min(.2,Math.abs(Math.log(c.rect.width/c.rect.height/(g.width/g.height)))*.15):0;});
      const score=scores.reduce((a,b)=>a+b,0)/scores.length;
      scoresByFace.set(JSON.stringify([font,bold]),score);
      if(!best||score>best.score)best={font,bold,score};
    }
    if(!nativeEvidence&&best?.bold&&best.score-scoresByFace.get(JSON.stringify([best.font,false]))<.08)best={...best,bold:false,score:scoresByFace.get(JSON.stringify([best.font,false]))};
    if(singleNumeric&&best.score<.75)return numericFallback()||partial();
    let alignment=null;
    if(allowSymbolCorrection&&han&&best&&alignmentBudget?.remaining>0){
      const poor=chars.filter(c=>c.mask&&(()=>{const g=glyph(c.text,best.font,best.bold);return g&&similarity(c.mask,g.mask)<.45;})()).length;
      const punctuation=chars.some(c=>c.mask&&/^[、，。,.．：:；;]$/u.test(c.text)
        &&(()=>{const g=glyph(c.text,best.font,best.bold);return g&&(c.rect.height>tight.height*.55&&similarity(c.mask,g.mask)<.55
          ||c.rect.width/c.rect.height/(g.outline.width/g.outline.height)>1.8);})());
      const missingPunctuation=missing&&chars.every((c,index)=>c.mask||c.ruling
        ||/^[、，。,.]$/u.test(c.text)&&ordered[index].confidence>=.75);
      const glyphAnchors=chars.flatMap((c,index)=>{
        if(!c.mask||!/^\p{Script=Han}$/u.test(c.text)||ordered[index].confidence<.9||c.rect.height<tight.height*.55)return [];
        const g=glyph(c.text,best.font,best.bold);if(!g)return [];
        const ratio=c.rect.width/c.rect.height/(g.outline.width/g.outline.height);
        return (ratio<.75||ratio>1.3)&&similarity(c.mask,g.mask)<.6?[index]:[];
      });
      const suspiciousGlyph=glyphAnchors.length>0&&glyphAnchors.length<=8;
      if(missing||probeOnly||punctuation||suspiciousGlyph||best.score<.72||poor>=Math.max(2,chars.length*.07)){
        // OCR measurement includes a 35-level antialias fringe. Use the same
        // alpha support for alignment signatures; native calibration stays on
        // its existing threshold and never enters this spelling-preserving path.
        const candidate=alignOcrGlyphs({line,chars,ordered,tight,inkAt,width,height,sx,sy,
          glyph:(text,font,bold)=>glyph(text,font,bold,35),normalized,similarity,fonts,weights,budget:alignmentBudget,
          mixedScripts:{baseFont:best.font,latinFonts:['Arial','Times New Roman','Calibri']},
          ownershipAnchors:suspiciousGlyph?glyphAnchors:[],
          referenceFace:punctuation||missingPunctuation||suspiciousGlyph?{font:best.font,bold:best.bold}:null});
        if(first?.ocrEdgeGlyphRecovery&&candidate?.words[0])candidate.words[0].ocrEdgeGlyphRecovery=true;
        const originalProof=candidate&&candidate.score>=best.score+.06;
        const localProof=!originalProof&&((punctuation||missingPunctuation)&&candidate?.ownershipGain>=.05&&candidate.ownershipMinimum>=.45
          ||missingPunctuation&&candidate?.missingPunctuationGain>=.05&&candidate.missingPunctuationMinimum>=.45
          ||(punctuation||suspiciousGlyph)&&candidate?.pairedGlyphGain>=.05&&candidate.pairedGlyphMinimum>=.65);
        if(originalProof){
          alignment=candidate;chars.splice(0,chars.length,...candidate.words);best={font:candidate.font,bold:candidate.bold,score:candidate.score};sample=samples();
        }else if(localProof){
          alignment={...candidate,localOwnership:true};chars.splice(0,chars.length,...candidate.words);sample=samples();
          const scores=sample.map(c=>{const g=glyph(c.text,best.font,best.bold);return g?similarity(c.mask,g.mask)-Math.min(.2,Math.abs(Math.log(c.rect.width/c.rect.height/(g.width/g.height)))*.15):0;});
          best={...best,score:scores.reduce((a,b)=>a+b,0)/scores.length};
        }else if(!missing&&!probeOnly&&(punctuation||suspiciousGlyph)){
          const marks=chars.flatMap((c,i)=>c.mask&&/^[、，。,.．：:；;]$/u.test(c.text)
            &&(()=>{const g=glyph(c.text,best.font,best.bold);return g&&similarity(c.mask,g.mask)<.55;})()?[i]:[]);
          const local=alignOcrGlyphWindows({line,chars,ordered,tight,inkAt,width,height,sx,sy,
            glyph:(text,font,bold)=>glyph(text,font,bold,35),normalized,similarity,fonts,weights,budget:alignmentBudget,
            referenceFace:{font:best.font,bold:best.bold}},[...new Set([...marks,...glyphAnchors])].slice(0,8));
          if(local){alignment=local;chars.splice(0,chars.length,...local.words);sample=samples();}
        }
      }
    }
    // A shallow Han "一" can include a neighbour's upper stroke while staying
    // below the ordinary Han-height trigger. Try only an isolated local path,
    // after established repairs, with its own small page allowance. It must
    // not restyle a whole line or consume later lines' existing proof budget.
    if(allowSymbolCorrection&&han&&best&&!missing&&!probeOnly&&!alignment&&alignmentBudget?.remaining>0){
      const shallow=chars.flatMap((c,index)=>{
        if(c.text!=='一'||!c.mask||ordered[index].confidence<.95||c.rect.height>=tight.height*.55
          ||c.rect.width<tight.height*.5)return [];
        const g=glyph(c.text,best.font,best.bold);
        return g&&similarity(c.mask,g.mask)<.6?[index]:[];
      });
      if(shallow.length&&shallow.length<=2){
        const budget=alignmentBudget.shallowStroke??={remaining:8000,pixelsRemaining:250000,
          anchorUpgrade:{remaining:0,pixelsRemaining:0}};
        const local=alignOcrGlyphWindows({line,chars,ordered,tight,inkAt,width,height,sx,sy,
          glyph:(text,font,bold)=>glyph(text,font,bold,35),normalized,similarity,fonts,weights,budget,
          referenceFace:{font:best.font,bold:best.bold}},shallow);
        if(local){alignment=local;chars.splice(0,chars.length,...local.words);sample=samples();}
      }
    }
    // A local patch can use another proven CJK face when a comma still owns
    // neighbouring ink. Require the complete ordered path and fixed exterior
    // anchors; keep distant styles and the established page allowance intact.
    if(allowSymbolCorrection&&han&&!missing&&!probeOnly&&best&&alignmentBudget?.remaining>0&&(!alignment||alignment.localOwnership)){
      const body=chars.filter(c=>c.mask&&/^\p{Script=Han}$/u.test(c.text)&&c.rect.height>tight.height*.6)
        .map(c=>{const g=glyph(c.text,best.font,best.bold);return g?c.rect.height*100/g.outline.height:0;}).filter(n=>n>0).sort((a,b)=>a-b);
      const nominal=body[Math.floor(body.length/2)];
      const marks=chars.flatMap((c,i)=>{
        if(c.text!=='、'||!c.mask||ordered[i].confidence<.95||!(nominal>0))return [];
        const g=glyph(c.text,best.font,best.bold);
        return g&&c.rect.height*100/g.outline.height>nominal*1.5&&similarity(c.mask,g.mask)<.65?[i]:[];
      });
      if(marks.length&&marks.length<=3){
        const budget=alignmentBudget.punctuationFace??={remaining:20000,pixelsRemaining:1000000,
          anchorUpgrade:{remaining:0,pixelsRemaining:0}};
        for(const font of CJK_FONTS){
          const local=alignOcrGlyphWindows({line,chars,ordered,tight,inkAt,width,height,sx,sy,
            glyph:(text,font,bold)=>glyph(text,font,bold,35),normalized,similarity,fonts:[font],weights,budget,
            referenceFace:{font,bold:best.bold}},marks);
          if(local){alignment=local;chars.splice(0,chars.length,...local.words);sample=samples();break;}
        }
      }
    }
    // A clipped Han edge can keep an ordinary aspect ratio while losing a
    // defining stroke. Try local proposals after established repairs, with a
    // separate page allowance; the same complete-path/anchor gates still apply.
    if(allowSymbolCorrection&&han&&!fontHint&&!missing&&!probeOnly&&best&&alignmentBudget?.remaining>0&&(!alignment||alignment.localOwnership)){
      const targets=chars.flatMap((c,i)=>{
        if(!c.mask||!/^\p{Script=Han}$/u.test(c.text)||ordered[i].confidence<.99||c.rect.height<tight.height*.55)return [];
        const g=glyph(c.text,c.alignmentFace?.font||best.font,c.alignmentFace?.bold??best.bold);
        return g&&similarity(c.mask,g.mask)<.5?[i]:[];
      });
      if(targets.length&&targets.length<=8){
        const budget=alignmentBudget.localHan??={remaining:16000,pixelsRemaining:800000,anchorUpgrade:{remaining:0,pixelsRemaining:0}};
        for(const font of CJK_FONTS){
          const local=alignOcrGlyphWindows({line,chars,ordered,tight,inkAt,width,height,sx,sy,
            glyph:(text,font,bold)=>glyph(text,font,bold,35),normalized,similarity,fonts:[font],weights,budget,
            referenceFace:{font,bold:best.bold}},targets);
          if(local){alignment=local;chars.splice(0,chars.length,...local.words);sample=samples();break;}
        }
      }
    }
    // A mark can still own a clipped neighbour after the first fixed-anchor
    // pass. Retry only its bounded, fully accounted local path; the optional
    // anchor upgrade must prove the exterior edge and the recovered glyph.
    if(allowSymbolCorrection&&han&&!fontHint&&!missing&&!probeOnly&&best&&alignmentBudget?.remaining>0&&(!alignment||alignment.localOwnership)){
      const marks=chars.flatMap((c,i)=>{
        if(!c.mask||!/^[、，。；：]$/u.test(c.text)||ordered[i].confidence<.95)return [];
        const g=glyph(c.text,c.alignmentFace?.font||best.font,c.alignmentFace?.bold??best.bold);
        return g&&similarity(c.mask,g.mask)<.65?[i]:[];
      });
      if(marks.length&&marks.length<=3){
        const budget=alignmentBudget.localMarks??={remaining:20000,pixelsRemaining:1000000,
          anchorUpgrade:{remaining:12000,pixelsRemaining:500000}};
        for(const font of CJK_FONTS){
          const local=alignOcrGlyphWindows({line,chars,ordered,tight,inkAt,width,height,sx,sy,
            glyph:(text,font,bold)=>glyph(text,font,bold,35),normalized,similarity,fonts:[font],weights,budget,
            referenceFace:{font,bold:best.bold}},marks);
          if(local){alignment=local;chars.splice(0,chars.length,...local.words);sample=samples();break;}
        }
      }
    }
    if((missing||probeOnly)&&!alignment)return partial();
    if(!best||best.score<.55)return partial();
    // Keep the existing coarse line-size hint for peer selection and fallback.
    // Actual child glyph geometry below uses the continuous outline metrics.
    const sizes=sample.flatMap(c=>{const g=glyph(c.text,best.font,best.bold);return g?[c.rect.height*100/g.height]:[];}).sort((a,b)=>a-b);
    const size=sizes[Math.floor(sizes.length/2)];if(!(size>=4&&size<=120))return partial();
    const words=chars.flatMap((c,index)=>{
      if(c.ruling)return [];
      let selected={...best,score:-Infinity};
      const fixedFace=alignment&&!alignment.localOwnership;
      // Latin fonts can appear to match a fullwidth CJK punctuation mark only
      // because Canvas silently substitutes another face. Office may choose a
      // different substitute, invalidating the measured glyph box and size.
      const cjk=/[\p{Script=Han}\u3000-\u303f\uff01-\uff60]/u.test(c.text);
      const explicitCjk=fonts.filter(font=>cjkFamilies.includes(font));
      const cjkFonts=explicitCjk.length?explicitCjk:cjkFamilies;
      const characterFonts=cjk&&(!fixedFace||!cjkFamilies.includes(best.font))?cjkFonts
        :fixedFace?[best.font]:fontHint?fonts:['Arial','Times New Roman','Calibri',...fonts];
      const characterWeights=fixedFace?[best.bold]:weights;
      const scoreFor=(font,bold)=>{const g=glyph(c.text,font,bold);return g?similarity(c.mask,g.mask)-Math.min(.2,Math.abs(Math.log(c.rect.width/c.rect.height/(g.width/g.height)))*.15):-1;};
      const reference=cjk&&!cjkFamilies.includes(best.font)?{...best,font:cjkFonts[0]}:best;
      const baseScore=scoreFor(reference.font,reference.bold);
      for(const font of characterFonts)for(const bold of characterWeights){const score=scoreFor(font,bold);if(score>selected.score)selected={font,bold,score};}
      const ownershipScore=selected.score;
      if(!nativeEvidence&&!fixedFace&&selected.bold&&selected.score-scoreFor(selected.font,false)<.08)selected={...selected,bold:false,score:scoreFor(selected.font,false)};
      if(selected.score<.65||selected.score<baseScore+.1)selected=reference;
      if(fixedFace&&c.alignmentFace)selected={...c.alignmentFace,score:scoreFor(c.alignmentFace.font,c.alignmentFace.bold)};
      if(c.symbolFace)selected=c.symbolFace;
      const g=glyph(c.text,selected.font,selected.bold),ownSize=g?Math.max(4,Math.min(120,c.rect.height*100/g.outline.height)):size;
      const baseline=g?c.rect.y+g.outline.ascent*ownSize/100:c.rect.y+c.rect.height;
      const glyphScale=g?Math.max(25,Math.min(400,Math.round(c.rect.width/(g.outline.width*ownSize/100)*100))):100;
      return [{text:c.text,rect:c.rect,baseline,baselineX:c.rect.x,advanceWidth:c.rect.width,size:ownSize,font:selected.font,fontFamily:selected.font,bold:selected.bold,glyphScale,preciseInk:true,
        confidence:ordered[index].confidence,ocrGlyphScore:scoreFor(selected.font,selected.bold),
        ...(glyphOwnershipEvidence?{ocrGlyphOwnershipScore:ownershipScore}:{}),
        ...(c.ocrEdgeGlyphRecovery?{ocrEdgeGlyphRecovery:true}:{})}];
    });
    const baselines=words.map(word=>word.baseline).sort((a,b)=>a-b);
    const inkAmount=mask=>mask.reduce((sum,value)=>sum+value,0);
    const colorEvidence=requireColorEvidence?{ocrColorInkError:sample.reduce((sum,c)=>{
      const g=glyph(c.text,c.alignmentFace?.font??best.font,c.alignmentFace?.bold??best.bold);
      return sum+(g?Math.abs(inkAmount(c.mask)-inkAmount(g.mask))/(SIDE*SIDE):1);
    },0)/sample.length}:{};
    if(numericLabel&&!fontHint&&best.score<.8){const numeric=numericFallback();if(numeric)return numeric;}
    return {font:best.font,fontFamily:best.font,bold:best.bold,size,baseline:baselines[Math.floor(baselines.length/2)],words,ocrFontScore:Math.round(best.score*1000)/1000,
      ...colorEvidence,
      ...(alignment?{ocrGlyphAlignment:true}:{}),...partial()};
  };
  fit.recoverWritingPunctuation=options=>fitOcrWritingPunctuation(createCanvas,options);
  const boundedGlyphMetrics=(text,font,bold,budget)=>glyph(text,font,bold,100,100,{
    get remaining(){return budget.pixelsRemaining;},
    set remaining(value){budget.pixelsRemaining=value;},
  });
  if(!nativeEvidence)fit.refineLatinPunctuation=(prepared,data)=>
    refinePreparedLatinPunctuation(createCanvas,prepared,{...data,glyph:boundedGlyphMetrics});
  if(!nativeEvidence)fit.refineLatinCharacters=(prepared,data)=>
    refineOcrLatinCharacters(createCanvas,prepared,data);
  if(!nativeEvidence)fit.refineLiteralLabels=(prepared,data)=>{
    const budget=data.budget,allowance={
      get remaining(){return budget.remaining>0?budget.pixelsRemaining:0;},
      set remaining(value){budget.pixelsRemaining=value;budget.remaining--;},
    };
    fitLiteralLabelPlacement({scene:prepared.scene,data,createCanvas,allowance,check:data.check});
    return prepared;
  };
  return fit;
}
