// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { validRect, overlaps, contains } from './geometry.js';

const CAPTION = /^(?:fig(?:ure)?\.?|图)\s*(?:[0-9]{1,4}|[一二三四五六七八九十]{1,3})\s*[:：.、]\s*\S/iu;

/** With no accepted new text, keep the native page intact. Uncertain OCR
 * hypotheses may be attributed to a containing original composited image;
 * they do not justify erasing/rebuilding native tables or adding new layers.
 * No owner, conflicting ids or exhausted work budget leaves the old recovery
 * path responsible. Nothing is partially attached on refusal.
 */
export function retainUnverifiedImageSources(scene, candidates) {
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 1000
    || !Array.isArray(scene?.sources) || !Array.isArray(scene.items)
    || scene.sources.length > 20_000 || scene.items.length > 20_000) return null;
  const ids = new Set(scene.sources.map(source => source.id)), itemIds = new Set(scene.items.map(item => item.id));
  if (itemIds.size !== scene.items.length || ids.size !== scene.sources.length) return null;
  const images = scene.items.filter(item => item.type === 'image' && !item.thin && !item.decoration
    && typeof item.id === 'string' && validRect(item.rect));
  const owners = new Map(); let remaining = 250_000;
  for (const source of candidates) {
    if (typeof source?.id !== 'string' || ids.has(source.id) || source.ocrUnverified !== true
      || source.disposition !== 'visible-image' || typeof source.text !== 'string' || !validRect(source.rect)) return null;
    ids.add(source.id);
    let owner = null, area = Infinity;
    for (const image of images) {
      if (--remaining < 0) return null;
      const size = image.rect.width * image.rect.height;
      if (size < area && contains(image.rect, source.rect, 2)) { owner = image; area = size; }
    }
    if (!owner) return null;
    let assigned = owners.get(owner.id);
    if (!assigned) owners.set(owner.id, assigned = []);
    assigned.push(source.id);
  }
  const sources = [...scene.sources, ...candidates];
  return { ...scene, sources,
    items: scene.items.map(item => owners.has(item.id)
      ? { ...item, sourceIds: [...(item.sourceIds || []), ...owners.get(item.id)] } : item),
    risks: [...new Set([...(scene.risks || []), 'ocr', 'ocr-low-confidence'])],
    characters: sources.reduce((count, source) => count + source.text.length, 0), ocr: true };
}

/** A large illustration is not a scanned body merely because it exceeds the
 * page OCR area threshold. Require an independently native caption, nearby
 * geometry and other native body text. Unknown or overlapping regions retain
 * the existing OCR policy; this does not guess picture text from its context.
 */
export function nativeCaptionedFigureIds(scene) {
  const protectedIds = new Set();
  if (!scene || scene.rasterPage || scene.risks?.includes('image-page')
    || !Number.isFinite(scene.width * scene.height) || scene.width <= 0 || scene.height <= 0
    || !Array.isArray(scene.items) || scene.items.length > 20_000
    || !Array.isArray(scene.sources) || scene.sources.length > 20_000) return protectedIds;
  const text = scene.items.filter(item => item.type === 'text' && !item.raster && !item.ocr
    && typeof item.text === 'string' && !/[\p{Cc}\ufffd]/u.test(item.text) && validRect(item.rect));
  if (text.reduce((total, item) => total + item.text.replace(/\s/gu, '').length, 0) < 120) return protectedIds;
  const sources = new Map(scene.sources.map(source => [source.id, source]));
  const captions = text.filter(item => CAPTION.test(item.text.trim())
    && Number.isFinite(item.size) && item.size >= 4 && item.size <= 18
    && item.sourceIds?.length && item.sourceIds.every(id => {
      const source = sources.get(id);
      return typeof source?.text === 'string' && !/[\p{Cc}\ufffd]/u.test(source.text);
    }) && item.sourceIds.map(id => sources.get(id).text).join('') === item.text).slice(0, 128);
  if (!captions.length) return protectedIds;
  let remaining = 20_000;
  const pageArea = scene.width * scene.height;
  const page = { x: 0, y: 0, width: scene.width, height: scene.height };
  for (const image of scene.items) {
    if (image.type !== 'image' || image.role !== 'figure' || image.decoration || image.thin
      || !validRect(image.rect) || !contains(page, image.rect, 0) || image.sourceIds?.length || image.reasons?.length
      || !image.drawingIds?.length || typeof image.id !== 'string') continue;
    const box = image.rect, area = box.width * box.height;
    if (area < pageArea * .02 || area > pageArea * .65) continue;
    let captionFound = false;
    for (const caption of captions) {
      if (--remaining < 0) return protectedIds;
      const rect = caption.rect, gap = rect.y - box.y - box.height;
      if (gap < 0 || gap > caption.size * 1.25 || rect.width < box.width * .55 || rect.width > box.width * 1.4) continue;
      const leftAligned = Math.abs(rect.x - box.x) <= Math.max(caption.size * 1.25, box.width * .05);
      const centered = Math.abs(rect.x + rect.width / 2 - box.x - box.width / 2) <= box.width * .07;
      if (leftAligned || centered) { captionFound = true; break; }
    }
    if (!captionFound) continue;
    let outside = 0, intersects = false;
    for (const item of text) {
      if (--remaining < 0) return protectedIds;
      if (overlaps(item.rect, box)) { intersects = true; break; }
      outside++;
    }
    if (!intersects && outside >= 3) protectedIds.add(image.id);
  }
  return protectedIds;
}
