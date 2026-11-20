import { applyTranslations, getLang, onLangChange, t } from '../../i18n.js';
import { tauriCorePromise, loadTauriDialog, loadTauriWebview } from '../../platform/tauri-runtime.js';
import { taskCenter } from '../../app/task-center.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { buildRenamePlan } from './rename-core.js';
import { WORKFLOW_PRESETS, normalizeWorkflow, validateWorkflowFiles } from './workflow-core.js';
import './productivity.css';

const PRESET_KEY = 'toolknit.workflows.v1';
const basename = path => String(path || '').split(/[\\/]/).pop();
export function initProductivityTool({ overlay, isTauri = false, getOutputDir, refreshIcons = () => {} } = {}) {
  const q = selector => overlay.querySelector(selector);
  const qa = selector => [...overlay.querySelectorAll(selector)];
  const tr = key => t(`productivity.${key}`);
  const local = (zh, en) => getLang() === 'zh' ? zh : en;
  const invoke = (command, args) => tauriCorePromise.then(api => api.invoke(command, args));
  const renameForm = q('[data-rename-form]'), flowForm = q('[data-workflow-form]');
  const field = (form, name) => form.elements.namedItem(name);
  const button = action => q(`[data-action="${action}"]`);
  let renameFiles = [], flowFiles = [], plan = [], tab = 'batch-rename', busyRename = false, undoCount = 0;
  let customPresets = [], flowRunning = false, disposed = false, unlistenDrop;
  function close() { if (busyRename) return false; modal.close(); return true; }
  const modal = createModalSession({ root: overlay, background: overlay.ownerDocument.querySelector('.app'),
    initialFocus: q('[data-productivity-tab]'), canClose: () => !busyRename, onClose: close });
  const activeControllers = new Set();
  try {
    const values = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]');
    if (Array.isArray(values)) customPresets = values.slice(0, 30).filter(value => typeof value?.id === 'string' && typeof value.name === 'string')
      .flatMap(value => { try { return [{ id: value.id, name: value.name.slice(0, 60), ...normalizeWorkflow(value) }]; } catch { return []; } });
  } catch {}
  function message(value = '', error = false) {
    q('[data-productivity-message]').textContent = String(value);
    q('[data-productivity-message]').classList.toggle('productivity-error', error);
  }
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function action(label, callback, disabled = false) {
    const element = node('button', label); element.type = 'button'; element.disabled = disabled;
    element.addEventListener('click', () => { void Promise.resolve().then(callback).catch(error => message(error.message || error, true)); });
    return element;
  }
  function showTab(id) {
    if (!['batch-rename', 'task-center', 'tool-workflows'].includes(id)) return;
    tab = id; message();
    qa('[data-productivity-tab]').forEach(button => {
      if (button.dataset.productivityTab === id) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    qa('[data-productivity-panel]').forEach(panel => { panel.hidden = panel.dataset.productivityPanel !== id; });
    renderTasks();
  }
  function renameOptions() {
    return { pattern: field(renameForm, 'pattern').value, start: Number(field(renameForm, 'start').value), digits: Number(field(renameForm, 'digits').value),
      find: field(renameForm, 'find').value, replace: field(renameForm, 'replace').value, regex: field(renameForm, 'regex').checked };
  }
  function renderRename() {
    let error = '';
    try { plan = buildRenamePlan(renameFiles, renameOptions()); } catch (failure) { plan = []; error = failure.message; }
    const rows = q('[data-rename-rows]'); rows.replaceChildren();
    plan.forEach((item, index) => {
      const row = node('tr'), original = node('td', item.name), target = node('td', item.newName), controls = node('td');
      original.append(node('small', item.path));
      if (item.error) { target.classList.add('productivity-error'); target.append(node('small', item.error)); }
      else if (!item.changed) target.append(node('small', local('保持原名称', 'Unchanged')));
      controls.append(action('×', () => { renameFiles.splice(index, 1); renderRename(); }, busyRename));
      controls.firstChild.setAttribute('aria-label', `${tr('remove')} ${item.name}`);
      row.append(original, target, controls); rows.append(row);
    });
    const count = plan.filter(row => row.changed).length;
    q('[data-rename-empty]').hidden = renameFiles.length > 0;
    q('[data-rename-summary]').textContent = error || (renameFiles.length ? local(`${renameFiles.length} 个文件，${count} 个名称将修改`, `${renameFiles.length} files, ${count} names will change`) : '');
    q('[data-rename-summary]').classList.toggle('productivity-error', !!error || plan.some(row => row.error));
    button('rename').disabled = busyRename || !isTauri || !count || !!error || plan.some(row => row.error);
    button('undo').disabled = busyRename || !isTauri || !undoCount;
    for (const control of renameForm.elements) if (control.tagName !== 'BUTTON') control.disabled = busyRename;
    ['pick-rename', 'sort-rename', 'clear-rename'].forEach(name => { button(name).disabled = busyRename; });
  }
  function addFiles(values, kind) {
    if (kind === 'rename' && busyRename) return;
    const current = kind === 'rename' ? renameFiles : flowFiles;
    const seen = new Set(current.map(file => file.path || `${file.name}-${file.size}-${file.lastModified}`));
    const incoming = values.filter(file => {
      const key = file.path || `${file.name}-${file.size}-${file.lastModified}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    });
    const limit = kind === 'rename' ? 500 : 100;
    if (current.length + incoming.length > limit) throw new Error(local(`最多添加 ${limit} 个文件`, `Maximum ${limit} files`));
    current.push(...incoming); kind === 'rename' ? renderRename() : renderFlow();
  }
  async function pick(kind) {
    if (!isTauri) { q(`[data-${kind}-input]`).click(); return; }
    const { open } = await loadTauriDialog();
    const extensions = field(flowForm, 'input').value === 'pdf' ? ['pdf'] : ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff'];
    const selected = await open({ multiple: true, directory: false, ...(kind === 'flow' ? { filters: [{ name: tr('input'), extensions }] } : {}) });
    if (selected) addFiles((Array.isArray(selected) ? selected : [selected]).map(path => ({ path, name: basename(path), size: 0 })), kind);
  }
  async function refreshUndo() {
    if (!isTauri) return;
    try { undoCount = await invoke('undo_batch_rename', { preview: true }); } catch { undoCount = 0; }
    if (!disposed) renderRename();
  }
  async function applyRename() {
    if (button('rename').disabled) return;
    busyRename = true; renderRename(); message();
    const entries = plan.map(row => ({ path: row.path, new_name: row.newName }));
    // The operation is atomic to the UI; cancel is deliberately unavailable during file publication.
    const task = taskCenter.begin({ label: tr('rename'), tool: 'batch-rename' });
    try {
      await invoke('batch_rename_files', { entries, preview: true });
      await invoke('batch_rename_files', { entries, preview: false });
      const outputs = plan.map(row => row.path.replace(/[^\\/]+$/, () => row.newName));
      task.finish({ outputs }); renameFiles = [];
      message(local('重命名完成，可撤销最近一次操作。', 'Files renamed. You can undo the most recent batch.'));
      await refreshUndo();
    } catch (error) { task.fail(error); message(error.message || error, true); }
    finally { busyRename = false; if (!disposed) renderRename(); }
  }
  async function undo() {
    if (button('undo').disabled) return;
    busyRename = true; renderRename();
    const task = taskCenter.begin({ label: tr('undo'), tool: 'batch-rename' });
    try {
      const count = await invoke('undo_batch_rename', { preview: false }); task.finish();
      message(local(`已恢复 ${count} 个文件的原名称。`, `Restored ${count} original filenames.`));
      renameFiles = []; await refreshUndo();
    } catch (error) { task.fail(error); message(error.message || error, true); }
    finally { busyRename = false; if (!disposed) renderRename(); }
  }
  function renderTasks() {
    if (disposed) return;
    const focusedId = document.activeElement?.dataset?.taskId, focusedCommand = document.activeElement?.dataset?.taskCommand;
    const filter = q('[data-task-filter]').value, search = q('[data-task-search]').value.toLowerCase();
    const all = taskCenter.list();
    const tasks = all.filter(row => (filter === 'all' || filter === 'active' && ['queued', 'running', 'cancelling'].includes(row.state) || row.state === filter)
      && `${row.label} ${row.message}`.toLowerCase().includes(search));
    const container = q('[data-task-rows]'); container.replaceChildren();
    q('[data-task-summary]').textContent = local(`${all.filter(row => ['queued', 'running', 'cancelling'].includes(row.state)).length} 个任务处理中 · ${all.length} 条记录`, `${all.filter(row => ['queued', 'running', 'cancelling'].includes(row.state)).length} active · ${all.length} records`);
    if (!tasks.length) {
      const empty = node('div', undefined, 'productivity-empty');
      empty.append(node('h3', all.length ? tr('noMatches') : tr('noTasks')), node('p', tr('taskCoverage'))); container.append(empty);
    }
    for (const task of tasks) {
      const row = node('article', undefined, 'productivity-task'), identity = node('div'), state = node('div'), controls = node('div', undefined, 'productivity-task-actions');
      identity.append(node('strong', task.label));
      const time = node('time', new Date(task.createdAt).toLocaleString(getLang() === 'zh' ? 'zh-CN' : 'en-US')); time.dateTime = task.createdAt; identity.append(time);
      if (task.message) identity.append(node('p', task.message === 'interrupted' ? tr('interruptedHint') : task.message));
      const status = node('span', tr(task.state), 'productivity-state'); status.dataset.state = task.state; state.append(status);
      if (['queued', 'running', 'cancelling'].includes(task.state)) {
        const progress = node('progress'); progress.max = 100; progress.setAttribute('aria-label', `${task.label} ${tr('progress')}`);
        if (task.progress !== null) progress.value = task.progress;
        state.append(progress);
      }
      if (task.canCancel) controls.append(action(tr('cancel'), () => taskCenter.cancel(task.id)));
      if (task.canRetry) controls.append(action(tr('retry'), () => taskCenter.retry(task.id)));
      if (isTauri && task.outputs?.length) controls.append(action(tr('openOutput'), () => invoke('open_path', { path: task.outputs[0] })));
      for (const control of controls.children) { control.dataset.taskId = task.id; control.dataset.taskCommand = control.textContent; }
      row.append(identity, state, controls); container.append(row);
    }
    if (focusedId) {
      const next = [...container.querySelectorAll('button')].find(control => control.dataset.taskId === focusedId && control.dataset.taskCommand === focusedCommand);
      next?.focus({ preventScroll: true });
    }
  }
  function flowOptions() {
    return normalizeWorkflow({ input: field(flowForm, 'input').value, quality: field(flowForm, 'quality').value, number: field(flowForm, 'number').checked, start: Number(field(flowForm, 'start').value) });
  }
  function renderPresets(selected = field(flowForm, 'preset').value || WORKFLOW_PRESETS[0].id) {
    field(flowForm, 'preset').replaceChildren(...[...WORKFLOW_PRESETS, ...customPresets].map(preset => {
      const option = node('option', getLang() === 'en' && preset.nameEn ? preset.nameEn : preset.name); option.value = preset.id; return option;
    }));
    field(flowForm, 'preset').value = selected;
    button('delete-preset').disabled = !customPresets.some(preset => preset.id === selected);
  }
  function applyPreset() {
    const preset = [...WORKFLOW_PRESETS, ...customPresets].find(preset => preset.id === field(flowForm, 'preset').value);
    if (!preset) return;
    field(flowForm, 'input').value = preset.input; field(flowForm, 'quality').value = preset.quality;
    field(flowForm, 'number').checked = preset.number; field(flowForm, 'start').value = preset.start;
    button('delete-preset').disabled = !customPresets.some(value => value.id === preset.id);
    renderFlow();
  }
  function renderFlow() {
    const imageMode = field(flowForm, 'input').value === 'images';
    field(flowForm, 'quality').disabled = !imageMode;
    field(flowForm, 'start').disabled = !field(flowForm, 'number').checked;
    q('[data-flow-input]').accept = imageMode ? '.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff' : '.pdf';
    const steps = [imageMode ? tr('imagePdf') : tr('mergePdf'), ...(field(flowForm, 'number').checked ? [tr('addNumbers')] : []), tr('savePdf')];
    q('[data-flow-steps]').replaceChildren(...steps.map(text => node('li', text)));
    const list = q('[data-flow-files]'); list.replaceChildren();
    if (!flowFiles.length) list.append(node('p', tr('flowEmpty'), 'productivity-muted'));
    flowFiles.forEach((file, index) => {
      const row = node('div', undefined, 'productivity-file'), controls = node('div');
      row.append(node('span', `${String(index + 1).padStart(2, '0')}  ${file.name}`));
      const move = direction => { const target = index + direction; [flowFiles[index], flowFiles[target]] = [flowFiles[target], flowFiles[index]]; renderFlow(); };
      controls.append(action('↑', () => move(-1), index === 0), action('↓', () => move(1), index === flowFiles.length - 1), action('×', () => { flowFiles.splice(index, 1); renderFlow(); }));
      [...controls.children].forEach((button, i) => button.setAttribute('aria-label', `${[tr('moveUp'), tr('moveDown'), tr('remove')][i]} ${file.name}`));
      row.append(controls); list.append(row);
    });
    let error = '';
    if (flowFiles.length) try { validateWorkflowFiles(flowFiles, flowOptions()); } catch (failure) { error = failure.message; }
    q('[data-flow-status]').textContent = error || (flowRunning ? tr('flowRunning') : '');
    q('[data-flow-status]').classList.toggle('productivity-error', !!error);
    button('run-flow').disabled = flowRunning || !flowFiles.length || !!error;
  }
  async function runFlow(files = [...flowFiles], options = flowOptions()) {
    if (flowRunning) throw new Error(tr('flowRunning'));
    validateWorkflowFiles(files, options);
    flowRunning = true; renderFlow(); message();
    const controller = new AbortController(); activeControllers.add(controller);
    const task = taskCenter.begin({ label: options.input === 'images' ? tr('imagePdf') : tr('mergePdf'), tool: 'tool-workflows',
      cancel: () => controller.abort(), retry: () => runFlow(files, options) });
    try {
      const { executeWorkflow } = await import('./workflow-runtime.js');
      const result = await executeWorkflow({ files, options, isTauri, invoke, getOutputDir, signal: controller.signal,
        report: (percent, message) => task.progress(percent, message), onCommit: () => task.disableCancellation() });
      task.finish({ outputs: result.path ? [result.path] : [], message: local(`已输出 ${result.pages} 页 PDF`, `Created a ${result.pages}-page PDF`) });
      if (!disposed) message(local('流程已完成。可在任务中心查看输出。', 'Workflow complete. Find the output in Task Center.'));
    } catch (error) {
      task.fail(error); if (!disposed) message(error.message || error, error.name !== 'AbortError');
    } finally { activeControllers.delete(controller); flowRunning = false; if (!disposed) renderFlow(); }
  }
  async function savePreset() {
    const name = field(flowForm, 'presetName').value.trim();
    if (!name) throw new Error(local('请输入预设名称', 'Enter a preset name'));
    if (customPresets.length >= 30) throw new Error(local('最多保存 30 条预设', 'Maximum 30 saved presets'));
    const preset = { ...flowOptions(), id: `custom-${crypto.randomUUID()}`, name };
    const next = [...customPresets, preset]; localStorage.setItem(PRESET_KEY, JSON.stringify(next)); customPresets = next;
    renderPresets(preset.id); field(flowForm, 'presetName').value = ''; message(tr('presetSaved'));
  }
  const handlers = {
    'pick-rename': () => pick('rename'), 'pick-flow': () => pick('flow'), rename: applyRename, undo,
    'sort-rename': () => { renameFiles.sort((a, b) => a.name.localeCompare(b.name, getLang() === 'zh' ? 'zh-CN' : 'en', { numeric: true })); renderRename(); },
    'clear-rename': () => { renameFiles = []; renderRename(); }, 'clear-flow': () => { flowFiles = []; renderFlow(); },
    'clear-tasks': () => taskCenter.clearFinished(), 'view-tasks': () => showTab('task-center'), 'run-flow': () => runFlow(), 'save-preset': savePreset,
    'delete-preset': () => { const next = customPresets.filter(preset => preset.id !== field(flowForm, 'preset').value); localStorage.setItem(PRESET_KEY, JSON.stringify(next)); customPresets = next; renderPresets(WORKFLOW_PRESETS[0].id); applyPreset(); }
  };
  const events = new AbortController();
  overlay.addEventListener('click', event => {
    const target = event.target.closest('[data-action], [data-productivity-tab]');
    if (!target || target.disabled) return;
    if (target.dataset.productivityTab) showTab(target.dataset.productivityTab);
    else if (handlers[target.dataset.action]) void Promise.resolve().then(handlers[target.dataset.action]).catch(error => message(error.message || error, true));
  }, { signal: events.signal });
  renameForm.addEventListener('input', renderRename, { signal: events.signal });
  for (const form of [renameForm, flowForm]) form.addEventListener('submit', event => event.preventDefault(), { signal: events.signal });
  flowForm.addEventListener('change', event => { event.target.name === 'preset' ? applyPreset() : renderFlow(); }, { signal: events.signal });
  q('[data-task-search]').addEventListener('input', renderTasks, { signal: events.signal });
  q('[data-task-filter]').addEventListener('change', renderTasks, { signal: events.signal });
  for (const kind of ['rename', 'flow']) q(`[data-${kind}-input]`).addEventListener('change', event => {
    try { addFiles([...event.target.files], kind); } catch (error) { message(error.message, true); } event.target.value = '';
  }, { signal: events.signal });
  overlay.addEventListener('dragover', event => event.preventDefault(), { signal: events.signal });
  overlay.addEventListener('drop', event => {
    event.preventDefault(); if (isTauri || tab === 'task-center') return;
    try { addFiles([...event.dataTransfer.files], tab === 'batch-rename' ? 'rename' : 'flow'); } catch (error) { message(error.message, true); }
  }, { signal: events.signal });
  if (isTauri) void loadTauriWebview().then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent(event => {
    if (disposed || !overlay.classList.contains('visible') || event.payload?.type !== 'drop' || tab === 'task-center') return;
    try { addFiles((event.payload.paths || []).map(path => ({ path, name: basename(path), size: 0 })), tab === 'batch-rename' ? 'rename' : 'flow'); } catch (error) { message(error.message, true); }
  })).then(unlisten => { if (disposed) unlisten(); else unlistenDrop = unlisten; }).catch(error => message(error.message || error, true));
  const unsubscribe = taskCenter.subscribe(renderTasks);
  const unsubscribeLanguage = onLangChange(() => { applyTranslations(); renderPresets(); renderRename(); renderFlow(); renderTasks(); });
  renderPresets(); applyPreset(); renderRename(); refreshIcons();
  return {
    open(toolId) {
      modal.open();
      applyTranslations(); showTab(toolId); void refreshUndo();
      if (!isTauri && toolId === 'batch-rename') message(local('网页预览可查看命名规则；修改本机文件请使用桌面版。', 'Preview naming rules here. Use the desktop app to rename local files.'));
      q(`[data-productivity-tab="${tab}"]`).focus({ preventScroll: true });
    },
    close,
    dispose() { disposed = true; events.abort(); modal.dispose(); unsubscribe(); unsubscribeLanguage(); unlistenDrop?.(); for (const controller of activeControllers) controller.abort(); }
  };
}
