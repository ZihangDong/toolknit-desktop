const width=1400,height=900,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
const paint=canvas.getContext('2d');paint.fillStyle='#edf2f5';paint.fillRect(0,0,width,height);paint.fillStyle='#fff';paint.fillRect(100,80,800,440);
paint.fillStyle='#111';paint.font='32px sans-serif';paint.fillText('SCREENSHOT TEST',160,160);paint.fillStyle='#14965c';paint.fillRect(160,210,180,120);
const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')), bytes=await blob.arrayBuffer();canvas.width=canvas.height=1;
let id=0,session=0,active=false,theme='light',lang='zh',failImage=false,delayLanguage=false;
const callbacks=new Map(),listeners=new Map(),calls=[],errors=[];
addEventListener('error',event=>errors.push(event.message));addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
const context=()=>({theme,lang,provider:{url:'https://example.invalid/v1/chat/completions',model:'fixture'}});
const emit=(event,payload)=>{for(const [key,listener]of listeners)if(listener.event===event)callbacks.get(listener.handler)?.({event,id:key,payload});};
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_,key)=>listeners.delete(key)};
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'screenshot-capture'},currentWebview:{label:'screenshot-capture'}},transformCallback(fn){callbacks.set(++id,fn);return id;},unregisterCallback(key){callbacks.delete(key);},
  async invoke(command,args={}){
    calls.push({command,action:args.request?.action,session:args.session??args.request?.session});
    if(command==='plugin:event|listen'){listeners.set(++id,args);return id;}
    if(command==='plugin:event|unlisten'){listeners.delete(args.eventId);return;}
    if(command.startsWith('plugin:window|'))return;
    if(command==='get_output_root'||command==='get_default_output_root')return 'C:/SyntheticOutput';
    if(command==='open_path')return;
    if(command==='load_ai_api_key')return '';
    if(command==='quick_screenshot_image'){
      if(!active||args.session!==session)throw Error('screenshot:expired');
      if(failImage)throw Error('screenshot:capture-failed');return bytes.slice(0);
    }
    if(command==='local_translation'){
      if(delayLanguage)await new Promise(resolve=>setTimeout(resolve,1500));
      return {ready:false,targetLanguage:'zh-Hans'};
    }
    if(command==='quick_screenshot'){
      const request=args.request;
      if(request.action==='boot')return active?{session,context:context(),desktop:{bounds:{x:0,y:0,width,height},windows:[],monitors:[{x:0,y:0,width,height}]},imageBytes:bytes.byteLength}:{prepared:true,context:context()};
      if(request.action==='metadata')return {context:context()};
      if(request.action==='cancel'||request.action==='confirm'){active=false;emit('screenshot-ended');return;}
      if(request.action==='save')return 'C:/SyntheticOutput/capture.png';
      if(request.action==='ocr')return {text:'SCREENSHOT TEST',lines:[]};
      return null;
    }
    throw Error('Unexpected fixture command: '+command);
  }};
await import('../../src/features/quick-screenshot/auxiliary.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<200;i++){if(check())return;await delay(15);}throw Error('Fixture timed out');}
const readyCount=()=>calls.filter(call=>call.action==='ready').length;
async function open(){const count=readyCount();active=true;session++;emit('screenshot-opened',session);await until(()=>readyCount()>count);}
function button(action){return document.querySelector('[data-shot-action="'+action+'"]');}
function crop(){const target=document.getElementById('shotCanvas'),r=target.getBoundingClientRect();
  target.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,button:0,clientX:r.width*.12,clientY:r.height*.14,bubbles:true}));
  target.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,button:0,clientX:r.width*.62,clientY:r.height*.55,bubbles:true}));
  target.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,button:0,clientX:r.width*.62,clientY:r.height*.55,bubbles:true}));}
document.getElementById('qa-open').onclick=()=>void open();
document.getElementById('qa-theme').onclick=()=>{theme=theme==='light'?'dark':'light';emit('screenshot-context-changed');};
document.getElementById('qa-run').onclick=async()=>{
  const output=document.getElementById('qa-result'),checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
  output.textContent='Running';
  const original=HTMLCanvasElement.prototype.setPointerCapture;HTMLCanvasElement.prototype.setPointerCapture=()=>{};
  try {
    await until(()=>calls.some(call=>call.action==='prepared'));
    assert(!calls.some(call=>call.command==='quick_screenshot_image'),'prewarm contains no pixels or image request');
    delayLanguage=true;const began=performance.now();await open();
    assert(performance.now()-began<1200,'slow translation status does not delay capture readiness');delayLanguage=false;
    for(const value of ['light','dark']){
      theme=value;lang=value==='light'?'zh':'en';emit('screenshot-context-changed');await delay(25);
      assert(document.documentElement.dataset.theme===value,'theme '+value+' applied');
      crop();assert(!document.getElementById('shotToolbar').hidden,'crop and toolbar '+value);
      button('ocr').click();await until(()=>document.getElementById('shotDialog').classList.contains('visible'));
      assert(document.querySelector('#shotDialogContent textarea')?.value.includes('SCREENSHOT TEST'),'OCR result '+value);
      document.getElementById('shotDialogOk').click();button('save').click();await until(()=>!document.getElementById('shotDialogFolder').hidden);
      document.getElementById('shotDialogFolder').click();await until(()=>!active);
      assert(calls.at(-1).command==='open_path','save reveals after capture exits '+value);
      await open();const before=calls.filter(call=>call.command==='quick_screenshot_image').length;emit('screenshot-opened',session);await delay(45);
      assert(calls.filter(call=>call.command==='quick_screenshot_image').length===before,'duplicate event does not decode twice '+value);
      button('cancel').click();await until(()=>!active);await delay(20);
      assert(!document.getElementById('shotDesktop').getAttribute('src'),'cancel releases image '+value);
      await open();
    }
    button('cancel').click();await delay(20);failImage=true;active=true;session++;emit('screenshot-opened',session);await until(()=>!active);failImage=false;
    assert(!document.getElementById('shotDesktop').getAttribute('src'),'failed decode cancels and clears capture');
    await open();assert(errors.length===0,'no uncaught errors');output.textContent='PASS\n'+checks.join('\n');
  }catch(error){output.textContent='FAIL '+error.message+'\n'+checks.join('\n');}
  finally{HTMLCanvasElement.prototype.setPointerCapture=original;}
};
