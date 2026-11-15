export const MAX_ANNOTATIONS = 300;
export const MAX_POINTS = 6000;
export const MAX_TOTAL_POINTS = 20000;
export const TOOLS = Object.freeze(['select', 'rectangle', 'ellipse', 'arrow', 'brush', 'mosaic', 'text']);
export const isPaintStroke = item => item?.kind === 'brush' || item?.kind === 'mosaic';
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function rectangle(a, b, width, height) {
  const x = clamp(Math.min(a.x, b.x), 0, width), y = clamp(Math.min(a.y, b.y), 0, height);
  return { x, y, width: Math.max(1, clamp(Math.max(a.x, b.x), 0, width)-x), height: Math.max(1, clamp(Math.max(a.y, b.y), 0, height)-y) };
}
export function contains(r, p, tolerance = 0) { return p.x >= r.x-tolerance && p.y >= r.y-tolerance && p.x <= r.x+r.width+tolerance && p.y <= r.y+r.height+tolerance; }
export function moveRect(r, dx, dy, width, height) { return { ...r, x:clamp(r.x+dx,0,Math.max(0,width-r.width)), y:clamp(r.y+dy,0,Math.max(0,height-r.height)) }; }
export function handlePoints(r) { return [[r.x,r.y],[r.x+r.width/2,r.y],[r.x+r.width,r.y],[r.x+r.width,r.y+r.height/2],[r.x+r.width,r.y+r.height],[r.x+r.width/2,r.y+r.height],[r.x,r.y+r.height],[r.x,r.y+r.height/2]]; }
export function resizeRect(r, handle, p, width, height) {
  let left=r.x, top=r.y, right=r.x+r.width, bottom=r.y+r.height;
  if ([0,6,7].includes(handle)) left=clamp(p.x,0,right-1);
  if ([2,3,4].includes(handle)) right=clamp(p.x,left+1,width);
  if ([0,1,2].includes(handle)) top=clamp(p.y,0,bottom-1);
  if ([4,5,6].includes(handle)) bottom=clamp(p.y,top+1,height);
  return {x:left,y:top,width:right-left,height:bottom-top};
}
export function resizeAnnotation(original, r) {
  const next={...original,...r};
  if (original.points) next.points=original.points.map(p=>({x:r.x+(p.x-original.x)*r.width/Math.max(1,original.width),y:r.y+(p.y-original.y)*r.height/Math.max(1,original.height)}));
  return next;
}
export function windowAt(desktop, point) {
  const global={x:point.x+desktop.bounds.x,y:point.y+desktop.bounds.y};
  const r=desktop.windows.find(r=>contains(r,global));
  if (!r) return {x:0,y:0,width:desktop.bounds.width,height:desktop.bounds.height};
  return rectangle({x:r.x-desktop.bounds.x,y:r.y-desktop.bounds.y},{x:r.x+r.width-desktop.bounds.x,y:r.y+r.height-desktop.bounds.y},desktop.bounds.width,desktop.bounds.height);
}
export function textLines(ctx, text, maxWidth) {
  const result=[];
  for (const paragraph of String(text).split('\n')) {
    let current='';
    for (const char of paragraph) { if (current && ctx.measureText(current+char).width>maxWidth) { result.push(current); current=''; } current+=char; }
    result.push(current);
  }
  return result;
}
export function fitText(ctx, text, width, height, preferred=28) {
  let size=clamp(preferred,8,120), lines;
  do { ctx.font=`${size}px sans-serif`; lines=textLines(ctx,text,Math.max(1,width-4)); if (lines.length*size*1.25<=height-4 || size<=8) break; size--; } while (true);
  return {size,lines,fits:lines.length*size*1.25<=height-4 && lines.every(line=>ctx.measureText(line).width<=width-4)};
}
export function annotationTextLayout(ctx, item) {
  if (item.cover) return { ...fitText(ctx,item.text,item.width,item.height,item.font||28), offsetX:2,offsetY:2 };
  const size=clamp(item.font||28,8,120);
  ctx.font=`${size}px sans-serif`;ctx.textBaseline='top';
  const lines=textLines(ctx,item.text,Math.max(1,item.width-4));
  let left=0,right=0,top=Infinity,bottom=-Infinity;
  lines.forEach((line,index)=>{
    const metrics=ctx.measureText(line), y=index*size*1.25;
    left=Math.min(left,-(metrics.actualBoundingBoxLeft||0));
    right=Math.max(right,metrics.width,metrics.actualBoundingBoxRight||0);
    top=Math.min(top,y-(metrics.actualBoundingBoxAscent||0));
    bottom=Math.max(bottom,y+(Number.isFinite(metrics.actualBoundingBoxDescent)&&line?metrics.actualBoundingBoxDescent:size));
  });
  const width=Math.ceil(right-left)+4,height=Math.ceil(bottom-top)+4;
  return {size,lines,width,height,offsetX:2-left,offsetY:2-top,fits:width<=item.width&&height<=item.height};
}
export function tightenTextAnnotation(ctx, item) {
  if(item.cover)return item;
  for(let font=clamp(item.font||28,8,120);font>=8;font--){
    const layout=annotationTextLayout(ctx,{...item,font});
    if(layout.fits)return {...item,font,width:layout.width,height:layout.height};
  }
  throw new Error('screenshot:text-overflow');
}
function hasCjk(value) { return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]/u.test(value); }
export function normalizeOcrText(value) {
  // Remove OCR-inserted CJK spaces, retaining code/Latin spacing and line breaks.
  return String(value || '').replace(/([\u3040-\u30ff\u3400-\u9fff])[ \u00a0]+(?=[\u3040-\u30ff\u3400-\u9fff，。！？；：、）】》])/gu, '$1')
    .replace(/([（【《])[ \u00a0]+(?=[\u3400-\u9fff])/gu, '$1').trim();
}
export function ocrLines(result) {
  return (Array.isArray(result?.lines) ? result.lines : []).filter(line => line && typeof line.text === 'string')
    .slice().sort((a,b) => a.y-b.y || a.x-b.x).map((line, index) => ({
    ...line, id: index,
    text: normalizeOcrText(result.engine === 'pp-ocrv5-mobile' ? line.text : Array.isArray(line.words) && line.words.length ? joinOcrLine(line.words) : line.text)
  })).filter(line => line.text && [line.x,line.y,line.width,line.height].every(Number.isFinite) && line.width > 0 && line.height > 0);
}
function joinOcrLine(lines) {
  return lines.reduce((result, line, index) => {
    const text = normalizeOcrText(line.text);
    if (!text) return result;
    if (!result) return text;
    const previous = lines[index - 1];
    const gap = Number(line.x) - (Number(previous.x) + Number(previous.width));
    const height = Math.max(1, Math.min(Number(previous.height) || 16, Number(line.height) || 16));
    const needsSpace = gap > 0
      && !hasCjk(result.slice(-1)) && !hasCjk(text.slice(0, 1))
      && !/^[,.;:!?%)\]}]/.test(text) && !/[([{]$/.test(result);
    const columnGap = gap > height * 2;
    return result + (columnGap ? '\t' : needsSpace ? ' ' : '') + text;
  }, '');
}
export function formatOcrText(result) {
  const fallback = normalizeOcrText(result?.text);
  const lines = Array.isArray(result?.lines)
    ? result.lines.filter(line => typeof line?.text === 'string' && line.text.trim())
      .map((line, index) => ({
        ...line,
        text: normalizeOcrText(result.engine === 'pp-ocrv5-mobile' ? line.text : Array.isArray(line.words) && line.words.length ? joinOcrLine(line.words) : line.text),
        id: Number.isInteger(line.id) ? line.id : index,
        x: Number(line.x), y: Number(line.y), width: Number(line.width), height: Number(line.height)
      }))
    : [];
  if (!lines.length || lines.some(line => ![line.x, line.y, line.width, line.height].every(Number.isFinite) || line.width <= 0 || line.height <= 0)) return fallback;
  lines.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const line of lines) {
    const lineCenter = line.y + line.height / 2;
    const row = rows.find(candidate => Math.abs(lineCenter - candidate.center) <= Math.max(line.height, candidate.height) * 0.6);
    if (row) {
      row.lines.push(line);
      row.center = row.lines.reduce((sum, item) => sum + item.y + item.height / 2, 0) / row.lines.length;
      row.height = Math.max(row.height, line.height);
    } else rows.push({ lines: [line], center: lineCenter, height: line.height });
  }
  rows.sort((a, b) => a.center - b.center);
  return rows.map((row, index) => {
    row.lines.sort((a, b) => a.x - b.x);
    const text = joinOcrLine(row.lines);
    if (index === 0) return text;
    const previous = rows[index - 1];
    const previousBottom = Math.max(...previous.lines.map(item => item.y + item.height));
    const currentTop = Math.min(...row.lines.map(item => item.y));
    const paragraphGap = currentTop - previousBottom > Math.max(previous.height, row.height) * 1.5;
    return `${paragraphGap ? '\n\n' : '\n'}${text}`;
  }).join('').trim() || fallback;
}
export function errorKey(error) {
  if(String(error?.message||error).startsWith('ocr:'))return ({'not-installed':'ocrModelsMissing','cancelled':'cancelled','busy':'busy','image-too-large':'ocrTooLarge','desktop-only':'desktopOnly'})[String(error?.message||error).slice(4)]||'ocrFailed';
  if(String(error?.message||error).startsWith('translation:'))return ({'not-installed':'localMissing','cancelled':'cancelled','timeout':'localTimeout','busy':'busy','desktop-only':'desktopOnly'})[String(error?.message||error).slice(12)]||'localFailure';
  const code=String(error?.code || error?.message || error).replace(/^screenshot:/,'');
  if (code==='text-overflow') return 'textOverflow';
  if (code==='annotation-limit') return 'annotationLimit';
  if (code==='aborted') return 'cancelled';
  if (code === 'http_error') {
    const status = Number(error?.status);
    return ({401:'aiUnauthorized',403:'aiForbidden',404:'aiNotFound',429:'aiRateLimited'})[status] || (status >= 500 && status <= 599 ? 'aiProviderUnavailable' : 'aiHttp');
  }
  return ({'windows-only':'desktopOnly','shortcut-conflict':'shortcutConflict','shortcut-invalid':'shortcutInvalid','shortcut-failed':'shortcutConflict','image-too-large':'tooLarge','ocr-too-large':'ocrTooLarge','ocr-language-missing':'ocrUnavailable','ocr-unavailable':'ocrUnavailable','ocr-failed':'ocrFailed','busy':'busy','expired':'expired','viewer-limit':'viewerLimit','invalid-translation':'invalidTranslation','timeout':'aiTimeout','response_truncated':'aiTruncated','empty_response':'aiEmpty','invalid_request':'aiInvalidRequest','invalid_response':'aiInvalidResponse','response_too_large':'aiTooLarge','invalid_config':'aiInvalidConfig','network_error':'aiNetwork','native_transport_unavailable':'aiNativeUnavailable','private_http_requires_opt_in':'aiPrivateHttp','insecure_http_not_allowed':'aiInsecureHttp','provider_changed':'providerChanged'})[code] || 'failed';
}
