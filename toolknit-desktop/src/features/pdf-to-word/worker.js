// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { prepareWordScene } from './adapters/scene.js';
import { inferDocument, validateCoverage } from './core/layout.js';
import { createWordBytes } from './adapters/docx.js';
import { planContinuousSection } from './adapters/docx-continuous.js';
import { LIMITS, wordError } from './core/input.js';
import { inspectSceneInk } from './core/ink-coverage.js';

let scenes = [], assets = [], bytes = 0, operations = 0, characters = 0, items = 0;
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    let result;
    if (type === 'scene') {
      operations += data.snapshot.operations.length;
      if (operations > LIMITS.operations) throw wordError('complexity');
      result = prepareWordScene(data.snapshot);
    } else if (type === 'ink') {
      result = inspectSceneInk(data.scene, data.pixels, data.width, data.height, data.scale);
    } else if (type === 'page') {
      if (scenes.length >= LIMITS.selectedPages) throw wordError('selection-large');
      bytes += data.assets.reduce((sum, asset) => sum + asset.bytes.length, 0);
      if (bytes > LIMITS.assetBytes) throw wordError('asset-large');
      characters += data.scene.characters; items += data.scene.sources.length;
      if (characters > LIMITS.characters || items > LIMITS.items) throw wordError('text-large');
      if (items * 1000 + characters * 4 + bytes * 4 > LIMITS.estimatedWorkingBytes) throw wordError('complexity');
      scenes.push(data.scene); assets.push(...data.assets); result = true;
    } else if (type === 'layout') {
      result = inferDocument(scenes, data.options);
      if (data.options?.continuous) planContinuousSection(result);
    } else if (type === 'assets') {
      const ids = new Set(data.ids);
      result = assets.filter(asset => ids.has(asset.id));
    } else if (type === 'finish') {
      validateCoverage(data.document);
      const extra = data.editedAssets || [];
      if (extra.reduce((sum, asset) => sum + asset.bytes.length, bytes) > LIMITS.assetBytes) throw wordError('asset-large');
      result = await createWordBytes(data.document, [...assets, ...extra], data.options);
      self.postMessage({ id, result }, [result.bytes.buffer]); return;
    } else throw wordError('worker');
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error?.code || 'failed' }); }
};
