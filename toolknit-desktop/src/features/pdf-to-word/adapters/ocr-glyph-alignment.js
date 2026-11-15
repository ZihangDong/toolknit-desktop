// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.

/** Recover a suspicious CJK line's ordered ink ownership. CTC peaks guide the
 * bounded search; they cannot assign a neighbouring glyph to a punctuation mark.
 * Every original ink cluster must belong to exactly one unchanged OCR token.
 */
export function alignOcrGlyphs({line,chars,ordered,tight,inkAt,width,height,sx,sy,glyph,normalized,similarity,fonts,weights,budget,referenceFace=null,mixedScripts=null,ownershipAnchors=[]}) {
  if(!budget||!Number.isFinite(budget.remaining)||budget.remaining<1
    ||!Array.isArray(fonts)||fonts.length>5||!Array.isArray(weights)||weights.length>2
    ||chars.length>96||chars.length<4||chars.some(c=>[...c.text].length!==1)
    ||!/[\p{Script=Han}]/u.test(line.text))return null;
  const left=Math.max(0,Math.floor(tight.x*sx)),top=Math.max(0,Math.floor(tight.y*sy));
  const right=Math.min(width,Math.ceil((tight.x+tight.width)*sx)),bottom=Math.min(height,Math.ceil((tight.y+tight.height)*sy));
  const w=right-left,h=bottom-top;
  if(w*h>262144||w<1||h<12||h>180)return null;
  const pixelBudget=budget.pixelsRemaining??4_000_000;
  if(!Number.isFinite(pixelBudget)||w*h>pixelBudget)return null;
  budget.pixelsRemaining=pixelBudget-w*h;
  const pixels=new Uint8Array(w*h),columns=[];
  for(let x=0;x<w;x++){
    let amount=0,first=h,end=0;
    for(let y=0;y<h;y++)if(inkAt(left+x,top+y)){pixels[y*w+x]=1;amount++;first=Math.min(first,y);end=y+1;}
    columns.push({amount,top:first,bottom:end});
  }
  const clusters=[];
  for(let x=0;x<w;){
    if(!columns[x].amount){x++;continue;}
    let start=x;while(x<w&&columns[x].amount)x++;
    // Bold or blurred neighbours can share a shallow fringe. Offer a bounded
    // valley cut only for an over-wide cluster; the glyph path may merge the
    // pieces back, and must still prove the complete unchanged token sequence.
    while(x-start>h*1.45){
      let cut=-1,best=Infinity;
      for(let at=start+Math.ceil(h*.55);at<Math.min(x-h*.35,start+h*1.45);at++){
        if(columns[at].amount>Math.max(2,h*.1))continue;
        const score=columns[at].amount+Math.abs(at-start-h)/h*.25;
        if(score<best){best=score;cut=at;}
      }
      if(cut<0)break;
      clusters.push({start,end:cut});start=cut;
    }
    clusters.push({start,end:x});
  }
  if(clusters.length<chars.filter(c=>!c.ruling).length||clusters.length>400)return null;
  const groups=new Map();
  const group=(start,count)=>{
    const key=start*6+count-1;if(groups.has(key))return groups.get(key);
    const first=clusters[start],last=clusters[start+count-1];if(!first||!last)return null;
    let a=h,b=0;
    for(let x=first.start;x<last.end;x++){a=Math.min(a,columns[x].top);b=Math.max(b,columns[x].bottom);}
    const ww=last.end-first.start,hh=b-a;
    if(ww>h*2.5||hh<1)return null;
    const mask=new Uint8Array(ww*hh);
    for(let y=0;y<hh;y++)for(let x=0;x<ww;x++)mask[y*ww+x]=pixels[(y+a)*w+x+first.start];
    const result={end:start+count,center:left+(first.start+last.end)/2,
      rect:{x:(left+first.start)/sx,y:(top+a)/sy,width:ww/sx,height:hh/sy},mask:normalized(mask,ww,hh)};
    groups.set(key,result);return result;
  };
  let best=null;const regular=new Map();
  const latin=c=>/^[A-Za-z0-9]$/u.test(c.text);
  const mixedAllowed=mixedScripts&&fonts.includes(mixedScripts.baseFont)
    &&Array.isArray(mixedScripts.latinFonts)&&mixedScripts.latinFonts.length<=3
    &&mixedScripts.latinFonts.every(font=>['Arial','Times New Roman','Calibri'].includes(font))
    &&chars.filter((c,i)=>latin(c)&&ordered[i].confidence>=.75).length>=2
    &&chars.filter(c=>/\p{Script=Han}/u.test(c.text)).length>=4;
  for(const mixed of [false,true]){
   // Try bounded script-specific faces only after the uniform-font path fails;
   // every cluster still has one owner and the original score gates apply.
   if(mixed&&(!mixedAllowed||best&&best.score>=.72&&best.minimum>=.45))break;
   const bases=mixed?[...new Set([mixedScripts.baseFont,...fonts])].slice(0,2):fonts;
   const latinFaces=mixed?mixedScripts.latinFonts.flatMap(font=>weights.map(bold=>({font,bold}))):[null];
   for(const font of bases)for(const bold of weights)for(const scriptFace of latinFaces){
    const key=JSON.stringify([font,scriptFace]);
    const face=chars.map(c=>glyph(c.text,scriptFace&&latin(c)?scriptFace.font:font,scriptFace&&latin(c)?scriptFace.bold:bold));
    const sizes=chars.flatMap((c,i)=>c.rect&&/[\p{Script=Han}]/u.test(c.text)&&c.rect.height*sy>h*.6&&face[i]
      ?[c.rect.height*100/face[i].outline.height]:[]).sort((a,b)=>a-b);
    if(!sizes.length)continue;
    const nominal=sizes[Math.floor(sizes.length/2)];
    let states=new Map([[0,{score:0,previous:null,part:null,minimum:1}]]);
    for(let i=0;i<chars.length;i++){
      const next=new Map(),c=chars[i],g=face[i];if(!g){states.clear();break;}
      for(const [start,path]of states){
        if(c.ruling){next.set(start,{...path,previous:path,part:{text:c.text,ruling:c.ruling}});continue;}
        for(let count=1;count<=6;count++){
          const box=group(start,count);if(!box)continue;
          if(Math.abs(box.center-ordered[i].center)>Math.max(h*2,ordered[i].width*3))continue;
          if(budget.remaining<1)return null;
          budget.remaining--;
          const shape=similarity(box.mask,g.mask),ratio=box.rect.width/box.rect.height/(g.outline.width/g.outline.height);
          const size=box.rect.height*100/g.outline.height;
          const score=shape-Math.min(.25,Math.abs(Math.log(ratio))*.15)
            -Math.min(.45,Math.abs(Math.log(size/nominal))*.25)
            -Math.min(.15,Math.abs(box.center-ordered[i].center)/h*.035);
          if(shape<.45||score<.25)continue;
          const total=path.score+score,existing=next.get(box.end);
          if(!existing||total>existing.score)next.set(box.end,{score:total,previous:path,
            part:{text:c.text,rect:box.rect,mask:box.mask},minimum:Math.min(path.minimum,score)});
        }
      }
      states=next;if(!states.size)break;
    }
    const path=states.get(clusters.length);
    if(!path)continue;
    const score=path.score/chars.filter(c=>!c.ruling).length;
    const words=[];for(let node=path;node.part;node=node.previous)words.push(node.part);
    const result={font,bold,score,minimum:path.minimum,words:words.reverse(),faceKey:key};
    if(scriptFace)for(const c of result.words)if(latin(c))c.alignmentFace={...scriptFace};
    if(!bold)regular.set(key,result);
    if(!best||score>best.score)best=result;
   }
   const normal=best?.bold&&regular.get(best.faceKey);
   if(normal&&best.score-normal.score<.08&&normal.minimum>=.45)best=normal;
  }
  if(!best||best.score<.72||best.minimum<.45)return null;
  if(referenceFace&&fonts.includes(referenceFace.font)&&weights.includes(referenceFace.bold)){
    const face=chars.map(c=>glyph(c.text,referenceFace.font,referenceFace.bold));
    const sizes=chars.flatMap((c,i)=>c.rect&&/[\p{Script=Han}]/u.test(c.text)&&c.rect.height*sy>h*.6&&face[i]
      ?[c.rect.height*100/face[i].outline.height]:[]).sort((a,b)=>a-b);
    const nominal=sizes[Math.floor(sizes.length/2)];
    const measure=(parts,allowEmptyPunctuation=false,indices=null)=>{
      let total=0,minimum=1,count=0;
      for(let i=0;i<parts.length;i++){
        if(indices&&!indices.has(i))continue;
        const box=parts[i],g=face[i];if(box.ruling)continue;
        if(!g||!(nominal>0)||budget.remaining<1)return null;
        // The original CTC cell may be blank because its punctuation ink was
        // assigned to a neighbour. Count that missing member as zero evidence;
        // the replacement still needs the complete unchanged source-ink path.
        if(!box.mask||!box.rect){
          if(!allowEmptyPunctuation||!/^[、，。,.]$/u.test(box.text))return null;
          count++;minimum=0;continue;
        }
        budget.remaining--;
        const shape=similarity(box.mask,g.mask),ratio=box.rect.width/box.rect.height/(g.outline.width/g.outline.height);
        const size=box.rect.height*100/g.outline.height,center=(box.rect.x+box.rect.width/2)*sx;
        const score=shape-Math.min(.25,Math.abs(Math.log(ratio))*.15)
          -Math.min(.45,Math.abs(Math.log(size/nominal))*.25)
          -Math.min(.15,Math.abs(center-ordered[i].center)/h*.035);
        total+=score;minimum=Math.min(minimum,score);count++;
      }
      return count?{score:total/count,minimum}:null;
    };
    // Compare complete old/new ink ownership under the SAME retained face.
    // A letters-only font score cannot judge a repaired punctuation boundary.
    const before=measure(chars,true),after=measure(best.words);
    if(before&&after)best={...best,ownershipGain:after.score-before.score,ownershipMinimum:after.minimum};
    const punctuation=chars.flatMap((c,i)=>/^[、，。,.．：:；;]$/u.test(c.text)?[i]:[]);
    const anchors=Array.isArray(ownershipAnchors)&&ownershipAnchors.length<=8
      ?ownershipAnchors.filter(i=>Number.isSafeInteger(i)&&i>=0&&i<chars.length):[];
    const changed=new Set(chars.flatMap((c,i)=>{
      const a=c.rect,b=best.words[i].rect;
      return !a!==!b||a&&['x','y','width','height'].some(key=>a[key]!==b[key])?[i]:[];
    }));
    if(changed.size>0&&changed.size<=12&&[...changed].every(i=>[...punctuation,...anchors].some(j=>Math.abs(i-j)<=1))){
      const pairs=[];
      for(const i of changed){
        if(pairs.length&&pairs.at(-1).at(-1)===i-1)pairs.at(-1).push(i);
        else pairs.push([i]);
      }
      let gain=1,minimum=1,valid=pairs.every(pair=>pair.length<=4);
      for(const pair of pairs){
        let ownGain=0;
        for(const i of pair){
          const g=glyph(chars[i].text,best.font,best.bold),next=best.words[i];
          if(!g||!next.mask||!next.rect||budget.remaining<1){valid=false;break;}
          budget.remaining--;
          const score=part=>part.mask&&part.rect?similarity(part.mask,g.mask)
            -Math.min(.2,Math.abs(Math.log(part.rect.width/part.rect.height/(g.outline.width/g.outline.height)))*.15):0;
          const nextScore=score(next);ownGain+=nextScore-score(chars[i]);minimum=Math.min(minimum,nextScore);
        }
        if(!valid)break;
        gain=Math.min(gain,ownGain/pair.length);
      }
      if(valid)best={...best,pairedGlyphGain:gain,pairedGlyphMinimum:minimum};
    }
    const missing=chars.flatMap((c,i)=>!c.mask&&!c.ruling?[i]:[]);
    if(missing.length>0&&missing.length<=2&&missing.every(i=>/^[、，。,.]$/u.test(chars[i].text))){
      // A local punctuation repair must leave every distant glyph untouched.
      // Compare only that pair's evidence so a long unchanged sentence cannot
      // dilute it; whole-line score/minimum gates above remain mandatory.
      if([...changed].every(i=>missing.some(j=>Math.abs(i-j)<=1))){
        const oldLocal=measure(chars,true,changed),newLocal=measure(best.words,false,changed);
        if(oldLocal&&newLocal)best={...best,missingPunctuationGain:newLocal.score-oldLocal.score,
          missingPunctuationMinimum:newLocal.minimum};
      }
    }
  }
  return best;
}

/** An unrelated uncertain character must not prevent a proven local boundary
 * repair. Keep strong exterior glyphs fixed and prove every intervening source
 * pixel with the same ordered-ink path; never average or restyle the full line.
 */
export function alignOcrGlyphWindows(options, targets) {
  const { chars, ordered, tight, glyph, similarity, referenceFace, sx, sy, width, height, inkAt, budget: pageBudget } = options;
  if (!referenceFace || !Array.isArray(targets) || targets.length < 1 || targets.length > 8
    || !pageBudget || pageBudget.remaining < 1 || chars.length > 96 || chars.some(c => !c.mask && !c.ruling)) return null;
  const face = referenceFace;
  const anchorEvidence = (c, i) => {
    if (!c?.mask || !c.rect || !/^\p{Script=Han}$/u.test(c.text) || !(ordered[i]?.confidence >= .9)
      || c.rect.height < tight.height * .55) return null;
    let best = null;
    for (const bold of options.weights) {
      const g = glyph(c.text, face.font, bold);
      const ratio = g && c.rect.width / c.rect.height / (g.outline.width / g.outline.height);
      const score = g && similarity(c.mask, g.mask);
      if (g && ratio >= .75 && ratio <= 1.3 && (!best || score > best.score))
        best = { score, size: c.rect.height * 100 / g.outline.height };
    }
    return best;
  };
  const strong = (c, i) => {
    const a = anchorEvidence(c, i);
    if (!a) return false;
    if (a.score >= .75) return true;
    if (a.score < .65 || ordered[i].confidence < .99) return false;
    // A clipped interior edge can be proposed by a second independently read
    // neighbour. Admission below still requires a complete improved glyph,
    // an unchanged exterior edge/height and the entire ordered source path.
    return [i - 1, i + 1].some(j => {
      const b = anchorEvidence(chars[j], j);
      return b && b.score >= .65 && ordered[j].confidence >= .99
        && Math.abs(c.rect.y - chars[j].rect.y) * sy <= 3
        && Math.max(a.size, b.size) / Math.min(a.size, b.size) <= 1.15;
    });
  };
  const result = chars.slice(), claimed = new Set(); let changes = 0;
  // Preserve the established pass and its page budget before proposing weaker
  // anchors. Optional upgrades have a separate bounded allowance so an early
  // uncertain line cannot starve later punctuation repairs.
  for (const upgrading of [false, true]) {
  const budget = upgrading
    ? (pageBudget.anchorUpgrade ??= { remaining: 12000, pixelsRemaining: 500000 }) : pageBudget;
  const legacyStrong = (c, i) => {
    if (!c?.mask || !c.rect || !/^\p{Script=Han}$/u.test(c.text) || !(ordered[i]?.confidence >= .9)
      || c.rect.height < tight.height * .55) return false;
    const g = glyph(c.text, face.font, face.bold);
    const ratio = g && c.rect.width / c.rect.height / (g.outline.width / g.outline.height);
    return g && ratio >= .75 && ratio <= 1.3 && similarity(c.mask, g.mask) >= .75;
  };
  const isStrong = upgrading ? strong : legacyStrong;
  for (const target of targets) {
    if (!Number.isSafeInteger(target) || target < 0 || target >= chars.length || claimed.has(target)) continue;
    const before = [], after = [];
    for (let i = Math.max(0, target - 8); i < target; i++) if (isStrong(chars[i], i)) before.push(i);
    for (let i = target + 1; i < Math.min(chars.length, target + 9); i++) if (isStrong(chars[i], i)) after.push(i);
    if (!before.length || !after.length) continue;
    const ranges = before.slice(-3).flatMap(first => after.slice(0, 3).map(last => ({ first, last })))
      .filter(({ first, last }) => last - first >= 3 && last - first <= 15
        && (!upgrading || !legacyStrong(chars[first], first) || !legacyStrong(chars[last], last)))
      .sort((a, b) => a.last - a.first - (b.last - b.first));
    for (const { first, last, bold } of ranges.flatMap(range => [face.bold, !face.bold]
      .filter(weight => options.weights.includes(weight)).map(bold => ({ ...range, bold })))) {
    if (last - first < 3 || last - first > 15 || [...claimed].some(i => i > first && i < last)) continue;
    const parts = chars.slice(first, last + 1);
    if (parts.some(c => !c.rect || c.ruling)) continue;
    // These boxes were measured on this exact pixel grid. Avoid a phantom
    // exterior column from (pixel / scale) * scale floating point error.
    const floor = upgrading ? Math.round : Math.floor, ceil = upgrading ? Math.round : Math.ceil;
    const x = floor(parts[0].rect.x * sx), right = ceil((parts.at(-1).rect.x + parts.at(-1).rect.width) * sx);
    const y = floor(Math.min(...parts.map(c => c.rect.y)) * sy);
    const bottom = ceil(Math.max(...parts.map(c => c.rect.y + c.rect.height)) * sy);
    if (x < 1 || right >= width || y < 0 || bottom > height || bottom <= y || right <= x) continue;
    const cost = (bottom - y) * 2;
    if (cost > (budget.pixelsRemaining ?? 0)) continue;
    budget.pixelsRemaining -= cost;
    let isolated = true;
    for (let yy = y; yy < bottom; yy++) if (inkAt(x - 1, yy) || inkAt(right, yy)) { isolated = false; break; }
    if (!isolated) continue;
    const local = alignOcrGlyphs({ ...options, chars: parts, ordered: ordered.slice(first, last + 1),
      tight: { x: x / sx, y: y / sy, width: (right - x) / sx, height: (bottom - y) / sy },
      fonts: [face.font], weights: [bold], referenceFace: { font: face.font, bold }, mixedScripts: null, budget, ownershipAnchors: [target - first] });
    if (!local || local.minimum < .45 || !(local.ownershipGain >= .1 || local.pairedGlyphGain >= .1)) continue;
    const sameEdge = (a, b) => ['x', 'y', 'width', 'height'].every(k => Math.abs(a.rect[k] - b.rect[k]) * (k === 'x' || k === 'width' ? sx : sy) <= 1.01);
    const upgradedAnchor = i => {
      const prior = parts[i], next = local.words[i], g = glyph(prior.text, local.font, local.bold);
      if (!g || ordered[first + i].confidence < .99
        || Math.abs(prior.rect.y - next.rect.y) * sy > 1.01
        || Math.abs(prior.rect.height - next.rect.height) * sy > 1.01) return false;
      const old = similarity(prior.mask, g.mask), score = similarity(next.mask, g.mask);
      const exterior = i === 0 ? Math.abs(prior.rect.x - next.rect.x) * sx
        : Math.abs(prior.rect.x + prior.rect.width - next.rect.x - next.rect.width) * sx;
      return exterior <= 1.01 && Math.abs(prior.rect.width - next.rect.width) <= prior.rect.height * .15
        && score >= .8 && score >= old + .1;
    };
    const anchors = [0, parts.length - 1];
    if (anchors.some(i => upgrading ? (!sameEdge(parts[i], local.words[i])
      || anchorEvidence(parts[i], first + i)?.score < .75) && !upgradedAnchor(i)
      : !sameEdge(parts[i], local.words[i]))) continue;
    const nominal = [parts[0], parts.at(-1)].map(c => c.rect.height * 100 / glyph(c.text, local.font, local.bold).outline.height);
    if (Math.max(...nominal) / Math.min(...nominal) > 1.25) continue;
    const bodySize = (nominal[0] + nominal[1]) / 2;
    const plausible = local.words.every(c => {
      const g = glyph(c.text, local.font, local.bold), size = g && c.rect.height * 100 / g.outline.height;
      return size >= bodySize * .65 && size <= bodySize * 1.5;
    });
    if (!plausible) continue;
    for (let i = upgrading ? 0 : 1; i < parts.length - (upgrading ? 0 : 1); i++) {
      const c = local.words[i], prior = chars[first + i];
      if (!sameEdge(prior, c)) { result[first + i] = { ...prior, ...c, alignmentFace: { font: local.font, bold: local.bold } }; claimed.add(first + i); changes++; }
    }
    break;
    }
  }
  }
  return changes ? { words: result, localOwnership: true } : null;
}
