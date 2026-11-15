// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { buildPageScene } from '../core/scene.js';
import { tablesRequiringFallback } from './docx.js';
import { prepareOcrScene } from '../core/ocr-scene.js';
import { contains } from '../core/geometry.js';
import { createOcrTypography } from './ocr-typography.js';
import { ocrMathCandidate, ocrMathFallback } from '../core/ocr-math.js';
import { calibrateNativeTypography } from './native-typography.js';
import { createGlyphEncodingDecoder } from './glyph-encoding.js';
import { recoverMathLetters } from './math-text.js';
import { createNativeDisplayFitter } from './native-display-typography.js';
import { createOcrPhysicalTypography } from './ocr-physical-typography.js';
import { recoverNativeMappingTables } from './native-mapping-tables.js';
import { prepareNativeFallback, refineNativeDisplayInk } from './native-fallback-typography.js';

let typography;
let encodingDecoder;
let nativeDisplayFitter;
let physicalTypography;

/** Use the writer's actual cell measurement before crops and consent are made. */
export function prepareWordScene(snapshot, { measurementContext = null, check = () => {}, pixels = null, width = 0, height = 0, createCanvas = null, preserveGeometry = false, sourceFonts = null } = {}) {
  check();
  createCanvas ||= typeof OffscreenCanvas === 'function' ? (width,height) => new OffscreenCanvas(width,height) : null;
  if (!encodingDecoder && createCanvas) encodingDecoder = createGlyphEncodingDecoder(createCanvas);
  const resolveGlyph = encodingDecoder?.(snapshot, check);
  const scene = buildPageScene(snapshot, { traceTypography: Boolean(pixels), resolveGlyph, preserveGeometry });
  if (preserveGeometry) sourceFonts?.apply(scene, check);
  measurementContext ||= typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
  if (preserveGeometry) prepareNativeFallback(scene, snapshot.fonts, measurementContext, check);
  recoverMathLetters(scene, measurementContext);
  if (preserveGeometry) recoverNativeMappingTables(scene, measurementContext);
  if (!typography && typeof OffscreenCanvas === 'function') typography = createOcrTypography((width,height) => new OffscreenCanvas(width,height));
  if (!nativeDisplayFitter && createCanvas) nativeDisplayFitter = createNativeDisplayFitter(createCanvas);
  calibrateNativeTypography(scene,pixels,width,height,typography,nativeDisplayFitter);
  if (preserveGeometry) refineNativeDisplayInk(scene,pixels,width,height,createCanvas,check);
  const tableFallbackIds = tablesRequiringFallback(scene, measurementContext);
  check();
  if (!tableFallbackIds.length) return scene;
  const fallback = recoverMathLetters(buildPageScene(snapshot, { tableFallbackIds, traceTypography: Boolean(pixels), resolveGlyph, preserveGeometry }), measurementContext);
  if (preserveGeometry) recoverNativeMappingTables(fallback, measurementContext, tableFallbackIds);
  if (preserveGeometry) sourceFonts?.apply(fallback, check);
  if (preserveGeometry) prepareNativeFallback(fallback, snapshot.fonts, measurementContext, check);
  calibrateNativeTypography(fallback,pixels,width,height,typography,nativeDisplayFitter);
  if (preserveGeometry) refineNativeDisplayInk(fallback,pixels,width,height,createCanvas,check);
  return fallback;
}

/** Apply the same measured table preflight to OCR as to native PDF text.
 * An exceptionally small/tight table must retain its visible source instead
 * of failing the whole export or silently clipping editable cell text.
 */
export function prepareOcrWordScene(data, measurementContext = null) {
  measurementContext ||= typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
  if (!typography && typeof OffscreenCanvas === 'function') typography = createOcrTypography((width,height) => new OffscreenCanvas(width,height));
  const prepared = prepareOcrScene({ ...data, measurementContext, fitTypography: typography });
  if (!prepared.changed) return prepared;
  if (!physicalTypography && typeof OffscreenCanvas === 'function') physicalTypography = createOcrPhysicalTypography((width, height) => new OffscreenCanvas(width, height));
  physicalTypography?.(prepared, data);
  const mathSources=new Map();
  prepared.scene.items=prepared.scene.items.map(item=>{
    const math=item.type==='text'&&(ocrMathCandidate(item)||ocrMathFallback(item));if(!math)return item;
    item.sourceIds.forEach(id=>mathSources.set(id,math.sources));return math.item;
  });
  prepared.scene.sources=prepared.scene.sources.flatMap(source=>mathSources.get(source.id)||[source]);
  const rejected = new Set(tablesRequiringFallback(prepared.scene, measurementContext));
  if (!rejected.size) return prepared;
  const scene = prepared.scene, tables = scene.items.filter(item => rejected.has(item.id));
  const sourceIds = new Set(tables.flatMap(table => table.sourceIds));
  const sx = data.width / scene.width, sy = data.height / scene.height;
  for (const table of tables) {
    const x = Math.max(0, Math.floor(table.rect.x * sx)), right = Math.min(data.width, Math.ceil((table.rect.x + table.rect.width) * sx));
    const y = Math.max(0, Math.floor(table.rect.y * sy)), bottom = Math.min(data.height, Math.ceil((table.rect.y + table.rect.height) * sy));
    for (let row = y; row < bottom; row++) prepared.pixels.set(data.pixels.subarray((row * data.width + x) * 4, (row * data.width + right) * 4), (row * data.width + x) * 4);
  }
  scene.sources = scene.sources.map(source => sourceIds.has(source.id) ? { ...source, disposition: 'visible-image' } : source);
  const background = scene.items.find(item => item.ocrBackground);
  if (background) background.sourceIds = [...new Set([...background.sourceIds, ...sourceIds])];
  scene.items = scene.items.filter(item => !rejected.has(item.id) && !(item.type === 'image' && !item.ocrBackground && tables.some(table => contains(table.rect, item.rect, .5))))
    .concat(background ? [] : tables.map(table => ({ id: table.id + ':raster', type: 'image', sourceIds: table.sourceIds, rect: table.rect, role: 'figure', order: 0, reasons: ['ocr-table-fit'] })));
  scene.risks.push('table-image');
  return prepared;
}
