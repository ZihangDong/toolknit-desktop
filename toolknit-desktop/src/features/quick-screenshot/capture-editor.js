import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createSnapshotHistory } from '../../shared/snapshot-history.js';
import { createAiRequestRuntime } from '../../app/ai-request-runtime.js';
import { tauriCorePromise } from '../../platform/tauri-runtime.js';
import { createLocalTranslationRuntime } from '../../platform/local-translation-runtime.js';
import { enhanceToolSelect } from '../../tool-custom-select.js';
import { t } from '../../i18n.js';
import { clamp, rectangle, contains, moveRect, handlePoints, resizeRect, resizeAnnotation, windowAt, formatOcrText, ocrLines, fitText, tightenTextAnnotation, isPaintStroke, MAX_ANNOTATIONS, MAX_POINTS, MAX_TOTAL_POINTS, errorKey } from './core.js';
import { RECOGNITION_PROMPT, translationBlocks, resolveTranslationBatches, createTranslationRequestBudget, layoutTranslations } from './translation.js';
import { renderEditor, composeScreenshot, createPaintScratch } from './renderer.js';
import { loadCaptureSource } from './capture-source.js';

export async function createController(services, data) {
  const { runtime, tr, q, notify, showDialog, getContext } = services;
  const scope = createLifecycleScope(), canvas = q('Canvas'), source = q('Desktop');
  const sampler = document.createElement('canvas'), scratch = createPaintScratch();
  scope.use(()=>{sampler.width=sampler.height=scratch.pixels.width=scratch.pixels.height=scratch.mask.width=scratch.mask.height=1;});
  try {
  const state = { width: data.desktop.bounds.width, height: data.desktop.bounds.height, crop: null, candidate: null, items: [], selected: null, original: false };
  let disposed = false, tool = 'select', drag = null, frame = 0, nextId = 0, busy = false, taskRevision = 0, abort = null, pointer = null;
  let ocrCache = null, recognitionCache = null;
  const localTranslation = createLocalTranslationRuntime({isTauri: services.isTauri, session: data.session});
  let languageSelect;
  function stage(key, vars) { q('Busy').querySelector('[data-i18n]').textContent = tr(key, vars); }
  const snapshot = () => structuredClone({ crop: state.crop, items: state.items });
  const history = createSnapshotHistory({ capture: snapshot, apply(value) { Object.assign(state, structuredClone(value)); state.selected = null; draw(); }, equals: (a, b) => JSON.stringify(a) === JSON.stringify(b), onChange: () => updateActions(), limit: 30, measure: value => JSON.stringify(value).length*2, maxBytes: 8*1024*1024 });
  const requestAi = createAiRequestRuntime({ isTauri: services.isTauri, getConfig: () => getContext().provider,
    getApiKey: async () => (await tauriCorePromise).invoke('load_ai_api_key'), translate: t });
  await loadCaptureSource({source,data,runtime,scope,isCurrent:()=>!scope.disposed&&(services.isCurrent?.()??true)});
  services.mark?.('decode');
  sampler.width = state.width; sampler.height = state.height;
  const sample = sampler.getContext('2d', { willReadFrequently: true }); sample.drawImage(source, 0, 0);
  services.mark?.('sample');
  languageSelect = enhanceToolSelect(q('Language'));
  scope.use(() => languageSelect?.dispose());
  q('Language').value = 'zh-Hans';
  languageSelect?.refresh();
  function currentPoint(e) { const r = canvas.getBoundingClientRect(); return { x: clamp((e.clientX-r.left)*state.width/r.width, 0, state.width-1), y: clamp((e.clientY-r.top)*state.height/r.height, 0, state.height-1) }; }
  function physicalScale() { return { x: canvas.width/state.width, y: canvas.height/state.height }; }
  function queueDraw() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!disposed) draw(); }); }
  function monitorArea(point) {
    const origin = data.desktop.bounds;
    const area = data.desktop.monitors?.find(r => contains(r, { x: point.x+origin.x, y: point.y+origin.y }));
    const sx = innerWidth/state.width, sy = innerHeight/state.height;
    return area ? { x: (area.x-origin.x)*sx, y: (area.y-origin.y)*sy, width: area.width*sx, height: area.height*sy } : { x: 0, y: 0, width: innerWidth, height: innerHeight };
  }
  function positionTools() {
    const r = state.crop; q('Toolbar').hidden = !r;
    if (!r) return;
    const sx = innerWidth/state.width, sy = innerHeight/state.height, area = monitorArea({ x:r.x+r.width/2, y:r.y+r.height/2 });
    const toolbar = q('Toolbar'); toolbar.style.maxWidth = `${Math.max(160, area.width-16)}px`;
    const w = toolbar.offsetWidth, h = toolbar.offsetHeight;
    toolbar.style.left = `${clamp(r.x*sx, area.x+8, Math.max(area.x+8, area.x+area.width-w-8))}px`;
    const below = (r.y+r.height)*sy+12;
    toolbar.style.top = `${clamp(below+h<area.y+area.height ? below : r.y*sy-h-12, area.y+8, Math.max(area.y+8,area.y+area.height-h-8))}px`;
    q('Dimensions').textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    q('Dimensions').style.left = `${clamp(r.x*sx,area.x+8,area.x+area.width-140)}px`;
    q('Dimensions').style.top = `${clamp(r.y*sy-30,area.y+8,area.y+area.height-32)}px`;
    q('Dimensions').hidden = false;
  }
  function updateActions() {
    const toolbar = q('Toolbar');
    toolbar.querySelectorAll('[data-shot-action]').forEach(b => {
      const a = b.dataset.shotAction;
      b.disabled = busy || (a==='undo'&&!history?.canUndo()) || (a==='redo'&&!history?.canRedo());
      if (b.hasAttribute('data-shot-tool')) b.setAttribute('aria-pressed', String(a===tool));
    });
    toolbar.querySelectorAll('input,select').forEach(input => { input.disabled = busy; });
    languageSelect?.refresh();
    toolbar.querySelector('[data-shot-action="original"]').setAttribute('aria-pressed', String(state.original));
    q('Busy').hidden = !busy;
  }
  function draw() {
    renderEditor(canvas,state,source,scratch,physicalScale()); positionTools(); updateActions();
  }
  function resize() { const dpr = Math.min(devicePixelRatio||1,2); canvas.width = Math.round(innerWidth*dpr); canvas.height = Math.round(innerHeight*dpr); draw(); }
  function magnify(e,p) {
    const box = q('Magnifier'); box.hidden = Boolean(state.crop || busy);
    if (box.hidden) return;
    const pixels = q('Pixels').getContext('2d'); pixels.imageSmoothingEnabled = false;
    pixels.fillStyle='#000';pixels.fillRect(0,0,126,126);pixels.drawImage(sampler, Math.floor(p.x)-10,Math.floor(p.y)-10,21,21,0,0,126,126);
    pixels.strokeStyle='#22c55e';pixels.lineWidth=1;pixels.strokeRect(60,60,6,6);
    const rgb=sample.getImageData(Math.floor(p.x),Math.floor(p.y),1,1).data;
    const hex=`#${[...rgb].slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('')}`;
    q('PixelInfo').textContent=`${Math.round(p.x+data.desktop.bounds.x)}, ${Math.round(p.y+data.desktop.bounds.y)}\n${hex} · RGB ${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;
    const area=monitorArea(p), w=box.offsetWidth,h=box.offsetHeight;
    box.style.left=`${clamp(e.clientX+22,area.x+8,area.x+area.width-w-8)}px`;
    box.style.top=`${clamp(e.clientY+22,area.y+8,area.y+area.height-h-8)}px`;
  }
  function handleAt(r,p) { if(!r)return -1; const tolerance=8*state.width/innerWidth;return handlePoints(r).findIndex(([x,y])=>Math.hypot(p.x-x,p.y-y)<=tolerance); }
  function commit() { if(JSON.stringify(snapshot())!==JSON.stringify(history.current))history.commit();draw(); }
  function style() { return {color:q('Color').value,stroke:Number(q('Stroke').value),fill:q('Fill').checked,font:Number(q('Font').value)||28,block:Number(q('Block').value)}; }
  function editText(item, point) {
    if (!item && state.items.length>=MAX_ANNOTATIONS) return notify(tr('annotationLimit'));
    const input=document.createElement('textarea');input.className='shot-text-input';input.maxLength=4000;input.value=item?.text||'';input.setAttribute('aria-label',tr('text'));
    showDialog(tr('text'),input,{copyText:()=>input.value,iconOnly:true,onConfirm:()=>{
      if(disposed||!input.value.trim())return;
      let next=item?{...item,text:input.value.trim()}:{id:++nextId,kind:'text',x:point.x,y:point.y,text:input.value.trim(),...style()};
      if(!next.cover){
        next.width=state.crop.x+state.crop.width-next.x;next.height=state.crop.y+state.crop.height-next.y;
        try{next=tightenTextAnnotation(sample,next);}catch{notify(tr('textOverflow'));return;}
      }else if(!fitText(sample,next.text,next.width,next.height,next.font).fits){notify(tr('textOverflow'));return;}
      if(item)Object.assign(item,next);else{state.items.push(next);state.selected=next.id;}
      tool='select';state.selected=next.id;commit();
    }});requestAnimationFrame(()=>input.focus());
  }
  function down(e) {
    if(busy||e.button!==0||state.original)return;
    canvas.focus();const p=currentPoint(e);pointer=p;
    canvas.setPointerCapture(e.pointerId);
    if(!state.crop){drag={kind:'crop',start:p,window:windowAt(data.desktop,p),before:snapshot()};return;}
    const selected=state.items.find(a=>a.id===state.selected&&!isPaintStroke(a)), handle=tool==='select'?handleAt(selected||state.crop,p):-1;
    if(handle>=0){drag={kind:selected?'resize-item':'resize-crop',handle,start:p,original:structuredClone(selected||state.crop),before:snapshot()};return;}
    if(!contains(state.crop,p)) {state.selected=null;draw();return;}
    if(tool==='select') {
      const item=[...state.items].reverse().find(a=>!isPaintStroke(a)&&contains(a,p,3));state.selected=item?.id||null;
      drag={kind:item?'move-item':'move-crop',start:p,original:structuredClone(item||state.crop),before:snapshot()};draw();return;
    }
    if(tool==='text'){editText(null,p);return;}
    if(state.items.length>=MAX_ANNOTATIONS)return notify(tr('annotationLimit'));
    const item={id:++nextId,kind:tool,...rectangle(p,p,state.width,state.height),...style()};
    if(isPaintStroke(item)&&state.items.reduce((n,a)=>n+(a.points?.length||0),0)+2>MAX_TOTAL_POINTS)return notify(tr('annotationLimit'));
    if(tool==='arrow'||isPaintStroke(item))item.points=[p,p];
    state.items.push(item);state.selected=isPaintStroke(item)?null:item.id;drag={kind:'draw',start:p,item,before:history.current};draw();
  }
  function move(e) {
    if(busy)return;const p=currentPoint(e);pointer=p;
    if(!drag){if(!state.crop){state.candidate=windowAt(data.desktop,p);magnify(e,p);}queueDraw();return;}
    const d=drag, dx=p.x-d.start.x,dy=p.y-d.start.y;
    if(d.kind==='crop'){state.crop=rectangle(d.start,p,state.width,state.height);state.candidate=null;}
    if(d.kind==='move-crop')state.crop=moveRect(d.original,dx,dy,state.width,state.height);
    if(d.kind==='resize-crop')state.crop=resizeRect(d.original,d.handle,p,state.width,state.height);
    if(d.kind==='move-item'||d.kind==='resize-item'){
      const index=state.items.findIndex(a=>a.id===d.original.id);
      if(index>=0){const r=d.kind==='move-item'?moveRect(d.original,dx,dy,state.width,state.height):resizeRect(d.original,d.handle,p,state.width,state.height);let next=resizeAnnotation(d.original,r);
        if(d.kind==='resize-item'&&next.kind==='text'&&!next.cover){try{next=tightenTextAnnotation(sample,next);}catch{return;}}
        state.items[index]=next;}
    }
    if(d.kind==='draw'){
      if(isPaintStroke(d.item)){if(d.item.points.length<MAX_POINTS&&state.items.reduce((n,a)=>n+(a.points?.length||0),0)<MAX_TOTAL_POINTS&&Math.hypot(p.x-d.item.points.at(-1).x,p.y-d.item.points.at(-1).y)>1){
        d.item.points.push(p);
        const left=Math.min(d.item.x,p.x),top=Math.min(d.item.y,p.y),right=Math.max(d.item.x+d.item.width,p.x),bottom=Math.max(d.item.y+d.item.height,p.y);
        Object.assign(d.item,{x:left,y:top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)});
      }
      }else{Object.assign(d.item,rectangle(d.start,p,state.width,state.height));if(d.item.kind==='arrow')d.item.points=[d.start,p];}
    }
    q('Magnifier').hidden=true;queueDraw();
  }
  function up(e) {
    if(!drag)return;
    move(e);
    if(drag.kind==='crop'&&Math.hypot(currentPoint(e).x-drag.start.x,currentPoint(e).y-drag.start.y)<4)state.crop=drag.window;
    if(drag.kind==='draw'&&!isPaintStroke(drag.item))tool='select';
    drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);commit();
  }
  function rollbackDrag() {if(!drag)return;Object.assign(state,structuredClone(drag.before));drag=null;state.selected=null;draw();}
  function imagePayload(items=state.items) {
    const image=composeScreenshot(source,state.crop,items,scratch);
    return {session:data.session,image:image.toDataURL('image/png'),origin:[state.crop.x,state.crop.y],format:q('Jpeg').checked?'jpg':'png'};
  }
  function showText(title,text,description=''){
    const area=document.createElement('textarea');area.className='shot-text-input';area.readOnly=true;area.value=text;area.setAttribute('aria-label',title);
    const content=document.createElement('div');
    if(description){const message=document.createElement('p');message.textContent=description;content.append(message);}
    content.append(area);showDialog(title,content,{copyText:text});
  }
  function visionImage(image) {
    const scale=Math.min(1,4096/Math.max(image.width,image.height));
    const small=document.createElement('canvas');small.width=Math.max(1,Math.round(image.width*scale));small.height=Math.max(1,Math.round(image.height*scale));small.getContext('2d').drawImage(image,0,0,small.width,small.height);
    let encoded=small.toDataURL('image/png');
    if(encoded.length>7_500_000)encoded=small.toDataURL('image/jpeg',.95);
    small.width=small.height=1;
    if(encoded.length>7_500_000)throw new Error('screenshot:image-too-large');return encoded;
  }
  function backgroundColor(line,crop) {
    const x=clamp(Math.round(crop.x+line.x),0,state.width-1),y=clamp(Math.round(crop.y+line.y-2),0,state.height-1),rgb=sample.getImageData(x,y,1,1).data;
    return { background:`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,color:(rgb[0]*.299+rgb[1]*.587+rgb[2]*.114)>140?'#111111':'#ffffff' };
  }
  function recognitionContent(image, blocks) {
    const x=Math.max(0,Math.floor(Math.min(...blocks.map(b=>b.x))-8)),y=Math.max(0,Math.floor(Math.min(...blocks.map(b=>b.y))-8));
    const width=Math.min(image.width-x,Math.ceil(Math.max(...blocks.map(b=>b.x+b.width))-x+8));
    const height=Math.min(image.height-y,Math.ceil(Math.max(...blocks.map(b=>b.y+b.height))-y+8));
    const tile=document.createElement('canvas');tile.width=width;tile.height=height;
    tile.getContext('2d').drawImage(image,x,y,width,height,0,0,width,height);
    try { return [
      {type:'text',text:JSON.stringify({blocks:blocks.map(b=>({id:b.id,text:b.text,box:[(b.x-x)/width,(b.y-y)/height,b.width/width,b.height/height]}))})},
      {type:'image_url',image_url:{url:visionImage(tile),detail:'high'}}
    ]; } finally { tile.width=tile.height=1; }
  }
  async function run(action) {
    if(disposed)return;
    if(action==='cancel'){abort?.abort();taskRevision++;return runtime.call('cancel',{session:data.session}).catch(()=>notify(tr('failed')));}
    if(busy||drag)return;
    if(['select','rectangle','ellipse','arrow','brush','mosaic','text'].includes(action)){tool=action;state.original=false;if(action!=='select')state.selected=null;draw();return;}
    if(action==='undo'){history.undo();return;}if(action==='redo'){history.redo();return;}
    if(action==='original')return;
    if(!state.crop)return;
    stage('processing');
    busy=true;updateActions();const owner=++taskRevision,provider=structuredClone(getContext().provider||{}),crop=structuredClone(state.crop);abort=new AbortController();
    const current=()=>!disposed&&owner===taskRevision&&!abort?.signal.aborted;
    try {
      if(action==='ai-translate') {
        const status=await localTranslation.call('status');
        if(!current())return;
        if(!status.ready||status.installing){notify(tr('localMissing'));return;}
        if(languageRevision===0&&['zh-Hans','en'].includes(status.targetLanguage)){q('Language').value=status.targetLanguage;languageSelect?.refresh();}
      }
      if(action==='save'){await services.save(imagePayload(),current);return;}
      if(['confirm','copy','pin'].includes(action)){await runtime.call(action,imagePayload());if(action==='copy')notify(tr('copied'));return;}
      const selectedImage=composeScreenshot(source,crop,state.items.filter(item=>!item.translation),scratch);
      async function recognize() {
        stage('recognizing');
        const image=selectedImage.toDataURL('image/png'),language=getContext().lang==='en'?'en':'zh';
        if(ocrCache?.image===image&&ocrCache.language===language)return ocrCache.result;
        const result=await runtime.call('ocr',{session:data.session,image,language});
        if(current())ocrCache={image,language,result};
        return result;
      }
      if(action==='ocr'){
        const result=await recognize();
        const text=formatOcrText(result);
        if(current())text?showText(tr('localOcr'),text):notify(tr('noText'));return;
      }
      if(action==='ai-extract'){
        stage('extracting');
        const result=await requestAi([{role:'user',content:[{type:'text',text:tr('extractPrompt')},{type:'image_url',image_url:{url:visionImage(selectedImage),detail:'high'}}]}],abort.signal,8000,{expectedProvider:provider,temperature:0,timeoutMs:90000});
        if(current())showText(tr('aiExtract'),result);return;
      }
      if(action==='ai-translate'){
        const ocr=await recognize();if(!current())return;
        const blocks=translationBlocks(ocrLines(ocr));if(!blocks.length){notify(tr('noText'));return;}
        const language=q('Language').value;
        const signal=abort.signal,budget=createTranslationRequestBudget(undefined,45000),providerKey=JSON.stringify(provider);
        const options={signal,current,budget,progress:(key,vars)=>{if(current())stage(key==='batch'?'correcting':key,vars);}};
        let lines=blocks;
        const configured=Boolean(provider.url&&provider.model&&(await (await tauriCorePromise).invoke('load_ai_api_key')));
        if(!current())return;
        if(configured&&recognitionCache?.image===ocrCache.image&&recognitionCache.language===ocrCache.language&&recognitionCache.provider===providerKey)lines=recognitionCache.lines;
        else if(configured) {
          const recognized=await resolveTranslationBatches(blocks,(batch,maxTokens,timeoutMs)=>requestAi([
            {role:'system',content:RECOGNITION_PROMPT},{role:'user',content:recognitionContent(selectedImage,batch)}
          ],signal,maxTokens,{expectedProvider:provider,temperature:0,timeoutMs}),options);
          if(!current())return;
          if(recognized.failed.length) {
            const message=document.createElement('p');
            message.textContent=`${tr(errorKey(recognized.failed[0].error))} ${tr('fallbackPrompt')}`;
            q('Busy').hidden=true;
            const proceed=await new Promise(resolve=>{
              const cancelled=()=>{services.closeDialog();resolve(false);};
              signal.addEventListener('abort',cancelled,{once:true});
              showDialog(tr('fallbackTitle'),message,{confirmLabel:tr('fallbackContinue'),
                onConfirm:()=>{signal.removeEventListener('abort',cancelled);resolve(true);},
                onDismiss:()=>{signal.removeEventListener('abort',cancelled);resolve(false);}});
            });
            if(!current()||!proceed)return;
            q('Busy').hidden=false;
            notify(tr('recognitionFallback'));
          } else {
            lines=recognized.lines;
            recognitionCache={image:ocrCache.image,language:ocrCache.language,provider:providerKey,lines};
          }
        }
        stage('translatingLocal');
        const texts=await localTranslation.translate(lines.map(line=>line.text.replace(/\n/g,' ')),language,signal);
        if(!current())return;
        const translated=lines.map((line,index)=>({...line,text:texts[index]}));
        stage('layingOut');
        const retained=state.items.filter(item=>!item.translation);
        const obstacles=retained.map(item=>({...item,x:item.x-crop.x,y:item.y-crop.y}));
        const {layers,skipped}=layoutTranslations(sample,translated,lines,selectedImage.width,selectedImage.height,obstacles);
        const available=layers.slice(0,Math.max(0,MAX_ANNOTATIONS-retained.length));
        state.items=[...retained,...available.map(({source,...layer})=>({id:++nextId,kind:'text',...layer,x:crop.x+layer.x,y:crop.y+layer.y,cover:true,translation:true,...backgroundColor(source,crop)}))];
        state.selected=null;commit();
        if(skipped.length||available.length<layers.length){
          const byId=new Map(translated.map(line=>[line.id,line]));
          const complete=lines.map(line=>byId.get(line.id)||{...line,text:`${tr('untranslated')}: ${line.text}`});
          const description=tr('translationPartial',{count:available.length,total:lines.length});
          showText(tr('translationResult'),formatOcrText({...ocr,lines:complete.map(line=>({...line,words:undefined}))}),description);
        }else notify(tr('translated'));
      }
    }catch(e){if(current()){notify(tr(errorKey(e)));}}
    finally{if(!disposed&&owner===taskRevision){busy=false;abort=null;draw();}}
  }
  scope.event(canvas,'pointerdown',down);scope.event(canvas,'pointermove',move);scope.event(canvas,'pointerup',up);scope.event(canvas,'pointercancel',rollbackDrag);
  scope.event(canvas,'dblclick',e=>{if(busy||!state.crop)return;const item=[...state.items].reverse().find(a=>a.kind==='text'&&contains(a,currentPoint(e)));if(item)editText(item);});
  const originalButton=q('Toolbar').querySelector('[data-shot-action="original"]');
  function startOriginal() {if(!disposed&&!busy&&!drag&&state.crop){state.original=true;draw();}}
  function endOriginal() {if(state.original){state.original=false;if(!disposed)draw();}}
  scope.event(originalButton,'pointerdown',e=>{if(e.button!==0||originalButton.disabled)return;e.preventDefault();originalButton.focus();originalButton.setPointerCapture(e.pointerId);startOriginal();});
  scope.event(window,'pointerup',endOriginal);scope.event(window,'pointercancel',endOriginal);
  scope.event(originalButton,'lostpointercapture',endOriginal);scope.event(originalButton,'blur',endOriginal);
  scope.event(window,'blur',endOriginal);scope.event(document,'visibilitychange',()=>{if(document.hidden)endOriginal();});
  scope.event(document,'keyup',e=>{if(e.key===' '||e.key==='Enter')endOriginal();});
  scope.event(q('Toolbar'),'click',e=>{const button=e.target.closest('[data-shot-action]');if(button&&!button.disabled)void run(button.dataset.shotAction);});
  scope.event(q('Toolbar'),'change',e=>{if(busy||!e.target.matches('input'))return;const item=state.items.find(a=>a.id===state.selected);if(item&&['shotColor','shotStroke','shotFill','shotFont','shotBlock'].includes(e.target.id)){
    let next={...item,...style()};
    if(item.kind==='text'&&!item.cover){try{next=tightenTextAnnotation(sample,{...next,width:state.crop.x+state.crop.width-item.x,height:state.crop.y+state.crop.height-item.y});}catch{notify(tr('textOverflow'));return;}}
    Object.assign(item,next);commit();}});
  let languageRevision=0;
  let languageWrite=Promise.resolve();
  scope.event(q('Language'),'change',()=>{
    const owner=++languageRevision,value=q('Language').value;
    languageWrite=languageWrite.then(()=>localTranslation.call('target',{target:value})).catch(()=>{if(!disposed&&owner===languageRevision)notify(tr('localFailure'));});
  });
  scope.event(q('Abort'),'click',()=>{abort?.abort();taskRevision++;busy=false;abort=null;draw();notify(tr('cancelled'));});
  scope.event(document,'keydown',e=>{
    if(e.target===originalButton&&(e.key===' '||e.key==='Enter')){e.preventDefault();startOriginal();return;}
    if(state.original){e.preventDefault();if(e.key==='Escape')endOriginal();return;}
    if(q('Dialog').classList.contains('visible')||e.target.closest('input, textarea, select, .tool-custom-select, .tool-custom-select-menu, [contenteditable="true"]'))return;
    const key=e.key.toLowerCase(),modifier=e.ctrlKey||e.metaKey;
    if(key==='escape'){e.preventDefault();if(busy){q('Abort').click();return;}if(drag){rollbackDrag();return;}if(state.selected){state.selected=null;draw();return;}if(state.crop){state.crop=null;state.items=[];q('Dimensions').hidden=true;commit();return;}void run('cancel');return;}
    if(busy)return;
    if(modifier&&['z','y','s','c'].includes(key)){e.preventDefault();void run(key==='s'?'save':key==='c'?'copy':key==='y'||e.shiftKey?'redo':'undo');return;}
    if(key==='enter'){e.preventDefault();void run('confirm');return;}
    if(key==='delete'||key==='backspace'){if(state.selected){e.preventDefault();state.items=state.items.filter(a=>a.id!==state.selected);state.selected=null;commit();}return;}
    if(key.startsWith('arrow')&&state.crop){e.preventDefault();const step=e.shiftKey?10:1,dx=key==='arrowleft'?-step:key==='arrowright'?step:0,dy=key==='arrowup'?-step:key==='arrowdown'?step:0;
      const item=state.items.find(a=>a.id===state.selected);if(item){const index=state.items.indexOf(item);state.items[index]=resizeAnnotation(item,moveRect(item,dx,dy,state.width,state.height));}else state.crop=moveRect(state.crop,dx,dy,state.width,state.height);commit();}
  });
  const toolbarObserver=new ResizeObserver(()=>{if(!disposed)positionTools();});
  toolbarObserver.observe(q('Toolbar'));scope.use(()=>toolbarObserver.disconnect());
  scope.event(window,'resize',resize);history.reset();resize();canvas.focus();
  return {finishCapture:()=>runtime.call('cancel',{session:data.session}),
    afterReady(){const owner=languageRevision;void localTranslation.call('status').then(status=>{
      if(disposed||owner!==languageRevision||!['zh-Hans','en'].includes(status.targetLanguage))return;
      q('Language').value=status.targetLanguage;languageSelect?.refresh();
    }).catch(()=>{});},
    copyText:async text=>{try{await runtime.call('copy-text',{session:data.session,text});notify(tr('copied'));}catch{notify(tr('failed'));}},
    contextChanged(next){if(busy&&JSON.stringify(next.provider)!==JSON.stringify(data.context?.provider)){abort?.abort();taskRevision++;busy=false;abort=null;notify(tr('providerChanged'));}data.context=next;draw();},
    dispose(){if(disposed)return;disposed=true;taskRevision++;abort?.abort();ocrCache=recognitionCache=null;cancelAnimationFrame(frame);scope.dispose();history.clear();state.items=[];sampler.width=sampler.height=scratch.pixels.width=scratch.pixels.height=scratch.mask.width=scratch.mask.height=1;canvas.width=canvas.height=1;source.removeAttribute('src');q('Toolbar').hidden=true;q('Magnifier').hidden=true;q('Dimensions').hidden=true;q('Busy').hidden=true;}
  };
  } catch(error) {scope.dispose();source.removeAttribute('src');canvas.width=canvas.height=1;throw error;}
}
