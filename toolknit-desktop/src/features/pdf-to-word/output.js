// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.
export function downloadWord(bytes, name, scope) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  const revoke = scope.use(() => URL.revokeObjectURL(url)); scope.timeout(revoke, 30000);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
}
const known = new Set(['type','empty','input-large','pages','selection-large','range','page-size','complexity','text-large','geometry','coverage','layout-quality','asset-large','output-large','worker','timeout','image','structure','output-invalid','output-path','output-name','permission','busy','session','read','edit-text','edit-fit','edit-image','edit-complex']);
export function wordErrorKey(error) {
  const message = String(error?.message || error);
  if (message.startsWith('ocr:')) return message === 'ocr:cancelled' ? 'cancelled' : message === 'ocr:not-installed' ? 'error.ocrMissing' : message === 'ocr:busy' ? 'error.busy' : 'error.ocrFailed';
  if (['cancelled','aborted'].includes(error?.code) || error?.name === 'RenderingCancelledException') return 'cancelled';
  const code = error?.code || message.match(/^pdf-to-word:([^\s:]+)/)?.[1];
  if (['InvalidPDFException','MissingPDFException'].includes(error?.name)) return 'error.read';
  return 'error.' + (known.has(code) ? code : 'failed');
}
