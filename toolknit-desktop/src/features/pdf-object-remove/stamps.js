import { PDFArray, PDFBool, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib';
import { REMOVE_LIMITS, removeError } from './core.js';

const N = PDFName.of;
const popupKey = N('Popup'), parentKey = N('Parent');
const relatedKeys = [popupKey, N('IRT'), parentKey];
const excludedKeys = ['IRT', 'Parent', 'RT', 'StructParent', 'OC', 'A', 'AA'].map(N);
const popupFields = new Set(['Type', 'Subtype', 'Parent', 'Rect', 'P', 'F', 'Open', 'NM', 'M'].map(N));
// Invisible, Hidden, NoView, ToggleNoView, ReadOnly, Locked, LockedContents.
const excludedFlags = 1 | 2 | 32 | 256 | 64 | 128 | 512;

function editableFlags(annotation) {
  const flagObject = annotation.lookup(N('F'));
  const flags = flagObject instanceof PDFNumber ? flagObject.asNumber() : 0;
  if ((annotation.has(N('F')) && !(flagObject instanceof PDFNumber)) ||
      !Number.isSafeInteger(flags) || flags < 0 || flags > 1023 || (flags & excludedFlags)) return null;
  return flags;
}

function annotationRect(annotation) {
  const rectangle = annotation.lookup(N('Rect'));
  if (!(rectangle instanceof PDFArray) || rectangle.size() !== 4) return null;
  const bounds = rectangle.asArray().map(value => annotation.context.lookup(value));
  if (!bounds.every(value => value instanceof PDFNumber && Number.isFinite(value.asNumber()))) return null;
  const rect = bounds.map(value => value.asNumber());
  if (rect[0] === rect[2] || rect[1] === rect[3]) return null;
  return rect;
}

function stampDescriptor(annotation) {
  if (annotation.get(N('Subtype')) !== N('Stamp') || excludedKeys.some(key => annotation.has(key))) return null;
  const flags = editableFlags(annotation), rect = annotationRect(annotation);
  if (flags === null || !rect) return null;

  const appearance = annotation.lookup(N('AP'));
  if (!(appearance instanceof PDFDict)) return null;
  let normalRef = appearance.get(N('N')), normal = appearance.lookup(N('N'));
  let state = null;
  if (normal instanceof PDFDict) {
    // Only use unambiguous, non-interactive normal states.
    if (appearance.has(N('R')) || appearance.has(N('D'))) return null;
    state = annotation.get(N('AS'));
    if (!(state instanceof PDFName)) return null;
    normalRef = normal.get(state);
    normal = normal.lookup(state);
  }
  if (!(normalRef instanceof PDFRef) || !(normal instanceof PDFRawStream) ||
      normal.dict.get(N('Subtype')) !== N('Form')) return null;

  // Match the same embedded appearance at the same position. Appearance and page
  // objects can be shared, so none of them are rewritten when a stamp is removed.
  const rotation = annotation.lookup(N('Rotate'));
  const opacity = annotation.lookup(N('CA'));
  const angle = rotation instanceof PDFNumber ? rotation.asNumber() : 0;
  const alpha = opacity instanceof PDFNumber ? opacity.asNumber() : 1;
  if ((annotation.has(N('Rotate')) && !(rotation instanceof PDFNumber)) ||
      (annotation.has(N('CA')) && !(opacity instanceof PDFNumber)) ||
      !Number.isFinite(angle) || !Number.isFinite(alpha) || alpha <= 0 || alpha > 1) return null;
  return JSON.stringify(['stamp', String(normalRef), rect, flags, angle, alpha, state?.toString() ?? null]);
}

function pairedPopupIndex(stamp, page, pageIndex, locations, incoming) {
  const stampLink = locations.get(stamp), popupRef = stamp.get(popupKey), popup = stamp.lookup(popupKey);
  if (!(stampLink?.raw instanceof PDFRef) || !(popupRef instanceof PDFRef) || !(popup instanceof PDFDict)) return null;
  const popupLink = locations.get(popup);
  if (stampLink.pageIndex !== pageIndex || popupLink?.pageIndex !== pageIndex ||
      popupLink.raw !== popupRef || popup.get(parentKey) !== stampLink.raw ||
      popup.get(N('Subtype')) !== popupKey || popup.keys().some(key => !popupFields.has(key))) return null;
  if (popup.has(N('Type')) && popup.get(N('Type')) !== N('Annot')) return null;
  if (popup.has(N('Open')) && popup.lookup(N('Open')) !== PDFBool.False) return null;
  if (editableFlags(popup) === null || !annotationRect(popup)) return null;
  if ([stamp, popup].some(entry => entry.has(N('P')) && entry.get(N('P')) !== page.ref)) return null;
  const stampOwner = incoming.get(stamp), popupOwner = incoming.get(popup);
  if (stampOwner?.entry !== popup || stampOwner.key !== parentKey ||
      popupOwner?.entry !== stamp || popupOwner.key !== popupKey) return null;
  return popupLink.index;
}

export function collectStampCandidates(document, check) {
  const pages = document.getPages();
  const incoming = new Map(), locations = new Map();
  const annotations = [];
  let count = 0;
  for (const [pageIndex, page] of pages.entries()) {
    check();
    const array = page.node.lookup(N('Annots'));
    if (!(array instanceof PDFArray)) {
      annotations.push([]);
      continue;
    }
    count += array.size();
    if (count > REMOVE_LIMITS.objects) throw removeError('complex');
    const entries = array.asArray().map(value => document.context.lookup(value));
    annotations.push(entries);
    for (const [index, entry] of entries.entries()) {
      if (!(entry instanceof PDFDict)) continue;
      locations.set(entry, locations.has(entry) ? null : { pageIndex, index, raw: array.get(index) });
      for (const key of relatedKeys) {
        const target = entry.lookup(key);
        if (target instanceof PDFDict) incoming.set(target, incoming.has(target) ? null : { entry, key });
      }
    }
  }

  let candidates = 0;
  return annotations.map((entries, pageIndex) => {
    check();
    const stamps = [];
    for (const [annotationIndex, entry] of entries.entries()) {
      if (!(entry instanceof PDFDict)) continue;
      const signature = stampDescriptor(entry);
      if (!signature) continue;
      const popupAnnotationIndex = entry.has(popupKey)
        ? pairedPopupIndex(entry, pages[pageIndex], pageIndex, locations, incoming)
        : null;
      if (entry.has(popupKey) ? popupAnnotationIndex === null : incoming.has(entry)) continue;
      if (++candidates > REMOVE_LIMITS.candidates) throw removeError('complex');
      // Popup pairs are selected individually; visual equality says nothing about comments.
      stamps.push({ kind: 'stamp', label: '', annotationIndex, annotationNumber: annotationIndex + 1,
        ...(popupAnnotationIndex === null ? { signature }
          : { popupAnnotationIndex, signature: JSON.stringify([signature, pageIndex, annotationIndex]) }),
      });
    }
    return stamps;
  });
}

export function removePageStamps(page, indexes) {
  const annotations = page.node.lookup(N('Annots'));
  if (!(annotations instanceof PDFArray) || [...indexes].some(index => index < 0 || index >= annotations.size())) {
    throw removeError('selection');
  }
  const remaining = annotations.asArray().filter((_, index) => !indexes.has(index));
  page.node.set(N('Annots'), page.node.context.obj(remaining));
}
