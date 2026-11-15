import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { bindGlobalToolPageChrome } from '../../shared/tool-page-shell.js';
import { clamp } from './core.js';
export async function createController({runtime,tr,q,notify,save,getCurrentWindow},data){
  const scope=createLifecycleScope(), image=q('ViewImage'),stage=q('ViewerStage');
  const native=getCurrentWindow();let zoom=1,x=0,y=0,drag=null,frame=0,busy=false,disposed=false;
  const close=()=>void native.close().catch(()=>notify(tr('failed')));
  const navigate=target=>void runtime.call('navigate',{target}).catch(()=>notify(tr('failed')));
  image.src=data.shot.image;image.alt=tr('viewScreenshot');
  function render(){image.style.width=`${data.shot.width*zoom}px`;image.style.height=`${data.shot.height*zoom}px`;image.style.transform=`translate(${x}px,${y}px)`;q('ZoomValue').textContent=`${zoom<.01?(zoom*100).toFixed(1):Math.round(zoom*100)}%`;}
  function fit(){zoom=clamp(Math.min(Math.max(1,stage.clientWidth-40)/data.shot.width,Math.max(1,stage.clientHeight-40)/data.shot.height,1),.001,1);x=0;y=0;render();}
  async function action(value){
    if(value==='close')return close();if(value==='fit')return fit();if(value==='actual'){zoom=1;x=0;y=0;return render();}
    if(value==='zoom-in'||value==='zoom-out'){zoom=clamp(zoom*(value==='zoom-in'?1.25:.8),.02,8);return render();}
    if(busy)return;busy=true;
    try{if(value==='copy'){await runtime.call('copy');if(!disposed)notify(tr('copied'));}if(value==='save')await save({format:'png'},()=>!disposed);}catch{if(!disposed)notify(tr('failed'));}finally{busy=false;}
  }
  scope.event(q('Viewer'),'click',e=>{const b=e.target.closest('[data-shot-action]');if(b)void action(b.dataset.shotAction);if(e.target.closest('[data-shot-back]'))close();});
  scope.use(bindGlobalToolPageChrome({onToolBack:()=>{close();return true;},onWebsite:()=>navigate('website'),onSupport:()=>navigate('support'),onHelp:()=>navigate('help'),onFeedback:()=>navigate('feedback'),onSettings:()=>navigate('settings'),onWindowAction:a=>{void (a==='close'?native.close():a==='minimize'?native.minimize():native.toggleMaximize()).catch(()=>notify(tr('failed')));}}));
  scope.event(q('Pin'),'change',async()=>{const enabled=q('Pin').checked;try{await native.setAlwaysOnTop(enabled);}catch{q('Pin').checked=!enabled;notify(tr('failed'));}});
  scope.event(stage,'wheel',e=>{e.preventDefault();zoom=clamp(zoom*(e.deltaY<0?1.1:1/1.1),.02,8);render();},{passive:false});
  scope.event(stage,'pointerdown',e=>{drag={px:e.clientX,py:e.clientY,x,y};stage.setPointerCapture(e.pointerId);});
  scope.event(stage,'pointermove',e=>{if(!drag)return;x=drag.x+e.clientX-drag.px;y=drag.y+e.clientY-drag.py;if(!frame)frame=requestAnimationFrame(()=>{frame=0;render();});});
  scope.event(stage,'pointerup',()=>{drag=null;});scope.event(stage,'pointercancel',()=>{drag=null;});
  scope.event(document,'keydown',e=>{if(q('Dialog')?.classList.contains('visible'))return;if(e.key==='Escape')close();if((e.ctrlKey||e.metaKey)&&['s','c'].includes(e.key.toLowerCase())){e.preventDefault();void action(e.key.toLowerCase()==='s'?'save':'copy');}});
  const observer=new ResizeObserver(fit);observer.observe(stage);scope.use(()=>observer.disconnect());fit();
  return {dispose(){disposed=true;scope.dispose();cancelAnimationFrame(frame);image.removeAttribute('src');}};
}
