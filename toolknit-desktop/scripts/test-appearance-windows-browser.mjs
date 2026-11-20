import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import {THEME_PRESETS,createThemePalette} from '../src/app/theme-palette.js';
const require=createRequire(process.env.TOOLKNIT_TEST_MODULES?path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const output=path.resolve('tmp/appearance-windows');await mkdir(output,{recursive:true});
const html=`<!doctype html><html data-tk-auxiliary><head><meta charset="UTF-8"></head><body><main id="fileSearchRoot"></main><main id="screenshotRoot"></main><div id="toastContainer" class="toast-container"></div><script type="module">
import {mockIPC,mockWindows} from '/node_modules/@tauri-apps/api/mocks.js';
import {emit} from '/node_modules/@tauri-apps/api/event.js';
const type=new URLSearchParams(location.search).get('type'),role=new URLSearchParams(location.search).get('role');
mockWindows(type==='file'?'file-search-'+role:'screenshot-toast');
window.fixtureState={generation:1,enabled:true,expanded:true,hidden:false,suspended:false,context:{lang:'zh',theme:'light',appearance:{version:1,mode:'light',preset:'neutral',customColor:'#3565a6',wallpaperEnabled:false}},query:{text:'',extension:'',kind:'all',sort:'name'},index:{state:'ready',total:0,ready:true},menuToken:'fixture'};
window.calls=[];
mockIPC(async(command,args)=>{
 window.calls.push({command,args});
 if(command==='file_search'){
  const action=args.request.action;
  if(action==='boot'||action==='ready'||action==='status')return structuredClone(window.fixtureState);
  if(action==='search')return {rows:[],total:0,generation:1,offset:0};
  return null;
 }
 if(command==='quick_screenshot')return {context:structuredClone(window.fixtureState.context),feedback:{revision:1,kind:'copied',lang:'zh'}};
 return null;
},{shouldMockEvents:true});
window.setAppearance=async appearance=>{
 window.fixtureState.context={...window.fixtureState.context,theme:appearance.mode,appearance};
 await emit(type==='file'?'file-search-state':'screenshot-context-changed',type==='file'?structuredClone(window.fixtureState):null);
};
await import(type==='file'?'/src/features/file-search/auxiliary.js':'/src/features/quick-screenshot/auxiliary.js');
window.ready=true;
</script></body></html>`;
await writeFile(path.join(output,'fixture.html'),html);
const server=await createServer({configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();
const browser=await chromium.launch({headless:true,executablePath:process.env.TOOLKNIT_TEST_BROWSER});
const checks=[],errors=[];
try{
 for(const [type,role,width,height]of [['file','bar',520,56],['file','results',520,600],['file','menu',280,220],['shot','toast',340,88]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(`${type}/${role}: ${error.message}`));
  await page.goto(server.resolvedUrls.local[0]+'tmp/appearance-windows/fixture.html?type='+type+'&role='+role);
  await page.waitForFunction(()=>window.ready&&document.documentElement.dataset.themeConfig);
  for(const mode of ['light','dark'])for(const preset of THEME_PRESETS){
   const appearance={version:1,mode,preset:preset.id,customColor:'#3565a6',wallpaperEnabled:false};
   await page.evaluate(value=>window.setAppearance(value),appearance);
   await page.waitForFunction(value=>{const config=JSON.parse(document.documentElement.dataset.themeConfig);return config.mode===value.mode&&config.preset===value.preset;},appearance);
   const tokens=createThemePalette(appearance);
   assert.equal(await page.locator('html').evaluate(n=>getComputedStyle(n).getPropertyValue('--tk-page-bg').trim()),tokens['--tk-page-bg']);
  }
  await page.screenshot({path:path.join(output,`${type}-${role}-dark-sand.png`),omitBackground:true});
  if(type==='file')assert.equal(await page.locator('body').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
  checks.push(`${type}/${role}: all 16 appearances arrive through native context events`);await page.close();
 }
 assert.deepEqual(errors,[]);console.log(checks.join('\n'));
}finally{await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors},null,2));await browser.close();await server.close();}
