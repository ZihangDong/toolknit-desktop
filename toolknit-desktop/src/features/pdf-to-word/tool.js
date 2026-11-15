// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
import { createPdfWordController } from './controller.js';
import './pdf-to-word.css';

export function initPdfWordTool(context) { return createPdfWordController(context); }
