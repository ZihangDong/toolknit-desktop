export function historyTimeLabel(timestamp, lang = 'zh', detailed = false, offsetMinutes = null) {
  const locale = lang === 'zh' ? 'zh-CN' : 'en-GB';
  const offset = detailed && Number.isFinite(offsetMinutes) ? offsetMinutes : null;
  const date = new Date(timestamp + (offset === null ? 0 : offset * 60000));
  const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', ...(offset === null ? {} : { timeZone: 'UTC' }) };
  if (!detailed) return date.toLocaleTimeString(locale, options);
  const sign = offset >= 0 ? '+' : '-';
  const zone = offset === null ? '' : ` UTC${sign}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
  return `${date.toLocaleString(locale, { ...options, year: 'numeric', month: '2-digit', day: '2-digit', fractionalSecondDigits: 3 })}${zone}`;
}
export function clipboardErrorKey(error) {
  if(String(error?.message||error)==='screenshot:viewer-limit')return 'viewerLimit';
  if(String(error?.message||error)==='screenshot:image-too-large')return 'tooLarge';
  const code = String(error?.message || error).replace(/^clipboard:/, '');
  const library={ 'invalid-note':'invalidNote','note-capacity':'noteCapacity','invalid-phrase':'invalidPhrase','phrase-duplicate':'phraseDuplicate','phrase-capacity':'phraseCapacity','phrase-text-only':'phraseTextOnly' };
  if(library[code])return library[code];
  return ({ 'desktop-only': 'desktopOnly', busy: 'busy', capacity: 'capacity', 'too-large': 'tooLarge', 'files-missing': 'filesMissing', 'key-failed': 'keyFailed', 'key-missing':'keyMissing', 'key-invalid':'keyInvalid', 'key-unavailable':'keyUnavailable', 'key-mismatch':'keyMismatch', 'key-storage':'keyStorage', 'storage-busy':'storageBusy', 'record-damaged': 'recordDamaged', 'not-found': 'notFound', 'invalid-settings': 'invalidSettings', changed: 'changed', 'image-invalid': 'imageInvalid' })[code] || 'operationFailed';
}
