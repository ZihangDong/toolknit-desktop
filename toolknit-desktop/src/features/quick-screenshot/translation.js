import { fitText, clamp } from './core.js';


export function translationBlocks(lines) {
  const blocks = [];
  for (const line of lines) {
    const previous = blocks.at(-1), last = previous?.last;
    const gap = last ? line.y - last.y - last.height : Infinity;
    const aligned = last && Math.abs(line.x - last.x) <= Math.max(12, last.height * 1.2);
    const paragraph = last && gap >= 0 && gap <= Math.min(line.height, last.height) * .9
      && aligned && Math.abs(line.height - last.height) <= last.height * .3
      && !/^\s*(?:[•●▪\-*]|\d+[.)])\s/.test(line.text)
      && previous.lineCount < 6 && previous.text.length + line.text.length < 1800;
    if (paragraph) {
      const right = Math.max(previous.x + previous.width, line.x + line.width);
      previous.x = Math.min(previous.x, line.x); previous.width = right - previous.x;
      previous.height = line.y + line.height - previous.y;
      previous.text += '\n' + line.text; previous.last = line; previous.lineCount++;
    } else blocks.push({...line, id: blocks.length, words: undefined, fontHeight: line.height, last: line, lineCount: 1});
  }
  return blocks.map(({last, lineCount, ...block}) => block);
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// Expand only into unoccupied space inside the captured image; otherwise retain the source.
export function layoutTranslations(ctx, translated, sources, width, height, obstacles = []) {
  const layers = [], skipped = [];
  for (const line of translated) {
    const source = sources.find(item => item.id === line.id);
    if (!source) { skipped.push(line); continue; }
    const x = clamp(source.x - 2, 0, width), y = clamp(source.y - 2, 0, height);
    let base = { x, y, width: Math.min(width - x, source.width + 4), height: Math.min(height - y, source.height + 4) };
    const occupied = [...sources.filter(item => item.id !== line.id), ...layers, ...obstacles];
    if (occupied.some(item => overlaps(base, item))) base = { x:source.x, y:source.y, width:Math.min(width-source.x,source.width), height:Math.min(height-source.y,source.height) };
    const right = occupied.filter(item => item.x >= base.x + base.width && item.y < base.y + base.height && item.y + item.height > base.y)
      .reduce((edge, item) => Math.min(edge, item.x - 2), width);
    const expandedWidth = Math.max(base.width, right - base.x);
    const bottom = occupied.filter(item => item.y >= base.y + base.height && item.x < base.x + expandedWidth && item.x + item.width > base.x)
      .reduce((edge, item) => Math.min(edge, item.y - 2), height);
    const candidates = [base, {...base, width: expandedWidth}, {...base, width: expandedWidth, height: Math.max(base.height, bottom - base.y)}];
    let layer;
    for (const rect of candidates) {
      if (occupied.some(item => overlaps(rect, item))) continue;
      const fontHeight = source.fontHeight || source.height;
      const fitted = fitText(ctx, line.text, rect.width, rect.height, fontHeight * .9);
      if (fitted.fits && fitted.size >= Math.max(8, Math.min(12, fontHeight * .65))) {
        layer = {...rect, height:Math.max(base.height, fitted.lines.length*fitted.size*1.25+4), text: line.text, source, font: fitted.size}; break;
      }
    }
    if (layer) layers.push(layer); else skipped.push(line);
  }
  return {layers, skipped};
}
