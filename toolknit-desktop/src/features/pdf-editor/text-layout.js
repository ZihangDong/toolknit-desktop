import { estimateInsertedTextWidth } from '../../pdf-editor-core.js';

function cloneBox(box) {
  return box ? { ...box } : box;
}

export function groupTextItemsIntoLines(items) {
  const nonEmpty = (items || []).filter(item => item && typeof item.str === 'string' && item.str.length > 0);
  if (!nonEmpty.length) return [];
  const sorted = [...nonEmpty].sort((a, b) => {
    const ay = a.transform?.[5] ?? 0;
    const by = b.transform?.[5] ?? 0;
    if (Math.abs(ay - by) > 0.5) return by - ay;
    return (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0);
  });
  const lines = [];
  let current = [];
  let currentY = null;
  let currentHeight = 0;
  for (const item of sorted) {
    const y = item.transform?.[5] ?? 0;
    const height = Math.max(1, item.height || Math.hypot(item.transform?.[0] || 0, item.transform?.[1] || 0) || 1);
    if (!current.length) {
      current.push(item);
      currentY = y;
      currentHeight = height;
      continue;
    }
    const tolerance = Math.max(2, currentHeight * 0.42, height * 0.42);
    if (Math.abs(y - currentY) <= tolerance) {
      current.push(item);
      currentY = Math.min(currentY, y);
      currentHeight = Math.max(currentHeight, height);
    } else {
      lines.push(current);
      current = [item];
      currentY = y;
      currentHeight = height;
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

export function buildTextLine(items) {
  const sorted = [...items].sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0));
  let text = '';
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let fontSize = 0;
  let fontName = '';
  let prevEndX = null;
  const segments = [];
  for (const item of sorted) {
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    const width = item.width || 0;
    const height = item.height || Math.hypot(item.transform?.[0] || 0, item.transform?.[1] || 0) || 1;
    const box = {
      x,
      y: y - height * 0.2,
      width: Math.max(0.5, width),
      height: height * 1.08
    };
    minX = Math.min(minX, box.x);
    maxX = Math.max(maxX, box.x + box.width);
    minY = Math.min(minY, box.y);
    maxY = Math.max(maxY, box.y + box.height);
    fontSize = Math.max(fontSize, height);
    if (!fontName) fontName = item.fontName || '';
    if (prevEndX !== null && x - prevEndX > fontSize * 0.12 && !text.endsWith(' ') && !item.str.startsWith(' ')) {
      text += ' ';
    }
    text += item.str;
    prevEndX = x + width;
    segments.push({
      text: item.str,
      baselineX: x,
      baselineY: y,
      fontSize: height,
      fontName: item.fontName || '',
      bold: /bold|black|heavy|semibold|medium/i.test(item.fontName || ''),
      italic: /italic|oblique/i.test(item.fontName || ''),
      box,
      sourceBox: cloneBox(box)
    });
  }
  const padX = fontSize * 0.04;
  const finalMinX = minX === Infinity ? (sorted[0]?.transform?.[4] ?? 0) : minX;
  const finalMinY = minY === Infinity ? ((sorted[0]?.transform?.[5] ?? 0) - fontSize * 0.2) : minY;
  const finalMaxY = maxY === -Infinity ? finalMinY + fontSize * 1.08 : maxY;
  const box = {
    x: finalMinX - padX,
    y: finalMinY,
    width: Math.max(0, (maxX - minX) + padX * 2),
    height: Math.max(1, finalMaxY - finalMinY)
  };
  return {
    text: text.trim(),
    fontSize: fontSize || 10,
    fontName,
    bold: /bold|black|heavy|semibold|medium/i.test(fontName),
    italic: /italic|oblique/i.test(fontName),
    baselineX: sorted[0]?.transform?.[4] ?? finalMinX,
    baselineY: sorted[0]?.transform?.[5] ?? finalMinY + (fontSize || 10) * 0.2,
    box,
    sourceBox: cloneBox(box),
    segments
  };
}

export function rectToViewport(view, rect) {
  const { x, y, width, height } = rect;
  const points = [
    view.convertToViewportPoint(x, y),
    view.convertToViewportPoint(x + width, y),
    view.convertToViewportPoint(x, y + height),
    view.convertToViewportPoint(x + width, y + height)
  ];
  const minX = Math.min(...points.map(point => point[0]));
  const maxX = Math.max(...points.map(point => point[0]));
  const minY = Math.min(...points.map(point => point[1]));
  const maxY = Math.max(...points.map(point => point[1]));
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

export function sourceTextBox(edit, segment) {
  return edit?.baseSegment?.sourceBox
    || edit?.baseSegment?.box
    || segment?.sourceBox
    || segment?.box
    || null;
}

export function editedTextVisualBox(edit, segment) {
  const box = edit?.segment?.box || segment?.box || segment?.sourceBox || null;
  if (!box) return null;
  const fontSize = Math.max(1, Number(edit?.segment?.fontSize || segment?.fontSize) || 10);
  const textWidth = Number(edit?.segment?.visualTextWidth)
    || estimateInsertedTextWidth(edit?.newText, fontSize);
  return {
    x: Number.isFinite(Number(box.x)) ? Number(box.x) : 0,
    y: Number.isFinite(Number(box.y)) ? Number(box.y) : 0,
    width: Math.max(1, textWidth + fontSize * 0.15),
    height: Math.max(1, Number(box.height) || 0, Number(edit?.segment?.visualTextHeight) || fontSize * 1.2)
  };
}

export function insertedTextVisualBox(object) {
  const fontSize = Math.max(1, Number(object?.fontSize) || 16);
  const width = Math.max(
    1,
    Number(object?.visualTextWidth) || Number(object?.width) || estimateInsertedTextWidth(object?.text, fontSize)
  );
  const height = Math.max(1, Number(object?.height) || fontSize * 1.15, Number(object?.visualTextHeight) || 0);
  return {
    x: Number(object?.x) || 0,
    y: (Number(object?.y) || 0) - height * 0.2,
    width,
    height
  };
}
