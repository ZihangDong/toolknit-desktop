export const XML_MAX_TEXT = 2 * 1024 * 1024;
const XML_MAX_OUTPUT = 8 * 1024 * 1024;
const XML_MAX_DEPTH = 256;
const PARSER_ERROR_NS = 'http://www.mozilla.org/newlayout/xml/parsererror.xml';

function preservesSpace(tag) {
  for (const match of tag.matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (match[1] !== 'xml:space') continue;
    const value = (match[2] ?? match[3]).replace(/&#(x[\da-f]+|\d+);/gi, (raw, number) => {
      const code = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
      return code <= 0x10ffff ? String.fromCodePoint(code) : raw;
    });
    return value === 'preserve';
  }
  return false;
}

// Keep the source tokens: serializing the parsed DOM would rewrite entity
// references, attribute quoting, empty elements and CDATA sections.
function tokenize(source) {
  const tokens = [];
  let offset = 0;
  while (offset < source.length) {
    const start = offset;
    let kind = 'text';
    if (source[offset] !== '<') {
      const next = source.indexOf('<', offset);
      offset = next < 0 ? source.length : next;
    } else {
      const special = source.startsWith('<!--', offset) ? ['-->', 4, 'comment']
        : source.startsWith('<![CDATA[', offset) ? [']]>', 9, 'cdata']
          : source.startsWith('<?', offset) ? ['?>', 2, 'instruction'] : null;
      if (special) {
        const end = source.indexOf(special[0], offset + special[1]);
        if (end < 0) throw new Error('xml:invalid');
        offset = end + special[0].length;
        kind = special[2];
      } else {
        kind = source.startsWith('<!DOCTYPE', offset) ? 'doctype'
          : source.startsWith('</', offset) ? 'close' : 'open';
        let quote = '', subset = 0, closed = false;
        for (offset++; offset < source.length; offset++) {
          const char = source[offset];
          if (quote) { if (char === quote) quote = ''; continue; }
          if (char === '"' || char === "'") { quote = char; continue; }
          if (kind === 'doctype') {
            if (source.startsWith('<!--', offset)) {
              const end = source.indexOf('-->', offset + 4);
              if (end < 0) throw new Error('xml:invalid');
              offset = end + 2;
              continue;
            }
            if (char === '[') subset++;
            if (char === ']') subset--;
          }
          if (char === '>' && subset === 0) { offset++; closed = true; break; }
        }
        if (!closed) throw new Error('xml:invalid');
      }
    }
    tokens.push({ kind, raw: source.slice(start, offset), start, end: offset });
    if (tokens.length > 100000) throw new Error('xml:too-complex');
  }
  return tokens;
}

function sourceTree(source) {
  const document = { children: [] }, stack = [document];
  for (const token of tokenize(source)) {
    if (token.kind === 'close') {
      const element = stack.pop();
      if (stack.length === 0) throw new Error('xml:invalid');
      element.close = token.raw;
      element.end = token.end;
    } else {
      const parent = stack[stack.length - 1];
      parent.children.push(token);
      if (token.kind === 'open') {
        token.children = [];
        token.selfClosing = /\/\s*>$/.test(token.raw);
        token.preserve = preservesSpace(token.raw);
        if (!token.selfClosing) {
          stack.push(token);
          if (stack.length > XML_MAX_DEPTH + 1) throw new Error('xml:too-deep');
        }
      }
    }
  }
  if (stack.length !== 1) throw new Error('xml:invalid');
  return document;
}

/** Browser XML validation; formatting never mounts the parsed document. */
export function formatXmlText(value, indent = '2') {
  const source = String(value ?? '');
  if (source.length > XML_MAX_TEXT) throw new Error('developer-tool:input-too-large');
  if (!['2', '4', 'tab', '0'].includes(indent)) throw new Error('xml:invalid-indent');
  if (!source.trim()) return '';
  // Bound nesting and token count before invoking the native XML parser.
  const tree = sourceTree(source);
  const parsed = new DOMParser().parseFromString(source, 'application/xml');
  // Firefox uses the parsererror namespace; Chromium/WebView2 embeds an
  // XHTML parsererror in the partially parsed document.
  const failure = parsed.getElementsByTagNameNS(PARSER_ERROR_NS, 'parsererror')[0]
    || parsed.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'parsererror')[0];
  if (failure || !parsed.documentElement) {
    const location = failure?.textContent?.match(/line\s+(\d+)(?:\s+at)?\s+column\s+(\d+)/i);
    const error = new Error('xml:invalid');
    if (location) error.location = { line: Number(location[1]), column: Number(location[2]) };
    throw error;
  }
  const unit = indent === 'tab' ? '\t' : ' '.repeat(Number(indent));
  const newline = indent === '0' ? '' : '\n';
  const output = [];
  let size = 0;
  function append(text) {
    size += text.length;
    if (size > XML_MAX_OUTPUT) throw new Error('xml:output-too-large');
    output.push(text);
  }
  function render(node, depth) {
    if (node.kind !== 'open' || node.selfClosing) { append(node.raw); return; }
    // Mixed content, CDATA and xml:space stay byte-for-byte intact. Whitespace
    // in a text-only leaf is also data, even when it is only spaces.
    const hasElements = node.children.some(child => child.kind === 'open');
    const hasText = node.children.some(child => child.kind === 'cdata' || (child.kind === 'text'
      && (/[^\t\n\r ]/.test(child.raw) || (child.raw.length > 0 && !/[\r\n]/.test(child.raw)))));
    if (node.preserve || hasText || !hasElements) {
      append(source.slice(node.start, node.end));
      return;
    }
    append(node.raw);
    for (const child of node.children) {
      if (child.kind === 'text' && /^[\t\n\r ]*$/.test(child.raw)) continue;
      append(newline + unit.repeat(depth + 1));
      render(child, depth + 1);
    }
    append(newline + unit.repeat(depth) + node.close);
  }
  let first = true;
  for (const child of tree.children) {
    if (child.kind === 'text' && !child.raw.trim()) continue;
    if (!first) append(newline);
    render(child, 0);
    first = false;
  }
  return output.join('');
}
