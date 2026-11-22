import { assertPdfEncryptPassword, normalizePdfEncryptPermissions } from './pdf-encrypt-core.js';

export const WORD_ENCRYPTION_PERMISSIONS = Object.freeze(['modifying', 'copying', 'annotating', 'fillingForms', 'documentAssembly']);
export function normalizeWordEncryption(value) {
  const fail = code => { throw new Error(`word-render:encryption-${code}`); };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['password', 'permissions'].includes(key))) fail('options');
  try { assertPdfEncryptPassword(value.password); }
  catch (error) {
    const code = /pdf-encrypt:(password-[a-z-]+)/.exec(error.message)?.[1];
    fail(code || 'password');
  }
  if (/[\uD800-\uDFFF]/u.test(value.password)) fail('password-unsupported');
  const permissions = value.permissions === undefined ? {} : value.permissions;
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)
    || Object.keys(permissions).some(key => !['printing', 'contentAccessibility', ...WORD_ENCRYPTION_PERMISSIONS].includes(key))
    || (permissions.printing !== undefined && ![false, 'lowResolution', 'highResolution'].includes(permissions.printing))
    || WORD_ENCRYPTION_PERMISSIONS.some(key => permissions[key] !== undefined && typeof permissions[key] !== 'boolean')
    || (permissions.contentAccessibility !== undefined && permissions.contentAccessibility !== true)) fail('permissions');
  return { password: value.password, permissions: normalizePdfEncryptPermissions(permissions) };
}
