import { createIcons, icons } from 'lucide';
import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { bindToolPageChrome, mountToolPageBackground, toolTopbarMarkup } from '../../shared/tool-page-shell.js';
import { decodeBase64Utf8, decodeJwt, decodeUrlComponent, describeDeveloperToolError, encodeBase64Utf8, encodeUrlComponent, formatJsonText, generateUuidV4 } from './core.js';
import './developer-toolbox.css';
import '../../styles/components/developer-workbench-light.css';
import './developer-toolbox-light.css';

const MODES = [
  { id: 'json-tools', label: 'JSON 格式化', icon: 'braces' },
  { id: 'base64', label: 'Base64', icon: 'binary' },
  { id: 'url-codec', label: 'URL 编解码', icon: 'link-2' },
  { id: 'uuid', label: 'UUID 生成', icon: 'fingerprint' },
  { id: 'jwt', label: 'JWT 查看', icon: 'key-round' }
];
const MAX_TEXT = 2 * 1024 * 1024;
const JSON_INDENTS = [
  { value: '2', label: '2 空格' },
  { value: '4', label: '4 空格' },
  { value: 'tab', label: 'Tab' },
  { value: '0', label: 'Minify' }
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function initDeveloperToolbox({ overlay, notify = message => window.showToast?.(message) }) {
  if (!overlay) throw new Error('developer-toolbox:missing-overlay');
  const lifecycle = createLifecycleScope();
  overlay.innerHTML = `<div class="tool-page-v2-shell developer-toolbox-shell">
    ${toolTopbarMarkup({ tag: 'DEVELOPER TOOLS · TOOL PAGE 3.1', title: '开发者工具', closeAttr: 'data-dev-close' })}
    <main class="tool-page-v2-body developer-toolbox-main"><aside class="tool-page-v2-rail developer-toolbox-nav"><div class="tool-page-v2-rail-kicker">DEVELOPER TOOLS</div><h1>开发者<br>工具</h1><p>常用编码、数据和身份工具集中在一个本地工作台。</p><div class="tool-page-v2-rail-note"><span>LOCAL ONLY</span><strong>输入内容只存在当前会话，关闭页面后立即清除。</strong></div><div class="tool-page-v2-steps"><div class="is-active"><b>01</b><span><strong>选择工具</strong><small>从左侧导航切换处理模块。</small></span></div><div><b>02</b><span><strong>输入数据</strong><small>输入与选项变化后实时处理。</small></span></div><div><b>03</b><span><strong>复制结果</strong><small>结果不会写入历史记录。</small></span></div></div><div class="developer-toolbox-nav-index"><div class="developer-toolbox-nav-label">UTILITY INDEX</div><nav data-dev-nav></nav></div></aside><section class="developer-toolbox-workspace"><div class="developer-toolbox-heading"><div><span data-dev-eyebrow>JSON / DATA</span><h1 data-dev-title>JSON 格式化</h1><p data-dev-description>校验、格式化和压缩 JSON 文本。</p></div><span class="developer-toolbox-status" data-dev-status>就绪</span></div><div class="developer-toolbox-panel" data-dev-panel></div></section></main>
  </div>`;
  createIcons({ icons });
  const shell = overlay.querySelector('.tool-page-v2-shell');
  shell.classList.add('tool-page-v2-light');
  let backgroundDispose = null;
  lifecycle.use(bindToolPageChrome(shell, () => api.close()));
  const q = selector => overlay.querySelector(selector);
  let mode = 'json-tools'; let timer = 0;
  lifecycle.use(() => { clearTimeout(timer); timer = 0; });
  const descriptions = { 'json-tools': ['JSON / DATA', '校验、格式化和压缩 JSON 文本。'], base64: ['ENCODING / BASE64', '使用 UTF-8 安全处理中文和二进制文本。'], 'url-codec': ['ENCODING / URL', '编码或还原 URL 查询参数和路径片段。'], uuid: ['IDENTITY / UUID', '生成符合 RFC 4122 的随机 UUID v4。'], jwt: ['SECURITY / JWT', '仅解析 JWT 头部和载荷，不验证签名。'] };
  function setStatus(value, error = false) { const status = q('[data-dev-status]'); status.textContent = value; status.classList.toggle('is-error', error); }
  function jsonIndentMarkup() {
    return `<div class="developer-toolbox-select-field"><span>缩进</span><div class="developer-toolbox-select" data-json-indent-control><input type="hidden" value="2" data-json-indent><button type="button" class="developer-toolbox-select-trigger" data-json-indent-trigger aria-haspopup="listbox" aria-expanded="false"><span data-json-indent-label>2 空格</span><i data-lucide="chevron-down"></i></button><div class="developer-toolbox-select-menu" data-json-indent-menu role="listbox" hidden>${JSON_INDENTS.map((item, index) => `<button type="button" role="option" data-json-indent-option="${item.value}" aria-selected="${index === 0}" class="${index === 0 ? 'is-selected' : ''}">${item.label}</button>`).join('')}</div></div></div>`;
  }
  function closeJsonIndentMenu() {
    const menu = q('[data-json-indent-menu]');
    const trigger = q('[data-json-indent-trigger]');
    if (menu) menu.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  }
  function panelMarkup() {
    if (mode === 'uuid') return `<div class="developer-toolbox-single"><div class="developer-toolbox-control-row"><label>生成数量 <input type="number" min="1" max="50" value="5" data-uuid-count></label><button class="is-primary" type="button" data-uuid-generate><i data-lucide="sparkles"></i><span>生成 UUID</span></button></div><textarea data-dev-output readonly spellcheck="false" placeholder="生成结果"></textarea><div class="developer-toolbox-actions"><button type="button" data-dev-copy><i data-lucide="copy"></i><span>复制结果</span></button><button type="button" data-dev-clear><i data-lucide="eraser"></i><span>清空</span></button></div></div>`;
    if (mode === 'jwt') return `<div class="developer-toolbox-editor"><label class="developer-toolbox-field"><span>JWT 字符串</span><textarea data-dev-input spellcheck="false" placeholder="eyJhbGciOi..."></textarea></label><div class="developer-toolbox-jwt-grid"><article><span>Header</span><pre data-jwt-header>等待解析</pre></article><article><span>Payload</span><pre data-jwt-payload>等待解析</pre></article></div><div class="developer-toolbox-actions"><button type="button" data-dev-clear><i data-lucide="eraser"></i><span>清空</span></button></div></div>`;
    const options = mode === 'json-tools' ? jsonIndentMarkup() : mode === 'base64' ? `<div class="developer-toolbox-segment"><button class="is-active" data-codec-direction="encode">编码</button><button data-codec-direction="decode">解码</button></div>` : `<div class="developer-toolbox-segment"><button class="is-active" data-codec-direction="encode">编码</button><button data-codec-direction="decode">解码</button></div>`;
    const title = mode === 'json-tools' ? 'JSON 输入' : mode === 'base64' ? '文本输入' : 'URL 输入';
    return `<div class="developer-toolbox-editor"><div class="developer-toolbox-control-row"><span class="developer-toolbox-mode-label">${mode === 'json-tools' ? 'JSON PROCESSOR' : mode === 'base64' ? 'UTF-8 SAFE CODEC' : 'URI COMPONENT CODEC'}</span>${options}</div><div class="developer-toolbox-io-grid"><label class="developer-toolbox-field"><span>${title}</span><textarea data-dev-input spellcheck="false"></textarea></label><label class="developer-toolbox-field"><span>输出 <button type="button" data-dev-copy title="复制结果"><i data-lucide="copy"></i></button></span><textarea data-dev-output readonly spellcheck="false"></textarea></label></div><div class="developer-toolbox-actions"><button type="button" data-dev-clear><i data-lucide="eraser"></i><span>清空</span></button></div></div>`;
  }
  function renderPanel() { clearTimeout(timer); timer = 0; const [eyebrow, description] = descriptions[mode]; q('[data-dev-eyebrow]').textContent = eyebrow; q('[data-dev-title]').textContent = MODES.find(item => item.id === mode).label; q('[data-dev-description]').textContent = description; q('[data-dev-panel]').innerHTML = panelMarkup(); createIcons({ icons }); setStatus('就绪'); }
  function run() {
    const input = q('[data-dev-input]')?.value || ''; if (input.length > MAX_TEXT) { setStatus('输入超过 2 MB 限制', true); return; }
    try {
      if (mode === 'json-tools') { const output = q('[data-dev-output]'); output.value = formatJsonText(input, q('[data-json-indent]').value); setStatus('JSON 有效'); }
      else if (mode === 'base64') { const direction = q('[data-codec-direction].is-active').dataset.codecDirection; q('[data-dev-output]').value = direction === 'encode' ? encodeBase64Utf8(input) : decodeBase64Utf8(input); setStatus('处理完成'); }
      else if (mode === 'url-codec') { const direction = q('[data-codec-direction].is-active').dataset.codecDirection; q('[data-dev-output]').value = direction === 'encode' ? encodeUrlComponent(input) : decodeUrlComponent(input); setStatus('处理完成'); }
    } catch (error) { q('[data-dev-output]') && (q('[data-dev-output]').value = ''); setStatus(describeDeveloperToolError(error, mode), true); }
  }
  function runJwt() { const input = q('[data-dev-input]').value.trim(); try { const result = decodeJwt(input); q('[data-jwt-header]').textContent = JSON.stringify(result.header, null, 2); q('[data-jwt-payload]').textContent = JSON.stringify(result.payload, null, 2); setStatus('已解析，未验证签名'); } catch (error) { q('[data-jwt-header]').textContent = '无法解析'; q('[data-jwt-payload]').textContent = describeDeveloperToolError(error, mode); setStatus('解析失败', true); } }
  function clearSessionData() {
    closeJsonIndentMenu();
    q('[data-dev-input]') && (q('[data-dev-input]').value = '');
    q('[data-dev-output]') && (q('[data-dev-output]').value = '');
    q('[data-jwt-header]') && (q('[data-jwt-header]').textContent = '');
    q('[data-jwt-payload]') && (q('[data-jwt-payload]').textContent = '');
  }
  function copyResult() {
    const value = q('[data-dev-output]')?.value || q('[data-jwt-payload]')?.textContent || '';
    if (!value) return;
    const token = lifecycle.token();
    const pendingCopy = navigator.clipboard?.writeText(value);
    if (!pendingCopy) {
      setStatus('复制失败', true);
      return;
    }
    pendingCopy
      .then(() => { if (lifecycle.isCurrent(token)) notify('已复制结果'); })
      .catch(() => { if (lifecycle.isCurrent(token)) setStatus('复制失败', true); });
  }
  lifecycle.event(overlay, 'click', event => { const nav = event.target.closest('[data-dev-tool]'); if (nav) { mode = nav.dataset.devTool; overlay.querySelectorAll('[data-dev-tool]').forEach(item => item.classList.toggle('is-active', item === nav)); renderPanel(); return; } const indentTrigger = event.target.closest('[data-json-indent-trigger]'); if (indentTrigger) { const menu = q('[data-json-indent-menu]'); const opening = menu.hidden; menu.hidden = !opening; indentTrigger.setAttribute('aria-expanded', String(opening)); return; } const indentOption = event.target.closest('[data-json-indent-option]'); if (indentOption) { q('[data-json-indent]').value = indentOption.dataset.jsonIndentOption; q('[data-json-indent-label]').textContent = indentOption.textContent; overlay.querySelectorAll('[data-json-indent-option]').forEach(item => { const selected = item === indentOption; item.classList.toggle('is-selected', selected); item.setAttribute('aria-selected', String(selected)); }); closeJsonIndentMenu(); q('[data-dev-input]')?.value ? run() : setStatus('就绪'); return; } if (q('[data-json-indent-menu]') && !event.target.closest('[data-json-indent-control]')) closeJsonIndentMenu(); const direction = event.target.closest('[data-codec-direction]'); if (direction) { overlay.querySelectorAll('[data-codec-direction]').forEach(item => item.classList.toggle('is-active', item === direction)); run(); return; } if (event.target.closest('[data-uuid-generate]')) { const count = Math.max(1, Math.min(50, Number(q('[data-uuid-count]').value) || 1)); q('[data-dev-output]').value = Array.from({ length: count }, generateUuidV4).join('\n'); setStatus(`${count} 个 UUID 已生成`); } if (event.target.closest('[data-dev-copy]')) copyResult(); if (event.target.closest('[data-dev-clear]')) { q('[data-dev-input]') && (q('[data-dev-input]').value = ''); q('[data-dev-output]') && (q('[data-dev-output]').value = ''); q('[data-jwt-header]') && (q('[data-jwt-header]').textContent = '等待解析'); q('[data-jwt-payload]') && (q('[data-jwt-payload]').textContent = '等待解析'); setStatus('已清空'); } });
  lifecycle.event(overlay, 'input', event => { if (event.target.matches('[data-dev-input]')) { clearTimeout(timer); timer = setTimeout(() => mode === 'jwt' ? runJwt() : run(), 180); } });
  lifecycle.event(overlay, 'keydown', event => {
    const menu = q('[data-json-indent-menu]');
    if (event.key !== 'Escape' || !menu || menu.hidden) return;
    event.preventDefault();
    closeJsonIndentMenu();
    q('[data-json-indent-trigger]')?.focus();
  });
  const api = {
    open(toolId = 'json-tools') {
      lifecycle.invalidate();
      mode = MODES.some(item => item.id === toolId) ? toolId : 'json-tools';
      backgroundDispose?.();
      backgroundDispose = mountToolPageBackground(shell);
      overlay.classList.add('visible');
      overlay.setAttribute('aria-hidden', 'false');
      overlay.querySelector('[data-dev-nav]').innerHTML = MODES.map(item => `<button type="button" data-dev-tool="${item.id}" class="${item.id === mode ? 'is-active' : ''}"><i data-lucide="${item.icon}"></i><span>${escapeHtml(item.label)}</span></button>`).join('');
      createIcons({ icons });
      renderPanel();
    },
    close() {
      lifecycle.invalidate();
      clearTimeout(timer);
      timer = 0;
      backgroundDispose?.();
      backgroundDispose = null;
      clearSessionData();
      overlay.classList.remove('visible');
      overlay.setAttribute('aria-hidden', 'true');
    },
    dispose() {
      api.close();
      lifecycle.dispose();
      overlay.replaceChildren();
    }
  };
  return api;
}
