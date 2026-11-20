export const RENAME_DEFAULTS = Object.freeze({ pattern: '{name}_{n}', start: 1, digits: 3, find: '', replace: '', regex: false });
const reserved = /^(CON|PRN|AUX|NUL|CLOCK\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i;
export function validFileName(name) {
  return !!name && name.length <= 240 && !/[<>:"/\\|?*\p{Cc}]/u.test(name) && !/[. ]$/.test(name) && !reserved.test(name) && name !== '.' && name !== '..';
}
export function buildRenamePlan(files, values = {}, date = new Date()) {
  const options = { ...RENAME_DEFAULTS, ...values };
  if (!Number.isSafeInteger(options.start) || options.start < 0 || options.start > 999999999
    || !Number.isSafeInteger(options.digits) || options.digits < 1 || options.digits > 10) throw new Error('序号或位数无效 / Invalid sequence settings');
  if (!options.pattern || options.pattern.length > 200) throw new Error('请输入命名模板 / Enter a naming pattern');
  let search;
  if (options.regex && options.find) {
    if (options.find.length > 120) throw new Error('正则表达式过长 / Regular expression is too long');
    search = new RegExp(options.find, 'gu');
  }
  const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const targets = new Set();
  return files.map((file, index) => {
    const name = String(file.name || file.path?.split(/[\\/]/).pop() || '');
    const dot = name.lastIndexOf('.'), hasExtension = dot > 0;
    const extension = hasExtension ? name.slice(dot) : '';
    let stem = hasExtension ? name.slice(0, dot) : name;
    if (options.find) stem = options.regex ? stem.replace(search, options.replace) : stem.split(options.find).join(options.replace);
    const replacements = { name: stem, n: String(options.start + index).padStart(options.digits, '0'), date: stamp };
    const newName = options.pattern.replace(/\{(name|n|date)\}/g, (_, key) => replacements[key]) + extension;
    const parent = String(file.path || '').replace(/[^\\/]+$/, '').toLowerCase();
    const key = parent + newName.toLowerCase();
    const error = !validFileName(newName) ? '文件名无效 / Invalid filename' : targets.has(key) ? '目标名称重复 / Duplicate target' : '';
    targets.add(key);
    return { path: file.path || '', name, newName, error, changed: name !== newName };
  });
}
