export function searchTextRecords(records, query, limit = 100) {
  const needle = String(query).trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  return records.flatMap(record => {
    const position = record.text.toLocaleLowerCase().indexOf(needle);
    if (position < 0 && !record.name.toLocaleLowerCase().includes(needle)) return [];
    const start = Math.max(0, position - 70);
    return [{ ...record, snippet: record.text.slice(start, start + 220), text: undefined }];
  }).slice(0, limit);
}
export function highlightedParts(text, query) {
  const needle = String(query).toLocaleLowerCase(), source = String(text), lowered = source.toLocaleLowerCase(), parts = [];
  if (!needle) return [{ text: source, match: false }];
  let start = 0, index;
  while ((index = lowered.indexOf(needle, start)) >= 0) {
    if (index > start) parts.push({ text: source.slice(start, index), match: false });
    parts.push({ text: source.slice(index, index + needle.length), match: true }); start = index + needle.length;
  }
  if (start < source.length) parts.push({ text: source.slice(start), match: false });
  return parts;
}
