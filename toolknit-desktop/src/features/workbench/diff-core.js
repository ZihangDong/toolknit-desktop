/** Bounded line comparison: exact LCS for normal documents, explicit coarse fallback for large edits. */
export function compareDocuments(before, after, { ignoreSpace = false, maxCells = 4_000_000 } = {}) {
  const split = value => value ? String(value).replace(/\r\n?/g, '\n').split('\n') : [];
  const left = split(before), right = split(after);
  if (left.length > 10000 || right.length > 10000 || before.length > 1_000_000 || after.length > 1_000_000) throw new Error('对比最多支持每份 10000 行、100 万字符 / Maximum 10,000 lines and 1M characters per document');
  const normalize = value => ignoreSpace ? value.replace(/\s+/g, ' ').trim() : value;
  const a = left.map(normalize), b = right.map(normalize), edits = [];
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  for (let i = 0; i < prefix; i++) edits.push({ kind: 'equal', left: left[i], right: right[i], leftLine: i + 1, rightLine: i + 1 });
  const n = a.length - prefix - suffix, m = b.length - prefix - suffix;
  const coarse = n * m > maxCells;
  const deleted = i => edits.push({ kind: 'delete', left: left[i], right: '', leftLine: i + 1, rightLine: null });
  const added = j => edits.push({ kind: 'add', left: '', right: right[j], leftLine: null, rightLine: j + 1 });
  if (coarse) {
    for (let i = prefix; i < prefix + n; i++) deleted(i);
    for (let j = prefix; j < prefix + m; j++) added(j);
  } else {
    const width = m + 1, grid = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) grid[i * width + j] = a[prefix + i] === b[prefix + j]
      ? 1 + grid[(i + 1) * width + j + 1] : Math.max(grid[(i + 1) * width + j], grid[i * width + j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[prefix + i] === b[prefix + j]) {
        edits.push({ kind: 'equal', left: left[prefix + i], right: right[prefix + j], leftLine: prefix + i + 1, rightLine: prefix + j + 1 }); i++; j++;
      } else if (i < n && (j >= m || grid[(i + 1) * width + j] >= grid[i * width + j + 1])) deleted(prefix + i++);
      else added(prefix + j++);
    }
  }
  for (let i = 0; i < suffix; i++) {
    const x = a.length - suffix + i, y = b.length - suffix + i;
    edits.push({ kind: 'equal', left: left[x], right: right[y], leftLine: x + 1, rightLine: y + 1 });
  }
  return { edits, coarse, added: edits.filter(row => row.kind === 'add').length, removed: edits.filter(row => row.kind === 'delete').length };
}

export function exportComparison(result) {
  return ['--- 原文 / Before', '+++ 新文 / After', ...(result.coarse ? ['# Large change shown as a replaced block'] : []),
    ...result.edits.map(row => `${row.kind === 'add' ? '+' : row.kind === 'delete' ? '-' : ' '} ${row.kind === 'add' ? row.right : row.left}`)].join('\n');
}
