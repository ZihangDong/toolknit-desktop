import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { pdfjsDocumentOptions, destroyPdfDocument } from '../../shared/pdfjs-options.js';
import { readRasterDimensions } from '../../core/image-dimensions.js';
import { OCR_EDIT_LIMITS, editError, validateEditInput, validateEditDimensions, createEditHistory } from './core.js';
export function releaseEditPages(pages) { for (const page of pages) { page.source.width = page.source.height = 1; } }
export async function loadEditPages(file, { invoke, check = () => {}, operation, progress = () => {} } = {}) {
  let pdf, task; const pages = []; let total = 0;
  try {
    const size = file.path ? Number(await invoke('get_file_size', { path: file.path })) : file.size; check(); validateEditInput({ ...file, name:file.name, size });
    const bytes = file.path ? Uint8Array.from(await invoke('read_file_bytes_limited', { path:file.path, maxBytes:OCR_EDIT_LIMITS.inputBytes })) : new Uint8Array(await file.arrayBuffer());
    check(); validateEditInput({ name:file.name,size:bytes.length });
    const add = canvas => { const state = { regions:[],rotation:0 }; pages.push({ source:canvas,...state,history:createEditHistory(state) }); total += canvas.width * canvas.height; };
    if (/\.pdf$/i.test(file.name)) {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); check(); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      task = pdfjs.getDocument(pdfjsDocumentOptions({ data:bytes,isEvalSupported:false })); if (operation) operation.loadingTask = task;
      let password = false; task.onPassword = () => { password = true; void task.destroy().catch(() => {}); };
      try { pdf = await task.promise; } catch (error) { if (password) throw editError('password'); throw error; }
      check(); if (!pdf.numPages || pdf.numPages > OCR_EDIT_LIMITS.pages) throw editError('pages');
      // Preflight every page before allocating raster memory.
      const viewports = []; let planned = 0;
      for (let index = 1; index <= pdf.numPages; index++) { const sheet = await pdf.getPage(index); check(); const viewport = sheet.getViewport({ scale:2 }); const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height); validateEditDimensions(width,height,planned); planned += width * height; viewports.push({ sheet,viewport,width,height }); }
      for (const { sheet,viewport,width,height } of viewports) {
        check(); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; add(canvas);
        const renderTask = sheet.render({ canvasContext:canvas.getContext('2d'),viewport,background:'#ffffff' }); if (operation) operation.renderTask = renderTask;
        await renderTask.promise; check(); sheet.cleanup(); progress(pages.length / pdf.numPages * 90);
      }
    } else {
      const dimensions = readRasterDimensions(bytes,file.name.split('.').pop().toLowerCase()); if (!dimensions) throw editError('decode');
      validateEditDimensions(dimensions.width,dimensions.height);
      const bitmap = await createImageBitmap(new Blob([bytes]),{ imageOrientation:'from-image' });
      try { check(); validateEditDimensions(bitmap.width,bitmap.height,total); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; add(canvas); const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(bitmap,0,0); } finally { bitmap.close(); }
    }
    check(); return pages;
  } catch (error) { releaseEditPages(pages); throw error; }
  finally { if (operation) { operation.loadingTask = null; operation.renderTask = null; } if (pdf) await Promise.resolve(destroyPdfDocument(pdf)).catch(() => {}); else if (task) await task.destroy().catch(() => {}); }
}
