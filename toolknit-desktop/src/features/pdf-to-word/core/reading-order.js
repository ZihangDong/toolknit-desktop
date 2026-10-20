// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
export function baselineBands(rows) {
  const bands = [];
  for (const row of [...rows].sort((a, b) => a.baseline - b.baseline)) {
    let band = bands.at(-1);
    const size = band ? Math.min(band.size, row.size) : row.size;
    if (!band || row.baseline - band.baseline > Math.max(1, size * .28)) {
      band = { baseline: row.baseline, size, rows: [] }; bands.push(band);
    }
    band.size = size; band.rows.push(row);
  }
  return bands.map(band => band.rows);
}

/** Order fragments inside one established column. Tall inline formulas must
 * not move the end of a sentence ahead of its beginning in the DOCX stream. */
export function orderBandBlocks(blocks) {
  const rows = [], other = [];
  for (const block of blocks) {
    const line = block.type === 'paragraph' && block.lines.length === 1 ? block.lines[0] : null;
    const text = line?.items.filter(item => item.type !== 'image') || [];
    if (text.length && Number.isFinite(line.baseline) && line.size > 0) {
      rows.push({ block, baseline: line.baseline, size: line.size, y: Math.min(...text.map(item => item.rect.y)) });
    } else other.push({ blocks: [block], y: block.rect.y, x: block.rect.x });
  }
  const bands = baselineBands(rows);
  const packets = bands.map(band => ({
    blocks: band.sort((a, b) => a.block.rect.x - b.block.rect.x).map(row => row.block),
    y: Math.min(...band.map(row => row.y)), x: Math.min(...band.map(row => row.block.rect.x))
  }));
  return [...packets, ...other].sort((a, b) => a.y - b.y || a.x - b.x).flatMap(packet => packet.blocks);
}
