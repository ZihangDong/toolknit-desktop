import { createLifecycleScope } from '../../app/tool-lifecycle.js';
import { createModalSession } from '../../app/modal-runtime.js';
import { taskCenter } from '../../app/task-center.js';
import { tauriCorePromise, tauriEventPromise, loadTauriDialog } from '../../platform/tauri-runtime.js';
import { writeUniqueBinaryFile } from '../../platform/binary-output.js';
import { getLang, onLangChange, t } from '../../i18n.js';
import { createMeetingRecorder } from './recorder.js';
import { createMeetingDraftStore } from './draft.js';
import { prepareLiveTranscription } from './live-transcription.js';
import { MEETING_LIMITS, MEETING_MEDIA_EXTENSIONS, meetingClock, meetingError, meetingErrorCode, meetingFileName, meetingMessages,
  meetingTranscript, minutesMarkdown, parseMeetingMinutes, recordingExtension, validateMeetingFile,
  combineMeetingMinutes, meetingMinutesChunks } from './core.js';

export function createMeetingController({ overlay, isTauri = false, getOutputDir, displayFilesystemPath = String,
  requestAi, getAiApiKey = async () => '', getAiPlatformConfig = () => ({}), refreshIcons = () => {},
  ensureFfmpegAvailable = async () => false, refreshTranscriptionModels = async () => {}, activeTranscriptionModel = () => null,
  showDependencyGate = () => {}, invokeNative, listenNative, chooseFile, recorderOptions = {}, center = taskCenter } = {}) {
  const scope = createLifecycleScope(), q = id => overlay.querySelector(`#meeting${id}`), tr = (key, params) => t(`home.meeting.${key}`, params);
  const invoke = async (...args) => (invokeNative || (await tauriCorePromise).invoke)(...args);
  const listen = async (...args) => (listenNative || (await tauriEventPromise).listen)(...args);
  let owner = null, operation = null, recorder = null, source = null, audioUrl = null, activeTab = 'transcript', disposed = false;
  let recording = { state: 'idle', elapsed: 0 }, notice = null, outputs = [], stale = false, sourceMismatch = false;
  let liveCapture = null, liveStatus = '', liveHasText = false;
  const drafts = isTauri ? createMeetingDraftStore() : null;
  let draftWrite = Promise.resolve(), draftTimer, draftBusy = false, draftExists = false;
  let leaveTask = null, resumeLeaving = null, allowReload = false;
  const currentOwner = token => token && token === owner && !token.disposed;
  const current = op => operation === op && currentOwner(op?.owner) && !op.cancelled;
  const recordingBusy = () => recording.state !== 'idle';
  const modal = createModalSession({ root: overlay, background: document.querySelector('.app'), initialFocus: q('Record'), onClose: close });
  scope.use(modal.dispose);
  function setNotice(key, params = {}, error = false) { notice = { key, params, error }; renderNotice(); }
  function renderNotice() { q('Status').textContent = notice ? tr(notice.key, notice.params) : ''; q('Status').classList.toggle('is-error', !!notice?.error); }
  function render() {
    const busy = !!operation, finishing = liveStatus === 'finishing';
    const locked = busy || recordingBusy() || finishing || draftBusy;
    q('RecordState').textContent = tr(`recordStates.${recording.state}`); q('Timer').textContent = meetingClock(recording.elapsed);
    for (const id of ['Name','Pick','Reset','Language']) q(id).disabled = locked;
    q('LiveOption').hidden = !isTauri;
    q('Live').disabled = locked;
    q('LiveStatus').hidden = !liveStatus;
    const liveMessage = liveStatus ? tr(`liveStates.${liveStatus}`) : '';
    if (q('LiveStatus').textContent !== liveMessage) q('LiveStatus').textContent = liveMessage;
    q('Record').disabled = locked; q('Pause').disabled = !['recording','paused'].includes(recording.state);
    q('Pause').querySelector('span').textContent = tr(recording.state === 'paused' ? 'resume' : 'pause');
    q('Pause').setAttribute('aria-pressed', String(recording.state === 'paused'));
    q('Stop').disabled = !['requesting','recording','paused'].includes(recording.state);
    q('SaveAudio').disabled = locked || !source?.blob;
    q('Transcribe').disabled = locked || !source || !isTauri;
    q('Generate').disabled = locked || !q('Transcript').value.trim();
    q('Transcript').disabled = locked; q('Minutes').disabled = locked;
    q('ExportText').disabled = locked || !q('Transcript').value.trim();
    q('ExportMinutes').disabled = locked || !q('Minutes').value.trim();
    q('Copy').disabled = locked || !q(activeTab === 'transcript' ? 'Transcript' : 'Minutes').value.trim();
    q('Folder').hidden = !isTauri || !outputs.length; q('Folder').disabled = busy;
    q('Cancel').hidden = !busy && !finishing; q('Cancel').disabled = !!operation?.committing || !!operation?.cancelled;
    q('Stale').hidden = !stale && !sourceMismatch;
    q('Stale').textContent = tr(sourceMismatch ? 'sourceMismatch' : 'stale');
    overlay.querySelector('.meeting-progress').hidden = !busy;
    q('Source').textContent = source ? `${source.name}${source.path && source.blob ? ` · ${tr('saved')}` : ''}` : tr('noSource');
    for (const tab of ['transcript','minutes']) {
      const suffix = tab === 'transcript' ? 'Transcript' : 'Minutes';
      q(`${suffix}Panel`).hidden = activeTab !== tab;
      q(`${suffix}Tab`).setAttribute('aria-selected', String(activeTab === tab));
      q(`${suffix}Tab`).tabIndex = activeTab === tab ? 0 : -1;
    }
    q('Provider').textContent = tr('provider', { model: getAiPlatformConfig()?.model || tr('noModel') });
  }
  function translate() {
    overlay.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    overlay.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
    render(); renderNotice();
  }
  function progress(percent, key, params = {}) {
    if (!operation) return;
    q('ProgressFill').style.width = `${percent}%`; overlay.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(percent));
    operation.task.progress(percent, tr(key, params)); setNotice(key, params);
  }
  function begin(kind) {
    const op = { kind, owner, cancelled: false, committing: false, jobId: `meeting-${crypto.randomUUID()}`, abort: new AbortController(), outputs: [] };
    op.check = () => { if (!current(op)) throw meetingError('cancelled'); };
    operation = op;
    op.task = center.begin({ label: tr(kind === 'minutes' ? 'minutesTitle' : kind === 'transcribe' ? 'transcribe' : 'saving'), tool: 'meeting-notes', cancel: () => cancel(op) });
    render(); progress(0, kind === 'minutes' ? 'generating' : kind === 'transcribe' ? 'preparing' : 'saving');
    return op;
  }
  function end(op) { if (operation !== op) return; operation = null; if (currentOwner(op.owner)) render(); }
  function report(error, fallback) {
    const code = meetingErrorCode(error);
    setNotice(code === 'cancelled' ? 'cancelled' : `error.${code === 'failed' && fallback ? fallback : code}`, {}, code !== 'cancelled');
  }
  async function cancel(target = operation) {
    if (!target && liveStatus === 'finishing') {
      liveCapture?.dispose();
      liveCapture = null;
      liveStatus = 'incomplete';
      render();
      recordingSettled();
      return;
    }
    const op = target; if (!op || op.committing || op.cancelled) return;
    if (op.kind === 'transcribe' && op.started) {
      try {
        const accepted = await invoke('cancel_meeting_transcription', { jobId: op.jobId });
        if (!accepted) { op.committing = true; op.task.disableCancellation(); if (operation === op) render(); return; }
      } catch { if (operation === op) setNotice('error.cancel', {}, true); throw meetingError('cancel'); }
    }
    op.cancelled = true; op.abort.abort();
    if (operation === op) { setNotice('cancelling'); render(); }
  }
  function player(blob) {
    q('Audio').pause(); q('Audio').removeAttribute('src'); q('Audio').load();
    if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = null;
    q('Audio').hidden = !blob;
    if (blob) { audioUrl = URL.createObjectURL(blob); q('Audio').src = audioUrl; }
  }
  function hasDraft() {
    return drafts && (draftExists || source?.recorded || q('Name').value || q('Transcript').value || q('Minutes').value);
  }
  function persistDraft() {
    clearTimeout(draftTimer);
    const draft = {
      audio: source?.recorded ? { blob: source.blob, name: source.name } : null,
      title: q('Name').value,
      transcript: q('Transcript').value,
      minutes: q('Minutes').value,
      elapsed: recording.elapsed,
      language: q('Language').value,
      stale, sourceMismatch
    };
    const save = draftWrite.then(() => drafts.save(draft)).then(() => { draftExists = true; });
    draftWrite = save.catch(() => {});
    return save;
  }
  function queueDraft() {
    if (!hasDraft()) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const token = owner;
      void persistDraft().catch(() => {
        if (currentOwner(token)) setNotice('draftWriteFailed', {}, true);
      });
    }, 350);
  }
  function recordingSettled() {
    if (!recordingBusy() && liveStatus !== 'finishing') resumeLeaving?.();
  }
  function prepareToLeave() {
    if (!owner) return true;
    if (leaveTask) return leaveTask;
    if (draftBusy || operation?.committing) return false;
    if (recordingBusy() && recording.state !== 'stopping') { setNotice('stopFirst'); return false; }
    const waitingForAudio = recordingBusy() || liveStatus === 'finishing';
    if (!waitingForAudio && !hasDraft()) return true;
    const token = owner;
    leaveTask = (async () => {
      if (waitingForAudio) await new Promise(resolve => { resumeLeaving = resolve; });
      if (!currentOwner(token)) return false;
      if (!hasDraft()) return true;
      draftBusy = true;
      setNotice('draftSaving');
      render();
      try {
        await persistDraft();
        return currentOwner(token);
      } catch {
        if (currentOwner(token)) setNotice('draftWriteFailed', {}, true);
        return false;
      } finally {
        if (currentOwner(token)) { draftBusy = false; render(); }
      }
    })().finally(() => { leaveTask = null; resumeLeaving = null; });
    return leaveTask;
  }
  function newRecorder(token) {
    return createMeetingRecorder({ ...recorderOptions,
      async beforeRecord(stream, signal) {
        if (!isTauri || !q('Live').checked) return;
        try {
          const capture = await prepareLiveTranscription({
            stream, invoke, language: q('Language').value, signal,
            onStatus(status) {
              if (!currentOwner(token) || signal.aborted) return;
              liveStatus = status;
              render();
              recordingSettled();
            },
            onText(line) {
              if (!currentOwner(token) || signal.aborted) return false;
              const previous = liveHasText ? q('Transcript').value : '';
              const next = previous ? `${previous}\n${line}` : line;
              if (next.length > MEETING_LIMITS.transcriptChars) return false;
              const transcript = q('Transcript');
              const shouldFollow = !liveHasText || transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 48;
              transcript.value = next;
              if (shouldFollow) transcript.scrollTop = transcript.scrollHeight;
              if (!liveHasText) activeTab = 'transcript';
              stale = !!q('Minutes').value;
              sourceMismatch = false;
              liveHasText = true;
              if (source?.recorded && !recordingBusy()) queueDraft();
              render();
              return true;
            },
          });
          if (signal.aborted || !currentOwner(token)) { capture.dispose(); return; }
          liveCapture = capture;
          return capture;
        } catch {
          if (currentOwner(token) && !signal.aborted) { liveStatus = 'unavailable'; render(); }
        }
      },
      onState: value => { if (currentOwner(token)) { recording = value; render(); } },
      onError: error => {
        if (!currentOwner(token)) return;
        if (liveStatus && liveStatus !== 'unavailable') liveStatus = 'incomplete';
        report(error);
        render();
        recordingSettled();
      },
      onResult: value => {
        if (!currentOwner(token)) return;
        const name = `meeting-${new Date().toISOString().replace(/[:.]/g, '-')}.${recordingExtension(value.blob.type)}`;
        source = { blob: value.blob, name, size: value.blob.size, recorded: true }; player(value.blob);
        sourceMismatch = !liveHasText && !!q('Transcript').value.trim();
        recording = { state: 'idle', elapsed: value.elapsed }; render();
        setNotice(value.reason ? `recordEnded.${value.reason}` : 'recordReady');
        if (drafts) {
          if (!leaveTask || liveStatus === 'finishing') void persistDraft().catch(() => {
            if (currentOwner(token)) setNotice('draftWriteFailed', {}, true);
          });
        }
        recordingSettled();
      }
    });
  }
  async function importFile(file) {
    if (!owner || operation || recordingBusy() || liveStatus === 'finishing') return;
    const op = begin('import');
    try {
      if (file.path) { file = { ...file, size: Number(await invoke('get_file_size', { path: file.path })) }; op.check(); }
      const kind = validateMeetingFile(file);
      if (kind === 'text') {
        const bytes = file.path ? Uint8Array.from(await invoke('read_file_bytes_limited', { path: file.path, maxBytes: MEETING_LIMITS.transcriptBytes })) : new Uint8Array(await file.arrayBuffer()); op.check();
        q('Transcript').value = meetingTranscript(new TextDecoder('utf-8', { fatal: true }).decode(bytes), file.name, { timestamps: true });
        stale = !!q('Minutes').value; sourceMismatch = false; activeTab = 'transcript';
      } else { source = { name: file.name, size: file.size, path: file.path, blob: file.path ? null : file }; player(source.blob); sourceMismatch = !!q('Transcript').value.trim(); }
      liveStatus = '';
      setNotice('imported', { name: file.name }); op.task.finish();
      queueDraft();
    } catch (error) { op.task.fail(error); if (currentOwner(op.owner)) report(error); }
    finally { end(op); }
  }
  async function pick() {
    if (operation || recordingBusy() || !owner) return;
    if (!isTauri) { q('FileInput').click(); return; }
    const token = owner;
    try {
      const choose = chooseFile || ((options) => loadTauriDialog().then(api => api.open(options)));
      const path = await choose({ multiple: false, filters: [{ name: 'Audio / Video / Text', extensions: [...MEETING_MEDIA_EXTENSIONS, 'txt', 'srt'] }] });
      if (path && currentOwner(token)) await importFile({ path, name: path.split(/[\\/]/).pop() });
    } catch (error) { if (currentOwner(token)) report(error); }
  }
  async function saveBytes(bytes, name, op) {
    op.check();
    if (isTauri) {
      const directory = await getOutputDir('Meetings'); op.check();
      op.committing = true; op.task.disableCancellation(); render();
      return writeUniqueBinaryFile(invoke, { directory, fileName: name, bytes });
    }
    const url = URL.createObjectURL(new Blob([bytes]));
    const revoke = op.owner.use(() => URL.revokeObjectURL(url)); op.owner.timeout(revoke, 30000);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
    return '';
  }
  async function saveAudio() {
    if (!source?.blob || operation || recordingBusy()) return false;
    const snapshot = source, op = begin('save');
    try {
      const bytes = new Uint8Array(await snapshot.blob.arrayBuffer()); op.check();
      const path = await saveBytes(bytes, snapshot.name, op);
      op.task.finish({ outputs: path ? [path] : [] });
      if (currentOwner(op.owner)) { if (path) { snapshot.path = path; outputs = [path]; } setNotice(path ? 'audioSaved' : 'downloaded'); }
      return true;
    } catch (error) { op.task.fail(error); if (currentOwner(op.owner)) report(error); return false; }
    finally { end(op); }
  }
  async function transcribe() {
    if (!source || operation || recordingBusy() || !isTauri || !owner) return;
    const snapshot = source, token = owner;
    if (!snapshot.path && (!await saveAudio() || !currentOwner(token) || source !== snapshot || !snapshot.path)) return;
    if (operation || !currentOwner(token)) return;
    const op = begin('transcribe'); let unlisten;
    try {
      await refreshTranscriptionModels(); op.check();
      const engine = await invoke('check_transcription_engine'); op.check();
      const ffmpeg = await ensureFfmpegAvailable(); op.check();
      const model = activeTranscriptionModel();
      if (!engine || !ffmpeg || !model) {
        if (engine) showDependencyGate({ needsFfmpeg: !ffmpeg, needsModel: !model, openFn: () => {} });
        throw meetingError('dependencies');
      }
      unlisten = await listen('meeting-transcription-progress', event => {
        const value = event.payload || {};
        if (value.jobId !== op.jobId || !current(op)) return;
        if (value.phase === 'publishing' || value.phase === 'complete') { op.committing = true; op.task.disableCancellation(); render(); }
        progress(Number(value.progress) || 0, 'localProgress', { percent: Number(value.progress) || 0 });
      }); op.check();
      const directory = await getOutputDir('Meetings'); op.check(); op.started = true;
      const result = await invoke('transcribe_meeting_media', { inputPath: snapshot.path, outputDir: directory, language: q('Language').value, jobId: op.jobId });
      op.outputs = [result.raw_txt_path, result.raw_srt_path, result.raw_json_path].filter(Boolean);
      if (currentOwner(op.owner)) outputs = op.outputs;
      op.check(); op.committing = true; op.task.disableCancellation(); render();
      const subtitles = result.raw_srt_path;
      const bytes = await invoke('read_file_bytes_limited', { path: subtitles || result.raw_txt_path, maxBytes: MEETING_LIMITS.transcriptBytes }); op.check();
      q('Transcript').value = meetingTranscript(new TextDecoder().decode(Uint8Array.from(bytes)), subtitles ? 'transcript.srt' : 'transcript.txt', { timestamps: true });
      liveStatus = '';
      stale = !!q('Minutes').value; sourceMismatch = false; activeTab = 'transcript'; setNotice('transcribed'); op.task.finish({ outputs: op.outputs });
      queueDraft();
    } catch (error) {
      const actual = op.cancelled ? meetingError('cancelled') : error;
      op.task.fail(actual, { outputs: op.outputs }); if (currentOwner(op.owner)) report(actual, 'transcription');
    } finally { unlisten?.(); end(op); }
  }
  async function generate() {
    if (operation || recordingBusy() || !owner) return;
    const text = q('Transcript').value, title = q('Name').value, language = getLang();
    const op = begin('minutes');
    try {
      const chunks = meetingMinutesChunks(text);
      const provider = { ...getAiPlatformConfig() };
      const key = await getAiApiKey(); op.check(); if (!key || !provider.url || !provider.model || !requestAi) throw meetingError('key');
      const parts = [];
      for (const [index, chunk] of chunks.entries()) {
        if (chunks.length > 1) progress(Math.floor(index / chunks.length * 100), 'generatingPart', { current: index + 1, total: chunks.length });
        const messages = meetingMessages(chunk, title, language);
        const response = await requestAi(messages, op.abort.signal, 6000, { expectedProvider: provider, temperature: 0, timeoutMs: 90000 });
        op.check();
        if (['url','model','allowPrivateHttp'].some(field => (getAiPlatformConfig()?.[field] || '') !== (provider[field] || ''))) throw meetingError('provider');
        parts.push(parseMeetingMinutes(response, chunk));
      }
      const draft = minutesMarkdown(combineMeetingMinutes(parts), title, language);
      if (draft.length > MEETING_LIMITS.minutesChars) throw meetingError('minutes-large');
      q('Minutes').value = draft; activeTab = 'minutes'; stale = false;
      op.task.finish(); setNotice('generated');
      queueDraft();
    } catch (error) {
      const actual = op.cancelled ? meetingError('cancelled') : error;
      op.task.fail(meetingError(meetingErrorCode(actual))); if (currentOwner(op.owner)) report(actual, 'ai');
    } finally { end(op); }
  }
  async function exportText(kind) {
    if (operation || recordingBusy() || !owner) return;
    const value = q(kind === 'minutes' ? 'Minutes' : 'Transcript').value; if (!value.trim()) return;
    const op = begin('save');
    try {
      const path = await saveBytes(new TextEncoder().encode(value), meetingFileName(q('Name').value || 'meeting', kind === 'minutes' ? 'md' : 'txt'), op);
      op.task.finish({ outputs: path ? [path] : [] });
      if (currentOwner(op.owner)) { if (path) outputs = [path]; setNotice(path ? 'exported' : 'downloaded'); }
    } catch (error) { op.task.fail(error); if (currentOwner(op.owner)) report(error); }
    finally { end(op); }
  }
  function reset() {
    if (operation || recordingBusy()) return;
    source = null; outputs = []; stale = false; sourceMismatch = false; activeTab = 'transcript'; player(null);
    q('Name').value = ''; q('Transcript').value = ''; q('Minutes').value = ''; recording = { state: 'idle', elapsed: 0 };
    q('Language').value = 'auto'; q('Live').checked = false;
    liveStatus = ''; liveHasText = false; notice = null; render(); renderNotice();
  }
  for (const [id, fn] of [['Pick', pick], ['SaveAudio', saveAudio], ['Transcribe', transcribe], ['Generate', generate], ['Cancel', cancel],
    ['ExportText', () => exportText('transcript')], ['ExportMinutes', () => exportText('minutes')]]) scope.event(q(id), 'click', () => { void Promise.resolve().then(fn).catch(error => report(error)); });
  scope.event(q('Record'), 'click', () => {
    if (operation || recordingBusy() || liveStatus === 'finishing' || draftBusy) return;
    liveStatus = ''; liveHasText = false;
    q('Audio').pause();
    void recorder?.start();
  });
  scope.event(q('Pause'), 'click', () => recorder?.pause()); scope.event(q('Stop'), 'click', () => recorder?.stop());
  scope.event(q('Reset'), 'click', async () => {
    if (operation || recordingBusy() || draftBusy) return;
    clearTimeout(draftTimer);
    if (drafts) {
      draftBusy = true; render();
      try { await draftWrite; await drafts.clear(); draftExists = false; }
      catch { setNotice('draftWriteFailed', {}, true); return; }
      finally { draftBusy = false; render(); }
    }
    reset();
  });
  scope.event(q('JumpEditor'), 'click', () => { overlay.querySelector('.meeting-editor').scrollIntoView({ block: 'start' }); q(activeTab === 'transcript' ? 'Transcript' : 'Minutes').focus({ preventScroll: true }); });
  scope.event(q('JumpRecord'), 'click', () => { q('Title').scrollIntoView({ block: 'start' }); q(recordingBusy() ? 'Stop' : 'Record').focus({ preventScroll: true }); });
  scope.event(overlay.querySelector('[data-meeting-close]'), 'click', close);
  scope.event(q('FileInput'), 'change', () => { const file = q('FileInput').files?.[0]; q('FileInput').value = ''; if (file) void importFile(file); });
  scope.event(q('Transcript'), 'input', () => { stale = !!q('Minutes').value; sourceMismatch = false; render(); queueDraft(); });
  for (const id of ['Name', 'Minutes', 'Language']) scope.event(q(id), 'change', queueDraft);
  for (const id of ['Name', 'Minutes']) scope.event(q(id), 'input', queueDraft);
  scope.event(q('Copy'), 'click', async () => {
    try { await navigator.clipboard.writeText(q(activeTab === 'transcript' ? 'Transcript' : 'Minutes').value); setNotice('copied'); }
    catch { setNotice('error.copy', {}, true); }
  });
  for (const tab of ['transcript','minutes']) scope.event(q(tab === 'transcript' ? 'TranscriptTab' : 'MinutesTab'), 'click', () => { activeTab = tab; render(); });
  scope.event(overlay.querySelector('.meeting-tabs'), 'keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault();
    activeTab = event.key === 'Home' ? 'transcript' : event.key === 'End' ? 'minutes' : activeTab === 'minutes' ? 'transcript' : 'minutes'; render(); q(activeTab === 'transcript' ? 'TranscriptTab' : 'MinutesTab').focus();
  });
  scope.event(q('Folder'), 'click', async () => {
    const path = outputs[0]; if (!path) return;
    try { await invoke('open_path', { path }); } catch { setNotice('error.folder', {}, true); }
  });
  scope.use(onLangChange(translate)); scope.event(window, 'pagehide', teardown);
  if (drafts) {
    scope.event(window, 'toolknit:tray-quit', event => { event.detail.ready = Promise.resolve(prepareToLeave()); });
    let reloadTask = null;
    const reload = () => {
      reloadTask ??= Promise.resolve(prepareToLeave()).then(ready => {
        if (!ready) return;
        allowReload = true;
        window.location.reload();
      }).finally(() => { reloadTask = null; });
    };
    if (window.navigation) scope.event(window.navigation, 'navigate', event => {
      if (!owner || allowReload || event.navigationType !== 'reload' || !event.cancelable) return;
      event.preventDefault();
      reload();
    });
    scope.event(window, 'keydown', event => {
      if (!owner || (event.key !== 'F5' && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r'))) return;
      event.preventDefault();
      reload();
    }, true);
  }
  function open() {
    if (disposed || owner) return false;
    owner = createLifecycleScope(); recorder = newRecorder(owner); modal.open(); reset(); translate(); refreshIcons();
    draftExists = false;
    if (!isTauri) setNotice('browserMode');
    else {
      const token = owner;
      draftBusy = true; render();
      void drafts.load().then(draft => {
        if (!currentOwner(token) || !draft) return;
        draftExists = true;
        q('Name').value = draft.title;
        q('Transcript').value = draft.transcript;
        q('Minutes').value = draft.minutes;
        q('Language').value = draft.language;
        stale = draft.stale;
        sourceMismatch = draft.sourceMismatch;
        recording.elapsed = draft.elapsed;
        if (draft.audio?.blob instanceof Blob) {
          source = { ...draft.audio, size: draft.audio.blob.size, recorded: true };
          player(source.blob);
        }
        setNotice('draftRestored');
      }).catch(() => {
        if (currentOwner(token)) setNotice('draftReadFailed', {}, true);
      }).finally(() => {
        if (currentOwner(token)) { draftBusy = false; render(); }
      });
    }
  }
  function close() {
    const ready = prepareToLeave();
    if (typeof ready === 'boolean') return ready && teardown();
    return ready.then(saved => saved && teardown());
  }
  function teardown() {
    if (!owner) return true;
    clearTimeout(draftTimer);
    resumeLeaving?.();
    draftBusy = false;
    if (operation && !operation.committing) {
      const pending = operation;
      void cancel(pending).catch(() => {}); pending.cancelled = true; pending.abort.abort();
      if (!pending.started) pending.task.fail(meetingError('cancelled'), { outputs: pending.outputs });
    }
    operation = null;
    owner?.dispose(); owner = null; recorder?.dispose(); recorder = null;
    liveCapture?.dispose(); liveCapture = null; liveStatus = ''; liveHasText = false;
    player(null); source = null; outputs = [];
    recording = { state: 'idle', elapsed: 0 }; modal.close();
    q('Name').value = ''; q('Transcript').value = ''; q('Minutes').value = ''; q('Source').textContent = '';
    return true;
  }
  translate(); refreshIcons();
  return { open, close, importFile, get busy() { return !!operation || recordingBusy() || liveStatus === 'finishing' || draftBusy; },
    dispose() { if (disposed) return; teardown(); disposed = true; scope.dispose(); } };
}
