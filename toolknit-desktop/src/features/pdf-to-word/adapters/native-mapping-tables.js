// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { nativeMappingTablePlans } from '../core/native-mapping-tables.js';
import { measureLineBox } from './text-layout.js';
import { fitNativeMappingArrow } from './math-text.js';

export function recoverNativeMappingTables(scene, context, excludedIds = []) {
  if (!context) return scene;
  const plans = nativeMappingTablePlans(scene, {
    fitArrow: glyph => fitNativeMappingArrow(glyph, context),
    measureLine: line => measureLineBox(line, context, false, null, true), excludedIds,
  });
  if (!plans.length) return scene;
  const claimed = new Set(plans.flatMap(plan => [...plan.members]));
  const recovered = new Set(plans.flatMap(plan => plan.recoveredSources));
  scene.items = scene.items.filter(item => !claimed.has(item)).concat(plans.map(plan => plan.table));
  for (const source of scene.sources) if (recovered.has(source.id)) source.disposition = 'editable';
  return scene;
}
