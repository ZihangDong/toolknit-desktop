// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { loadCore } from './core-loader.mjs';
import { withPdf, selectPages, createCanvas } from './pdf-headless.mjs';
import { ToolKnitError } from './errors.mjs';
import { aiConfiguration, requestConfiguredAi, aiFailure } from './ai-provider-runtime.mjs';

export async function convertPdfWord(args, options) {
  const provider = args.ai_mode ? await aiConfiguration() : null;
  const adapter = await loadCore('features/pdf-to-word/adapters/pdfjs.js');
  const { prepareWordScene } = await loadCore('features/pdf-to-word/adapters/scene.js');
  const { inferDocument, validateCoverage } = await loadCore('features/pdf-to-word/core/layout.js');
  const { inspectSceneInk } = await loadCore('features/pdf-to-word/core/ink-coverage.js');
  const { createWordBytes } = await loadCore('features/pdf-to-word/adapters/docx.js');
  const { LIMITS } = await loadCore('features/pdf-to-word/core/input.js');
  const { planContinuousSection } = await loadCore('features/pdf-to-word/adapters/docx-continuous.js');
  return withPdf(args.input.bytes, async (pdf, ops) => {
    const pages = selectPages(args.pages, pdf.numPages, LIMITS.selectedPages);
    const scenes = [], assets = [], canvas = createCanvas(1, 1), measurement = createCanvas(1, 1);
    const operation = { optionalContentConfig: await pdf.getOptionalContentConfig({ intent: 'display' }) };
    let operations = 0, characters = 0, items = 0, assetBytes = 0;
    try {
      for (let index = 0; index < pages.length; index++) {
        options.reportProgress?.(5 + 75 * index / pages.length, `Analyzing page ${index + 1} of ${pages.length}.`);
        const page = await pdf.getPage(pages[index]);
        try {
          const snapshot = await adapter.snapshotPage(page, ops, undefined, operation.optionalContentConfig);
          operations += snapshot.operations.length;
          if (operations > LIMITS.operations) throw new ToolKnitError('INPUT_TOO_LARGE', 'PDF operator complexity exceeds the conversion limit.');
          const plan = await adapter.renderPage(page, canvas, operation);
          snapshot.fonts = adapter.snapshotFonts(page, snapshot.fontIds);
          const scene = prepareWordScene(snapshot, { measurementContext: measurement.getContext('2d') });
          scene.inkCoverage = inspectSceneInk(scene, canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, plan.scale);
          if (!scene.inkCoverage.accepted) throw new ToolKnitError('PROCESSING_FAILED', 'A page contains unsupported visible content; conversion was stopped to avoid dropping it.');
          const pageAssets = await adapter.collectPageAssets(scene, canvas, createCanvas);
          characters += scene.characters; items += scene.sources.length;
          assetBytes += pageAssets.reduce((sum, asset) => sum + asset.bytes.length, 0);
          if (characters > LIMITS.characters || items > LIMITS.items || assetBytes > LIMITS.assetBytes
            || items * 1000 + characters * 4 + assetBytes * 4 > LIMITS.estimatedWorkingBytes) throw new ToolKnitError('INPUT_TOO_LARGE', 'PDF exceeds the text/image working budget.');
          scenes.push(scene); assets.push(...pageAssets);
        } finally { canvas.width = canvas.height = 0; page.cleanup(); }
      }
      if (!characters) throw new ToolKnitError('INPUT_INVALID', 'This PDF has no supported editable text. OCR conversion is not available.');
      const continuous = args.layout === 'a4';
      let document = inferDocument(scenes, { continuous, preserveGeometry: !continuous }), aiReview = null;
      if (provider) {
        const { runWordAi, wordInputDigest } = await loadCore('features/pdf-to-word/ai-runtime.js');
        try {
          const enhanced = await runWordAi({ document, inputDigest: await wordInputDigest(args.input.bytes), expectedProvider: provider,
            layoutOnly: true, operation: { check() {}, abort: new AbortController() },
            requestAi: (messages, signal, maxTokens, requestOptions) => requestConfiguredAi(messages, { ...requestOptions, configuration: provider, signal, maxTokens }),
            onProgress: progress => options.reportProgress?.(80 + 4 * progress.current / Math.max(1, progress.total), 'Reviewing layout with configured AI.'),
            renderRegion: async (source, scope, signal) => {
              const page = await pdf.getPage(source.number), view = page.getViewport({ scale: 1 });
              const scale = Math.min(2, 8192 / Math.max(view.width, view.height), Math.sqrt(4_500_000 / (view.width * view.height)));
              canvas.width = Math.max(1, Math.floor(view.width * scale)); canvas.height = Math.max(1, Math.floor(view.height * scale));
              const render = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale }), background: '#fff' });
              const abort = () => render.cancel(); signal.addEventListener('abort', abort, { once: true });
              const rect = scope.rect, ratio = Math.min(scale, 1600 / Math.max(rect.width, rect.height));
              const crop = createCanvas(Math.max(1, Math.ceil(rect.width * ratio)), Math.max(1, Math.ceil(rect.height * ratio)));
              try {
                await render.promise;
                if (signal.aborted) throw new ToolKnitError('CANCELLED', 'AI region rendering cancelled.');
                crop.getContext('2d').drawImage(canvas, rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale, 0, 0, crop.width, crop.height);
                return crop.toDataURL('image/png');
              } finally { signal.removeEventListener('abort', abort); crop.width = crop.height = canvas.width = canvas.height = 0; page.cleanup(); }
            } });
          document = enhanced.document; aiReview = enhanced.review;
        } catch (error) { throw aiFailure(error); }
      }
      if (continuous) planContinuousSection(document);
      validateCoverage(document);
      options.reportProgress?.(85, 'Writing editable Word document.');
      const { bytes, quality } = await createWordBytes(document, assets, { continuous, preserveGeometry: !continuous, measurementContext: measurement.getContext('2d') });
      return { bytes, meta: { source_pages: pages, layout: continuous ? 'a4' : 'original', image_regions: assets.length, quality, ai_review: aiReview,
        warnings: ['Complex graphics and unsupported formulas can remain images. Word pagination depends on the reader and available fonts.'] } };
    } finally { canvas.width = canvas.height = measurement.width = measurement.height = 0; }
  });
}
