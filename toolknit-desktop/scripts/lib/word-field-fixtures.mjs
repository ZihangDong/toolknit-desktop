import { Document, Packer, Paragraph, HeadingLevel, Footer, TextRun, PageNumber } from 'docx';
import JSZip from 'jszip';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const field = (instruction, cached) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${escape(instruction)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${escape(cached)}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;

export async function createWordFieldFixture(root, { externalUrl = 'http://127.0.0.1:9/field-probe', sections = 70,
  name = 'internal-fields.docx', includeExternal = true, includeCaptionIndexes = false, includeLocalIndexes = false } = {}) {
  await mkdir(root, { recursive: true });
  const headings = Array.from({ length: sections }, (_, i) => `SECTION_${String(i + 1).padStart(2, '0')}_中文标题`);
  const doc = new Document({ ...(includeLocalIndexes ? { customProperties: [{ name: 'LocalProperty', value: 'CURRENT_LOCAL_PROPERTY' }] } : {}),
    styles: { default: { document: { run: { font: 'Noto Sans SC', size: 22 } } } }, sections: [{
    properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
    footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun('FOOTER_PAGE '), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun(' / '), new TextRun({ children: [PageNumber.TOTAL_PAGES] })] })] }) },
    children: [new Paragraph('INTERNAL_FIELD_TEST'), new Paragraph('REF_TEXT_MARKER'), new Paragraph('REF_PAGE_MARKER'),
      new Paragraph('TOTAL_COUNT_MARKER'), new Paragraph('DATE_FIELD_MARKER'), new Paragraph('EXTERNAL_FIELD_MARKER'), new Paragraph('TOC_MARKER'),
      ...(includeCaptionIndexes ? [new Paragraph('FIGURE_INDEX_MARKER'), new Paragraph('TABLE_INDEX_MARKER'),
        new Paragraph('LOCKED_DATE_MARKER')] : []),
      ...(includeLocalIndexes ? [new Paragraph('ALPHA_INDEX_MARKER'), new Paragraph('CUSTOM_INDEX_MARKER'), new Paragraph('EXTRA_FIELDS_MARKER')] : []),
      ...headings.flatMap(title => [new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, pageBreakBefore: true }), new Paragraph('BODY_ANCHOR_' + title)]),
      ...(includeCaptionIndexes ? [new Paragraph('FIGURE_CAPTION_MARKER'), new Paragraph('TABLE_CAPTION_MARKER')] : []),
      ...(includeLocalIndexes ? [new Paragraph('LOCAL_ENTRIES_MARKER')] : [])]
  }] });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  let xml = await zip.file('word/document.xml').async('string');
  const replaceParagraph = (marker, replacement) => { xml = xml.replace(new RegExp(`<w:p(?: [^>]*)?>(?:(?!<w:p[ >])[\\s\\S])*?<w:t(?: [^>]*)?>${marker}</w:t>[\\s\\S]*?</w:p>`), replacement); };
  replaceParagraph('REF_TEXT_MARKER', `<w:p><w:r><w:t xml:space="preserve">TARGET_REFERENCE </w:t></w:r>${field('REF TargetBookmark \\h', 'STALE_REFERENCE')}</w:p>`);
  replaceParagraph('REF_PAGE_MARKER', `<w:p><w:r><w:t xml:space="preserve">TARGET_PAGE </w:t></w:r>${field('PAGEREF TargetBookmark \\h', '999')}</w:p>`);
  replaceParagraph('TOTAL_COUNT_MARKER', `<w:p><w:r><w:t xml:space="preserve">TOTAL_COUNT </w:t></w:r>${field('NUMPAGES', '999')}</w:p>`);
  replaceParagraph('DATE_FIELD_MARKER', `<w:p><w:r><w:t xml:space="preserve">PRESERVED_DATE </w:t></w:r>${field('DATE \\@ "yyyy-MM-dd"', '2001-01-01')}</w:p>`);
  replaceParagraph('EXTERNAL_FIELD_MARKER', `<w:p><w:r><w:t xml:space="preserve">EXTERNAL_CACHE </w:t></w:r>${includeExternal ? field(`INCLUDETEXT "${externalUrl}"`, 'EXTERNAL_CACHED_TEXT') : '<w:r><w:t>EXTERNAL_CACHED_TEXT</w:t></w:r>'}</w:p>`);
  replaceParagraph('TOC_MARKER', `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-1" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>STALE_TOC 999</w:t></w:r></w:p><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:sdtContent></w:sdt>`);
  if (includeCaptionIndexes) {
    for (const [label, marker] of [['Figure', 'FIGURE'], ['Table', 'TABLE']]) {
      replaceParagraph(`${marker}_INDEX_MARKER`, `<w:p>${field(`TOC \\h \\z \\c "${label}"`, `STALE_${marker}_INDEX`)}</w:p>`);
      replaceParagraph(`${marker}_CAPTION_MARKER`, `<w:p><w:r><w:t xml:space="preserve">${label} </w:t></w:r>${field(`SEQ ${label} \\* ARABIC`, '1')}<w:r><w:t xml:space="preserve"> ${marker}_LOCAL_CAPTION</w:t></w:r></w:p>`);
    }
    const lockedDate = field('DATE \\@ "yyyy-MM-dd"', '2002-02-02').replace('w:fldCharType="begin"', 'w:fldCharType="begin" w:fldLock="true"');
    replaceParagraph('LOCKED_DATE_MARKER', `<w:p><w:r><w:t xml:space="preserve">LOCKED_DATE </w:t></w:r>${lockedDate}</w:p>`);
  }
  if (includeLocalIndexes) {
    replaceParagraph('ALPHA_INDEX_MARKER', `<w:p>${field('INDEX \\h "A"', 'STALE_ALPHA_INDEX')}</w:p>`);
    replaceParagraph('CUSTOM_INDEX_MARKER', `<w:p>${field('TOC \\f X \\l "1-1"', 'STALE_CUSTOM_INDEX')}</w:p>`);
    replaceParagraph('LOCAL_ENTRIES_MARKER', `<w:p><w:r><w:t>LOCAL_INDEX_TARGET</w:t></w:r>${field('XE "ALPHABETIC_LOCAL_ENTRY"', '')}${field('TC "CUSTOM_LOCAL_ENTRY" \\f X \\l 1', '')}</w:p>`);
    const locked = (instruction, cached) => field(instruction, cached).replace('w:fldCharType="begin"', 'w:fldCharType="begin" w:fldLock="true"');
    replaceParagraph('EXTRA_FIELDS_MARKER', `<w:p><w:r><w:t xml:space="preserve">EXPRESSION_VALUE </w:t></w:r>${field('= 2 + 3', '99')}<w:r><w:t xml:space="preserve"> LOCKED_EXPRESSION_VALUE </w:t></w:r>${locked('= 4 + 5', '88')}<w:r><w:t xml:space="preserve"> PROPERTY_VALUE </w:t></w:r>${field('DOCPROPERTY LocalProperty', 'CACHED_PROPERTY')}<w:r><w:t xml:space="preserve"> LOCKED_PROPERTY_VALUE </w:t></w:r>${locked('DOCPROPERTY LocalProperty', 'LOCKED_PROPERTY')}</w:p>`);
  }
  const target = escape(headings.at(-1));
  xml = xml.replace(new RegExp(`<w:t[^>]*>${target}</w:t>`), `<w:t>${target}</w:t></w:r><w:bookmarkStart w:id="99" w:name="TargetBookmark"/><w:r><w:t> TARGET_BOOKMARK_TEXT</w:t></w:r><w:bookmarkEnd w:id="99"/><w:r>`);
  xml = xml.replaceAll('<w:pStyle w:val="Heading1"/>', '<w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/>');
  zip.file('word/document.xml', xml);
  const source = path.join(root, name);
  await writeFile(source, await zip.generateAsync({ type: 'nodebuffer' }));
  return { source, headings, externalUrl };
}
