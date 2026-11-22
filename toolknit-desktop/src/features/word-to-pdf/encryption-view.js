import { normalizeWordEncryption, WORD_ENCRYPTION_PERMISSIONS } from '../../word-encryption-core.js';

export function createWordEncryptionView({ q, lifetime }) {
  const fields = ['EncryptionPassword', 'EncryptionConfirm', 'EncryptionPrinting', ...WORD_ENCRYPTION_PERMISSIONS.map(key => `Encryption${key[0].toUpperCase()}${key.slice(1)}`)];
  const enabled = () => q('EncryptionEnabled').checked;
  function render(busy = false) {
    q('EncryptionEnabled').disabled = busy; q('EncryptionSettings').hidden = !enabled();
    fields.forEach(id => { q(id).disabled = busy || !enabled(); });
  }
  function clearPasswords() { q('EncryptionPassword').value = ''; q('EncryptionConfirm').value = ''; }
  function prepare() {
    if (!enabled()) return null;
    if (q('EncryptionPassword').value !== q('EncryptionConfirm').value) throw new Error('word-render:encryption-password-mismatch');
    const permissions = { printing: q('EncryptionPrinting').value === 'none' ? false : q('EncryptionPrinting').value,
      ...Object.fromEntries(WORD_ENCRYPTION_PERMISSIONS.map(key => [key, q(`Encryption${key[0].toUpperCase()}${key.slice(1)}`).checked])) };
    const value = normalizeWordEncryption({ password: q('EncryptionPassword').value, permissions });
    clearPasswords(); return value;
  }
  function reset() {
    q('EncryptionEnabled').checked = false; clearPasswords(); q('EncryptionPrinting').value = 'highResolution';
    WORD_ENCRYPTION_PERMISSIONS.forEach(key => { q(`Encryption${key[0].toUpperCase()}${key.slice(1)}`).checked = true; }); render();
  }
  lifetime.event(q('EncryptionEnabled'), 'change', () => { if (!enabled()) clearPasswords(); render(); });
  lifetime.use(clearPasswords);
  function restore(permissions = {}) {
    reset(); q('EncryptionEnabled').checked = true;
    q('EncryptionPrinting').value = permissions.printing === false ? 'none' : permissions.printing || 'highResolution';
    WORD_ENCRYPTION_PERMISSIONS.forEach(key => { q(`Encryption${key[0].toUpperCase()}${key.slice(1)}`).checked = permissions[key] !== false; }); render();
  }
  return { prepare, render, reset, clearPasswords, restore };
}
