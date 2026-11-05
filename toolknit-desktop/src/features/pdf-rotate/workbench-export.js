import { copyPdfPages } from '../../core/pdf-page-copy.js';
import { PDFDocument } from 'pdf-lib';
import { createPdfRotateFileName, rotatePdfPages } from '../../pdf-rotate-core.js';
import { flattenPdfFormForPageCopy } from '../../pdf-document-structure.js';

export async function buildPdfRotateOutput({ fileData, fileName, pages, mode, onProgress = () => {} }) {
  if (!pages?.length || !['single', 'all', 'zip'].includes(mode) || (mode === 'single' && pages.length !== 1)) {
    throw new Error('Invalid PDF rotation export');
  }
  // Rotate once using the existing validated core. ZIP page extraction reuses this document.
  const bytes = await rotatePdfPages({ fileData, pages,
    onProgress: ({ completed, total }) => onProgress(completed / total * (mode === 'zip' ? 40 : 90)) });
  const checked = await PDFDocument.load(bytes);
  if (checked.getPageCount() !== pages.length) throw new Error('PDF rotation output validation failed');
  const outputName = createPdfRotateFileName(fileName, mode === 'single' ? pages[0].pageIndex : undefined);
  if (mode !== 'zip') {
    onProgress(100);
    return { bytes, fileName: outputName, pageCount: pages.length };
  }
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  flattenPdfFormForPageCopy(checked);
  for (let index = 0; index < pages.length; index++) {
    const output = await PDFDocument.create();
    const [page] = await copyPdfPages(output, checked, [index]);
    output.addPage(page);
    const single = await output.save();
    if ((await PDFDocument.load(single)).getPageCount() !== 1) throw new Error('PDF rotation ZIP validation failed');
    zip.file(createPdfRotateFileName(fileName, pages[index].pageIndex), single);
    onProgress(40 + (index + 1) / pages.length * 45);
  }
  const archive = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' },
    meta => onProgress(85 + meta.percent * .15));
  return { bytes: archive, fileName: outputName.replace(/\.pdf$/i, '.zip'), pageCount: pages.length };
}
