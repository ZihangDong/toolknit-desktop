import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createThemeRuntime, THEME_STORAGE_KEY, normalizeTheme } from '../src/app/theme-runtime.js';
import { themeEngine, APPEARANCE_STORAGE_KEY, DEFAULT_THEME_CONFIG, THEME_PRESETS, createThemePalette, themeContrast, normalizeColor, normalizeThemeConfig, readAppearancePreference } from '../src/app/theme-palette.js';
import { createBackgroundRuntime } from '../src/app/background-runtime.js';
import { initializeDefaultBackground, CUSTOM_BACKGROUND_STORAGE_KEY } from '../src/app/custom-background-default.js';

class Element extends EventTarget {
  constructor(dataset={}) { super(); this.dataset=dataset; this.attributes=new Map(); this.classes=new Set(); this.children=[]; this.isConnected=true; this.style={setProperty:(key,value)=>this.attributes.set(key,value)};
    this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),contains:name=>this.classes.has(name),toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)}; }
  setAttribute(key,value){this.attributes.set(key,value);}
  getAttribute(key){return this.attributes.get(key)??null;}
  removeAttribute(key){this.attributes.delete(key);}
  focus(){this.focused=true;}
  appendChild(child){this.children.push(child);child.parentElement=this;}
  insertBefore(child){this.appendChild(child);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
}
function fixture(entries=[],transition=null) {
  const values=new Map(entries), windowRef=new EventTarget();
  windowRef.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const buttons=['dark','light'].map(themeChoice=>new Element({themeChoice}));
  const presets=THEME_PRESETS.map(p=>new Element({paletteChoice:p.id}));
  const nodes=new Map(['themeCustomColor','themeCustomHex','themeColorError','themeWallpaperToggle','themePreviewActions','themePreviewSave','themePreviewCancel','themeRestoreDefault'].map(id=>[id,new Element()]));
  const root={documentElement:new Element(),querySelectorAll:selector=>selector==='[data-theme-choice]'?buttons:selector==='[data-palette-choice]'?presets:[],getElementById:id=>nodes.get(id)};
  const theme=createThemeRuntime({root,windowRef,pageTransition:transition});
  return {theme,root,windowRef,values,buttons,presets,nodes};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for (const mode of ['dark', 'light']) {
  const reset = fixture([[APPEARANCE_STORAGE_KEY, JSON.stringify({ ...DEFAULT_THEME_CONFIG, mode, preset: 'rose', customColor: '#ff00ff', wallpaperEnabled: true })]]);
  reset.nodes.get('themeCustomHex').value = '#00ff00';
  reset.nodes.get('themeCustomHex').dispatchEvent(new Event('input'));
  reset.nodes.get('themeRestoreDefault').dispatchEvent(new Event('click'));
  const expected = { ...DEFAULT_THEME_CONFIG, mode, wallpaperEnabled: true };
  assert.deepEqual(reset.theme.getConfig(), expected, 'restoring colors keeps the active mode and wallpaper setting');
  assert.deepEqual(JSON.parse(reset.values.get(APPEARANCE_STORAGE_KEY)), expected);
  assert.equal(reset.values.get(THEME_STORAGE_KEY), mode);
  assert.equal(reset.nodes.get('themePreviewActions').hidden, true);
  reset.theme.dispose();
}
assert.equal(normalizeColor('#F0A'),'#ff00aa');
for(const color of [null,'red','#abcd','#12345g','url(file://x)'])assert.equal(normalizeColor(color),null);
assert.equal(normalizeTheme('system'),'light');
assert.deepEqual(normalizeThemeConfig({css:'bad',preset:'unknown'}),DEFAULT_THEME_CONFIG);
for(const mode of ['light','dark'])for(const preset of [...THEME_PRESETS.map(p=>p.id),'custom'])for(const customColor of ['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00','#eeeeee']) {
  const tokens=createThemePalette({mode,preset,customColor});
  for(const surface of ['--tk-page-bg','--tk-surface','--tk-surface-hover','--tk-inset'])for(const ink of ['--tk-ink','--tk-muted','--tk-success','--tk-warning','--tk-danger'])assert.ok(themeContrast(tokens[ink],tokens[surface])>=4.5,`${mode}/${preset}/${customColor} ${ink} on ${surface}`);
  assert.ok(themeContrast(tokens['--tk-accent'],tokens['--tk-page-bg'])>=3);
  assert.ok(themeContrast(tokens['--tk-on-accent'],tokens['--tk-accent'])>=4.5);
  assert.ok(themeContrast(tokens['--tk-on-accent'],tokens['--tk-accent-hover'])>=4.5);
}
assert.equal(createThemePalette(DEFAULT_THEME_CONFIG)['--tk-page-bg'],'#ffffff');
assert.equal(createThemePalette(DEFAULT_THEME_CONFIG)['--tk-surface'],'#e7e8ea');
assert.deepEqual(readAppearancePreference({get localStorage(){throw Error('restricted');}}),DEFAULT_THEME_CONFIG);
const corruptWallpaper=fixture([[THEME_STORAGE_KEY,'dark'],[CUSTOM_BACKGROUND_STORAGE_KEY,'invalid JSON']]);
assert.equal(corruptWallpaper.theme.get(),'dark','a corrupt wallpaper must not reset the saved mode');corruptWallpaper.theme.dispose();
for(const mode of ['dark','light']) {
  const old=fixture([[THEME_STORAGE_KEY,mode],[CUSTOM_BACKGROUND_STORAGE_KEY,JSON.stringify({type:'image',path:'kept.png'})]]);
  assert.equal(old.theme.get(),mode);assert.equal(old.theme.allowsCustomBackground(),mode==='dark');
  assert.equal(JSON.parse(old.values.get(APPEARANCE_STORAGE_KEY)).mode,mode);
  assert.equal(JSON.parse(old.values.get(CUSTOM_BACKGROUND_STORAGE_KEY)).path,'kept.png');old.theme.dispose();
}
const state=fixture();
assert.equal(state.buttons[1].getAttribute('aria-checked'),'true');
assert.equal(state.theme.allowsCustomBackground(),false);
const events=[];state.theme.subscribe((mode,config)=>events.push(config));
state.presets[1].dispatchEvent(new Event('click'));
assert.equal(state.theme.getConfig().preset,'blue');assert.equal(events.at(-1).preset,'blue');
const previous=state.values.get(APPEARANCE_STORAGE_KEY);
state.nodes.get('themeCustomHex').value='#f0a';state.nodes.get('themeCustomHex').dispatchEvent(new Event('input'));
assert.equal(state.theme.getConfig().customColor,'#ff00aa');assert.equal(state.theme.getConfig().preset,'custom');
assert.equal(state.values.get(APPEARANCE_STORAGE_KEY),previous,'preview is reversible and never saved');
state.nodes.get('themePreviewCancel').dispatchEvent(new Event('click'));assert.equal(state.theme.getConfig().preset,'blue');
state.nodes.get('themeCustomHex').value='garbage';state.nodes.get('themeCustomHex').dispatchEvent(new Event('input'));
assert.equal(state.nodes.get('themeCustomHex').getAttribute('aria-invalid'),'true');assert.equal(state.theme.getConfig().preset,'blue');
state.nodes.get('themeCustomHex').value='#00ff00';state.nodes.get('themeCustomHex').dispatchEvent(new Event('input'));state.nodes.get('themePreviewSave').dispatchEvent(new Event('click'));
assert.equal(JSON.parse(state.values.get(APPEARANCE_STORAGE_KEY)).customColor,'#00ff00');
state.nodes.get('themeWallpaperToggle').dispatchEvent(new Event('click'));assert.equal(state.theme.allowsCustomBackground(),true);
state.theme.set('dark',{transition:false});state.theme.set('light',{transition:false});assert.equal(state.theme.allowsCustomBackground(),true,'wallpaper does not depend on mode');
state.theme.setConfig({preset:'rose'});const current=state.theme.getConfig();current.preset='amber';assert.equal(state.theme.getConfig().preset,'rose','configuration copies cannot mutate the runtime');
const arrows=new Event('keydown',{cancelable:true});Object.defineProperty(arrows,'key',{value:'ArrowRight'});state.presets[5].dispatchEvent(arrows);assert.equal(state.theme.getConfig().preset,'amber');
state.values.set(APPEARANCE_STORAGE_KEY,JSON.stringify({...DEFAULT_THEME_CONFIG,preset:'teal',mode:'dark'}));state.windowRef.dispatchEvent(Object.assign(new Event('storage'),{key:APPEARANCE_STORAGE_KEY}));assert.equal(state.theme.getConfig().preset,'teal');
Object.defineProperty(state.windowRef,'localStorage',{get(){throw Error('restricted');}});assert.doesNotThrow(()=>state.theme.setConfig({preset:'green'}));
state.theme.dispose();state.theme.dispose();const count=events.length;state.presets[0].dispatchEvent(new Event('click'));assert.equal(events.length,count);
const queued=[],rapid=fixture([], {run(action){return new Promise(resolve=>queued.push(()=>resolve(action())));}});
rapid.theme.set('dark');rapid.theme.set('light');queued.shift()();await tick();assert.equal(rapid.theme.get(),'light','stale covered switches are discarded');rapid.theme.dispose();
// The production bootstrap is generated from this exact, dependency-free engine.
const bootstrap = new Function(`return (${themeEngine.bootstrap.toString()})`);assert.ok(bootstrap);
const vite=await readFile(new URL('../vite.config.js',import.meta.url),'utf8');assert.match(vite,/createThemeEngine\.toString\(\)/);
const template=await readFile(new URL('../src/app/templates/settings.html',import.meta.url),'utf8');assert.match(template,/id="themePaletteChoices"/);assert.equal(state.presets.length,8);
for(const lang of ['zh','en']){const locale=JSON.parse(await readFile(new URL(`../src/locales/${lang}.json`,import.meta.url)));for(const key of ['colorPalette','customThemeColor','wallpaperEnabled','saveThemeColor','cancelThemePreview'])assert.ok(locale.settings[key]);}
// New users never receive a seeded wallpaper. Turning it off cancels late native replies.
const bg=fixture(),home=new Element();home.classList.add('is-v2-home');
const doc=new EventTarget();doc.querySelector=()=>home;doc.createElement=()=>new Element();
initializeDefaultBackground(bg.windowRef);assert.equal(bg.values.has(CUSTOM_BACKGROUND_STORAGE_KEY),false);
const metadata=JSON.stringify({type:'image',path:'kept.png'});bg.values.set(CUSTOM_BACKGROUND_STORAGE_KEY,metadata);
const pending=[];
const background=createBackgroundRuntime({documentRef:doc,windowRef:bg.windowRef,isTauri:true,tauriCorePromise:Promise.resolve({invoke:()=>new Promise(resolve=>pending.push(resolve))}),allowCustomBackground:bg.theme.allowsCustomBackground,onThemeChange:bg.theme.subscribe});
background.syncHome();await tick();assert.equal(pending.length,0);
bg.theme.setConfig({wallpaperEnabled:true});await tick();assert.equal(pending.length,1);
bg.theme.setConfig({wallpaperEnabled:false});pending[0]('data:image/png;base64,stale');await tick();assert.equal(home.children[0]?.children.length??0,0);
assert.equal(bg.values.get(CUSTOM_BACKGROUND_STORAGE_KEY),metadata);
bg.theme.setConfig({mode:'light',wallpaperEnabled:true});await tick();assert.equal(pending.length,2);pending[1]('data:image/png;base64,current');await tick();assert.equal(home.children[0].children.length,1);
home.children[0].children[0].dispatchEvent(new Event('load'));await background.whenHomeReady();
bg.theme.setConfig({mode:'dark'});await tick();assert.equal(bg.theme.allowsCustomBackground(),true);
bg.theme.setConfig({wallpaperEnabled:false});assert.equal(home.children[0].children.length,0);
background.dispose();background.dispose();bg.theme.dispose();
console.log('Appearance: 126 palette combinations, contrast, migration, previews, persistence, keyboard, stale transitions and independent wallpaper lifecycle passed.');
