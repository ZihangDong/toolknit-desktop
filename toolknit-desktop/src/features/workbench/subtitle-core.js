export function parseSubtitleTime(value) {
  const text = String(value).trim();
  const match = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[,.](\d{3})$/.exec(text);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw new Error(`无效时间 / Invalid time: ${text}`);
  return ((Number(match[1] || 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
}
export function subtitleTime(ms, vtt = false) {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 359999999) throw new Error('字幕时间超出范围 / Subtitle time is out of range');
  const hours = Math.floor(ms / 3600000), minutes = Math.floor(ms / 60000) % 60, seconds = Math.floor(ms / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${vtt ? '.' : ','}${String(ms % 1000).padStart(3, '0')}`;
}
export function parseSubtitles(value) {
  const source = String(value).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (source.length > 5_000_000) throw new Error('字幕文件过大 / Subtitle file is too large');
  const vtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(source), cues = [];
  const blocks = source.replace(/^WEBVTT[^\n]*(?:\n[^\n]+)*?\n\n/, '').split(/\n[ \t]*\n/);
  for (const block of blocks) {
    if (!block.trim() || vtt && /^(NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue;
    const lines = block.split('\n');
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) { if (/^WEBVTT/.test(block)) continue; throw new Error('字幕块缺少时间轴 / Subtitle cue has no timing'); }
    const match = /^\s*(\S+)\s+-->\s+(\S+)(?:\s+(.*))?$/.exec(lines[index]);
    if (!match) throw new Error('字幕时间轴无效 / Invalid subtitle timing');
    const cue = { id: `cue-${cues.length + 1}`, start: parseSubtitleTime(match[1]), end: parseSubtitleTime(match[2]), text: lines.slice(index + 1).join('\n').trim(), settings: vtt ? match[3] || '' : '' };
    if (cue.end <= cue.start || !cue.text) throw new Error('字幕结束时间须晚于开始时间且文字不能为空 / Each cue needs text and an end after its start');
    cues.push(cue);
    if (cues.length > 5000) throw new Error('最多 5000 条字幕 / Maximum 5,000 cues');
  }
  if (!cues.length) throw new Error('未找到字幕 / No subtitle cues found');
  return cues;
}
export function subtitleIssues(cues) {
  return cues.map((cue, index) => {
    if (!Number.isSafeInteger(cue.start) || !Number.isSafeInteger(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > 359999999 || !cue.text.trim() || /\n\s*\n|-->/.test(cue.text)) return 'invalid';
    if (index > 0 && cue.start < cues[index - 1].end) return 'overlap';
    return '';
  });
}
export function exportSubtitles(cues, format = 'srt') {
  if(cues.length>5000)throw new Error('最多 5000 条字幕 / Maximum 5,000 cues');
  if(!['srt','vtt'].includes(format))throw new Error('Invalid subtitle format');
  if (!cues.length || subtitleIssues(cues).includes('invalid')) throw new Error('请修正无效的字幕时间和空文字 / Fix invalid timings and empty text');
  const vtt = format === 'vtt';
  return (vtt ? 'WEBVTT\n\n' : '') + cues.map((cue, i) => `${i + 1}\n${subtitleTime(cue.start, vtt)} --> ${subtitleTime(cue.end, vtt)}${vtt && cue.settings ? ` ${cue.settings}` : ''}\n${cue.text}`).join('\n\n') + '\n';
}
export function shiftSubtitles(cues, offset) {
  if(subtitleIssues(cues).includes('invalid'))throw new Error('请先修正无效字幕 / Fix invalid cues before shifting');
  if (!Number.isSafeInteger(offset) || Math.abs(offset) > 3600000) throw new Error('偏移须为 ±3600000 毫秒内的整数 / Offset must be an integer within ±3,600,000 ms');
  const shifted = cues.map(cue => ({ ...cue, start: cue.start + offset, end: cue.end + offset }));
  if (subtitleIssues(shifted).includes('invalid')) throw new Error('偏移后时间超出范围 / Shift would produce invalid timings');
  return shifted;
}
export function splitSubtitle(cue, at) {
  if (!Number.isSafeInteger(at) || !Number.isSafeInteger(cue.start) || !Number.isSafeInteger(cue.end) || at <= cue.start || at >= cue.end) throw new Error('播放位置必须位于字幕区间内 / Playhead must be inside the cue');
  return [{ ...cue, end: at }, { ...cue, id: `${cue.id}-split-${at}`, start: at }];
}
