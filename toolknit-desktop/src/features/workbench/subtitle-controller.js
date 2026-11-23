import { taskCenter } from '../../app/task-center.js';
import { parseSubtitles, parseSubtitleTime, subtitleTime, subtitleIssues, exportSubtitles, shiftSubtitles, splitSubtitle } from './subtitle-core.js';
import { element, action, saveText, basename } from './ui.js';
const DRAFT = 'toolknit.subtitle-draft.v1';

export function createSubtitleWorkbench({ panel, isTauri, invoke, listen, choose, getOutputDir, tr, local, message, signal, ensureFfmpegAvailable, activeTranscriptionModel, refreshTranscriptionModels, showDependencyGate }) {
  const q = selector => panel.querySelector(selector), media = q('[data-subtitle-media]');
  let cues = [], selected = -1, page = 0, mediaFile, mediaUrl, transcribing = false, draftTimer, mediaRevision = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT) || '[]');
    if (Array.isArray(saved) && saved.length <= 5000) cues = saved.filter(cue => cue && typeof cue.text === 'string' && typeof cue.id === 'string').map(cue => ({ ...cue, text: cue.text.slice(0, 5000), settings: String(cue.settings || '') }));
    if (cues.length) selected = 0;
  } catch {}
  const format = ms => Number.isSafeInteger(ms) && ms >= 0 && ms <= 359999999 ? subtitleTime(ms) : '';
  function persist() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { try { localStorage.setItem(DRAFT, JSON.stringify(cues)); } catch { message(local('草稿保存失败，请导出字幕保留修改。', 'Draft could not be saved. Export subtitles to keep your edits.'), true); } }, 200);
  }
  function preview() {
    const time = Math.round(media.currentTime * 1000), current = cues.filter(cue => cue.start <= time && time < cue.end);
    q('[data-subtitle-caption]').textContent = current.map(cue => cue.text.replace(/<[^>]*>/g, '')).join('\n');
  }
  function updateSummary() {
    const issues = subtitleIssues(cues), invalid = issues.filter(value => value === 'invalid').length, overlaps = issues.filter(value => value === 'overlap').length;
    q('[data-subtitle-summary]').textContent = local(`${cues.length} 条字幕 · ${invalid} 条无效 · ${overlaps} 处重叠`, `${cues.length} cues · ${invalid} invalid · ${overlaps} overlaps`);
    for (const name of ['export-srt','export-vtt']) q(`[data-wb-action="${name}"]`).disabled = !cues.length || !!invalid || transcribing;
    q('[data-wb-action="delete-cue"]').disabled = selected < 0 || transcribing;
    q('[data-wb-action="split-cue"]').disabled = selected < 0 || !mediaUrl || transcribing || cues.length >= 5000;
    q('[data-wb-action="transcribe"]').disabled = !isTauri || !mediaFile?.path || transcribing;
    q('[data-wb-action="add-cue"]').disabled = cues.length >= 5000 || transcribing;
  }
  function editor() {
    const cue = cues[selected];
    q('[data-cue-start]').value = cue ? format(cue.start) : '';
    q('[data-cue-end]').value = cue ? format(cue.end) : '';
    q('[data-cue-text]').value = cue?.text || '';
    for(const [selector,key] of [['[data-cue-start]','start'],['[data-cue-end]','end']]){if(cue&&!Number.isSafeInteger(cue[key]))q(selector).setAttribute('aria-invalid','true');else q(selector).removeAttribute('aria-invalid');}
    for (const control of [q('[data-cue-start]'),q('[data-cue-end]'),q('[data-cue-text]')]) control.disabled = !cue || transcribing;
  }
  function render() {
    const list = q('[data-cue-list]'), issues = subtitleIssues(cues); list.replaceChildren();
    page = Math.max(0, Math.min(page, Math.ceil(cues.length / 50) - 1));
    if (!cues.length) list.append(element('p', tr('subtitleEmpty'), 'productivity-empty'));
    for (let index = page * 50; index < Math.min(cues.length, (page + 1) * 50); index++) {
      const cue = cues[index], row = element('div', undefined, 'wb-cue-row'); row.dataset.selected = String(index === selected); row.dataset.issue = issues[index]; row.dataset.cueIndex = index;
      const chooseCue = () => { selected = index; render(); };
      const edit = action(String(index + 1), chooseCue, { title: tr('cueEditor') });
      const timing = element('span', `${format(cue.start)} → ${format(cue.end)}${issues[index] ? ` · ${local(issues[index] === 'invalid' ? '无效' : '重叠', issues[index])}` : ''}`, 'wb-cue-time');
      const text = element('span', cue.text);
      text.addEventListener('click', chooseCue);
      row.append(edit, timing, text, action(tr('playCue'), () => { selected = index; media.currentTime = (cue.start || 0) / 1000; void media.play().catch(error => message(error.message, true)); editor(); preview(); }, { disabled: !mediaUrl || issues[index] === 'invalid' }));
      list.append(row);
    }
    q('[data-cue-page]').textContent = `${cues.length ? page + 1 : 0} / ${Math.ceil(cues.length / 50)}`;
    q('[data-wb-action="previous-cues"]').disabled = page === 0;
    q('[data-wb-action="next-cues"]').disabled = (page + 1) * 50 >= cues.length;
    editor(); updateSummary(); preview();
  }
  function updateCue() {
    const cue = cues[selected]; if (!cue) return;
    for (const [field, key] of [['[data-cue-start]','start'],['[data-cue-end]','end']]) {
      try { cue[key] = parseSubtitleTime(q(field).value); q(field).removeAttribute('aria-invalid'); }
      catch { cue[key] = null; q(field).setAttribute('aria-invalid','true'); }
    }
    cue.text = q('[data-cue-text]').value;
    const row = q(`[data-cue-index="${selected}"]`);
    if (row) { row.children[2].textContent = cue.text; row.children[1].textContent = `${format(cue.start)} → ${format(cue.end)}`; row.dataset.issue = subtitleIssues(cues)[selected]; }
    updateSummary(); preview(); persist();
  }
  async function importFile(file) {
    if (!file) {
      if (!isTauri) { q('[data-subtitle-file]').click(); return; }
      const path = await choose({ multiple: false, filters: [{ name:'Subtitles', extensions:['srt','vtt'] }] });
      if (!path) return; file = { path, name: basename(path) };
    }
    const bytes = isTauri && file.path ? await invoke('read_file_bytes_limited', { path: file.path, maxBytes: 5 * 1024 * 1024 }) : await file.arrayBuffer();
    cues = parseSubtitles(new TextDecoder().decode(new Uint8Array(bytes))); selected = 0; page = 0; render(); persist(); message(file.name);
  }
  async function chooseMedia(file) {
    const token=++mediaRevision;
    if (!file) {
      if (!isTauri) { q('[data-media-file]').click(); return; }
      const path = await choose({ multiple: false, filters:[{name:'Media',extensions:['mp3','wav','m4a','aac','flac','ogg','mp4','mkv','webm','mov','avi']}] });
      if (!path) return; file = { path, name:basename(path) };
    }
    media.pause(); media.removeAttribute('src'); media.load(); if (mediaUrl) URL.revokeObjectURL(mediaUrl); mediaUrl = null; mediaFile = file;
    q('[data-media-status]').textContent = file.name; updateSummary();
    try {
      const blob = file.path ? new Blob([new Uint8Array(await invoke('read_file_bytes_limited',{path:file.path,maxBytes:64*1024*1024}))]) : file;
      if(token!==mediaRevision||signal.aborted)return;
      mediaUrl = URL.createObjectURL(blob); media.src = mediaUrl;
    } catch (error) { q('[data-media-status]').textContent = local(`${file.name}：预览读取失败（最多 64 MB），仍可尝试本地转写。`, `${file.name}: preview unavailable (64 MB limit); local transcription is still available.`); }
    updateSummary();
  }
  async function transcribe() {
    if (transcribing || !mediaFile?.path || !isTauri) return;
    await refreshTranscriptionModels?.();
    const ffmpeg = await ensureFfmpegAvailable?.(), model = activeTranscriptionModel?.();
    if (!ffmpeg || !model) {
      if (showDependencyGate) showDependencyGate({ openFn: transcribe, needsFfmpeg: !ffmpeg, needsModel: !model });
      else message(local('请先安装 FFmpeg 和本地转写模型。', 'Install FFmpeg and a local transcription model first.'), true);
      return;
    }
    transcribing = true; render(); q('[data-wb-action="import-subtitles"]').disabled = true; q('[data-wb-action="choose-media"]').disabled = true;
    const snapshot=JSON.stringify(cues);
    const task = taskCenter.begin({ label: `${tr('subtitles')} · ${mediaFile.name}`, tool:'subtitle-workbench' });
    let unlisten;
    try {
      unlisten = await listen('transcription-progress', event => { task.progress(event.payload?.progress ?? null); q('[data-media-status]').textContent = `${event.payload?.progress || 0}%`; });
      const result = await invoke('transcribe_media',{inputPath:mediaFile.path,outputDir:await getOutputDir('Subtitles'),language:q('[data-subtitle-language]').value});
      const bytes = await invoke('read_file_bytes_limited',{path:result.raw_srt_path,maxBytes:5*1024*1024});
      if(JSON.stringify(cues)!==snapshot)throw new Error(local(`字幕已在转写期间修改；转写结果保留在 ${result.raw_srt_path}，可手动导入。`,`Subtitles changed during transcription. Import the saved result manually: ${result.raw_srt_path}`));
      cues = parseSubtitles(new TextDecoder().decode(new Uint8Array(bytes))); selected = 0; page = 0; persist();
      task.finish({ outputs:[result.raw_srt_path] }); q('[data-media-status]').textContent = local('本地转写已完成，可继续编辑。','Local transcription complete. Subtitles are ready to edit.');
    } catch(error) {task.fail(error);message(error.message||error,true);}
    finally{unlisten?.();transcribing=false;q('[data-wb-action="import-subtitles"]').disabled=false;q('[data-wb-action="choose-media"]').disabled=false;render();}
  }
  async function exportFile(format) {
    const path=await saveText({text:exportSubtitles(cues,format),name:`ToolKnit_subtitles.${format}`,isTauri,invoke,getOutputDir,folder:'Subtitles'});message(path||local('字幕已下载。','Subtitles downloaded.'));
  }
  for(const field of ['[data-cue-start]','[data-cue-end]','[data-cue-text]'])q(field).addEventListener('input',updateCue,{signal});
  q('[data-subtitle-file]').addEventListener('change',event=>{const file=event.target.files[0];if(file)void importFile(file).catch(error=>message(error.message||error,true));event.target.value='';},{signal});
  q('[data-media-file]').addEventListener('change',event=>{const file=event.target.files[0];if(file)void chooseMedia(file).catch(error=>message(error.message||error,true));event.target.value='';},{signal});
  media.addEventListener('timeupdate',preview,{signal});media.addEventListener('error',()=>{if(mediaUrl)message(local('此音视频编码无法直接预览；可继续编辑或本地转写。','This codec cannot be previewed directly; subtitle editing and local transcription remain available.'),true);},{signal});
  signal.addEventListener('abort',()=>{clearTimeout(draftTimer);try{localStorage.setItem(DRAFT,JSON.stringify(cues));}catch{}media.pause();if(mediaUrl)URL.revokeObjectURL(mediaUrl);},{once:true});
  render();
  return {actions:{'import-subtitles':()=>importFile(),'choose-media':()=>chooseMedia(),transcribe,'export-srt':()=>exportFile('srt'),'export-vtt':()=>exportFile('vtt'),
    'add-cue':()=>{if(cues.length>=5000)return;const start=Math.max(0,Math.round(media.currentTime*1000),cues.at(-1)?.end||0);cues.push({id:crypto.randomUUID(),start,end:start+3000,text:local('新字幕','New subtitle'),settings:''});selected=cues.length-1;page=Math.floor(selected/50);render();persist();},
    'delete-cue':()=>{if(selected<0)return;cues.splice(selected,1);selected=Math.min(selected,cues.length-1);render();persist();},
    'split-cue':()=>{if(selected<0)return;const parts=splitSubtitle(cues[selected],Math.round(media.currentTime*1000));cues.splice(selected,1,...parts);render();persist();},
    'shift-cues':()=>{cues=shiftSubtitles(cues,Number(q('[data-cue-offset]').value));render();persist();},
    'previous-cues':()=>{page--;render();},'next-cues':()=>{page++;render();}
  },language:render,close:()=>{media.pause();return true;}};
}
