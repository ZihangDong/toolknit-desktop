import {createLifecycleScope} from '../../app/tool-lifecycle.js';
import {setLangWithoutFade} from '../../i18n.js';

export async function createController({runtime,tr,q},data){
  const scope=createLifecycleScope();let animation,revision=0;
  const show=async pending=>{
    if(scope.disposed||!pending||pending.revision<revision)return;
    revision=pending.revision;setLangWithoutFade(pending.lang==='en'?'en':'zh');
    q('DesktopToastText').textContent=tr({copied:'historyCopied',phraseAdded:'phraseAdded',orderSaved:'historyOrderSaved'}[pending.kind]||'historyCopied');
    animation?.cancel();
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
      animation=q('DesktopToast').animate([{opacity:0,transform:'translateY(8px)',offset:0},{opacity:1,transform:'translateY(0)',offset:.08},{opacity:1,transform:'translateY(0)',offset:.88},{opacity:0,transform:'translateY(4px)',offset:1}],{duration:2200,fill:'forwards',easing:'ease-out'});
    }
    await runtime.call('feedback-ready',{revision});
  };
  scope.use(()=>animation?.cancel());
  try{scope.use(await runtime.listen('desktop-feedback',pending=>{void show(pending).catch(()=>{});}));await show(data.feedback);}
  catch(error){scope.dispose();throw error;}
  return {dispose:()=>scope.dispose()};
}
