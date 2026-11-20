export const WORKFLOW_PRESETS = Object.freeze([
  { id: 'images-pdf', name: '图片 → PDF → 页码', nameEn: 'Images → PDF → page numbers', input: 'images', number: true, quality: 'balanced', start: 1 },
  { id: 'merge-pdf', name: 'PDF 合并 → 页码', nameEn: 'Merge PDFs → page numbers', input: 'pdf', number: true, quality: 'balanced', start: 1 },
]);
export function normalizeWorkflow(value) {
  if (!['images', 'pdf'].includes(value?.input)) throw new Error('Invalid workflow input');
  const start = Number(value.start ?? 1);
  if (!Number.isSafeInteger(start) || start < 1 || start > 999999) throw new Error('Invalid starting page number');
  return { input: value.input, number: value.number !== false, quality: ['clear', 'balanced', 'small'].includes(value.quality) ? value.quality : 'balanced', start };
}
export function validateWorkflowFiles(files, options) {
  if (!files?.length || files.length > 100) throw new Error('请选择 1–100 个文件 / Select 1–100 files');
  const pattern = options.input === 'pdf' ? /\.pdf$/i : /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;
  if (files.some(file => !pattern.test(file.name || ''))) throw new Error('文件类型不适用于此流程 / File type does not match the workflow');
  if (files.reduce((sum, file) => sum + (file.size || 0), 0) > 150 * 1024 * 1024) throw new Error('文件总大小超过 150 MB / Total input exceeds 150 MB');
}

/** The final output is published once, after all processing and cancellation checks. */
export async function runPdfWorkflow({ files, options: value, readFile, readImages, report = () => {}, check = () => {}, write, pdf, addNumbers }) {
  const options = normalizeWorkflow(value);
  validateWorkflowFiles(files, options);
  const { PDFDocument } = pdf;
  const output = await PDFDocument.create();
  let inputBytes = 0;
  for (let i = 0; i < files.length; i++) {
    check(); report(i / files.length * 65, files[i].name);
    if (options.input === 'pdf') {
      const bytes = await readFile(files[i]); check(); inputBytes += bytes.byteLength;
      if (inputBytes > 150 * 1024 * 1024) throw new Error('Total input exceeds 150 MB');
      const source = await PDFDocument.load(bytes);
      if (source.getPageCount() + output.getPageCount() > 200) throw new Error('流程最多处理 200 页 / Maximum 200 pages');
      // Shared copy path preserves forms, annotations, rotations and page boxes.
      const pages = await pdf.copyPages(output, source, source.getPageIndices());
      for (const page of pages) { check(); output.addPage(page); }
    } else {
      const images = await readImages(files[i], options, check); check(); inputBytes += images.bytes;
      if (inputBytes > 150 * 1024 * 1024) throw new Error('Total input exceeds 150 MB');
      for (const image of images.pages) {
        check();
        if (output.getPageCount() >= 200) throw new Error('流程最多处理 200 页 / Maximum 200 pages');
        const embedded = await output.embedJpg(image.bytes);
        const page = output.addPage([image.width, image.height]);
        page.drawImage(embedded, { x: image.x, y: image.y, width: image.drawWidth, height: image.drawHeight });
      }
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  check(); report(68, 'PDF');
  if (!output.getPageCount()) throw new Error('文档没有页面 / Document contains no pages');
  let bytes = await output.save(); check();
  if (options.number) {
    bytes = await addNumbers(bytes, output.getPageCount(), options, percent => report(70 + percent * .27, '页码 / Page numbers'), check);
  }
  check(); report(98, '保存 / Saving');
  if (bytes.byteLength > 150 * 1024 * 1024) throw new Error('Output exceeds 150 MB');
  // write is the commit boundary; cancellation is disabled here by the caller.
  const path = await write(bytes);
  return { path, pages: output.getPageCount(), bytes: bytes.byteLength };
}
