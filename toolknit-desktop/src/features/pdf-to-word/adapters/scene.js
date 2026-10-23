// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { buildPageScene } from '../core/scene.js';
import { tablesRequiringFallback } from './docx.js';

/** Use the writer's actual cell measurement before crops and consent are made. */
export function prepareWordScene(snapshot, { measurementContext = null, check = () => {} } = {}) {
  check();
  const scene = buildPageScene(snapshot);
  measurementContext ||= typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
  const tableFallbackIds = tablesRequiringFallback(scene, measurementContext);
  check();
  return tableFallbackIds.length ? buildPageScene(snapshot, { tableFallbackIds }) : scene;
}
