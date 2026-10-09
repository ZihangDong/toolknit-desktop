import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import fontkit from './pdf-lib-fontkit.js';
import { encryptPdf as encryptPdfBytes, normalizePdfEncryptPermissions } from './pdf-encrypt-core.js';
import { flattenPdfFormForPageCopy } from './pdf-document-structure.js';

export const PDF_EDITOR_LIMITS = Object.freeze({
  maxInputBytes: 150 * 1024 * 1024,
  maxPages: 500,
  maxMergeFiles: 25,
  maxMergeTotalBytes: 150 * 1024 * 1024
});

export function assertPdfEditorFile(name, size, limits = PDF_EDITOR_LIMITS) {
  if (!/\.pdf$/i.test(String(name || ''))) {
    throw new Error('A PDF file is required');
  }
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error('Invalid PDF file size');
  }
  if (size > limits.maxInputBytes) {
    throw new Error(`PDF input exceeds the ${Math.floor(limits.maxInputBytes / 1024 / 1024)}MB editor limit`);
  }
}

export function assertPdfEditorPageCount(count, limits = PDF_EDITOR_LIMITS) {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error('PDF has no pages');
  }
  if (count > limits.maxPages) {
    throw new Error(`PDF input exceeds the ${limits.maxPages}-page editor limit`);
  }
}

export function assertPdfEditorMergeSelection(sources, totalBytes, limits = PDF_EDITOR_LIMITS) {
  if (!Array.isArray(sources) || sources.length < 1) {
    throw new Error('No PDF source is available');
  }
  if (sources.length > limits.maxMergeFiles) {
    throw new Error(`PDF editor accepts at most ${limits.maxMergeFiles} files at a time`);
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
    throw new Error('Invalid PDF source size');
  }
  if (totalBytes > limits.maxMergeTotalBytes) {
    throw new Error(`PDF inputs exceed the ${Math.floor(limits.maxMergeTotalBytes / 1024 / 1024)}MB merge limit`);
  }
}

export function normalizePageRotation(value) {
  const number = Number(value) || 0;
  return ((number % 360) + 360) % 360;
}

export function resolvePdfPageRotation(sourceRotation, editRotation = 0) {
  return normalizePageRotation(
    normalizePageRotation(sourceRotation) + normalizePageRotation(editRotation)
  );
}

export function sanitizePdfBaseName(sourceName) {
  const baseName = String(sourceName || 'document.pdf')
    .split(/[\\/]/)
    .pop()
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'document';
  return baseName;
}

export function buildPdfName(sourceName, suffix) {
  return `${sanitizePdfBaseName(sourceName)}_${String(suffix || 'edited')}.pdf`;
}

async function loadPdfLibDocument(bytes) {
  return PDFDocument.load(bytes.slice());
}

async function loadInPlaceAssemblyTarget(sources, pages) {
  if (sources.length !== 1 || !sources[0]?.bytes?.length) return null;
  if (!pages.every((pageRef, index) => (
    pageRef?.sourceIndex === 0
    && pageRef.pageIndex === index
  ))) return null;
  const document = await loadPdfLibDocument(sources[0].bytes);
  return document.getPageCount() === pages.length ? document : null;
}

/**
 * Assemble an ordered page list into a single PDF document.
 *
 * @param {object} params
 * @param {Array<{ name: string, bytes: Uint8Array }>} params.sources
 * @param {Array<{ sourceIndex: number, pageIndex: number, rotation: number }>} params.pages
 * @param {boolean} [params.useObjectStreams]
 * @param {(info: { done: number, total: number }) => void} [params.onProgress]
 * @returns {Promise<Uint8Array>}
 */
export async function assemblePdf({ sources, pages, useObjectStreams = true, onProgress }) {
  if (!Array.isArray(sources) || !Array.isArray(pages) || pages.length === 0) {
    throw new Error('No PDF pages are available to assemble');
  }

  const inPlaceOutput = await loadInPlaceAssemblyTarget(sources, pages);
  if (inPlaceOutput) {
    for (let index = 0; index < pages.length; index++) {
      const page = inPlaceOutput.getPage(index);
      page.setRotation(degrees(
        page.getRotation().angle + normalizePageRotation(pages[index].rotation)
      ));
      onProgress?.({ done: index + 1, total: pages.length });
    }
    return inPlaceOutput.save({ useObjectStreams });
  }

  const output = await PDFDocument.create();
  const sourceCache = new Map();

  for (let index = 0; index < pages.length; index++) {
    const pageRef = pages[index];
    const source = sources[pageRef.sourceIndex];
    if (!source?.bytes?.length) {
      throw new Error(`Missing PDF data for source index ${pageRef.sourceIndex}`);
    }
    if (!Number.isInteger(pageRef.pageIndex) || pageRef.pageIndex < 0) {
      throw new Error(`Invalid page index for source index ${pageRef.sourceIndex}`);
    }

    let sourceDoc = sourceCache.get(pageRef.sourceIndex);
    if (!sourceDoc) {
      sourceDoc = await loadPdfLibDocument(source.bytes);
      flattenPdfFormForPageCopy(sourceDoc);
      sourceCache.set(pageRef.sourceIndex, sourceDoc);
    }
    if (pageRef.pageIndex >= sourceDoc.getPageCount()) {
      throw new Error(`Page ${pageRef.pageIndex + 1} is outside source index ${pageRef.sourceIndex}`);
    }

    const [copiedPage] = await output.copyPages(sourceDoc, [pageRef.pageIndex]);
    copiedPage.setRotation(degrees(
      copiedPage.getRotation().angle + normalizePageRotation(pageRef.rotation)
    ));
    output.addPage(copiedPage);
    onProgress?.({ done: index + 1, total: pages.length });
  }

  return output.save({ useObjectStreams });
}

const CJK_TEXT_RE = /[\u2E80-\u2EFF\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

/**
 * Keep inserted-text visual boxes deterministic across the canvas and PDF
 * export paths. The browser overlay does not have the embedded PDF font
 * metrics available, so both paths use this conservative width estimate when
 * an object has not been explicitly resized.
 */
export function estimateInsertedTextWidth(text, fontSize) {
  const size = Math.max(1, Number(fontSize) || 16);
  return Math.max(1, Array.from(String(text ?? '')).reduce((width, char) => {
    if (/[^\u0000-\u00ff]/u.test(char)) return width + size;
    if (/[MW@%]/.test(char)) return width + size * 0.95;
    return width + size * 0.55;
  }, 0));
}

function normalizeTextColor(color) {
  if (Array.isArray(color) && color.length >= 3) {
    return rgb(
      Math.max(0, Math.min(1, Number(color[0]) || 0)),
      Math.max(0, Math.min(1, Number(color[1]) || 0)),
      Math.max(0, Math.min(1, Number(color[2]) || 0))
    );
  }
  return rgb(0, 0, 0);
}

export function rotatePdfPointAround(x, y, cx, cy, rotationDegrees) {
  const rad = (Number(rotationDegrees) || 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos
  };
}

/**
 * Convert the editor's CSS/UI clockwise angle to the PDF content angle.
 *
 * CSS uses a screen coordinate system whose y axis points down, while PDF
 * content uses a Cartesian y axis that points up. Keep the geometry helpers
 * above mathematically positive (counter-clockwise) and make this sign change
 * explicit at the export boundary.
 */
export function uiRotationToPdfAngle(rotationDegrees) {
  const value = Number(rotationDegrees);
  return Number.isFinite(value) ? -value : 0;
}

/**
 * Return the PDF-space origin needed to rotate a box around its visual center.
 * pdf-lib rotates rectangles and images around their lower-left origin, while
 * the editor UI rotates controls around their center.
 */
export function rotatePdfBoxOriginAroundCenter(x, y, width, height, rotationDegrees) {
  const boxWidth = Math.max(0, Number(width) || 0);
  const boxHeight = Math.max(0, Number(height) || 0);
  const centerX = (Number(x) || 0) + boxWidth / 2;
  const centerY = (Number(y) || 0) + boxHeight / 2;
  return rotatePdfPointAround(Number(x) || 0, Number(y) || 0, centerX, centerY, rotationDegrees);
}

/**
 * Rotate a text baseline anchor around the center of its editor box.
 */
export function rotatePdfTextAnchorAroundBox(baselineX, baselineY, box, rotationDegrees) {
  if (!box || !Number.isFinite(Number(box.x)) || !Number.isFinite(Number(box.y))) {
    return { x: Number(baselineX) || 0, y: Number(baselineY) || 0 };
  }
  const width = Math.max(0, Number(box.width) || 0);
  const height = Math.max(0, Number(box.height) || 0);
  const centerX = Number(box.x) + width / 2;
  const centerY = Number(box.y) + height / 2;
  return rotatePdfPointAround(
    Number(baselineX) || 0,
    Number(baselineY) || 0,
    centerX,
    centerY,
    rotationDegrees
  );
}

/**
 * Assemble an ordered page list and apply text-line edits by covering the
 * original glyphs with a white rectangle, then redrawing the replacement text
 * with an embedded font. Edit coordinates must be expressed in the page's
 * untransformed PDF user space (the same space returned by pdf.js
 * `getTextContent()`), which is also the space pdf-lib draws into before the
 * page rotation is applied.
 *
 * @param {object} params
 * @param {Array<{ name: string, bytes: Uint8Array }>} params.sources
 * @param {Array<{ sourceIndex: number, pageIndex: number, rotation: number }>} params.pages
 * @param {Array<{ pageIndex: number, baselineX: number, baselineY: number, fontSize: number, text: string, bold?: boolean, italic?: boolean, rotation?: number, box?: { x: number, y: number, width: number, height: number }, textBox?: { x: number, y: number, width: number, height: number }, color?: number[] }>} [params.textEdits]
 * @param {Array<{ pageIndex: number, x: number, y: number, width?: number, height?: number, text: string, fontSize?: number, bold?: boolean, rotation?: number, color?: number[] }>} [params.textObjects]
 * @param {Array<{ pageIndex: number, x: number, y: number, width: number, height: number, rotation?: number, bytes: Uint8Array, mimeType?: string }>} [params.imageObjects]
 * @param {Array<{ pageIndex: number, shapeType: 'rect'|'ellipse'|'line', x: number, y: number, width: number, height: number, rotation?: number, fill?: number[]|null, stroke?: number[]|null, strokeWidth?: number }>} [params.shapeObjects]
 * Component rotations are supplied in UI clockwise degrees and converted at
 * the export boundary to PDF's Cartesian coordinate convention.
 * @param {Uint8Array} [params.fontRegularBytes]
 * @param {Uint8Array} [params.fontSemiboldBytes]
 * @param {boolean} [params.useObjectStreams]
 * @param {(info: { done: number, total: number }) => void} [params.onProgress]
 * @returns {Promise<Uint8Array>}
 */
export async function assemblePdfWithTextEdits({
  sources,
  pages,
  textEdits = [],
  textObjects = [],
  imageObjects = [],
  shapeObjects = [],
  fontRegularBytes,
  fontSemiboldBytes,
  useObjectStreams = true,
  onProgress
}) {
  if (!Array.isArray(sources) || !Array.isArray(pages) || pages.length === 0) {
    throw new Error('No PDF pages are available to assemble');
  }

  const edits = Array.isArray(textEdits) ? textEdits : [];
  const insertedTexts = Array.isArray(textObjects) ? textObjects : [];
  const insertedImages = Array.isArray(imageObjects) ? imageObjects : [];
  const insertedShapes = Array.isArray(shapeObjects) ? shapeObjects : [];
  const inPlaceOutput = await loadInPlaceAssemblyTarget(sources, pages);
  const output = inPlaceOutput || await PDFDocument.create();
  if (edits.length || insertedTexts.length) output.registerFontkit(fontkit);

  const sourceCache = inPlaceOutput ? new Map([[0, inPlaceOutput]]) : new Map();
  const editsByPageIndex = new Map();
  for (const edit of edits) {
    const pageIndex = Number(edit?.pageIndex);
    if (!Number.isInteger(pageIndex) || pageIndex < 0) continue;
    const list = editsByPageIndex.get(pageIndex) || [];
    list.push(edit);
    editsByPageIndex.set(pageIndex, list);
  }
  const textObjectsByPageIndex = new Map();
  for (const object of insertedTexts) {
    const pageIndex = Number(object?.pageIndex);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || !String(object?.text ?? '').length) continue;
    const list = textObjectsByPageIndex.get(pageIndex) || [];
    list.push(object);
    textObjectsByPageIndex.set(pageIndex, list);
  }
  const imageObjectsByPageIndex = new Map();
  for (const object of insertedImages) {
    const pageIndex = Number(object?.pageIndex);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || !object?.bytes?.length) continue;
    const list = imageObjectsByPageIndex.get(pageIndex) || [];
    list.push(object);
    imageObjectsByPageIndex.set(pageIndex, list);
  }
  const shapeObjectsByPageIndex = new Map();
  for (const object of insertedShapes) {
    const pageIndex = Number(object?.pageIndex);
    if (!Number.isInteger(pageIndex) || pageIndex < 0) continue;
    const list = shapeObjectsByPageIndex.get(pageIndex) || [];
    list.push(object);
    shapeObjectsByPageIndex.set(pageIndex, list);
  }

  let regularFont = null;
  let semiboldFont = null;
  let helvetica = null;
  let helveticaBold = null;
  let helveticaOblique = null;

  async function ensureFont(text, bold, italic) {
    if (CJK_TEXT_RE.test(text)) {
      if (bold && fontSemiboldBytes?.length) {
        semiboldFont = semiboldFont || await output.embedFont(fontSemiboldBytes, { subset: true });
        return semiboldFont;
      }
      if (fontRegularBytes?.length) {
        regularFont = regularFont || await output.embedFont(fontRegularBytes, { subset: true });
      } else {
        regularFont = regularFont || await output.embedFont(StandardFonts.Helvetica);
      }
      return regularFont;
    }

    helvetica = helvetica || await output.embedFont(StandardFonts.Helvetica);
    if (bold) {
      helveticaBold = helveticaBold || await output.embedFont(StandardFonts.HelveticaBold);
      return helveticaBold;
    }
    if (italic) {
      helveticaOblique = helveticaOblique || await output.embedFont(StandardFonts.HelveticaOblique);
      return helveticaOblique;
    }
    return helvetica;
  }

  const imageCache = new Map();
  async function ensureImage(object) {
    const key = object.bytes;
    if (imageCache.has(key)) return imageCache.get(key);
    const mimeType = String(object.mimeType || '').toLowerCase();
    const image = mimeType.includes('jpeg') || mimeType.includes('jpg')
      ? await output.embedJpg(object.bytes)
      : await output.embedPng(object.bytes);
    imageCache.set(key, image);
    return image;
  }

  for (let index = 0; index < pages.length; index++) {
    const pageRef = pages[index];
    const source = sources[pageRef.sourceIndex];
    if (!source?.bytes?.length) {
      throw new Error(`Missing PDF data for source index ${pageRef.sourceIndex}`);
    }
    if (!Number.isInteger(pageRef.pageIndex) || pageRef.pageIndex < 0) {
      throw new Error(`Invalid page index for source index ${pageRef.sourceIndex}`);
    }

    let sourceDoc = sourceCache.get(pageRef.sourceIndex);
    if (!sourceDoc) {
      sourceDoc = await loadPdfLibDocument(source.bytes);
      flattenPdfFormForPageCopy(sourceDoc);
      sourceCache.set(pageRef.sourceIndex, sourceDoc);
    }
    if (pageRef.pageIndex >= sourceDoc.getPageCount()) {
      throw new Error(`Page ${pageRef.pageIndex + 1} is outside source index ${pageRef.sourceIndex}`);
    }

    const copiedPage = inPlaceOutput
      ? output.getPage(index)
      : (await output.copyPages(sourceDoc, [pageRef.pageIndex]))[0];

    for (const edit of editsByPageIndex.get(index) || []) {
      const text = String(edit?.text ?? '');
      const fontSize = Math.max(1, Number(edit?.fontSize) || 10);
      const baselineX = Number(edit?.baselineX) || 0;
      const baselineY = Number(edit?.baselineY) || 0;
      const bold = Boolean(edit?.bold);
      const italic = Boolean(edit?.italic);
      const font = await ensureFont(text, bold, italic);

      const box = edit?.box || {};
      const originalWidth = Math.max(0, Number(box.width) || 0);
      const coverX = Number.isFinite(Number(box.x)) ? Number(box.x) : baselineX;
      const coverY = Number.isFinite(Number(box.y)) ? Number(box.y) : baselineY - fontSize * 0.2;
      const coverHeight = Math.max(fontSize, Number(box.height) || fontSize * 1.05);
      // Keep the mask tied to the immutable source box. A longer replacement
      // must not expand the old-text mask into neighboring content.
      const coverWidth = originalWidth || Math.max(1, font.widthOfTextAtSize(text, fontSize));
      const uiRotation = Number(edit?.rotation) || 0;
      const pdfRotation = uiRotationToPdfAngle(uiRotation);
      const maskPadding = fontSize * 0.08;
      const maskWidth = coverWidth + maskPadding;
      // The replacement can be moved or resized independently of the
      // immutable source mask. Center the rotated replacement mask on its own
      // visual box; rotating the source lower-left around that center drifts
      // whenever the component has moved or changed size.
      const rotationBox = edit?.textBox || edit?.box || {
        x: coverX,
        y: coverY,
        width: maskWidth,
        height: coverHeight
      };
      const replacementX = Number.isFinite(Number(rotationBox.x))
        ? Number(rotationBox.x)
        : coverX;
      const replacementY = Number.isFinite(Number(rotationBox.y))
        ? Number(rotationBox.y)
        : coverY;
      const replacementWidth = Math.max(1, Number(rotationBox.width) || maskWidth);
      const replacementHeight = Math.max(1, Number(rotationBox.height) || coverHeight);
      const actualTextWidth = text.length
        ? font.widthOfTextAtSize(text, fontSize) + maskPadding
        : 0;
      const replacementMaskWidth = Math.max(replacementWidth, actualTextWidth);
      const replacementMaskHeight = Math.max(replacementHeight, coverHeight);
      const replacementMaskX = replacementX - (replacementMaskWidth - replacementWidth) / 2;
      const replacementMaskY = replacementY - (replacementMaskHeight - replacementHeight) / 2;
      const maskOrigin = rotatePdfBoxOriginAroundCenter(
        replacementMaskX,
        replacementMaskY,
        replacementMaskWidth,
        replacementMaskHeight,
        pdfRotation
      );

      const baseMask = {
        x: coverX - maskPadding / 2,
        y: coverY,
        width: maskWidth,
        height: coverHeight,
        color: rgb(1, 1, 1)
      };
      // The source glyphs remain unrotated underneath an edited component.
      // Keep that original mask, then add a center-rotated mask for the new
      // glyphs so neither layer leaks through after a move, resize, or
      // component rotation. The destination mask is only needed when it is
      // materially different from the immutable source mask.
      copiedPage.drawRectangle(baseMask);
      const replacementMaskNeeded = (
        uiRotation
        || Math.abs(replacementX - coverX) > 0.001
        || Math.abs(replacementY - coverY) > 0.001
        || replacementMaskWidth > maskWidth + 0.001
        || replacementMaskHeight > coverHeight + 0.001
      );
      if (replacementMaskNeeded) {
        copiedPage.drawRectangle({
          x: maskOrigin.x,
          y: maskOrigin.y,
          width: replacementMaskWidth,
          height: replacementMaskHeight,
          color: rgb(1, 1, 1),
          rotate: degrees(pdfRotation)
        });
      }

      if (text.length) {
        const anchor = rotatePdfTextAnchorAroundBox(
          baselineX,
          baselineY,
          rotationBox,
          pdfRotation
        );
        copiedPage.drawText(text, {
          x: anchor.x,
          y: anchor.y,
          size: fontSize,
          font,
          rotate: degrees(pdfRotation),
          color: normalizeTextColor(edit?.color)
        });
      }
    }

    for (const object of textObjectsByPageIndex.get(index) || []) {
      const text = String(object.text ?? '');
      if (!text) continue;
      const fontSize = Math.max(1, Number(object.fontSize) || 16);
      const font = await ensureFont(text, Boolean(object.bold), false);
      const width = Math.max(1, Number(object.width) || estimateInsertedTextWidth(text, fontSize));
      const height = Math.max(1, Number(object.height) || fontSize * 1.15);
      const x = Number(object.x) || 0;
      const y = Number(object.y) || 0;
      const uiRotation = Number(object.rotation) || 0;
      const pdfRotation = uiRotationToPdfAngle(uiRotation);
      const anchor = rotatePdfTextAnchorAroundBox(
        x,
        y,
        { x, y: y - height * 0.2, width, height },
        pdfRotation
      );
      copiedPage.drawText(text, {
        x: anchor.x,
        y: anchor.y,
        size: fontSize,
        font,
        rotate: degrees(pdfRotation),
        color: normalizeTextColor(object.color)
      });
    }

    for (const object of imageObjectsByPageIndex.get(index) || []) {
      const image = await ensureImage(object);
      const x = Number(object.x) || 0;
      const y = Number(object.y) || 0;
      const width = Math.max(1, Number(object.width) || 1);
      const height = Math.max(1, Number(object.height) || 1);
      const uiRotation = Number(object.rotation) || 0;
      const pdfRotation = uiRotationToPdfAngle(uiRotation);
      const origin = rotatePdfBoxOriginAroundCenter(x, y, width, height, pdfRotation);
      copiedPage.drawImage(image, {
        x: origin.x,
        y: origin.y,
        width,
        height,
        rotate: degrees(pdfRotation)
      });
    }

    for (const object of shapeObjectsByPageIndex.get(index) || []) {
      const shapeType = ['rect', 'ellipse', 'line'].includes(object.shapeType) ? object.shapeType : 'rect';
      const x = Number(object.x) || 0;
      const y = Number(object.y) || 0;
      const width = Math.max(1, Number(object.width) || 1);
      const height = Math.max(1, Number(object.height) || 1);
      const uiRotation = Number(object.rotation) || 0;
      const pdfRotation = uiRotationToPdfAngle(uiRotation);
      const fill = Array.isArray(object.fill) ? normalizeTextColor(object.fill) : null;
      const stroke = normalizeTextColor(object.stroke);
      const strokeWidth = Math.max(0, Number(object.strokeWidth) || 0);
      const cx = x + width / 2;
      const cy = y + height / 2;

      if (shapeType === 'ellipse') {
        const options = {
          x: cx,
          y: cy,
          xScale: Math.max(0.5, width / 2),
          yScale: Math.max(0.5, height / 2),
          borderWidth: strokeWidth,
          borderColor: stroke,
          rotate: degrees(pdfRotation)
        };
        if (fill) options.color = fill;
        copiedPage.drawEllipse(options);
      } else if (shapeType === 'line') {
        // The SVG preview is drawn in screen coordinates from top-left to
        // bottom-right. Convert those endpoints back to PDF's bottom-left
        // origin before applying the shared center rotation.
        const start = rotatePdfPointAround(x, y + height, cx, cy, pdfRotation);
        const end = rotatePdfPointAround(x + width, y, cx, cy, pdfRotation);
        copiedPage.drawLine({
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          thickness: Math.max(0.1, strokeWidth),
          color: stroke
        });
      } else {
        const corner = rotatePdfPointAround(x, y, cx, cy, pdfRotation);
        const options = {
          x: corner.x,
          y: corner.y,
          width,
          height,
          borderWidth: strokeWidth,
          borderColor: stroke,
          rotate: degrees(pdfRotation)
        };
        if (fill) options.color = fill;
        copiedPage.drawRectangle(options);
      }
    }

    copiedPage.setRotation(degrees(
      copiedPage.getRotation().angle + normalizePageRotation(pageRef.rotation)
    ));
    if (!inPlaceOutput) output.addPage(copiedPage);
    onProgress?.({ done: index + 1, total: pages.length });
  }

  return output.save({ useObjectStreams });
}

/**
 * Encrypt already-assembled PDF bytes with a user password.
 *
 * @param {object} params
 * @param {Uint8Array} params.bytes
 * @param {string} params.password
 * @param {object} [params.permissions]
 */
export async function protectPdf({ bytes, password, permissions = {} }) {
  return encryptPdfBytes({
    fileData: bytes,
    password,
    permissions: normalizePdfEncryptPermissions(permissions),
    onProgress: () => {}
  });
}

/**
 * Produce a single-page PDF for each page in the ordered page list.
 *
 * @param {object} params
 * @param {Array<{ name: string, bytes: Uint8Array }>} params.sources
 * @param {Array<{ sourceIndex: number, pageIndex: number, rotation: number }>} params.pages
 * @param {(info: { done: number, total: number, bytes: Uint8Array, pageNumber: number }) => void} [params.onPage]
 * @returns {Promise<Array<Uint8Array>>}
 */
export async function splitPdfPages({ sources, pages, onPage }) {
  if (!Array.isArray(sources) || !Array.isArray(pages) || pages.length === 0) {
    throw new Error('No PDF pages are available to split');
  }

  const outputs = [];
  for (let index = 0; index < pages.length; index++) {
    const pageRef = pages[index];
    const bytes = await assemblePdf({
      sources,
      pages: [pageRef],
      useObjectStreams: true,
      onProgress: () => {}
    });
    outputs.push(bytes);
    onPage?.({ done: index + 1, total: pages.length, bytes, pageNumber: index + 1 });
  }
  return outputs;
}
