import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
const require = createRequire(process.env.TOOLKNIT_TEST_MODULES ? path.join(process.env.TOOLKNIT_TEST_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const version = createRequire(import.meta.url)('../package.json').version;
const storageKey='toolknit_release_notice_acknowledged_version';
const out=path.resolve('tmp/release-announcement');await mkdir(out,{recursive:true});
const server=await preview({configFile:false,preview:{host:'127.0.0.1',port:0,open:false}});
const url=server.resolvedUrls.local[0]+'?preview=release-notice';
const browser=await chromium.launch({headless:true,...(process.env.TOOLKNIT_TEST_BROWSER?{executablePath:process.env.TOOLKNIT_TEST_BROWSER}:{channel:'msedge'})});
try {
  const page=await browser.newPage({viewport:{width:1100,height:700}});page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    // Windows WebView can report unfocused even when the notice is visible.
    Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});
    window.openedLinks=[];window.open=url=>{openedLinks.push(url);return null;};
    new MutationObserver(()=>{if(window.noticeShownAt===undefined&&document.getElementById('releaseAnnouncement')?.classList.contains('visible'))window.noticeShownAt=performance.now();}).observe(document,{subtree:true,attributes:true,attributeFilter:['class']});
  });
  await page.goto(url);
  const modal=page.locator('#releaseAnnouncement'),button=page.locator('#releaseNoticeAcknowledge');
  await modal.waitFor({state:'visible'});
  assert(await button.isDisabled());assert(await page.locator('.app').evaluate(n=>n.inert));
  await page.keyboard.press('Escape');assert(await modal.isVisible());
  const links=modal.locator('a');await links.last().focus();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-home-link')),'website','mandatory dialog traps Tab');
  const panel=await page.locator('.release-announcement-panel').boundingBox();
  assert(panel.width>=1040&&panel.height>=650,'notice makes use of the main window');
  assert(Number.parseFloat(await button.evaluate(n=>getComputedStyle(n).borderRadius))>=22,'confirmation is a capsule');
  await page.waitForTimeout(1300);assert(await button.isDisabled());
  assert.match(await button.textContent(),/[89]/,'visible countdown starts without native focus');
  const beforeHidden=await button.textContent();
  await page.evaluate(()=>{window.qaHidden=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.qaHidden?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(1200);assert(await button.isDisabled(),'background time does not count');
  assert.equal(await button.textContent(),beforeHidden,'hidden notice pauses its countdown');
  await page.evaluate(()=>{window.qaHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>!document.getElementById('releaseNoticeAcknowledge').disabled);
  assert(await page.evaluate(()=>performance.now()-noticeShownAt>=11000),'ten visible seconds plus hidden time precede confirmation');
  await links.first().click();assert.deepEqual(await page.evaluate(()=>openedLinks),['https://toolknit.com/']);
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.screenshot({path:path.join(out,'light-1100.png')});
  await button.click();assert.equal(await modal.isVisible(),false);assert.equal(await page.locator('.app').evaluate(n=>n.inert),false);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),storageKey),version);
  await page.reload();await page.waitForFunction(()=>!document.documentElement.dataset.tkStartup);
  assert.equal(await modal.isVisible(),false,'already acknowledged version stays out of the way');
  await page.evaluate(key=>{localStorage.setItem(key,'3.2.0');localStorage.setItem('toolknit-lang','en');},storageKey);
  await page.reload();await modal.waitFor({state:'visible'});assert(await button.isDisabled(),'older acknowledgement does not skip a new version');
  const beforeDelay=Number((await button.textContent()).match(/\d+/)?.[0]);
  await page.evaluate(()=>{const original=performance.now.bind(performance);Object.defineProperty(performance,'now',{configurable:true,value:()=>original()+3500});});
  await page.waitForTimeout(250);
  assert(beforeDelay-Number((await button.textContent()).match(/\d+/)?.[0])>=3,'delayed timer delivery counts actual elapsed visible time');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  for(const width of [1100,720,480]) {
    await page.setViewportSize({width,height:480});
    const box=await button.boundingBox();assert(box.y>=0&&box.y+box.height<=480,'confirmation remains inside viewport');
    assert.equal(await modal.evaluate(n=>n.scrollWidth>n.clientWidth+1),false);
    await page.screenshot({path:path.join(out,'dark-en-'+width+'.png')});
  }
  await page.reload();await modal.waitFor({state:'visible'});assert(await button.isDisabled(),'closing without acknowledging does not mark the notice read');
  assert.deepEqual(errors,[]);
  console.log('Release notice passed: actual startup, ten visible seconds, hidden pause, Escape/Tab, links, version persistence, retry, dual themes, English and narrow layouts.');
} finally {await browser.close();await server.httpServer.close();}
