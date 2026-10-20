// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { LIMITS, wordError, renderPlan } from '../core/input.js';
import { encodeImageAsset } from './image-assets.js';
import { matchRenderedTextOperations, mappedTextSelection } from '../core/render-text-map.js';
export { canvasBytes } from './image-assets.js';
const renderedScales = new WeakMap();
const pageSnapshots = new WeakMap(), renderedPages = new WeakMap();

/** Snapshot before rendering: PDF.js replaces numeric paths with Path2D while drawing. */
export async function snapshotPage(page, ops, check = () => {}, optionalContentConfig = null) {
  const list = await page.getOperatorList(); check();
  if (list.fnArray.length > LIMITS.operationsPerPage) throw wordError('complexity');
  const names = Object.fromEntries(Object.entries(ops).map(([key, value]) => [value, key]));
  const fontIds = new Set();
  const operations = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const name = names[list.fnArray[i]];
    let args = list.argsArray[i] || [];
    if (name === 'setFont') fontIds.add(args[0]);
    if (name === 'setGState') for (const [key, value] of args[0] || []) if (key === 'Font') fontIds.add(value[0]);
    if (name === 'constructPath') {
      const [paint, data, bounds] = args;
      const path = data?.[0];
      args = [names[paint], [Array.isArray(path) || ArrayBuffer.isView(path) ? Array.from(path) : null], bounds ? Array.from(bounds) : null];
    } else if (/^paint(Image|InlineImage|SolidColor)/.test(name)) args = [];
    else if (name === 'dependency') args = [];
    else args = structuredClone(args);
    if (name === 'beginMarkedContentProps' && args[0] === 'OC' && optionalContentConfig) {
      try {
        const visible = optionalContentConfig.isVisible(args[1]);
        if (typeof visible === 'boolean') args = [...args.slice(0, 2), visible];
      } catch { /* Unknown layer visibility remains a rendered fallback. */ }
    }
    operations.push({ name, args });
    if (i % 2000 === 1999) { await new Promise(resolve => setTimeout(resolve, 0)); check(); }
  }
  const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: true }); check();
  if (content.items.length > LIMITS.itemsPerPage) throw wordError('complexity');
  const textCharacters = content.items.reduce((sum, item) => sum + String(item.str || '').replace(/\s/g, '').length, 0);
  if (textCharacters > LIMITS.characters) throw wordError('text-large');
  const viewport = page.getViewport({ scale: 1 });
  const snapshot = { number: page.pageNumber, width: viewport.width, height: viewport.height, transform: viewport.transform,
    operations, textCharacters, fontIds: [...fontIds] };
  pageSnapshots.set(page, { snapshot, names });
  return snapshot;
}

export function snapshotFonts(page, fontIds) {
  const fonts = {};
  for (const id of fontIds) {
    let font;
    try { font = page.commonObjs.get(id); } catch { continue; }
    fonts[id] = { name: font.name || '', ascent: font.ascent, descent: font.descent,
      fallbackFamily: ['serif', 'sans-serif', 'monospace'].includes(font.fallbackName) ? font.fallbackName : undefined,
      bold: Boolean(font.bold), italic: Boolean(font.italic), black: Boolean(font.black),
      data: font.data instanceof Uint8Array && !font.missingFile ? font.data : null,
      matrixScale: font.fontMatrix?.[0] || 0.001, vertical: Boolean(font.vertical), type3: Boolean(font.isType3Font), missingFile: Boolean(font.missingFile) };
  }
  return fonts;
}

export async function renderPage(page, canvas, operation, check = () => {}) {
  const base = page.getViewport({ scale: 1 }), plan = renderPlan(base.width, base.height, 300 / 72);
  canvas.width = plan.width; canvas.height = plan.height;
  renderedScales.set(canvas, plan.scale);
  const captured = pageSnapshots.get(page), context = { page, plan, operation, optionalContentConfig: operation.optionalContentConfig,
    names: captured?.snapshot.operations.map(operation => operation.name), textBinding: null, displayList: null };
  renderedPages.set(canvas, context); pageSnapshots.delete(page);
  const task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: plan.scale }), background: '#ffffff',
    ...(operation.optionalContentConfig ? { optionalContentConfigPromise: Promise.resolve(operation.optionalContentConfig) } : {}) });
  operation.renderTask = task;
  try {
    await task.promise; check();
    // Read the completed display list of the pinned PDF.js build; never mutate
    // it or reuse raw getOperatorList indexes as display indexes.
    if (captured) {
      context.displayList = task._internalRenderTask?.operatorList;
      context.textBinding = matchRenderedTextOperations(captured.snapshot.operations, context.displayList, captured.names);
      captured.snapshot.textLayerMapping = Boolean(context.textBinding);
    }
  } finally { if (operation.renderTask === task) operation.renderTask = null; }
  return plan;
}

export async function collectPageAssets(scene, canvas, createCanvas, check = () => {}) {
  let total = 0;
  const assets = [];
  let background = null;
  const scaleX = renderedScales.get(canvas) ?? canvas.width / scene.width;
  const scaleY = renderedScales.get(canvas) ?? canvas.height / scene.height;
  const images = scene.items.filter(item => item.type === 'image');
  const layers = images.filter(item => item.backgroundPaintIndexes?.length);
  try {
    check();
    if (layers.length) {
      if (layers.length > LIMITS.backgroundLayersPerPage || layers.some(item => !Array.isArray(item.backgroundPaintIndexes)
        || item.backgroundPaintIndexes.length > LIMITS.operationsPerPage)) throw wordError('image');
      const context = renderedPages.get(canvas), indexes = layers.flatMap(item => item.backgroundPaintIndexes);
      if (!context || context.page.pageNumber !== scene.number || canvas.width !== context.plan.width || canvas.height !== context.plan.height
        || indexes.length > LIMITS.operationsPerPage || new Set(indexes).size !== indexes.length
        || indexes.some(index => !Number.isInteger(index) || index < 0 || !['showText', 'showSpacedText'].includes(context.names?.[index]))) throw wordError('image');
      const excluded = mappedTextSelection(context.textBinding, indexes);
      if (!excluded) throw wordError('image');
      background = createCanvas(context.plan.width, context.plan.height);
      const task = context.page.render({ canvas: background, canvasContext: background.getContext('2d'),
        viewport: context.page.getViewport({ scale: context.plan.scale }), background: '#ffffff', operationsFilter: index => !excluded.has(index),
        ...(context.optionalContentConfig ? { optionalContentConfigPromise: Promise.resolve(context.optionalContentConfig) } : {}) });
      context.operation.renderTask = task;
      try {
        await task.promise; check();
        if (task._internalRenderTask?.operatorList !== context.displayList) throw wordError('image');
      }
      finally { if (context.operation.renderTask === task) context.operation.renderTask = null; }
    }
    for (const item of images) {
      check();
      const sourceCanvas = item.backgroundPaintIndexes?.length ? background : canvas, r = item.rect;
      const x = Math.max(0, Math.floor(r.x * scaleX)), y = Math.max(0, Math.floor(r.y * scaleY));
      const width = Math.min(canvas.width - x, Math.max(1, Math.ceil((r.x + r.width) * scaleX) - x));
      const height = Math.min(canvas.height - y, Math.max(1, Math.ceil((r.y + r.height) * scaleY) - y));
      if (width < 1 || height < 1) throw wordError('geometry');
      const crop = createCanvas(width, height);
      try {
        crop.getContext('2d').drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
        const { bytes, format } = await encodeImageAsset(crop, item, createCanvas, check, renderedScales.has(canvas));
        check(); total += bytes.length;
        if (total > LIMITS.assetBytes) throw wordError('asset-large');
        item.assetId = item.id;
        const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        item.fingerprint = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
        assets.push({ id: item.id, bytes, width, height, format,
          ...(item.backgroundPaintIndexes?.length ? { excludedPaintIndexes: [...item.backgroundPaintIndexes] } : {}) });
      } finally { crop.width = crop.height = 0; }
    }
  } finally { if (background) background.width = background.height = 0; }
  return assets;
}
