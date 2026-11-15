import { createScreenshotRuntime } from '../platform/screenshot-runtime.js';
import { createLifecycleScope } from './tool-lifecycle.js';
// Auxiliary WebViews have isolated storage. Mirror metadata, never credentials.
export function createScreenshotContextRuntime({ isTauri, getAiPlatformConfig, getLang, onLangChange, notify, translate, onNavigate } = {}) {
  if (!isTauri) return;
  const runtime=createScreenshotRuntime({isTauri}), scope=createLifecycleScope();
  let disposed=false, timer;
  // Warm a hidden, pixel-free shell after the main startup surface settles.
  const prepare=()=>{
    if(disposed)return;
    if(document.documentElement.hasAttribute('data-tk-startup')){scope.timeout(prepare,500);return;}
    void runtime.call('preferences').then(value=>{if(!disposed&&value.registered)return runtime.call('prepare');}).catch(()=>{});
  };
  scope.timeout(prepare,2500);
  runtime.listen('screenshot-preferences-changed',prepare).then(unlisten=>scope.use(unlisten));
  const sync=()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>{
      if(disposed) return;
      const provider=getAiPlatformConfig();
      void runtime.call('context',{context:{theme:document.documentElement.dataset.theme || 'dark',lang:getLang(),provider}}).catch(()=>{});
    },100);
  };
  const observer=new MutationObserver(sync); observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  scope.use(()=>observer.disconnect()); scope.use(onLangChange(sync));
  scope.event(window,'screenshot-provider-changed',sync);
  scope.event(document,'click',sync); scope.event(window,'storage',sync);
  runtime.listen('screenshot-error',error=>notify(translate(`home.quickScreenshot.${String(error).includes('shortcut')?'shortcutConflict':'failed'}`))).then(unlisten=>scope.use(unlisten));
  runtime.listen('screenshot-navigate',target=>{
    if (onNavigate) { void Promise.resolve().then(()=>onNavigate(target)).catch(()=>notify(translate('home.quickScreenshot.failed'))); return; }
    const selector=target==='settings'?'#homeV2Settings, #settingsBtn':target==='support'?'#homeSupportAuthor, [data-open-support]':null;
    if(selector)document.querySelector(selector)?.click();
  }).then(unlisten=>scope.use(unlisten));
  scope.event(window,'pagehide',()=>{disposed=true;clearTimeout(timer);scope.dispose();});
  sync();
}
