import { access } from 'node:fs/promises';

export async function loadCore(relative) {
  const staged = new URL(`./core/${relative}`, import.meta.url);
  try { await access(staged); }
  catch { return import(new URL(`../../src/${relative}`, import.meta.url)); }
  return import(staged.href);
}
