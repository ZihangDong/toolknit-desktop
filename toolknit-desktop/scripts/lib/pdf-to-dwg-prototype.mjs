// TK-016 research prototype. Deliberately rejects unsupported PDF content.
// This module is not registered in the desktop, CLI or MCP product surfaces.
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { sourceCapHeight } from './pdf-dwg-font.mjs';

export const CAD_PROTOTYPE_LIMITS = Object.freeze({ bytes: 50 * 1024 * 1024, pages: 50, operators: 200_000, entities: 50_000, text: 100_000, output: 64 * 1024 * 1024 });
const units = { mm: { factor: 25.4 / 72, code: 4 }, m: { factor: 25.4 / 72000, code: 6 }, inch: { factor: 1 / 72, code: 1 } };
export function cadFailure(code, detail = '') { const error = new Error(`pdf-dwg:${code}${detail ? ': ' + detail : ''}`); error.code = code; return error; }
const names = new Map(Object.entries(OPS).map(([name, code]) => [code, name]));
const identity = () => [1, 0, 0, 1, 0, 0];
const multiply = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const point = (matrix, x, y) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];

export function cadPrototypeSettings({ unit = 'mm', scale = 1 } = {}) {
  if (!Object.hasOwn(units, unit) || !Number.isFinite(scale) || scale <= 0 || scale > 10000) throw cadFailure('settings');
  return { unit, scale, factor: units[unit].factor * scale, unitCode: units[unit].code };
}

export function cadPrototypePages(range, count) {
  if (!Number.isInteger(count) || count < 1 || count > CAD_PROTOTYPE_LIMITS.pages) throw cadFailure('page-limit');
  if (range == null || range === '') return Array.from({ length: count }, (_, i) => i + 1);
  if (String(range).length > 1000) throw cadFailure('range');
  const result = new Set();
  for (const part of String(range).split(',')) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!match) throw cadFailure('range');
    const start = Number(match[1]), end = Number(match[2] || start);
    if (start < 1 || end < start || end > count) throw cadFailure('range');
    for (let i = start; i <= end; i++) result.add(i);
  }
  return [...result].sort((a, b) => a - b);
}

const ignored = new Set([
  'dependency', 'beginText', 'endText', 'setFont', 'setCharSpacing', 'setWordSpacing',
  'setHScale', 'setLeading', 'moveText', 'setLeadingMoveText', 'setTextMatrix',
  'nextLine', 'showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText',
  'setTextRise', 'setLineCap', 'setLineJoin', 'setMiterLimit', 'setRenderingIntent',
  'setFlatness', 'beginMarkedContent', 'endMarkedContent', 'markPoint', 'markPointProps',
]);

export async function extractCadPrototypePage(page, options = {}) {
  const settings = cadPrototypeSettings(options), check = options.check || (() => {});
  check();
  const annotations = await page.getAnnotations({ intent: 'display' }); check();
  if (annotations.length) throw cadFailure('annotations');
  const operations = await page.getOperatorList(); check();
  if (operations.fnArray.length > CAD_PROTOTYPE_LIMITS.operators) throw cadFailure('operator-limit');
  // PDF.js has already incorporated /UserUnit in the viewport. Flip only the
  // preview's downward y axis, giving CAD a lower-left origin after crop/rotate.
  const viewport = page.getViewport({ scale: settings.factor });
  if (![viewport.width, viewport.height].every(n => Number.isFinite(n) && n > 0 && n < 1e9)) throw cadFailure('page-size');
  const v = viewport.transform, pageMatrix = [v[0], -v[1], v[2], -v[3], v[4], viewport.height - v[5]];
  const geometry = [];
  const stack = [];
  let state = { matrix: identity(), stroke: '#000000', fill: '#000000', width: 1 };
  let textShown = false;
  function push(entity) {
    if (geometry.length >= CAD_PROTOTYPE_LIMITS.entities) throw cadFailure('entity-limit');
    const points = entity.points;
    if (points.some(pair => !pair.every(Number.isFinite))) throw cadFailure('coordinates');
    // Clipping arbitrary geometry against the page is not implemented. A curve's
    // control hull outside the page is conservatively rejected as well.
    const tolerance = Math.max(viewport.width, viewport.height) * 1e-7;
    if (points.some(([x, y]) => x < -tolerance || y < -tolerance || x > viewport.width + tolerance || y > viewport.height + tolerance)) throw cadFailure('outside-page');
    geometry.push(entity);
  }
  for (let i = 0; i < operations.fnArray.length; i++) {
    if (i % 1000 === 0) { check(); await new Promise(resolve => setTimeout(resolve, 0)); }
    const op = operations.fnArray[i], args = operations.argsArray[i] || [], name = names.get(op);
    if (['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'].includes(name)) textShown = true;
    if (ignored.has(name)) continue;
    switch (name) {
      case 'save': stack.push({ ...state, matrix: [...state.matrix] }); break;
      case 'restore': if (!stack.length) throw cadFailure('state'); state = stack.pop(); break;
      case 'transform': state.matrix = multiply(state.matrix, args); break;
      case 'setLineWidth': state.width = args[0]; break;
      case 'setStrokeRGBColor': state.stroke = args[0]; break;
      case 'setFillRGBColor': state.fill = args[0]; break;
      case 'setDash': if (args[0]?.length || args[1]) throw cadFailure('dash'); break;
      case 'setTextRenderingMode': if (args[0] !== 0) throw cadFailure('text-render-mode'); break;
      case 'setGState':
        for (const [key, value] of args[0]) {
          if (key === 'LW') state.width = value;
          else if (key === 'D' && (value[0]?.length || value[1])) throw cadFailure('dash');
          else if (['CA', 'ca'].includes(key) && value !== 1) throw cadFailure('transparency');
          else if (key === 'BM' && value !== 'source-over') throw cadFailure('blend-mode');
          else if (['SMask', 'TR'].includes(key) && value) throw cadFailure('mask');
          else if (!['LW', 'D', 'CA', 'ca', 'BM', 'SMask', 'TR', 'LC', 'LJ', 'ML', 'RI', 'FL', 'Font'].includes(key)) throw cadFailure('graphics-state', key);
        }
        break;
      case 'constructPath': {
        const [paint, paths] = args;
        if (paint === OPS.endPath) break;
        if (![OPS.stroke, OPS.closeStroke].includes(paint)) throw cadFailure('fill');
        if (!Array.isArray(paths)) throw cadFailure('path-format');
        const matrix = multiply(pageMatrix, state.matrix);
        const widthMm = state.width * Math.hypot(state.matrix[0], state.matrix[1]) * Number(page.userUnit || 1) * 25.4 / 72;
        for (const path of paths) {
          if (!path) continue;
          let at = 0, cursor = null, start = null;
          const next = () => { if (at + 1 >= path.length) throw cadFailure('path-format'); return point(matrix, path[at++], path[at++]); };
          const line = end => { if (!cursor) throw cadFailure('path-format'); if (Math.hypot(cursor[0] - end[0], cursor[1] - end[1]) > 1e-10) push({ type: 'LINE', points: [cursor, end], color: state.stroke, widthMm }); cursor = end; };
          while (at < path.length) {
            switch (path[at++]) {
              case 0: cursor = next(); start = cursor; break;
              case 1: line(next()); break;
              case 2: {
                if (!cursor) throw cadFailure('path-format');
                const controls = [cursor, next(), next(), next()];
                push({ type: 'SPLINE', points: controls, color: state.stroke, widthMm }); cursor = controls[3]; break;
              }
              case 4: if (!start) throw cadFailure('path-format'); line(start); break;
              default: throw cadFailure('path-format');
            }
          }
          if (paint === OPS.closeStroke && start && cursor) line(start);
        }
        break;
      }
      default:
        // Includes images, arbitrary clips, forms, OCGs, patterns, Type3 glyphs,
        // transparency groups and future PDF.js drawing operators.
        throw cadFailure('unsupported-operator', name || String(op));
    }
  }
  if (stack.length) throw cadFailure('state');
  const content = await page.getTextContent(); check();
  let characters = 0;
  const capCache = new Map();
  for (const item of content.items) {
    if (!item.str?.trim()) continue;
    if (content.styles[item.fontName]?.vertical || item.dir !== 'ltr') throw cadFailure('text-direction');
    characters += item.str.length;
    if (characters > CAD_PROTOTYPE_LIMITS.text) throw cadFailure('text-limit');
    const matrix = multiply(pageMatrix, item.transform), [a, b, c, d, x, y] = matrix;
    const height = Math.hypot(c, d), baseline = Math.hypot(a, b), determinant = a * d - b * c;
    if (!Number.isFinite(height) || height <= 0 || baseline <= 0 || determinant <= 0 || Math.abs(a * c + b * d) > baseline * height * 1e-5) throw cadFailure('text-transform');
    const width = item.width * Math.hypot(pageMatrix[0], pageMatrix[1]);
    if (!Number.isFinite(width) || width <= 0) throw cadFailure('text-metrics');
    const end = [x + a / baseline * width, y + b / baseline * width];
    const cap = sourceCapHeight(page, item.fontName, capCache);
    push({ type: 'TEXT', points: [[x, y], end], value: item.str, emHeight: height, width,
      capRatio: cap.ratio, capMethod: cap.method, height, rotation: Math.atan2(b, a), color: '#000000' });
  }
  if (textShown && !characters) throw cadFailure('text-unmapped');
  if (!geometry.length) throw cadFailure('empty');
  check();
  return { page: page.pageNumber, width: viewport.width, height: viewport.height, settings, geometry,
    notices: ['research-prototype', 'portable-font-requires-CAD-resolution', 'substituted-glyph-design', 'text-color-black', 'stroke-weight-approximation', 'paper-origin-after-crop-and-rotation', 'no-original-CAD-semantics'] };
}

export function writeCadPrototypePage(plan, cad) {
  const { CadDocument, ACadVersion, DwgWriter, DwgReader, Line, Spline, TextEntity, XYZ, Layer, Color, TextStyle } = cad;
  const document = new CadDocument(ACadVersion.AC1032);
  // CadDocument's table defaults do not initialize root-dictionary collections.
  // Populate them before writing: e.g. the header's current MLine style must
  // reference a real Standard entry for other CAD engines to save the document.
  document.updateCollections(true, true);
  document.header.insUnits = plan.settings.unitCode;
  document.modelSpace.units = plan.settings.unitCode;
  const layers = {};
  for (const name of ['PDF_GEOMETRY', 'PDF_TEXT']) { const layer = new Layer(name); document.layers.add(layer); layers[name] = layer; }
  const hasText = plan.geometry.some(item => item.type === 'TEXT');
  if (hasText && !plan.font?.file) throw cadFailure('cad-font-required');
  const style = hasText ? new TextStyle('PDF_PORTABLE') : null;
  if (style) { style.filename = plan.font.file; document.textStyles.add(style); }
  const weights = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
  for (const item of plan.geometry) {
    let entity;
    const points = item.points.map(([x, y]) => new XYZ(x, y, 0));
    if (item.type === 'LINE') { entity = new Line(); entity.startPoint = points[0]; entity.endPoint = points[1]; }
    else if (item.type === 'SPLINE') { entity = new Spline(); entity.degree = 3; entity.controlPoints = points; entity.knots = [0, 0, 0, 0, 1, 1, 1, 1]; }
    else if (item.type === 'TEXT') {
      entity = new TextEntity(item.value); entity.insertPoint = points[0];
      entity.height = item.height; entity.rotation = item.rotation; entity.style = style;
      entity.widthFactor = item.widthFactor;
    }
    else throw cadFailure('entity');
    entity.layer = layers[item.type === 'TEXT' ? 'PDF_TEXT' : 'PDF_GEOMETRY'];
    if (!/^#[\da-f]{6}$/i.test(item.color)) throw cadFailure('color');
    entity.color = new Color(...[1, 3, 5].map(at => parseInt(item.color.slice(at, at + 2), 16)));
    if (item.type !== 'TEXT') entity.lineWeight = weights.reduce((a, b) => Math.abs(a - item.widthMm * 100) < Math.abs(b - item.widthMm * 100) ? a : b);
    document.entities.add(entity);
  }
  const notifications = [];
  let bytes;
  for (let capacity = 1024 * 1024; capacity <= CAD_PROTOTYPE_LIMITS.output;) {
    const buffer = new Uint8Array(capacity), writer = new DwgWriter(buffer, document);
    const getHeader = writer._getFileHeaderWriter;
    if (typeof getHeader !== 'function') throw cadFailure('codec-version');
    // Scoped to this writer instance. acad-ts 3.9.0 AC18-container output counts
    // all page-map entries but writes their count minus one in the header.
    // Correct the count before the engine computes header CRC/encryption. No
    // output bytes/checksums or installed package files are patched afterwards.
    writer._getFileHeaderWriter = function () {
      getHeader.call(this);
      const header = this._fileHeaderWriter;
      if (!(header instanceof cad.DwgFileHeaderWriterAC18) || typeof header._writeRecords !== 'function') throw cadFailure('codec-version');
      const writeRecords = header._writeRecords;
      header._writeRecords = function () {
        writeRecords.call(this);
        const count = this._localSectionsMaps.length;
        if (this.fileHeader.gapAmount !== 0 || !Number.isInteger(count) || count < 2) throw cadFailure('codec-page-map');
        if (this.fileHeader.sectionAmount === count - 1) this.fileHeader.sectionAmount = count;
        else if (this.fileHeader.sectionAmount !== count) throw cadFailure('codec-page-map');
      };
    };
    writer.onNotification = (_, event) => notifications.push({ type: event.notificationType, message: event.message });
    try { writer.write(); bytes = buffer.slice(0, writer.bytesWritten); break; }
    catch (error) {
      if (!(error instanceof cad.DwgOutputBufferTooSmallError)) throw error;
      capacity = Math.max(capacity * 2, error.requiredLength * 2);
    } finally { writer.dispose(); }
  }
  if (!bytes) throw cadFailure('output-limit');
  if (notifications.some(event => event.type !== 0)) throw cadFailure('writer-notification', JSON.stringify(notifications));
  if (bytes.length > CAD_PROTOTYPE_LIMITS.output) throw cadFailure('output-limit');
  if (new TextDecoder().decode(bytes.subarray(0, 6)) !== 'AC1032') throw cadFailure('signature');
  // A same-codec read is only an internal consistency check. Independent reader
  // evidence and interactive CAD acceptance are separately recorded by the QA.
  const decoded = DwgReader.readFromStream(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if ([...decoded.entities].length !== plan.geometry.length) throw cadFailure('writer-entity-count');
  return bytes;
}
