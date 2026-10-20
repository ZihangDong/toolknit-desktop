import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'vite';
const require=createRequire(process.env.TOOLKNIT_TEST_MODULES?path.join(process.env.TOOLKNIT_TEST_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const source=`
import markup from '/src/features/quick-screenshot/template.js';
import { createQuickScreenshotController } from '/src/features/quick-screenshot/controller.js';
document.body.innerHTML=markup;
const listeners=new Set(),calls=[];
let preferences={shortcut:'Alt+Q',history:false,registered:'Alt+Q'},hold=true,release,slow=false,finish;
const runtime={available:true,listen:async(_,callback)=>{listeners.add(callback);return()=>listeners.delete(callback);},call:async(action,args)=>{
 calls.push({action,args});
 if(action==='preferences'){if(hold){hold=false;return new Promise(resolve=>{release=()=>resolve({shortcut:'Alt+Q',history:false});});}return structuredClone(preferences);}
 if(action==='configure'){if(slow)await new Promise(resolve=>{finish=resolve;});preferences={...preferences,...args.preferences};listeners.forEach(fn=>fn());return structuredClone(preferences);}
}};
const tool=createQuickScreenshotController({overlay:document.getElementById('quickScreenshotOverlay'),screenshotRuntime:runtime});
window.fixture={tool,calls,listeners,release:()=>release?.(),slow:()=>{slow=true;},finish:()=>{slow=false;finish?.();}};
tool.open();
`;
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'history-settings-test',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url!=='/__history-settings')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><script type="module" src="/__history-settings.js"></script></body></html>');});},resolveId(id){if(id==='/__history-settings.js')return '\0history-settings';},load(id){if(id==='\0history-settings')return source;}}]});
await server.listen();
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__history-settings');
 await page.waitForFunction(()=>window.fixture);
 await page.locator('#screenshotHistoryToggle').click();
 await page.waitForFunction(()=>document.getElementById('screenshotHistoryToggle').getAttribute('aria-checked')==='true');
 await page.evaluate(()=>window.fixture.release());
 await page.waitForTimeout(100);
 assert.equal(await page.locator('#screenshotHistoryToggle').getAttribute('aria-checked'),'true','late initial preference must not undo the successful toggle');
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.action==='preferences').length),1,'configure event cannot race a new preference query');
 await page.evaluate(()=>window.fixture.slow());
 await page.locator('#screenshotHistoryToggle').click();
 assert.ok(await page.locator('#screenshotHistoryToggle').isDisabled());
 await page.locator('#screenshotHistoryToggle').evaluate(button=>{button.click();button.click();});
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.action==='configure').length),2,'pending click must not enqueue duplicate operations');
 await page.evaluate(()=>window.fixture.finish());
 await page.waitForFunction(()=>document.getElementById('screenshotHistoryToggle').getAttribute('aria-checked')==='false');
 await page.evaluate(()=>{window.fixture.tool.close();window.fixture.tool.open();});
 await page.waitForFunction(()=>window.fixture.calls.filter(c=>c.action==='preferences').length===2);
 assert.equal(await page.locator('#screenshotHistoryToggle').getAttribute('aria-checked'),'false','reopen must retain disabled preference');
 await page.evaluate(()=>window.fixture.tool.dispose());
 assert.equal(await page.evaluate(()=>window.fixture.listeners.size),0);
 assert.deepEqual(errors,[]);
 console.log('Floating history settings passed: late reads, busy events, repeated clicks, immediate toggle state, reopen and disposal.');
}finally{await browser.close();await server.close();}
