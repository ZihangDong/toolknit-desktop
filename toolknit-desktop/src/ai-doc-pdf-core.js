import fontkit from './pdf-lib-fontkit.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { cloneAiDocLayout } from './ai-doc-core.js';

const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const PX_TO_PT = A4_WIDTH_PT / A4_WIDTH_PX;
const PAGE_TOP_PX = 60;
const PAGE_BOTTOM_PX = 1060;
const HEADER_Y_PX = 30;
const FOOTER_Y_PX = 1085;
const DEFAULT_GAP_PX = 12;

function colorFromHex(value, fallback) {
  const source = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return rgb(
    Number.parseInt(source.slice(1, 3), 16) / 255,
    Number.parseInt(source.slice(3, 5), 16) / 255,
    Number.parseInt(source.slice(5, 7), 16) / 255
  );
}

function regionOpacity(region) {
  const value = region.style?.opacity;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0.05, Math.min(1, value)) : 1;
}

function regionPadding(region, fallback) {
  const value = region.style?.padding;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) * PX_TO_PT : fallback;
}

function wrapText(text, font, fontSize, maxWidth) {
  const lines = [];
  for (const paragraph of String(text || '').split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const character of paragraph) {
      const candidate = line + character;
      if (line && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

function tableCellsFor(region) {
  if (region.type !== 'table-row') return [];
  return String(region.text || '').split('|').map(cell => cell.trim()).filter(Boolean);
}

function regionGap(regions, index) {
  if (index <= 0) return 0;
  const previous = regions[index - 1];
  const current = regions[index];
  if (Number.isFinite(current.flowGap)) return Math.max(0, Math.min(42, current.flowGap));
  if (previous.type === 'table-row' && current.type === 'table-row') return 0;
  if (previous.type === 'title' && current.type === 'subtitle') return 10;
  const authoredGap = (current.y || 0) - ((previous.y || 0) + (previous.h || 0));
  const minimum = current.type === 'section-heading' ? 20 : DEFAULT_GAP_PX;
  return Math.max(minimum, Math.min(42, Number.isFinite(authoredGap) ? authoredGap : minimum));
}

function fontForRegion(region, regular, bold) {
  return region.bold || ['title', 'section-heading', 'sub-heading', 'emphasis'].includes(region.type)
    ? bold
    : regular;
}

function minimumFlowRegionHeightPx(region) {
  if (region.type === 'divider') return 2;
  if (region.type === 'title') return 32;
  if (region.type === 'section-heading') return 24;
  if (region.type === 'sub-heading') return 18;
  if (region.type === 'table-row') return 30;
  return 16;
}

function regionHeightPx(region, regular, bold) {
  if (region.type === 'image') return region.imageHeight || region.h || 100;
  const declaredHeight = Number.isFinite(region.h) ? region.h : 0;
  // Project controls carry controlId. Their h can be a deliberate CLI/Agent
  // resize and must remain authoritative; raw desktop AI regions only carry a
  // model estimate, so their text height is measured instead.
  const preserveDeclaredHeight = region.layoutMode === 'absolute' || Boolean(region.controlId);
  if (!region.text || region.type === 'divider') {
    return preserveDeclaredHeight
      ? Math.max(minimumFlowRegionHeightPx(region), declaredHeight)
      : minimumFlowRegionHeightPx(region);
  }

  const fontSize = (region.fontSize || 12) * PX_TO_PT;
  const width = (region.w || 200) * PX_TO_PT;
  const font = fontForRegion(region, regular, bold);
  let textWidth = width;
  let verticalPadding = regionPadding(region, fontSize * 0.5);
  let lineHeight = fontSize * (region.style?.lineHeight || (region.type === 'title' ? 1.25 : 1.58));
  let lineCount = 0;

  if (region.type === 'table-row') {
    const cells = tableCellsFor(region);
    if (cells.length > 1) {
      const cellWidth = width / cells.length - 18 * PX_TO_PT;
      lineCount = Math.max(...cells.map(cell => wrapText(cell, regular, fontSize, cellWidth).length));
      lineHeight = fontSize * (region.style?.lineHeight || 1.45);
      verticalPadding = regionPadding(region, 14 * PX_TO_PT);
    }
  } else if (region.type === 'note' || region.type === 'emphasis') {
    textWidth -= 28 * PX_TO_PT;
    verticalPadding = regionPadding(region, 18 * PX_TO_PT);
    lineHeight = fontSize * (region.style?.lineHeight || 1.52);
  } else if (region.type === 'section-heading') {
    textWidth -= 14 * PX_TO_PT;
    verticalPadding = regionPadding(region, 6 * PX_TO_PT);
    lineHeight = fontSize * (region.style?.lineHeight || 1.35);
  }

  if (!lineCount) lineCount = wrapText(region.text, font, fontSize, textWidth).length;
  const measuredHeight = (lineCount * lineHeight + verticalPadding) / PX_TO_PT;
  // Model-supplied h is only an estimate for flow content. Keeping an
  // overestimated value here made the desktop exporter add a spill page even
  // though the same document visibly fit in its authored logical pages.
  return preserveDeclaredHeight
    ? Math.max(minimumFlowRegionHeightPx(region), declaredHeight, measuredHeight)
    : Math.max(minimumFlowRegionHeightPx(region), measuredHeight);
}

function decodeImageData(dataUrl) {
  const encoded = String(dataUrl || '').split(',')[1];
  if (!encoded) throw new Error('Invalid image data URL.');
  if (typeof globalThis.Buffer !== 'undefined') {
    return new Uint8Array(globalThis.Buffer.from(encoded, 'base64'));
  }
  return Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
}

function drawPageChrome(page) {
  const { width, height } = page.getSize();
  const margin = 56 * PX_TO_PT;
  const markWidth = 62 * PX_TO_PT;
  const topY = height - 38 * PX_TO_PT;
  page.drawRectangle({ x: margin, y: topY, width: markWidth, height: 4 * PX_TO_PT, color: rgb(0.09, 0.09, 0.09) });
  page.drawLine({
    start: { x: margin + markWidth, y: topY + 0.5 * PX_TO_PT },
    end: { x: width - margin, y: topY + 0.5 * PX_TO_PT },
    thickness: 0.55,
    color: rgb(0.84, 0.84, 0.82)
  });
  page.drawLine({
    start: { x: margin, y: 38 * PX_TO_PT },
    end: { x: width - margin, y: 38 * PX_TO_PT },
    thickness: 0.45,
    color: rgb(0.86, 0.86, 0.84)
  });
}

async function drawRegion({ region, page, pageHeight, document, regular, bold, imagePlaceholder }) {
  const x = (region.x || 0) * PX_TO_PT;
  const y = pageHeight - ((region.y || 0) + (region.h || 40)) * PX_TO_PT;
  const width = (region.w || 200) * PX_TO_PT;
  const height = (region.h || 40) * PX_TO_PT;
  const fontSize = (region.fontSize || 12) * PX_TO_PT;
  const font = fontForRegion(region, regular, bold);
  const style = region.style || {};
  const opacity = regionOpacity(region);
  let color = rgb(0.1, 0.1, 0.1);

  if (['page-header', 'page-footer'].includes(region.type)) color = rgb(0.6, 0.6, 0.6);
  else if (region.type === 'subtitle') color = rgb(0.4, 0.4, 0.4);
  else if (region.type === 'note') color = rgb(0.5, 0.5, 0.5);
  if (style.textColor) color = colorFromHex(style.textColor, '#1A1A1A');

  const drawStyledBox = ({ defaultBackground = null, defaultBorder = null, defaultBorderWidth = 0 } = {}) => {
    const background = style.backgroundColor
      ? colorFromHex(style.backgroundColor, '#FFFFFF')
      : defaultBackground;
    const border = style.borderColor
      ? colorFromHex(style.borderColor, '#D8D8D6')
      : defaultBorder;
    const borderWidth = (style.borderWidth ?? defaultBorderWidth) * PX_TO_PT;
    if (!background && !borderWidth) return;
    page.drawRectangle({
      x, y, width, height,
      ...(background ? { color: background } : {}),
      ...(border && borderWidth > 0 ? { borderColor: border, borderWidth } : {}),
      opacity,
      borderOpacity: opacity
    });
  };

  if (region.type === 'image' && region.imageData) {
    drawStyledBox();
    const bytes = decodeImageData(region.imageData);
    const image = region.imageData.includes('image/png')
      ? await document.embedPng(bytes)
      : await document.embedJpg(bytes);
    const scale = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    page.drawImage(image, {
      x: x + (width - drawWidth) / 2,
      y: y + (height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
      opacity
    });
    return;
  }

  if (region.type === 'image') {
    drawStyledBox({
      defaultBackground: rgb(0.88, 0.88, 0.88),
      defaultBorder: rgb(0.7, 0.7, 0.7),
      defaultBorderWidth: 0.5 / PX_TO_PT
    });
    const placeholderSize = Math.min(fontSize, 10);
    const placeholder = region.label || imagePlaceholder;
    const placeholderWidth = regular.widthOfTextAtSize(placeholder, placeholderSize);
    page.drawText(placeholder, {
      x: x + (width - placeholderWidth) / 2,
      y: y + height / 2 - placeholderSize / 2,
      size: placeholderSize,
      font: regular,
      color: style.textColor ? color : rgb(0.6, 0.6, 0.6),
      opacity
    });
    return;
  }

  if (region.type === 'divider') {
    page.drawLine({
      start: { x, y: y + height / 2 },
      end: { x: x + width, y: y + height / 2 },
      thickness: (style.dividerWidth ?? style.borderWidth ?? 0.5 / PX_TO_PT) * PX_TO_PT,
      color: colorFromHex(style.dividerColor || style.borderColor, '#CCCCCC'),
      opacity
    });
    return;
  }

  const tableCells = tableCellsFor(region);
  if (tableCells.length > 1) {
    drawStyledBox({
      defaultBackground: region.bold ? rgb(0.915, 0.915, 0.9) : rgb(0.965, 0.965, 0.955),
      defaultBorder: rgb(0.86, 0.86, 0.84),
      defaultBorderWidth: 0.55 / PX_TO_PT
    });
    const cellWidth = width / tableCells.length;
    const horizontalPadding = regionPadding(region, 9 * PX_TO_PT);
    const verticalPadding = regionPadding(region, 7 * PX_TO_PT);
    tableCells.forEach((cellText, cellIndex) => {
      if (cellIndex > 0) {
        const dividerX = x + cellWidth * cellIndex;
        page.drawLine({
          start: { x: dividerX, y },
          end: { x: dividerX, y: y + height },
          thickness: (style.dividerWidth ?? 0.45 / PX_TO_PT) * PX_TO_PT,
          color: colorFromHex(style.dividerColor, '#DBDBD6'),
          opacity
        });
      }
      const cellFont = region.bold || cellIndex === 0 ? bold : regular;
      const lines = wrapText(cellText, cellFont, fontSize, cellWidth - horizontalPadding * 2);
      let lineY = y + height - verticalPadding - fontSize;
      lines.forEach(line => {
        page.drawText(line, {
          x: x + cellWidth * cellIndex + horizontalPadding,
          y: lineY,
          size: fontSize,
          font: cellFont,
          color,
          opacity
        });
        lineY -= fontSize * (style.lineHeight || 1.45);
      });
    });
    return;
  }

  if (!region.text) return;
  let textX = x;
  let textWidth = width;
  let topPadding = 0;
  let lineHeight = fontSize * (style.lineHeight || 1.58);

  if (style.backgroundColor || style.borderColor || style.borderWidth) drawStyledBox();

  if (region.type === 'section-heading') {
    page.drawRectangle({
      x,
      y: y + PX_TO_PT,
      width: 4 * PX_TO_PT,
      height: Math.max(10, height - 2 * PX_TO_PT),
      color: colorFromHex(style.borderColor || style.dividerColor, '#171717'),
      opacity
    });
    const padding = regionPadding(region, 14 * PX_TO_PT);
    textX += padding;
    textWidth -= padding;
    topPadding = regionPadding(region, 2 * PX_TO_PT);
    lineHeight = fontSize * (style.lineHeight || 1.35);
  } else if (region.type === 'note') {
    if (!style.backgroundColor) page.drawRectangle({ x, y, width, height, color: rgb(0.965, 0.965, 0.955), opacity });
    page.drawRectangle({ x, y, width: (style.borderWidth ?? 3) * PX_TO_PT, height, color: colorFromHex(style.borderColor, '#9E9E96'), opacity });
    const padding = regionPadding(region, 14 * PX_TO_PT);
    textX += padding;
    textWidth -= padding * 2;
    topPadding = regionPadding(region, 8 * PX_TO_PT);
    lineHeight = fontSize * (style.lineHeight || 1.52);
  } else if (region.type === 'emphasis') {
    if (!style.backgroundColor) page.drawRectangle({ x, y, width, height, color: rgb(0.105, 0.105, 0.105), opacity });
    if (!style.textColor) color = rgb(1, 1, 1);
    const padding = regionPadding(region, 15 * PX_TO_PT);
    textX += padding;
    textWidth -= padding * 2;
    topPadding = regionPadding(region, 8 * PX_TO_PT);
    lineHeight = fontSize * (style.lineHeight || 1.48);
  } else if (region.type === 'title') {
    const padding = regionPadding(region, 0);
    textX += padding;
    textWidth -= padding * 2;
    topPadding = padding;
    lineHeight = fontSize * (style.lineHeight || 1.25);
  } else if (style.padding !== undefined) {
    const padding = regionPadding(region, 0);
    textX += padding;
    textWidth -= padding * 2;
    topPadding = padding;
  }

  const lines = wrapText(region.text, font, fontSize, textWidth);
  const actualHeight = lines.length * lineHeight + fontSize * 0.5;
  const effectiveHeight = Math.max(height, actualHeight);
  let lineY = y + effectiveHeight - fontSize - topPadding;
  lines.forEach(line => {
    let lineX = textX;
    if (region.align === 'center') {
      lineX = textX + (width - (textX - x) * 2 - font.widthOfTextAtSize(line, fontSize)) / 2;
    } else if (region.align === 'right') {
      lineX = textX + textWidth - font.widthOfTextAtSize(line, fontSize);
    }
    page.drawText(line, { x: lineX, y: lineY, size: fontSize, font, color, opacity });
    lineY -= lineHeight;
  });
}

export async function buildAiDocPdf({
  layout,
  fontRegularBytes,
  fontBoldBytes,
  footerText = (current, total) => `第 ${current} 页 / 共 ${total} 页`,
  imagePlaceholder = '图片位置'
}) {
  const source = cloneAiDocLayout(layout);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  document.setCreator('ToolKnit');
  document.setProducer('ToolKnit AI Document');
  if (source.summary) document.setSubject(source.summary);

  const regular = fontRegularBytes
    ? await document.embedFont(fontRegularBytes, { subset: true })
    : await document.embedFont(StandardFonts.Helvetica);
  const bold = fontBoldBytes
    ? await document.embedFont(fontBoldBytes, { subset: true })
    : regular;

  const pageInfos = source.pages
    .filter(page => Array.isArray(page.regions) && page.regions.length)
    .map((page, logicalPageIndex) => {
      const regions = [...page.regions];
      const header = regions.find(region => region.type === 'page-header') || null;
      const footer = regions.find(region => region.type === 'page-footer') || {
        type: 'page-footer', x: 56, y: FOOTER_Y_PX, w: 682, h: 18,
        text: '', fontSize: 9, bold: false, align: 'center'
      };
      const content = regions.filter(region => !['page-header', 'page-footer'].includes(region.type));
      const flowContent = content.filter(region => region.layoutMode !== 'absolute');
      const absoluteContent = content.filter(region => region.layoutMode === 'absolute');
      let pageCount = 1;
      let currentY = PAGE_TOP_PX;
      flowContent.forEach((region, index) => {
        const gap = regionGap(flowContent, index);
        const needed = regionHeightPx(region, regular, bold);
        if (currentY + gap + needed > PAGE_BOTTOM_PX && currentY > PAGE_TOP_PX) {
          pageCount += 1;
          currentY = PAGE_TOP_PX;
        } else {
          currentY += gap;
        }
        currentY += needed;
      });
      return { header, footer, flowContent, absoluteContent, pageCount, logicalPageIndex };
    });

  const totalPages = pageInfos.reduce((sum, info) => sum + info.pageCount, 0);
  let currentPageNumber = 0;
  let currentY = PAGE_TOP_PX;
  let page = null;
  const renderedControls = [];

  const addPage = () => {
    page = document.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
    currentPageNumber += 1;
    currentY = PAGE_TOP_PX;
    drawPageChrome(page);
    return page;
  };

  const drawTrackedRegion = async (region, logicalPageIndex) => {
    await drawRegion({ region, page, pageHeight: A4_HEIGHT_PT, document, regular, bold, imagePlaceholder });
    if (region.controlId || region.controlNumber || region.id || region.number) {
      renderedControls.push({
        controlId: region.controlId || region.id || null,
        controlNumber: region.controlNumber || region.number || null,
        type: region.type,
        logicalPageIndex,
        pageIndex: currentPageNumber - 1,
        x: region.x || 0,
        y: region.y || 0,
        w: region.w || 0,
        h: region.h || 0
      });
    }
  };

  const drawHeader = async (header, logicalPageIndex) => {
    if (!header) return;
    await drawTrackedRegion({ ...header, y: HEADER_Y_PX }, logicalPageIndex);
  };

  const drawFooter = async (footer, logicalPageIndex) => {
    await drawTrackedRegion(
      { ...footer, y: FOOTER_Y_PX, text: footerText(currentPageNumber, totalPages) },
      logicalPageIndex
    );
  };

  for (const info of pageInfos) {
    if (!page || currentY !== PAGE_TOP_PX || currentPageNumber > 0) addPage();
    await drawHeader(info.header, info.logicalPageIndex);
    for (const original of info.absoluteContent) {
      await drawTrackedRegion({ ...original }, info.logicalPageIndex);
    }
    for (let index = 0; index < info.flowContent.length; index++) {
      const original = info.flowContent[index];
      const needed = regionHeightPx(original, regular, bold);
      const gap = regionGap(info.flowContent, index);
      if (currentY + gap + needed > PAGE_BOTTOM_PX && currentY > PAGE_TOP_PX) {
        await drawFooter(info.footer, info.logicalPageIndex);
        addPage();
        await drawHeader(info.header, info.logicalPageIndex);
      } else {
        currentY += gap;
      }
      const region = { ...original, y: currentY, h: needed };
      await drawTrackedRegion(region, info.logicalPageIndex);
      currentY += needed;
    }
    await drawFooter(info.footer, info.logicalPageIndex);
  }

  const bytes = await document.save();
  return { bytes, pageCount: document.getPageCount(), renderedControls };
}
