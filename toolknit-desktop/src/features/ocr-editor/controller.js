import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { taskCenter } from '../../app/task-center.js';
import { createLocalOcrRuntime } from '../../platform/local-ocr-runtime.js';
import { tauriCorePromise, loadTauriDialog } from '../../platform/tauri-runtime.js';
import { writeUniqueBinaryFile } from '../../platform/binary-output.js';
import { t, onLangChange } from '../../i18n.js';
import { OCR_EDIT_LIMITS, normalizeRegion, regionsFromOcr, rotateRect, rotatedSize, editError, editOutputName } from './core.js';
import { ensureEditFonts, renderEditedPage, canvasPng, exportEditedPdf, layoutRegion } from './render.js';
import { loadEditPages, releaseEditPages } from './input.js';

export function createOcrEditorController({ overlay, isTauri = false, getOutputDir, invokeNative, chooseFile,
  ocrRuntime = createLocalOcrRuntime({ isTauri }), center = taskCenter, refreshIcons = () => {} } = {}) {
  const scope = createLifecycleScope(), q = id => overlay.querySelector(`#ocrEdit${id}`), tr = (key,params) => t(`home.ocrEditor.${key}`,params);
  const invoke = async (...args) => (invokeNative || (await tauriCorePromise).invoke)(...args);
  let owner = null, operation = null, pages = [], pageIndex = 0, selected = -1, fileName = '', output = '', disposed = false, notice = null;
  const page = () => pages[pageIndex];
  const modal = createModalSession({ root:overlay, background:document.querySelector('.app'),initialFocus:q('Pick'),onClose:close }); scope.use(modal.dispose);
  const fields = ['Text','Font','Size','Angle','Foreground','Background','X','Y','Width','Height'];
  function setNotice(key,params = {},error = false) { notice = { key,params,error }; renderNotice(); }
  function renderNotice() { q('Status').textContent = notice ? tr(notice.key,notice.params) : ''; q('Status').classList.toggle('is-error',!!notice?.error); }
  function report(error) {
    const code = /(?:ocr-edit|ocr):([a-z-]+)/.exec(String(error?.message || error))?.[1] || 'failed';
    const key = `error.${code}`, known = tr(key) !== `home.ocrEditor.${key}`;
    setNotice(code === 'cancelled' || error?.name === 'AbortError' ? 'cancelled' : known ? key : 'error.failed',{},code !== 'cancelled');
  }
  function alive(op) { return operation === op && owner === op.owner && !!owner && !op.abort.signal.aborted; }
  function begin(kind) {
    const op = { owner,kind,abort:new AbortController(),committing:false };
    op.check = () => { if (!alive(op)) throw editError('cancelled'); };
    operation = op; op.task = center.begin({ label:tr(kind === 'recognize' ? 'recognize' : kind === 'load' ? 'loading' : 'saving'),tool:'ocr-editor',cancel:() => cancel(op) });
    op.timer = setTimeout(() => { if (alive(op) && !op.committing) cancel(op); },180000);
    renderControls(); setNotice(kind === 'load' ? 'loading' : kind === 'recognize' ? 'recognizing' : 'saving'); return op;
  }
  function cancel(op = operation) {
    if (!op || op.committing || op.abort.signal.aborted) return;
    op.abort.abort(); op.renderTask?.cancel(); void op.loadingTask?.destroy().catch(() => {});
    op.task.fail(editError('cancelled')); if (owner === op.owner) setNotice('cancelled');
  }
  function end(op) { clearTimeout(op.timer); if (operation === op) { operation = null; renderControls(); } }
  function renderControls() {
    const busy = !!operation, current = page(), region = current?.regions[selected];
    for (const id of ['Pick','Page','Reset','Zoom','Compare']) q(id).disabled = busy || (id !== 'Pick' && !current);
    for (const id of ['Png','Pdf','Rotate']) q(id).disabled = busy || !current;
    q('Searchable').disabled = busy || !current;
    q('Recognize').disabled = busy || !current || current.regions.length > 0 || (!isTauri && !ocrRuntime.browserAvailable);
    q('Add').disabled = busy || !current || current.regions.length >= OCR_EDIT_LIMITS.regions;
    q('Regions').disabled = busy || !current?.regions.length;
    q('Fields').disabled = busy || !region; q('Empty').hidden = !!region;
    q('Undo').disabled = busy || !current?.history.canUndo; q('Redo').disabled = busy || !current?.history.canRedo;
    q('Cancel').hidden = !busy; q('Cancel').disabled = !!operation?.committing || !!operation?.abort.signal.aborted;
    q('Folder').hidden = !output || !isTauri; q('Folder').disabled = busy; q('Output').textContent = output;
    q('Boxes').querySelectorAll('button').forEach(node => { node.disabled = busy; });
  }
  function options() {
    q('Page').replaceChildren(...pages.map((_,i) => new Option(tr('pageNumber',{number:i+1,count:pages.length}),String(i)))); q('Page').value = String(pageIndex);
    const current = page();
    q('Regions').replaceChildren(...(current?.regions || []).map((region,index) => new Option(`${index+1}. ${region.text || tr('blank')}`,String(index))));
    q('Regions').value = String(selected);
    q('Source').textContent = current ? `${fileName} · ${current.source.width} × ${current.source.height} px` : '';
  }
  function syncForm() {
    const region = page()?.regions[selected];
    for (const id of fields) q(id).value = region ? region[id[0].toLowerCase()+id.slice(1)] : id === 'Foreground' ? '#111111' : id === 'Background' ? '#ffffff' : '';
    renderControls();
  }
  function fit() {
    const current = page(); if (!current || !q('Paper').firstElementChild) return;
    const size = rotatedSize(current.source.width,current.source.height,current.rotation), stage = q('Stage');
    const scale = q('Zoom').value === 'fit' ? Math.min(1,Math.max(100,stage.clientWidth - 32) / size.width,Math.max(160,stage.clientHeight - 32) / size.height) : Number(q('Zoom').value);
    q('Paper').style.width = `${size.width * scale}px`; q('Paper').style.height = `${size.height * scale}px`;
  }
  function draw() {
    const current = page(); q('Placeholder').hidden = !!current; q('Paper').hidden = !current; q('Boxes').replaceChildren();
    const target = q('Canvas'); if (!current) { target.width = target.height = 1; return; }
    const result = renderEditedPage(current,{ original:q('Compare').checked }); target.width = result.width; target.height = result.height; target.getContext('2d').drawImage(result,0,0); result.width = result.height = 1;
    const size = rotatedSize(current.source.width,current.source.height,current.rotation);
    current.regions.forEach((region,index) => {
      const bounds = rotateRect(region,current.source.width,current.source.height,current.rotation), node = document.createElement('button'); node.type = 'button';
      node.dataset.index = String(index); node.dataset.edited = String(region.edited); node.disabled = !!operation; node.setAttribute('aria-pressed',String(selected === index)); node.setAttribute('aria-label',tr('boxLabel',{number:index+1,text:region.text || tr('blank')}));
      Object.assign(node.style,{left:`${bounds.x / size.width * 100}%`,top:`${bounds.y / size.height * 100}%`,width:`${bounds.width / size.width * 100}%`,height:`${bounds.height / size.height * 100}%`}); q('Boxes').append(node);
    }); fit();
  }
  function select(index) { if (operation) return; selected = index; q('Regions').value = String(index); syncForm(); draw(); }
  function remember() { const current = page(); current.history.push({regions:current.regions,rotation:current.rotation}); output = ''; options(); syncForm(); draw(); }
  function sampleBackground(region) {
    const current = page(), context = current.source.getContext('2d'), channels = [[],[],[]];
    const x1 = Math.max(0,Math.floor(region.x)-2), x2 = Math.min(current.source.width-1,Math.ceil(region.x+region.width)+1), y1 = Math.max(0,Math.floor(region.y)-2), y2 = Math.min(current.source.height-1,Math.ceil(region.y+region.height)+1);
    for (let i=0;i<=12;i++) for (const [x,y] of [[Math.round(x1+(x2-x1)*i/12),y1],[Math.round(x1+(x2-x1)*i/12),y2],[x1,Math.round(y1+(y2-y1)*i/12)],[x2,Math.round(y1+(y2-y1)*i/12)]]) {
      const rgba = context.getImageData(x,y,1,1).data; for (let c=0;c<3;c++) channels[c].push(rgba[c]);
    }
    return '#' + channels.map(values => values.sort((a,b)=>a-b)[Math.floor(values.length/2)].toString(16).padStart(2,'0')).join('');
  }
  async function importFile(file) {
    if (!owner || operation || disposed || !file) return;
    const op = begin('load'); let loaded;
    try {
      await ensureEditFonts(); op.check(); loaded = await loadEditPages(file,{invoke,operation:op,check:op.check,progress:value=>op.task.progress(value)}); op.check();
      releaseEditPages(pages); pages = loaded; loaded = null; pageIndex = 0; selected = -1; fileName = file.name; output = ''; q('Compare').checked = false; q('Zoom').value = 'fit';
      options(); syncForm(); draw(); setNotice('loaded',{count:pages.length}); op.task.finish();
    } catch (error) { if (loaded) releaseEditPages(loaded); op.task.fail(error); if (owner === op.owner) report(error); }
    finally { end(op); }
  }
  async function pick() {
    if (!owner || operation) return;
    if (!isTauri) { q('FileInput').click(); return; }
    const token = owner;
    try { const choose = chooseFile || (options => loadTauriDialog().then(api=>api.open(options))); const path = await choose({multiple:false,filters:[{name:'Image / PDF',extensions:['png','jpg','jpeg','webp','bmp','pdf']}]}); if (path && owner === token) await importFile({path,name:path.split(/[\\/]/).pop()}); } catch (error) { if (owner === token) report(error); }
  }
  async function recognize() {
    const current = page(); if (!current || operation || current.regions.length) return;
    const op = begin('recognize');
    try {
      // First-use model installation has its own download lifecycle; do not time it as inference.
      clearTimeout(op.timer);
      await ocrRuntime.ensure(op.abort.signal); op.check();
      op.timer = setTimeout(() => { if (alive(op)) cancel(op); },150000);
      const data = current.source.toDataURL('image/png'); if (data.length > 34 * 1024 * 1024) throw editError('size');
      const result = await ocrRuntime.recognize(data,op.abort.signal); op.check();
      const regions = regionsFromOcr(result,current.source.width,current.source.height); for (const region of regions) region.background = sampleBackground(region);
      current.regions = regions; selected = regions.length ? 0 : -1; remember(); setNotice('recognized',{count:regions.length}); op.task.finish();
    } catch (error) { op.task.fail(error); if (owner === op.owner) report(error); }
    finally { end(op); }
  }
  function add() {
    const current = page(); if (!current || operation || current.regions.length >= OCR_EDIT_LIMITS.regions) return;
    const width = Math.min(240,current.source.width),height = Math.min(64,current.source.height);
    if (width < 2 || height < 2) { report(editError('geometry')); return; }
    const region = normalizeRegion({x:0,y:0,width,height,text:'',size:Math.max(4,Math.min(24,height*.8))},current.source.width,current.source.height); region.background = sampleBackground(region);
    current.regions.push(region); selected = current.regions.length - 1; remember(); q('Text').focus();
  }
  function apply() {
    const current = page(), old = current?.regions[selected]; if (!old || operation) return;
    try {
      const values = Object.fromEntries(fields.map(id=>[id[0].toLowerCase()+id.slice(1),q(id).value]));
      const region = normalizeRegion({...old,...values,edited:true},current.source.width,current.source.height);
      if (layoutRegion(q('Canvas').getContext('2d'),region).overflow) throw editError('overflow');
      current.regions[selected] = region; q('Compare').checked = false; remember(); setNotice('applied');
    } catch (error) { report(error); }
  }
  function history(direction) { const current = page(); if (!current || operation) return; Object.assign(current,current.history[direction]()); selected = Math.min(selected,current.regions.length-1); output = ''; options(); syncForm(); draw(); setNotice(direction); }
  async function save(extension) {
    if (!page() || operation || !owner) return;
    const op = begin('save');
    try {
      await ensureEditFonts(); op.check(); let bytes;
      if (extension === 'pdf') bytes = await exportEditedPdf(pages,{
        searchable:q('Searchable').checked,check:op.check,progress:value=>op.task.progress(value),
      });
      else { const canvas = renderEditedPage(page()); try { bytes = new Uint8Array(await (await canvasPng(canvas)).arrayBuffer()); } finally { canvas.width = canvas.height = 1; } }
      op.check(); if (!bytes.length || bytes.length > OCR_EDIT_LIMITS.outputBytes) throw editError('output');
      const name = editOutputName(fileName,extension,extension === 'png' && pages.length > 1 ? pageIndex+1 : undefined);
      let path = '';
      if (isTauri) {
        const directory = await getOutputDir('OCR_Edits'); op.check(); op.committing = true; op.task.disableCancellation(); renderControls();
        path = await writeUniqueBinaryFile(invoke,{directory,fileName:name,bytes});
      } else {
        op.check(); const url = URL.createObjectURL(new Blob([bytes],{type:extension === 'pdf' ? 'application/pdf' : 'image/png'}));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1500);
      }
      op.task.finish({outputs:path ? [path] : []});
      if (owner === op.owner) { output = path; setNotice(isTauri ? 'saved' : 'downloaded'); }
    } catch (error) { op.task.fail(error); if (owner === op.owner) report(error); }
    finally { end(op); }
  }
  function reset() { if (operation) return; releaseEditPages(pages); pages = []; selected = -1; pageIndex = 0; fileName = ''; output = ''; notice = null; q('Searchable').checked = false; options(); syncForm(); draw(); renderNotice(); }
  function translate() { overlay.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent = t(node.dataset.i18n);}); options(); renderControls(); renderNotice(); draw(); }
  for (const [id,fn] of [['Pick',pick],['Recognize',recognize],['Png',()=>save('png')],['Pdf',()=>save('pdf')]]) scope.event(q(id),'click',()=>{void Promise.resolve().then(fn).catch(report);});
  scope.event(q('Cancel'),'click',()=>{cancel();renderControls();}); scope.event(q('Add'),'click',add); scope.event(q('Apply'),'click',apply); scope.event(q('Undo'),'click',()=>history('undo')); scope.event(q('Redo'),'click',()=>history('redo')); scope.event(q('Reset'),'click',reset);
  scope.event(q('Restore'),'click',()=>{const region = page()?.regions[selected];if (region && !operation) {region.edited = false;region.text = region.original;remember();setNotice('restored');}});
  scope.event(q('Delete'),'click',()=>{if (selected >= 0 && !operation) {page().regions.splice(selected,1);selected=Math.min(selected,page().regions.length-1);remember();}});
  scope.event(q('Rotate'),'click',()=>{if (page() && !operation) {page().rotation=(page().rotation+90)%360;remember();}});
  scope.event(q('Regions'),'change',()=>select(Number(q('Regions').value)));
  scope.event(q('Boxes'),'click',event=>{const node=event.target.closest('[data-index]');if(node)select(Number(node.dataset.index));});
  scope.event(q('Page'),'change',()=>{if(!operation){pageIndex=Number(q('Page').value);selected=-1;options();syncForm();draw();}});
  scope.event(q('Compare'),'change',draw); scope.event(q('Zoom'),'change',fit);
  scope.event(q('JumpPreview'),'click',()=>{q('PreviewTitle').scrollIntoView({block:'start'});q('Stage').focus({preventScroll:true});});
  scope.event(q('JumpSettings'),'click',()=>{q('Title').scrollIntoView({block:'start'});q('Pick').focus({preventScroll:true});});
  scope.event(q('FileInput'),'change',()=>{const file=q('FileInput').files?.[0];q('FileInput').value='';void importFile(file);});
  scope.event(q('Folder'),'click',()=>{if(output)void invoke('open_path',{path:output}).catch(()=>setNotice('error.folder',{},true));});
  overlay.querySelectorAll('[data-ocr-edit-close]').forEach(node=>scope.event(node,'click',close));
  scope.event(overlay,'keydown',event=>{if ((event.ctrlKey || event.metaKey) && !event.target.closest('input,textarea,select') && event.key.toLowerCase()==='z') {event.preventDefault();history(event.shiftKey?'redo':'undo');}});
  const observer = new ResizeObserver(fit); observer.observe(q('Stage')); scope.use(()=>observer.disconnect()); scope.use(onLangChange(translate));
  function open() {if(disposed || close() === false)return false;owner={};modal.open();reset();translate();refreshIcons();if(!isTauri)setNotice('browserMode');return true;}
  function close() {if(operation?.committing){setNotice('saving');return false;}const pending=operation;if(pending){cancel(pending);clearTimeout(pending.timer);}operation=null;owner=null;reset();modal.close();return true;}
  translate(); return {open,close,importFile,get busy(){return !!operation;},dispose(){if(disposed || close()===false)return;disposed=true;scope.dispose();}};
}
