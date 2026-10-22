export function insertedTextLines(text) {
  return String(text ?? '').replace(/\r\n?|[\u2028\u2029]/g, '\n').split('\n');
}

export function estimateInsertedTextWidth(text, fontSize) {
  const size = Math.max(1, Number(fontSize) || 16);
  return insertedTextLines(text).reduce((maximum, line) => Math.max(maximum,
    Array.from(line).reduce((width, char) => width + size * (/[^\u0000-\u00ff]/u.test(char) ? 1 : /[MW@%]/.test(char) ? .95 : .55), 0)), 1);
}

/** The stored y is the first baseline; later baselines move down the PDF page. */
export function insertedTextLayout(object) {
  const fontSize = Math.max(1, Number(object?.fontSize) || 16);
  const lines = insertedTextLines(object?.text);
  const rowHeight = Math.max(1, Number(object?.height) || fontSize * 1.15, Number(object?.visualTextHeight) || 0);
  const lineHeight = lines.length > 1 ? Math.max(rowHeight, fontSize * 1.2) : rowHeight;
  const extraHeight = (lines.length - 1) * lineHeight;
  return { lines, lineHeight, fontSize, box: {
    x: Number(object?.x) || 0,
    y: (Number(object?.y) || 0) - rowHeight * .2 - extraHeight,
    width: Math.max(1, Number(object?.visualTextWidth) || Number(object?.width) || estimateInsertedTextWidth(object?.text, fontSize)),
    height: rowHeight + extraHeight
  } };
}
