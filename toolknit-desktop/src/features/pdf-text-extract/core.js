import { detectRuledTables } from './table-grid.js';

const HAN_PATTERN = /\p{Script=Han}/u;
const LIST_PATTERN = /^(?:([\u2022\u2023\u25e6\u25aa\u25cf\u25cb\u25a0\u25a1\u2043]|[-*+])\s+|(\d{1,3}[.)]\s+)|((?:-\s*)?\[[ xX]\]\s+))/;
const HEADING_PREFIX_PATTERN = /^(#{1,6})\s+(.+)$/;

export const PDF_TEXT_LIMITS = Object.freeze({
  maxDocumentBytes: 150 * 1024 * 1024,
  maxPages: 300,
  maxItemsPerPage: 100_000,
  maxCharacters: 2_000_000
});

export class PdfTextExtractionCancelledError extends Error {
  constructor() {
    super('pdf-text-extract:cancelled');
    this.name = 'PdfTextExtractionCancelledError';
  }
}

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b\ufeff]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function startsOrEndsWithHan(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return HAN_PATTERN.test(text[0]) || HAN_PATTERN.test(text[text.length - 1]);
}

function joinText(left, right, gap = 0) {
  const a = String(left || '').trimEnd();
  const b = String(right || '').trimStart();
  if (!a) return b;
  if (!b) return a;
  if (/\s$/.test(String(left)) || /^\s/.test(String(right))) return `${a} ${b}`;
  if (startsOrEndsWithHan(a) && startsOrEndsWithHan(b)) return `${a}${b}`;
  if (gap > 1.5 || /[A-Za-z0-9)]$/.test(a) && /^[A-Za-z0-9(]/.test(b)) return `${a} ${b}`;
  return `${a}${b}`;
}

function median(values) {
  const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function itemGeometry(item, index) {
  const transform = Array.isArray(item?.transform) ? item.transform : [];
  const hasTransform = transform.length >= 6;
  const a = numberOr(transform[0], 1);
  const b = numberOr(transform[1]);
  const c = numberOr(transform[2]);
  const d = numberOr(transform[3], 1);
  const fontSize = Math.max(1, numberOr(item?.height, 0) || Math.hypot(b, d) || 10);
  const width = Math.max(0, numberOr(item?.width, 0));
  const x = hasTransform ? numberOr(transform[4]) : 0;
  // PDF.js uses a bottom-left origin; descending baselines order horizontal text.
  const baseline = hasTransform ? numberOr(transform[5]) : -index * fontSize * 1.6;
  const text = String(item?.str ?? '');
  return {
    text,
    x,
    right: x + width,
    baseline,
    fontSize,
    width,
    fontName: String(item?.fontName || ''),
    hasEOL: Boolean(item?.hasEOL),
    index
  };
}

export function normalizePdfTextItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .slice(0, PDF_TEXT_LIMITS.maxItemsPerPage)
    .map(itemGeometry)
    .filter(item => item.text.trim());
}

function clusterRows(items, tolerance) {
  const rows = [];
  for (const item of [...items].sort((a, b) => b.baseline - a.baseline || a.x - b.x || a.index - b.index)) {
    let row = rows.find(candidate => Math.abs(candidate.baseline - item.baseline) <= tolerance);
    if (!row) {
      row = { baseline: item.baseline, items: [] };
      rows.push(row);
    }
    row.items.push(item);
    row.baseline = (row.baseline * (row.items.length - 1) + item.baseline) / row.items.length;
  }
  return rows
    .sort((a, b) => b.baseline - a.baseline)
    .map(row => ({ ...row, items: row.items.sort((a, b) => a.x - b.x || a.index - b.index) }));
}

function splitRowSegments(row, baseSize) {
  const segments = [];
  for (const item of row.items) {
    const last = segments.at(-1);
    if (!last || item.x - last.right > Math.max(12, baseSize * 1.6)) {
      segments.push({ x: item.x, right: item.right, items: [item] });
    } else {
      last.items.push(item);
      last.right = Math.max(last.right, item.right);
    }
  }
  return segments;
}

function tableCellsForRow(row, boundaries) {
  const groups = Array.from({ length: boundaries.length + 1 }, () => []);
  for (const item of row.items) {
    let column = 0;
    while (column < boundaries.length && item.x >= boundaries[column]) column += 1;
    groups[column].push(item);
  }
  return groups.map(group => {
    let text = '', right = 0;
    for (const item of group) {
      text = joinText(text, item.text, text ? item.x - right : 0);
      right = Math.max(right, item.right);
    }
    return cleanText(text);
  });
}

// Unruled tables need repeated local column alignment. Never infer a grid
// from all x positions on a page: that turns multi-column prose into tables.
function detectTableRegions(rows, baseSize) {
  const regions = [];
  for (let start = 0; start < rows.length - 1; start++) {
    const seed = splitRowSegments(rows[start], baseSize);
    if (seed.length < 3 || seed.length > 16) continue;
    const boundaries = seed.slice(1).map((cell, i) => (seed[i].right + cell.x) / 2);
    const logical = [], physical = new Map();
    let strong = 0, last = start - 1;
    for (let i = start; i < rows.length; i++) {
      const row = rows[i];
      if (i > start && rows[i - 1].baseline - row.baseline > baseSize * 4) break;
      if (row.items.some(item => item.x < seed[0].x - baseSize
        || boundaries.some(boundary => item.x < boundary - baseSize && item.right > boundary + baseSize))) break;
      const cells = tableCellsForRow(row, boundaries);
      const occupied = cells.filter(Boolean).length;
      const isStrong = occupied >= Math.max(3, seed.length - 1);
      if (isStrong) {
        strong++;
        logical.push({ cells, rowIndex: i });
        physical.set(i, { cells, tableId: regions.length });
      } else {
        // A continuation must belong to an existing interior cell, with tight
        // leading; isolated captions and footers terminate the candidate.
        if (!logical.length || cells[0] || cells.at(-1)
          || rows[i - 1].baseline - row.baseline > baseSize * 1.6) break;
        cells.forEach((cell, c) => {
          if (cell) logical.at(-1).cells[c] += (logical.at(-1).cells[c] ? '\n' : '') + cell;
        });
        physical.set(i, { skip: true, tableId: regions.length });
      }
      last = i;
    }
    if (strong < 2) continue;
    regions.push({ id: regions.length, rows: logical, physicalRows: physical, anchors: seed.map(cell => cell.x) });
    start = last;
  }
  return regions;
}

function findColumnBoundaries(items, pageWidth, baseSize) {
  if (items.length < 8) return [];
  const starts = [...new Set(items.map(item => Math.round(item.x * 10) / 10))].sort((a, b) => a - b);
  const threshold = Math.max(48, baseSize * 6);
  const candidates = [];
  for (let index = 1; index < starts.length; index += 1) {
    const gap = starts[index] - starts[index - 1];
    if (gap < threshold) continue;
    const boundary = (starts[index] + starts[index - 1]) / 2;
    if (pageWidth > 0 && (boundary < pageWidth * 0.22 || boundary > pageWidth * 0.78)) continue;
    const left = items.filter(item => item.x < boundary && item.right <= boundary + baseSize * 1.5).length;
    const right = items.filter(item => item.x >= boundary).length;
    if (left < 3 || right < 3) continue;
    const rows = clusterRows(items, Math.max(2, baseSize * 0.55));
    const rowsOnBothSides = rows.filter(row => {
      const hasLeft = row.items.some(item => item.x < boundary && item.right <= boundary + baseSize * 1.5);
      const hasRight = row.items.some(item => item.x >= boundary);
      return hasLeft && hasRight;
    }).length;
    candidates.push({ boundary, gap, rowsOnBothSides });
  }
  const viable = candidates.filter(candidate => candidate.rowsOnBothSides >= 2);
  if (!viable.length) return [];
  viable.sort((a, b) => b.rowsOnBothSides - a.rowsOnBothSides || b.gap - a.gap);
  return [viable[0].boundary];
}

function columnForItem(item, boundaries, baseSize) {
  for (let index = 0; index < boundaries.length; index += 1) {
    const boundary = boundaries[index];
    if (item.x < boundary && item.right > boundary + baseSize * 1.5) return -1;
    if (item.x < boundary) return index;
  }
  return boundaries.length;
}

function splitCells(items, baseSize) {
  const cells = [];
  let current = null;
  for (const item of items) {
    if (!current) {
      current = { text: item.text.trim(), x: item.x, right: item.right };
      cells.push(current);
      continue;
    }
    const gap = item.x - current.right;
    const separate = gap > Math.max(16, baseSize * 2.6);
    if (separate) {
      current = { text: item.text.trim(), x: item.x, right: item.right };
      cells.push(current);
    } else {
      current.text = joinText(current.text, item.text, gap);
      current.right = Math.max(current.right, item.right);
    }
  }
  return cells.filter(cell => cell.text).map(cell => cell.text);
}

function buildLine(items, column, baseSize) {
  let text = '';
  let right = 0;
  let fontSize = baseSize;
  let bold = false;
  for (const item of items) {
    const gap = text ? item.x - right : 0;
    text = joinText(text, item.text, gap);
    right = Math.max(right, item.right);
    fontSize = Math.max(fontSize, item.fontSize);
    bold ||= /bold|black|semibold|demi/i.test(item.fontName);
  }
  return {
    text: cleanText(text),
    cells: splitCells(items, baseSize),
    baseline: median(items.map(item => item.baseline)),
    fontSize,
    bold,
    column,
    items
  };
}

export function reconstructPdfPage(items = [], {
  pageNumber = 1,
  pageWidth = 0,
  pageHeight = 0,
  rules = []
} = {}) {
  const normalized = normalizePdfTextItems(items);
  if (!normalized.length) {
    return {
      pageNumber,
      pageWidth: numberOr(pageWidth),
      pageHeight: numberOr(pageHeight),
      lines: [],
      text: '',
      chars: 0,
      hasText: false,
      columns: 0,
      warnings: ['no-text-layer']
    };
  }
  const baseSize = Math.max(1, median(normalized.map(item => item.fontSize)) || 10);
  const ruledTables = detectRuledTables(normalized, rules);
  if (ruledTables.length) {
    const consumed = new Set(ruledTables.flatMap(table => [...table.consumed]));
    const lines = clusterRows(normalized.filter(item => !consumed.has(item)), Math.max(2, baseSize * .45))
      .map(row => buildLine(row.items, 0, baseSize));
    ruledTables.forEach((table, tableId) => table.rows.forEach((cells, rowIndex) => lines.push({
      cells, text: cells.join(' '), isTableRow: true, tableId, column: 0,
      baseline: table.top - rowIndex * .001, fontSize: baseSize, bold: false
    })));
    lines.sort((a,b) => b.baseline-a.baseline);
    const text = normalized.map(item => item.text).join(' ');
    return { pageNumber, pageWidth, pageHeight, lines, text, chars: text.length,
      hasText: true, columns: 1, tables: ruledTables.map(({consumed, ...table}) => table),
      warnings: ruledTables.some(table => table.merged) ? ['merged-cells-flattened'] : [] };
  }
  const rowGroups = clusterRows(normalized, Math.max(2, baseSize * 0.58));
  const tableRegions = detectTableRegions(rowGroups, baseSize);
  const tableRows = new Map();
  tableRegions.forEach(region => region.physicalRows.forEach((value, rowIndex) => {
    tableRows.set(rowIndex, value);
  }));
  let lines = [];
  let columns = [];
  if (tableRegions.length) {
    // A page containing a table is read row-first. This prevents a table's
    // left and right cells from being separated into newspaper columns.
    for (const [rowIndex, row] of rowGroups.entries()) {
      const tableRow = tableRows.get(rowIndex);
      if (tableRow?.skip) continue;
      const line = buildLine(row.items, 0, baseSize);
      if (tableRow) {
        line.cells = tableRow.cells;
        line.text = tableRow.cells.filter(Boolean).join(' ');
        line.isTableRow = true;
        line.tableId = tableRow.tableId;
      }
      lines.push(line);
    }
    columns = [0];
  } else {
    const boundaries = findColumnBoundaries(normalized, numberOr(pageWidth), baseSize);
    const columnItems = new Map();
    for (const item of normalized) {
      const column = columnForItem(item, boundaries, baseSize);
      const list = columnItems.get(column) || [];
      list.push(item);
      columnItems.set(column, list);
    }
    columns = [...columnItems.keys()].sort((a, b) => a - b);
    for (const column of columns) {
      const rows = clusterRows(columnItems.get(column), Math.max(2, baseSize * 0.58));
      for (const row of rows) lines.push(buildLine(row.items, column, baseSize));
    }
  }
  const text = lines.map(line => line.text).filter(Boolean).join('\n');
  return {
    pageNumber,
    pageWidth: numberOr(pageWidth),
    pageHeight: numberOr(pageHeight),
    lines,
    tables: tableRegions.map(region => ({
      id: region.id,
      rows: region.rows.map(row => row.cells.map(cell => cell || '')),
      columns: region.anchors.length
    })),
    text,
    chars: text.length,
    hasText: Boolean(text),
    columns: Math.max(1, columns.filter(column => column >= 0).length),
    warnings: text ? [] : ['no-text-layer']
  };
}

function escapeTableCell(value) {
  return String(value || '').split(/\r?\n/).map(escapeMarkdownText).join('<br>').trim() || ' ';
}

function escapeMarkdownText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_~\[\]{}|$])/g, '\\$1')
    .replace(/^(\s*)([#>])/g, '$1\\$2');
}

function paragraphHasBreak(previous, next, baseSize) {
  if (!previous || !next || previous.column !== next.column) return true;
  const gap = Math.abs(numberOr(previous.baseline) - numberOr(next.baseline));
  const lineSize = Math.max(1, numberOr(previous.fontSize, baseSize), numberOr(next.fontSize, baseSize));
  return gap > Math.max(18, lineSize * 1.8);
}

function formatParagraph(lines) {
  return lines.map(line => escapeMarkdownText(line.text)).filter(Boolean).join('  \n');
}

function listText(text) {
  const value = String(text || '').trim();
  if (/^(?:[\u2022\u2023\u25e6\u25aa\u25cf\u25cb\u25a0\u25a1\u2043]|[-*+])\s+/.test(value)) {
    return `- ${escapeMarkdownText(value.replace(/^(?:[\u2022\u2023\u25e6\u25aa\u25cf\u25cb\u25a0\u25a1\u2043]|[-*+])\s+/, ''))}`;
  }
  const ordered = /^(\d{1,3})[.)]\s+(.+)$/.exec(value);
  if (ordered) return `${ordered[1]}. ${escapeMarkdownText(ordered[2])}`;
  const task = /^(?:-\s*)?\[([ xX])\]\s+(.+)$/.exec(value);
  if (task) return `- [${task[1].toLowerCase()}] ${escapeMarkdownText(task[2])}`;
  return '';
}

function headingText(line, baseSize) {
  const explicit = HEADING_PREFIX_PATTERN.exec(line.text);
  if (explicit) return { level: Math.min(6, explicit[1].length), text: explicit[2].trim() };
  const ratio = line.fontSize / Math.max(1, baseSize);
  const short = line.text.length <= 120;
  const punctuation = /[。！？.!?:：]$/.test(line.text);
  if (short && !punctuation && (ratio >= 1.32 || (line.bold && ratio >= 1.08))) {
    const level = ratio >= 1.85 ? 1 : ratio >= 1.5 ? 2 : 3;
    return { level, text: line.text };
  }
  return null;
}

function looksLikeTableLine(line) {
  return line.cells.length >= 2 && line.text.length > 0;
}

function renderTable(lines) {
  const rows = lines.map(line => line.cells.map(escapeTableCell));
  const width = Math.max(...rows.map(row => row.length));
  const padded = rows.map(row => [...row, ...Array.from({ length: width - row.length }, () => ' ')].slice(0, width));
  const separator = Array.from({ length: width }, () => '---');
  return [
    `| ${padded[0].join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...padded.slice(1).map(row => `| ${row.join(' | ')} |`)
  ].join('\n');
}

function renderBlocks(page, continuedHeaders = new Map()) {
  const lines = page.lines || [];
  if (!lines.length) return [];
  const baseSize = median(lines.map(line => line.fontSize)) || 10;
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.isTableRow) {
      const tableLines = [line];
      let cursor = index + 1;
      while (cursor < lines.length
        && lines[cursor].isTableRow
        && lines[cursor].tableId === line.tableId) {
        tableLines.push(lines[cursor]);
        cursor += 1;
      }
      if (tableLines.length >= 2) {
        const header = continuedHeaders.get(line.tableId);
        if (header) tableLines.unshift({ cells: header });
        blocks.push(renderTable(tableLines));
        index = cursor;
        continue;
      }
    }
    const heading = headingText(line, baseSize);
    if (heading) {
      blocks.push(`${'#'.repeat(heading.level)} ${escapeMarkdownText(heading.text)}`);
      index += 1;
      continue;
    }
    const list = listText(line.text);
    if (list) {
      const listLines = [];
      while (index < lines.length) {
        const item = listText(lines[index].text);
        if (!item) break;
        listLines.push(item);
        index += 1;
      }
      blocks.push(listLines.join('\n'));
      continue;
    }
    if (looksLikeTableLine(line)) {
      const tableLines = [line];
      let cursor = index + 1;
      while (cursor < lines.length && looksLikeTableLine(lines[cursor])
        && lines[cursor].cells.length === line.cells.length) {
        tableLines.push(lines[cursor]);
        cursor += 1;
      }
      if (tableLines.length >= 2) {
        blocks.push(renderTable(tableLines));
        index = cursor;
        continue;
      }
    }
    const paragraph = [line];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const next = lines[cursor];
      if (headingText(next, baseSize) || listText(next.text) || looksLikeTableLine(next)) break;
      if (paragraphHasBreak(paragraph.at(-1), next, baseSize)) break;
      paragraph.push(next);
      cursor += 1;
    }
    blocks.push(formatParagraph(paragraph));
    index = cursor;
  }
  return blocks.filter(Boolean);
}

function titleFromName(name) {
  const base = String(name || 'PDF 文档').split(/[\\/]/).pop() || 'PDF 文档';
  return base.replace(/\.pdf$/i, '').replace(/[\r\n]+/g, ' ').trim() || 'PDF 文档';
}

export function convertPdfPagesToMarkdown(pages = [], { sourceName = '', includeTitle = true } = {}) {
  const normalizedPages = Array.isArray(pages) ? pages : [];
  const blocks = [];
  if (includeTitle) blocks.push(`# ${escapeMarkdownText(titleFromName(sourceName))}`);
  blocks.push('<!-- generated-by: ToolKnit local PDF text extraction -->');
  const warnings = [];
  let chars = 0;
  let pagesWithText = 0;
  const emptyPages = [];
  const failedPages = [];
  let previousTable = null;
  for (const page of normalizedPages) {
    const pageNumber = Number(page?.pageNumber) || normalizedPages.indexOf(page) + 1;
    blocks.push(`<!-- source-page: ${pageNumber} -->`);
    for (const code of page?.warnings || []) {
      if (code !== 'no-text-layer') warnings.push({ pageNumber, code });
    }
    if (page?.error) {
      previousTable = null;
      failedPages.push(pageNumber);
      warnings.push({ pageNumber, code: page.error.code || 'page-read-failed' });
      blocks.push(`> Page ${pageNumber} could not be extracted.`);
      continue;
    }
    const continuedHeaders = new Map();
    const firstTable = page?.tables?.[0];
    // Carry headers only across adjacent page edges with the same ruled grid.
    // Each page stays a separate table so source-page markers remain useful.
    const sameGrid = previousTable && firstTable?.xs
      && previousTable.pageNumber + 1 === pageNumber
      && firstTable.top >= page.pageHeight * .75
      && previousTable.bottom <= previousTable.pageHeight * .2
      && firstTable.xs.length === previousTable.xs.length
      && firstTable.xs.every((x, i) => Math.abs(x-previousTable.xs[i]) <= 3);
    if (sameGrid && firstTable.rows[0].some((cell, i) => cell.trim() !== previousTable.header[i]?.trim())) {
      continuedHeaders.set(0, previousTable.header);
    }
    const lastTable = page?.tables?.at(-1);
    previousTable = lastTable?.xs ? { ...lastTable, pageNumber, pageHeight: page.pageHeight,
      header: continuedHeaders.get(page.tables.length - 1) || lastTable.rows[0] } : null;
    const pageBlocks = renderBlocks(page, continuedHeaders);
    if (!page?.hasText || !pageBlocks.length) {
      emptyPages.push(pageNumber);
      warnings.push({ pageNumber, code: 'no-text-layer' });
      blocks.push(`> Page ${pageNumber} has no selectable text. It may be a scanned page.`);
      continue;
    }
    pagesWithText += 1;
    chars += Number(page.chars) || page.text?.length || 0;
    blocks.push(pageBlocks.join('\n\n'));
  }
  const markdown = `${blocks.filter(Boolean).join('\n\n').trim()}\n`;
  const status = !normalizedPages.length || pagesWithText === 0
    ? 'no-text'
    : (emptyPages.length || failedPages.length ? 'partial' : 'success');
  return {
    markdown,
    chars,
    pageCount: normalizedPages.length,
    pagesWithText,
    emptyPages,
    failedPages,
    warnings,
    status,
    isScanned: pagesWithText === 0 && normalizedPages.length > 0
  };
}

export function normalizePdfTextError(error) {
  const name = String(error?.name || '');
  const message = String(error?.message || error || '');
  if (/password|encrypted/i.test(name) || /password|encrypted|需密码|密码/i.test(message)) {
    return { code: 'password-protected', detail: message };
  }
  if (/InvalidPDF|MissingPDF|UnexpectedResponse|FormatError/i.test(name)
    || /invalid pdf|damaged|格式|损坏/i.test(message)) {
    return { code: 'invalid-pdf', detail: message };
  }
  if (/cancelled|canceled|abort/i.test(name) || /cancelled|canceled|aborted/i.test(message)) {
    return { code: 'cancelled', detail: message };
  }
  return { code: 'read-failed', detail: message };
}

export function isPdfTextCancellation(error) {
  return error instanceof PdfTextExtractionCancelledError
    || normalizePdfTextError(error).code === 'cancelled';
}
