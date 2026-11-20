import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { preview } from 'vite';
import { THEME_PRESETS, APPEARANCE_STORAGE_KEY } from '../src/app/theme-palette.js';
import { auditVisibleColors } from './lib/theme-color-audit.mjs';
const require=createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json') : import.meta.url);
const {chromium}=require('playwright');
const output=path.resolve('tmp/theme-browser');await mkdir(output,{recursive:true});
const server=await preview({configFile:false,logLevel:'error',preview:{host:'127.0.0.1',port:0,open:false}});
const url=server.resolvedUrls.local[0];
const browser=await chromium.launch({headless:true,executablePath:process.env.TOOLKNIT_TEST_BROWSER,args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1400,height:900},reducedMotion:'reduce'});
const page=await context.newPage();
page.setDefaultTimeout(15000);
const report={checks:[],errors:[],colors:[]};page.on('pageerror',error=>report.errors.push(error.message));
const done=label=>{report.checks.push(label);console.log('PASS',label);};
const settle=async()=>{await page.waitForFunction(()=>!document.documentElement.dataset.tkStartup&&(!document.querySelector('[data-tk-page-transition-veil]')||getComputedStyle(document.querySelector('[data-tk-page-transition-veil]')).visibility==='hidden'));await page.waitForTimeout(400);};
const config=()=>page.evaluate(()=>JSON.parse(document.documentElement.dataset.themeConfig));
const layout=()=>page.locator('#settingsOverlay').evaluate(root=>['.settings-v2-layout','.settings-v2-poster','.settings-language-theme-card','.settings-v2-topbar'].map(selector=>{const n=root.querySelector(selector),b=n.getBoundingClientRect(),s=getComputedStyle(n);return [selector,...['x','y','width','height'].map(k=>Math.round(b[k])),s.borderRadius,s.fontSize,s.gridTemplateColumns];}));
async function selectMode(mode){await page.locator(`[data-theme-choice="${mode}"]`).click();await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,mode);await settle();}
try{
  await page.goto(url);await settle();await page.evaluate(()=>document.fonts.ready);
  assert.equal((await config()).mode,'light');assert.equal((await config()).wallpaperEnabled,false);
  await page.locator('#homeV2Settings').click();await settle();
  const composition=await page.locator('#settingsOverlay').evaluate(overlay=>{
    const circles=[...overlay.querySelectorAll('[data-palette-choice]')];
    const boxes=circles.map(n=>n.getBoundingClientRect());
    const sidebar=overlay.querySelector('.settings-v2-poster');
    const cards=[...overlay.querySelectorAll('.settings-v2-grid > article')];
    return {horizontal:boxes.every(b=>Math.abs(b.top-boxes[0].top)<1),round:circles.every(n=>getComputedStyle(n).borderRadius==='50%'),
      names:circles.every(n=>n.getAttribute('aria-label')&&n.title),scrollbar:getComputedStyle(sidebar).scrollbarWidth,
      first:cards.slice(0,3).map(n=>n.querySelector('h2').dataset.i18n),
      fullWidth:Math.abs(cards[0].getBoundingClientRect().width-overlay.querySelector('.settings-v2-grid').getBoundingClientRect().width)<1};
  });
  assert.deepEqual(composition,{horizontal:true,round:true,names:true,scrollbar:'none',first:['settings.languageAndTheme','settings.customBackground','settings.soundEffects'],fullWidth:true});
  done('single row of labeled color circles, hidden sidebar scrollbar and appearance-first order');
  const baseline=await layout();
  for(const mode of ['light','dark'])for(const preset of THEME_PRESETS){
    await page.locator(`[data-palette-choice="${preset.id}"]`).click();await selectMode(mode);
    assert.equal((await config()).preset,preset.id);
    assert.deepEqual(await layout(),baseline,`${mode}/${preset.id} uses exactly the same geometry`);
    const audit=await page.evaluate(auditVisibleColors,'#settingsOverlay');report.colors.push({mode,preset:preset.id,...audit});
  }
  done('all eight palettes in light/dark use identical settings geometry');
  await page.locator('[data-palette-choice="blue"]').click();
  const before=await page.evaluate(key=>localStorage.getItem(key),APPEARANCE_STORAGE_KEY);
  await page.locator('#themeCustomHex').fill('#ff0000');
  assert.equal((await config()).preset,'custom');assert.equal(await page.evaluate(key=>localStorage.getItem(key),APPEARANCE_STORAGE_KEY),before);
  await page.locator('#themePreviewCancel').click();assert.equal((await config()).preset,'blue');
  await page.locator('#themeCustomHex').fill('bad');assert.equal(await page.locator('#themeCustomHex').getAttribute('aria-invalid'),'true');assert.equal((await config()).preset,'blue');
  for(const color of ['#000000','#ffffff','#00ff00','#ffff00','#eeeeee']){
    await page.locator('#themeCustomHex').fill(color);assert.equal((await config()).customColor,color);
  }
  await page.locator('#themePreviewSave').click();assert.equal(JSON.parse(await page.evaluate(key=>localStorage.getItem(key),APPEARANCE_STORAGE_KEY)).customColor,'#eeeeee');
  await page.reload();await settle();assert.equal((await config()).customColor,'#eeeeee');
  await page.locator('#homeV2Settings').click();await settle();
  await page.locator('#themeCustomHex').fill('#ff00ff');await page.locator('#settingsBack').click();await settle();assert.equal((await config()).customColor,'#eeeeee','closing settings cancels preview');
  done('custom preview, invalid input, cancel, save, reload and closing settings');
  await page.locator('#homeV2Settings').click();await settle();
  for (const mode of ['dark', 'light']) {
    await selectMode(mode);
    await page.locator('[data-palette-choice="rose"]').click();
    await page.locator('#themeCustomHex').fill('#ff00ff');
    await page.locator('#themeRestoreDefault').click();
    assert.equal((await config()).mode,mode);
    assert.equal((await config()).preset,'neutral');
    assert.equal((await config()).customColor,'#3565a6');
    await page.reload();await settle();
    assert.equal((await config()).mode,mode);
    assert.equal((await config()).preset,'neutral');
    await page.locator('#homeV2Settings').click();await settle();
  }
  done('restoring default colors preserves light/dark mode through preview and reload');
  await page.locator('#themeWallpaperToggle').click();assert.equal((await config()).wallpaperEnabled,true);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWQ0AAAAASUVORK5CYII=','base64');
  await page.locator('#customBackgroundImageInput').setInputFiles({name:'wallpaper.png',mimeType:'image/png',buffer:png});
  await page.waitForFunction(()=>document.querySelector('.app').classList.contains('has-custom-background'));
  const savedWallpaper=await page.evaluate(()=>localStorage.getItem('toolknit.customBackground.v1'));
  await selectMode('dark');assert.equal((await config()).wallpaperEnabled,true);await selectMode('light');assert.equal((await config()).wallpaperEnabled,true);
  assert.equal(await page.locator('#chooseBackgroundImage').isEnabled(),true);
  await page.locator('#themeWallpaperToggle').click();await page.waitForFunction(()=>document.querySelectorAll('.toolknit-custom-background-media').length===0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('toolknit.customBackground.v1')),savedWallpaper);
  const ffmpeg=spawnSync(process.env.TOOLKNIT_TEST_FFMPEG||'ffmpeg',['-v','error','-f','lavfi','-i','color=c=0x66aa99:size=64x64:rate=10','-t','1','-an','-c:v','libvpx','-f','webm','pipe:1'],{windowsHide:true,timeout:15000});
  assert.equal(ffmpeg.status,0,ffmpeg.error?.message||ffmpeg.stderr?.toString());
  await page.locator('#themeWallpaperToggle').click();await page.locator('#customBackgroundVideoInput').setInputFiles({name:'wallpaper.webm',mimeType:'video/webm',buffer:ffmpeg.stdout});
  await page.waitForFunction(()=>document.querySelector('#settingsBackgroundPreview video')?.readyState>=2);
  await page.evaluate(()=>{window.__themeVideos=[...document.querySelectorAll('video')];});await page.locator('#themeWallpaperToggle').click();
  assert.equal(await page.evaluate(()=>window.__themeVideos.every(v=>v.paused&&!v.getAttribute('src'))),true);
  done('image/video wallpaper works in both modes; disabling releases media and preserves metadata');
  for(const [width,height]of [[1400,900],[1100,700],[720,640],[480,640]]){
    await page.setViewportSize({width,height});
    for(const language of ['zh','en']){
      await page.locator(`[data-lang="${language}"]`).first().click();
      for(const mode of ['light','dark']){
        await selectMode(mode);
        const metrics=await page.locator('#settingsOverlay').evaluate(overlay=>{
          const targets=[...overlay.querySelectorAll('.settings-v2-poster,.settings-v2-card')];
          return {overflow:overlay.scrollWidth>innerWidth+1,cards:targets.map(n=>({name:n.className,overflow:n.scrollWidth>n.clientWidth+1})).filter(n=>n.overflow)};
        });
        assert.deepEqual(metrics,{overflow:false,cards:[]},`${width}/${height}/${language}/${mode}`);
      }
    }
  }
  done('wide, narrow and low-height settings in Chinese and English');
  await page.setViewportSize({width:1400,height:900});await page.locator('[data-lang="zh"]').first().click();
  await page.locator('[data-palette-choice="blue"]').click();await selectMode('light');await page.screenshot({path:path.join(output,'light-blue-settings.png')});
  await selectMode('dark');await page.screenshot({path:path.join(output,'dark-blue-settings.png')});
  await page.locator('#settingsBack').click();await settle();await page.screenshot({path:path.join(output,'dark-blue-home.png')});
  await page.locator('#homeV2Settings').click();await settle();await selectMode('light');await page.locator('#settingsBack').click();await settle();await page.screenshot({path:path.join(output,'light-blue-home.png')});
  const second=await page.context().newPage();await second.goto(url);await second.waitForFunction(()=>!document.documentElement.dataset.tkStartup);
  await page.locator('#homeV2Settings').click();await settle();await page.locator('[data-palette-choice="rose"]').click();await second.waitForFunction(()=>document.documentElement.dataset.palette==='rose');await second.close();
  done('same-origin windows synchronize saved appearance');
  assert.deepEqual(report.errors,[]);
}finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();await server.close();}
console.log(`Appearance browser checks passed. Report: ${output}`);
