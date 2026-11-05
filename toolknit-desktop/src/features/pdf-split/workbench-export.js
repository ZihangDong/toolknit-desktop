import { copyPdfPages } from '../../core/pdf-page-copy.js';
import { PDFDocument } from 'pdf-lib';
import { flattenPdfFormForPageCopy } from '../../pdf-document-structure.js';
import { splitPdfPages } from '../../pdf-split-core.js';

export async function buildPdfSplitOutput({ documents, pages, mode, assertCurrent = () => {}, onProgress = () => {} }) {
  if (!pages.length || !['single', 'all', 'zip'].includes(mode)) throw new Error('Invalid PDF split export');
  assertCurrent();
  if (mode === 'zip') {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    await splitPdfPages({ documents, pages, onProgress: async ({ output, completed, total }) => {
      assertCurrent();
      // Prefixes prevent collisions between identical source names and page numbers.
      zip.file(`${String(completed).padStart(3, '0')}_${output.fileName}`, output.bytes);
      onProgress(completed / total * 85);
      await new Promise(resolve => setTimeout(resolve, 0));
    } });
    assertCurrent();
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }, meta => {
      assertCurrent(); onProgress(85 + meta.percent * .15);
    });
    assertCurrent();
    return { bytes, fileName: 'split_pages.zip', pageCount: pages.length };
  }
  const output = await PDFDocument.create();
  const sources = new Map();
  for (let index = 0; index < pages.length; index++) {
    assertCurrent(); const { fileIndex, pageIndex } = pages[index];
    let source = sources.get(fileIndex);
    if (!source) {
      source = await PDFDocument.load(documents[fileIndex].fileData.slice());
      flattenPdfFormForPageCopy(source); sources.set(fileIndex, source);
    }
    const [page] = await copyPdfPages(output, source, [pageIndex - 1]); output.addPage(page);
    onProgress((index + 1) / pages.length * 90);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assertCurrent(); const bytes = await output.save(); assertCurrent();
  const checked = await PDFDocument.load(bytes);
  if (checked.getPageCount() !== pages.length) throw new Error('PDF split output validation failed');
  return { bytes, fileName: mode === 'single' ? `split_page_${pages[0].pageIndex}.pdf` : 'split_pages.pdf', pageCount: pages.length };
}
