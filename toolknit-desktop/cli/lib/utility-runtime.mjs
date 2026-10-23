import { createHash, randomUUID } from 'node:crypto';
import { loadCore } from './core-loader.mjs';
import { readInputFile, readTextInput } from './safe-files.mjs';
import { ToolKnitError, throwIfAborted } from './errors.mjs';

const developer = () => loadCore('features/developer-toolbox/core.js');
const result = (tool, value) => ({ tool, ...value });
function inputError() { return new ToolKnitError('INPUT_INVALID', 'Input cannot be decoded in the requested format.'); }
export async function text_format(args, options) {
  const text = await readTextInput(args, options), core = await loadCore('text-format-core.js');
  throwIfAborted(options.signal);
  try { return result('text.format', { text: core.executeTextFormat(args.action, text) }); }
  catch { throw new ToolKnitError('INPUT_INVALID', 'Text exceeds transformation limits or contains invalid input.'); }
}
export async function json(args, options) {
  const text = await readTextInput(args, options), core = await developer();
  throwIfAborted(options.signal);
  try { return result('dev.json', { text: core.formatJsonText(text, args.indent === 'compact' ? '0' : args.indent ?? '2') }); }
  catch { throw inputError(); }
}
export async function base64(args, options) {
  const text = await readTextInput(args, options), core = await developer();
  throwIfAborted(options.signal);
  try { return result('dev.base64', { text: args.action === 'encode' ? core.encodeBase64Utf8(text) : core.decodeBase64Utf8(text) }); }
  catch { throw inputError(); }
}
export async function url_codec(args, options) {
  const text = await readTextInput(args, options), core = await developer();
  throwIfAborted(options.signal);
  try { return result('dev.url', { text: args.action === 'encode' ? core.encodeUrlComponent(text) : core.decodeUrlComponent(text) }); }
  catch { throw inputError(); }
}
export async function uuid(args, options) {
  throwIfAborted(options.signal);
  return result('dev.uuid', { identifiers: Array.from({ length: args.count ?? 1 }, () => randomUUID()) });
}
export async function jwt_decode(args, options) {
  const text = await readTextInput(args, { ...options, maxBytes: 64 * 1024 }), core = await developer();
  throwIfAborted(options.signal);
  try {
    const { header, payload } = core.decodeJwt(text);
    return result('dev.jwt', { header, payload, signature_verified: false });
  } catch { throw inputError(); }
}
export async function hash(args, options) {
  const bytes = args.input_path !== undefined
    ? (await readInputFile(args.input_path, { maxBytes: 256 * 1024 * 1024, allowEmpty: true, signal: options.signal })).bytes
    : Buffer.from(await readTextInput(args, options), 'utf8');
  throwIfAborted(options.signal);
  const algorithm = args.algorithm ?? 'sha256';
  return result('dev.hash', { algorithm, bytes: bytes.length, checksum: createHash(algorithm).update(bytes).digest('hex') });
}
export async function timestamp(args, options) {
  throwIfAborted(options.signal);
  let milliseconds;
  if (args.iso !== undefined) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(args.iso);
    if (!match) throw new ToolKnitError('INVALID_ARGUMENT', 'Use a full ISO date/time with Z or an explicit timezone offset.');
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] || hour > 23 || minute > 59 || second > 59) {
      throw new ToolKnitError('INVALID_ARGUMENT', 'ISO date/time contains an invalid calendar date or time.');
    }
    milliseconds = Date.parse(args.iso);
  } else milliseconds = args.timestamp * (args.unit === 'seconds' ? 1000 : 1);
  if (!Number.isSafeInteger(milliseconds) || Math.abs(milliseconds) > 8640000000000000) throw new ToolKnitError('INVALID_ARGUMENT', 'Timestamp is outside the supported date range or precision.');
  return result('calculate.timestamp', { milliseconds, seconds: milliseconds / 1000, iso: new Date(milliseconds).toISOString() });
}
function finiteResult(value) {
  if (value === null || value === undefined) throw new ToolKnitError('INVALID_ARGUMENT', 'Required calculation inputs are missing or invalid.');
  const visit = item => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new ToolKnitError('INVALID_ARGUMENT', 'Calculation exceeds finite numeric limits.');
    if (item && typeof item === 'object') for (const child of Object.values(item)) visit(child);
  };
  visit(value); return value;
}
export async function bmi(args, options) {
  throwIfAborted(options.signal);
  const core = await loadCore('features/bmi-calculator/core.js'), value = finiteResult(core.calculateBmi(args));
  if (value.bodyFatError) throw new ToolKnitError('INVALID_ARGUMENT', 'Advanced body-fat calculation requires valid circumference measurements.');
  return result('calculate.bmi', { calculation: value });
}
export async function mortgage(args, options) {
  throwIfAborted(options.signal);
  const core = await loadCore('features/mortgage-calculator/core.js');
  return result('calculate.mortgage', { calculation: finiteResult(core.calculateMortgage({ amountWan: args.principal / 10000, termYears: args.term_years, annualRate: args.annual_rate, method: args.method })) });
}
export async function interest(args, options) {
  throwIfAborted(options.signal);
  const core = await loadCore('features/interest-calculator/core.js');
  return result('calculate.interest', { calculation: finiteResult(core.calculateInterest({ principal: args.principal, regularAmount: args.regular_amount, termYears: args.term_years, annualRate: args.annual_rate, mode: args.mode, frequency: args.frequency })) });
}
export async function color_convert(args, options) {
  throwIfAborted(options.signal);
  const core = await loadCore('features/color-space-compare/core.js'), rgb = core.parseHexColor(args.hex);
  return result('color.convert', { hex: core.rgbToHex(rgb.r, rgb.g, rgb.b), spaces: core.rgbToAllSpaces(rgb.r, rgb.g, rgb.b) });
}
