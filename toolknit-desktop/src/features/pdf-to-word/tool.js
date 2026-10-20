// SPDX-License-Identifier: LicenseRef-ToolKnit-PDF-Word-Source-View-1.0
// Copyright 2026 Zihang Dong.
// Source viewing only; other commercial/noncommercial use requires written authorization: info@toolknit.com
import { createPdfWordController } from './controller.js';
import './pdf-to-word.css';

export function initPdfWordTool(context) { return createPdfWordController(context); }
