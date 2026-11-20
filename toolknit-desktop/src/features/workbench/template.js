import { toolTopbarMarkup } from '../../shared/tool-page-shell.js';
const word = key => `<span data-wb-copy="${key}"></span>`;
const button = (id, key, extra = '') => `<button type="button" data-wb-action="${id}" ${extra}>${word(key)}</button>`;
const heading = (key, hint, controls) => `<div class="productivity-heading"><div><h1 data-wb-copy="${key}"></h1><p data-wb-copy="${hint}"></p></div><div class="wb-actions">${controls}</div></div>`;
export default `<div id="documentWorkbenchOverlay" class="productivity-overlay workbench-overlay" aria-hidden="true" inert>
${toolTopbarMarkup({ tag: 'ToolKnit · <span data-wb-copy="workspace"></span>', title: '', closeAttr: 'data-tool-close' })}
<main class="productivity-sheet workbench-sheet">
<nav class="productivity-tabs" aria-label="ToolKnit workbench">
<button type="button" data-wb-tab="content-search">${word('search')}</button><button type="button" data-wb-tab="document-compare">${word('compare')}</button><button type="button" data-wb-tab="subtitle-workbench">${word('subtitles')}</button><button type="button" data-wb-tab="folder-automation">${word('folders')}</button></nav>
<section data-wb-panel="content-search">
${heading('search', 'searchHint', button('index-folder','addFolder') + button('index-files','addFiles'))}
<div class="wb-toolbar"><label class="wb-query"><span class="sr-only" data-wb-copy="search"></span><input data-content-query data-wb-placeholder="searchPlaceholder" maxlength="200"></label>${button('search','searchAction')}${button('cancel-index','cancel','hidden')}${button('clear-index','clearIndex')}</div>
<p class="productivity-inline" data-index-status role="status" aria-live="polite"></p><progress data-index-progress max="100" hidden></progress>
<p class="productivity-muted" data-wb-copy="searchLimits"></p><p class="productivity-muted" data-wb-copy="searchLocal"></p>
<div class="wb-results" data-content-results></div><details data-index-errors hidden><summary>读取问题 / Read issues</summary><pre></pre></details>
<input type="file" data-content-files multiple accept=".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm" hidden><input type="file" data-content-folder webkitdirectory multiple hidden>
</section>
<section data-wb-panel="document-compare" hidden>
${heading('compare','compareHint',button('compare','compareAction')+button('export-diff','exportDiff','disabled'))}
<div class="wb-document-inputs"><label><span data-wb-copy="before"></span><textarea data-before maxlength="1000000" spellcheck="false"></textarea>${button('load-before','loadBefore')}</label><label><span data-wb-copy="after"></span><textarea data-after maxlength="1000000" spellcheck="false"></textarea>${button('load-after','loadAfter')}</label></div>
<div class="wb-toolbar"><label class="productivity-check"><input type="checkbox" data-ignore-space>${word('ignoreSpace')}</label><label class="productivity-check"><input type="checkbox" data-changes-only>${word('changesOnly')}</label><div class="wb-actions">${button('previous-change','previous','disabled')}${button('next-change','next','disabled')}</div></div>
<p class="productivity-muted" data-wb-copy="compareLimits"></p><p class="productivity-inline" data-diff-summary role="status" aria-live="polite"></p>
<div class="wb-diff" data-diff-result></div><input type="file" data-before-file accept=".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm" hidden><input type="file" data-after-file accept=".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm" hidden>
</section>
<section data-wb-panel="subtitle-workbench" hidden>
${heading('subtitles','subtitleHint',button('import-subtitles','importSubtitles')+button('export-srt','exportSrt')+button('export-vtt','exportVtt'))}
<div class="wb-subtitle-top"><div><div class="wb-media"><video data-subtitle-media controls preload="metadata"></video><div data-subtitle-caption class="wb-caption" aria-live="off"></div></div>
<div class="wb-toolbar">${button('choose-media','chooseMedia')}<label>${word('language')}<select data-subtitle-language><option value="auto" data-wb-copy="auto"></option><option value="zh">中文</option><option value="en">English</option></select></label>${button('transcribe','transcribe')}</div><p class="productivity-inline" data-media-status role="status"></p></div>
<div class="wb-cue-editor"><h2 data-wb-copy="cueEditor"></h2><div class="productivity-fields"><label>${word('startTime')}<input data-cue-start placeholder="00:00:00,000" maxlength="14"></label><label>${word('endTime')}<input data-cue-end placeholder="00:00:03,000" maxlength="14"></label></div>
<label>${word('cueText')}<textarea data-cue-text maxlength="5000" rows="3"></textarea></label><div class="wb-actions">${button('add-cue','addCue')}${button('delete-cue','deleteCue')}${button('split-cue','splitCue')}</div>
<div class="wb-toolbar"><label>${word('offset')}<input type="number" data-cue-offset value="0" min="-3600000" max="3600000"></label>${button('shift-cues','applyOffset')}</div><p class="productivity-muted" data-wb-copy="subtitleLimits"></p></div></div>
<div class="wb-toolbar"><h2 data-wb-copy="subtitleList"></h2><div class="wb-actions">${button('previous-cues','previousPage')}<span data-cue-page></span>${button('next-cues','nextPage')}</div></div><p class="productivity-inline" data-subtitle-summary role="status" aria-live="polite"></p>
<div class="wb-cue-list" data-cue-list></div><input type="file" data-subtitle-file accept=".srt,.vtt" hidden><input type="file" data-media-file accept="audio/*,video/*" hidden>
</section>
<section data-wb-panel="folder-automation" hidden>
${heading('folders','foldersHint',button('refresh-folders','refresh'))}
<div class="productivity-layout"><form class="productivity-controls" data-folder-form>
<label>${word('ruleName')}<input name="name" maxlength="60" required></label>
<label>${word('inputFolder')}<div class="wb-path"><input name="input" readonly>${button('choose-input','choose')}</div></label><label>${word('outputFolder')}<div class="wb-path"><input name="output" readonly>${button('choose-output','choose')}</div></label>
<label>${word('action')}<select name="action"><option value="image-convert" data-wb-copy="imageConvert"></option><option value="image-compress" data-wb-copy="imageCompress"></option><option value="archive-copy" data-wb-copy="archiveCopy"></option></select></label>
<label>${word('format')}<select name="format"><option>PNG</option><option>JPG</option><option>WEBP</option></select></label>
<label>${word('quality')}<select name="quality"><option value="high" data-wb-copy="high"></option><option value="medium" selected data-wb-copy="medium"></option><option value="low" data-wb-copy="low"></option></select></label>
<label class="productivity-check"><input type="checkbox" name="enabled" checked>${word('enableRule')}</label><div class="wb-actions">${button('save-rule','saveRule')}${button('reset-rule','resetRule')}</div><p class="productivity-muted" data-wb-copy="foldersLimits"></p></form>
<div><h2 data-wb-copy="rules"></h2><div data-folder-rules></div><h2 class="wb-history-title" data-wb-copy="history"></h2><div data-folder-history></div></div></div>
</section><p class="productivity-message" data-wb-message role="status" aria-live="polite"></p>
</main></div>`;
