import { PDFDocument } from 'pdf-lib';
import { copyPdfPages } from '../../core/pdf-page-copy.js';
import { flattenPdfFormForPageCopy } from '../../pdf-document-structure.js';
import { exportPdfWithPageNumbers } from '../../pdf-page-number-core.js';
import { createImageInputs } from '../image-to-pdf/input.js';
import { pagePlan, decodeSize, QUALITY } from '../image-to-pdf/core.js';
import { writeUniqueBinaryFile } from '../../platform/binary-output.js';
import { runPdfWorkflow } from './workflow-core.js';

export async function executeWorkflow({ files, options, isTauri, invoke, getOutputDir, report, signal, onCommit }) {
  const check = () => { if (signal.aborted) throw new DOMException('已取消 / Cancelled', 'AbortError'); };
  const inputs = createImageInputs({ isTauri });
  return runPdfWorkflow({ files, options, check, report,
    pdf: { PDFDocument, copyPages: async (target, source, indexes) => {
      flattenPdfFormForPageCopy(source); return copyPdfPages(target, source, indexes);
    } },
    readFile: async file => {
      const value = isTauri ? await invoke('read_file_bytes_limited', { path: file.path, maxBytes: 150 * 1024 * 1024 }) : await file.arrayBuffer();
      return value instanceof Uint8Array ? value : new Uint8Array(value);
    },
    readImages: async (file, settings) => {
      const source = await inputs.inspect(file, check);
      const pages = [];
      for (const frame of source.frames) {
        check(); const entry = { ...frame, source, rotation: 0 };
        const plan = pagePlan(entry, { quality: settings.quality });
        const { maxWidth, maxHeight } = decodeSize(entry, plan);
        const bitmap = await inputs.bitmap(entry, maxWidth, maxHeight, check);
        const canvas = document.createElement('canvas');
        try {
          canvas.width = Math.max(1, Math.round(plan.drawWidth * plan.pixelWidth / plan.width));
          canvas.height = Math.max(1, Math.round(plan.drawHeight * plan.pixelHeight / plan.height));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY[settings.quality].jpeg));
          check(); if (!blob) throw new Error('Cannot encode image');
          pages.push({ ...plan, bytes: new Uint8Array(await blob.arrayBuffer()) });
        } finally { bitmap.close(); canvas.width = canvas.height = 1; }
      }
      return { bytes: source.size, pages };
    },
    addNumbers: async (bytes, count, settings, progress) => exportPdfWithPageNumbers({
      sources: [{ id: 'workflow', bytes }],
      pages: Array.from({ length: count }, (_, index) => ({ id: `p-${index}`, sourceId: 'workflow', sourcePageIndex: index })),
      settings: { start: settings.start, template: '{page}' },
      shouldCancel: () => signal.aborted, onProgress: event => progress(event.percent)
    }),
    write: async bytes => {
      const directory = await getOutputDir('Workflows'); check();
      const fileName = `ToolKnit_${options.input}_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
      onCommit();
      if (isTauri) return writeUniqueBinaryFile(invoke, { directory, fileName, bytes });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return '';
    }
  });
}
