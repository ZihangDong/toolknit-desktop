export function selectPdfSplitRange(pages, value) {
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const input = String(value ?? '').normalize('NFKC').trim();
  if (!input) fail('rangeEmpty');
  const match = /^(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?$/.exec(input);
  if (!match) fail('rangeFormat');
  const start = Number(match[1]), end = Number(match[2] ?? match[1]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end > pages.length) fail('rangeBounds');
  if (end < start) fail('rangeOrder');
  let added = 0;
  for (let index = start - 1; index < end; index++) {
    if (!pages[index].selected) added++;
    pages[index].selected = true;
  }
  return { start, end, added, selected: pages.filter(page => page.selected).length };
}
