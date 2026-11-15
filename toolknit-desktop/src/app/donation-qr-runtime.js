import { loadTauriDialog, tauriCorePromise } from '../platform/tauri-runtime.js';

const QR_FILES = Object.freeze({ alipay: 'ToolKnit-Alipay.png', wechat: 'ToolKnit-WeChat.png' });

/** Download only the bundled, author-supplied payment image. No payment data is collected. */
export async function saveDonationQr(kind, {
  isTauri = false,
  signal,
  loadDialog = loadTauriDialog,
  core = tauriCorePromise,
  fetchAsset = globalThis.fetch,
  documentRef = globalThis.document
} = {}) {
  const fileName = Object.hasOwn(QR_FILES, kind) ? QR_FILES[kind] : null;
  if (!fileName) throw new Error('Unknown support image');
  if (signal?.aborted) return false;
  const url = `/assets/donate/${fileName}`;
  if (!isTauri) {
    const link = documentRef.createElement('a');
    link.href = url;
    link.download = fileName;
    documentRef.body.append(link);
    try { link.click(); } finally { link.remove(); }
    return true;
  }
  const dialog = await loadDialog();
  if (signal?.aborted) return false;
  const path = await dialog.save({ defaultPath: fileName, filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (!path || signal?.aborted) return false;
  const response = await fetchAsset(url, { signal });
  if (!response.ok) throw new Error('Support image unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 8 || bytes.length > 256 * 1024 ||
      ![137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte)) {
    throw new Error('Invalid support image');
  }
  const { invoke } = await core;
  if (signal?.aborted) return false;
  // The Save dialog confirms the exact destination and any overwrite.
  await invoke('write_file_bytes', { path, bytes: Array.from(bytes) });
  return true;
}
