// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
// Exact cmap/hmtx facts for this complete source class only. No font bytes.
const metric = new Map([[772, {"glyphId": 457, "advanceAt1000": 0.0}], [8721, {"glyphId": 963, "advanceAt1000": 708.49609375}], [43, {"glyphId": 3397, "advanceAt1000": 747.0703125}], [61, {"glyphId": 3404, "advanceAt1000": 747.0703125}], [48, {"glyphId": 882, "advanceAt1000": 553.7109375}], [49, {"glyphId": 883, "advanceAt1000": 553.7109375}], [50, {"glyphId": 884, "advanceAt1000": 553.7109375}], [51, {"glyphId": 885, "advanceAt1000": 553.7109375}], [52, {"glyphId": 886, "advanceAt1000": 553.7109375}], [53, {"glyphId": 887, "advanceAt1000": 553.7109375}], [54, {"glyphId": 888, "advanceAt1000": 553.7109375}], [55, {"glyphId": 889, "advanceAt1000": 553.7109375}], [56, {"glyphId": 890, "advanceAt1000": 553.7109375}], [57, {"glyphId": 891, "advanceAt1000": 553.7109375}]]);
export const sourceIndexedSumFontMetric = text => typeof text === "string" && text.length <= 2 && [...text].length === 1 ? metric.get(text.codePointAt(0)) || null : null;
