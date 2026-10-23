// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { Paragraph, OnOffElement } from 'docx';

/** docx exposes autoSpaceDN but not autoSpaceDE. Both must be off when source
 * glyph positions already include spacing between CJK and Latin characters.
 */
export class PdfParagraph extends Paragraph {
  prepForXml(context) {
    const result = super.prepForXml(context);
    const children = result?.['w:p'];
    if (!Array.isArray(children)) return result;
    let properties = children.find(child => child?.['w:pPr'])?.['w:pPr'];
    if (!properties) { properties = []; children.unshift({ 'w:pPr': properties }); }
    if (!properties.some(property => property?.['w:autoSpaceDE'])) {
      const position = properties.findIndex(property => ['w:bidi', 'w:snapToGrid', 'w:spacing', 'w:ind', 'w:jc', 'w:rPr'].some(key => property?.[key]));
      properties.splice(position < 0 ? properties.length : position, 0, new OnOffElement('w:autoSpaceDE', false).prepForXml(context));
    }
    return result;
  }
}
