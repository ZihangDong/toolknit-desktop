// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.

const MAX_PIXELS = 4_000_000;
const MAX_LOCAL_PIXELS = 131_072;
const finiteBox = line => line && typeof line.text === 'string' && line.text.trim() && line.confidence >= .7
  && [line.x,line.y,line.width,line.height].every(Number.isFinite) && line.width > 0 && line.height >= 6
  && line.height <= 256 && line.width <= 4096 && line.width > line.height;

/** Only long straight segments with four supported corner junctions can be a
 * local frame. They protect measurement/erasure; they never create Word tables.
 */
function localFrame(mask, width, height, origin, pair) {
  const segments=[];
  const add=(axis,at,from,to)=>{
    const last=segments.findLast(line=>line.axis===axis&&Math.abs(line.at-at)<=3
      &&Math.abs(line.from-from)<=3&&Math.abs(line.to-to)<=3);
    if(last)last.at=(last.at+at)/2;
    else segments.push({axis,at,from,to});
  };
  for(const horizontal of [true,false]){
    const cross=horizontal?height:width,length=horizontal?width:height;
    const minimum=Math.max(12,(horizontal?pair.right-pair.left:pair.bottom-pair.top)*.75);
    for(let at=0;at<cross;at++){
      let start=-1,last=-1;
      for(let pos=0;pos<=length;pos++){
        const ink=pos<length&&mask[horizontal?at*width+pos:pos*width+at];
        if(ink){if(start<0)start=pos;last=pos;}
        else if(pos===length||pos-last>2){
          if(start>=0&&last-start>=minimum)add(horizontal?'h':'v',at+(horizontal?origin.y:origin.x),
            start+(horizontal?origin.x:origin.y),last+(horizontal?origin.x:origin.y));
          start=-1;
        }
      }
      if(segments.length>64)return [];
    }
  }
  const horizontal=segments.filter(line=>line.axis==='h'),vertical=segments.filter(line=>line.axis==='v'),frames=[];
  for(const top of horizontal)for(const bottom of horizontal){
    if(top.at>=pair.top||bottom.at<=pair.bottom||bottom.at-top.at<pair.minimumHeight*1.5
      ||Math.abs(top.from-bottom.from)>3||Math.abs(top.to-bottom.to)>3)continue;
    const left=vertical.filter(line=>Math.abs(line.at-top.from)<=3&&line.from<=top.at+3&&line.to>=bottom.at-3);
    const right=vertical.filter(line=>Math.abs(line.at-top.to)<=3&&line.from<=top.at+3&&line.to>=bottom.at-3);
    if(left.length!==1||right.length!==1)continue;
    const margin=Math.max(2,pair.minimumHeight*.04);
    if(pair.centers.some(x=>x<=left[0].at+margin||x>=right[0].at-margin))continue;
    const frame=[top,bottom,left[0],right[0]];
    if(!frames.some(other=>Math.abs(other[0].at-top.at)<=3&&Math.abs(other[1].at-bottom.at)<=3))frames.push(frame);
  }
  return frames.length===1?frames[0]:[];
}

/** Overlapping detector boxes are not independent text ink bounds. Split only
 * at a source-proven blank band between comparable, horizontally aligned rows.
 * Work is bounded; uncertain rows retain their existing detector geometry.
 */
export function planOcrLineBands(lines,{width,height,inkAt,rules=[]}={}) {
  const result=new Map();
  if(!Array.isArray(lines)||lines.length>1000||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)
    ||width<1||height<1||width*height>16_000_000||typeof inkAt!=='function')return result;
  const boxes=lines.map((line,index)=>finiteBox(line)?{...line,index,right:line.x+line.width,bottom:line.y+line.height,
    cy:line.y+line.height/2}:null).filter(Boolean).sort((a,b)=>a.cy-b.cy),pairs=[];
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j],small=Math.min(a.height,b.height),distance=b.cy-a.cy;
    const overlap=Math.min(a.right,b.right)-Math.max(a.x,b.x);
    if(distance<=small*.35||distance>Math.max(a.height,b.height)*1.25||b.y-a.bottom>small*.2
      ||overlap<Math.max(a.width,b.width)*.7)continue;
    pairs.push({a,b,distance:distance/small});
    if(pairs.length>4000)return result;
  }
  pairs.sort((a,b)=>a.distance-b.distance);
  const above=new Set(),below=new Set();let remaining=MAX_PIXELS;
  for(const {a,b}of pairs){
    if(below.has(a.index)||above.has(b.index))continue;
    const minimumHeight=Math.min(a.height,b.height),pad=Math.ceil(minimumHeight*1.5);
    const left=Math.max(0,Math.floor(Math.min(a.x,b.x))),right=Math.min(width,Math.ceil(Math.max(a.right,b.right)));
    const from=Math.max(0,Math.ceil(a.cy+minimumHeight*.04));
    const to=Math.min(height,Math.floor(b.cy-minimumHeight*.04));
    if(to-from<2||right<=left)continue;
    const roi={x:Math.max(0,left-pad),y:Math.max(0,Math.floor(a.y)-pad),
      right:Math.min(width,right+pad),bottom:Math.min(height,Math.ceil(b.bottom)+pad)};
    const rw=roi.right-roi.x,rh=roi.bottom-roi.y,localPixels=rw*rh;
    // Large full-width paragraphs need only their narrow overlap strip.
    const useLocal=localPixels<=MAX_LOCAL_PIXELS,sy=useLocal?roi.y:Math.max(0,Math.floor(a.cy));
    const ey=useLocal?roi.bottom:Math.min(height,Math.ceil(b.cy)),sx=useLocal?roi.x:left,ex=useLocal?roi.right:right;
    const mw=ex-sx,mh=ey-sy,cost=mw*mh;
    if(cost<=0||cost>remaining)continue;
    remaining-=cost;
    const mask=new Uint8Array(cost);
    for(let y=sy;y<ey;y++)for(let x=sx;x<ex;x++)mask[(y-sy)*mw+x-sx]=inkAt(x,y)?1:0;
    const centers=[a,b].flatMap(line=>(line.words||[]).filter(word=>word?.text?.trim()
      &&Number.isFinite(word.x+word.width)&&word.width>0).map(word=>word.x+word.width/2));
    const frame=useLocal&&centers.length>=4?localFrame(mask,mw,mh,{x:sx,y:sy},
      {left, right,top:a.y,bottom:b.bottom,minimumHeight,centers}):[];
    const near=rules.filter(rule=>rule&&[rule.at,rule.from,rule.to].every(Number.isFinite)
      &&(rule.axis==='h'?rule.at>=sy&&rule.at<ey&&rule.to>=sx&&rule.from<ex
        :rule.axis==='v'&&rule.at>=sx&&rule.at<ex&&rule.to>=sy&&rule.from<ey));
    if(near.length>64)continue;
    near.push(...frame);
    const allowance=Math.max(1.5,Math.min(4,minimumHeight*.06));
    const ignored=(x,y)=>near.some(rule=>rule.axis==='h'
      ?Math.abs(y-rule.at)<=allowance&&x>=rule.from-allowance&&x<=rule.to+allowance
      :Math.abs(x-rule.at)<=allowance&&y>=rule.from-allowance&&y<=rule.to+allowance);
    const inkRows=[];
    for(let y=Math.floor(a.cy);y<Math.ceil(b.cy);y++){
      let ink=0;
      for(let x=left;x<right;x++)if(mask[(y-sy)*mw+x-sx]&&!ignored(x,y))ink++;
      inkRows.push({y,ink});
    }
    const gaps=[];
    for(let i=0;i<inkRows.length;){
      if(inkRows[i].ink||inkRows[i].y<from||inkRows[i].y>=to){i++;continue;}
      const start=i;
      while(i<inkRows.length&&!inkRows[i].ink&&inkRows[i].y<to)i++;
      if(i-start>=2&&inkRows.slice(0,start).some(row=>row.ink)&&inkRows.slice(i).some(row=>row.ink))
        gaps.push({start:inkRows[start].y,end:inkRows[i-1].y+1});
    }
    if(!gaps.length)continue;
    const center=(a.cy+b.cy)/2;
    gaps.sort((a,b)=>Math.abs((a.start+a.end)/2-center)-Math.abs((b.start+b.end)/2-center));
    const cut=(gaps[0].start+gaps[0].end)/2;
    // Only the shared boundary is proven. Keep outer erasure padding instead
    // of clipping antialiased glyph fringes to an approximate detector box.
    const first=result.get(a.index)||{top:0,bottom:height,rules:[]};
    const second=result.get(b.index)||{top:0,bottom:height,rules:[]};
    if(cut<=first.top||cut>=second.bottom)continue;
    first.bottom=Math.min(first.bottom,cut);second.top=Math.max(second.top,cut);
    first.rules.push(...frame);second.rules.push(...frame);result.set(a.index,first);result.set(b.index,second);
    below.add(a.index);above.add(b.index);
  }
  return result;
}
