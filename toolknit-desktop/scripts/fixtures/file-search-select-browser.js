import { enhanceToolSelect } from '../../src/tool-custom-select.js';
const select=document.getElementById('sample'),report=document.getElementById('qa-report');
let handle;
const mount=()=>{handle?.dispose();select.disabled=false;select.value='a';handle=enhanceToolSelect(select);};
document.getElementById('qa-mount').onclick=mount;
document.getElementById('qa-dispose').onclick=()=>{handle?.dispose();report.textContent='Disposed';};
document.getElementById('qa-light').onclick=()=>document.documentElement.dataset.theme='light';
document.getElementById('qa-dark').onclick=()=>document.documentElement.dataset.theme='dark';
const key=(target,value)=>target.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
document.getElementById('qa-run').onclick=async()=>{
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const nativeAdd=EventTarget.prototype.addEventListener,active=new Set();
  try{
    handle?.dispose();
    EventTarget.prototype.addEventListener=function(type,listener,options){
      if((this===document||this===window)&&options?.signal){const item={type,listener};active.add(item);nativeAdd.call(options.signal,'abort',()=>active.delete(item),{once:true});}
      return nativeAdd.call(this,type,listener,options);
    };
    for(const theme of ['light','dark'])for(const width of [320,420,600])for(let i=0;i<8;i++){
      document.documentElement.dataset.theme=theme;document.getElementById('qa-stage').style.width=`${width}px`;mount();
      const trigger=select.nextElementSibling.querySelector('button');key(trigger,'ArrowDown');
      key(document.activeElement,'End');assert(document.activeElement.dataset.toolSelectValue==='b','disabled choice was not skipped');
      key(document.activeElement,'Enter');assert(select.value==='b','legacy Enter selection failed');
      trigger.click();select.disabled=true;await Promise.resolve();await Promise.resolve();
      assert(trigger.disabled&&!handle.isOpen(),'disabled control stayed open');
      select.disabled=false;select.options[1].textContent=`Beta ${i}`;handle.refresh();
      assert(trigger.textContent.includes(`Beta ${i}`),'option label did not refresh');
      trigger.click();key(document.activeElement,'Escape');assert(!handle.isOpen(),'Escape did not close legacy picker');
      handle.dispose();handle.dispose();assert(active.size===0,'global select listeners retained');
      assert(!document.querySelector('.tool-custom-select-menu,.tool-custom-select'),'select DOM retained');
      assert(!select.hasAttribute('aria-hidden')&&!select.hasAttribute('tabindex'),'native attributes not restored');
    }
    report.textContent='PASS: 48 legacy mount/keyboard/disabled/mutation/Escape/disposal rounds; no retained global listeners';
  }catch(error){report.textContent=`FAIL: ${error.message}`;}
  finally{EventTarget.prototype.addEventListener=nativeAdd;mount();}
};
mount();
