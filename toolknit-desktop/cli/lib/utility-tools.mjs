import { operation, schema, number, integer, choice, textSource, oneTextSource } from './operation-schema.mjs';

const define = (name, command, description, fields, required = [], extra = {}) => operation(name, command, description,
  schema(fields, required, extra), './utility-runtime.mjs', name);
export const UTILITY_OPERATIONS = [
  define('text_format', ['text', 'format'], 'Apply one explicit local text transformation. Returns text; writes no files.',
    { ...textSource, action: choice(['uppercase', 'lowercase', 'titlecase', 'capitalize', 'trimSpaces', 'trimLines', 'removeEmptyLines', 'removeDuplicateLines', 'sortAsc', 'sortDesc', 'addLineNumbers', 'removeLineNumbers', 'reverseLines', 'reverseText', 'toHalfWidth', 'toFullWidth']) }, ['action'], oneTextSource),
  define('json', ['dev', 'json'], 'Format or compact UTF-8 JSON locally. Invalid inputs return no original text in diagnostics.',
    { ...textSource, indent: choice(['2', '4', 'tab', 'compact']) }, [], oneTextSource),
  define('base64', ['dev', 'base64'], 'Encode or decode UTF-8 Base64 locally. This is encoding, not encryption.',
    { ...textSource, action: choice(['encode', 'decode']) }, ['action'], oneTextSource),
  define('url_codec', ['dev', 'url'], 'Encode or decode a URL component locally; does not visit the URL.',
    { ...textSource, action: choice(['encode', 'decode']) }, ['action'], oneTextSource),
  define('uuid', ['dev', 'uuid'], 'Generate 1-100 UUID v4 identifiers. They are identifiers, not passwords.', { count: integer(1, 100, { default: 1 }) }),
  define('jwt_decode', ['dev', 'jwt'], 'Decode a caller-supplied JWT header and payload locally. Does not verify the signature, authorize a user or return the signature.', textSource, [], oneTextSource),
  define('hash', ['dev', 'hash'], 'Compute a local file or UTF-8 text checksum. MD5 and SHA-1 are legacy checksums, not authentication. No encryption keys are accepted.',
    { ...textSource, algorithm: choice(['sha256', 'sha384', 'sha512', 'sha1', 'md5']) }, [], oneTextSource),
  define('timestamp', ['calculate', 'timestamp'], 'Convert an explicit Unix timestamp or ISO date with timezone to UTC. No guessed timezone or clock-dependent output.',
    { timestamp: number(-8640000000000000, 8640000000000000), unit: choice(['seconds', 'milliseconds']), iso: { type: 'string', maxLength: 64 } }, [], { oneOf: [{ required: ['timestamp', 'unit'], not: { required: ['iso'] } }, { required: ['iso'], not: { anyOf: [{ required: ['timestamp'] }, { required: ['unit'] }] } }] }),
  define('bmi', ['calculate', 'bmi'], 'Calculate adult BMI and estimated body composition using the desktop formula. Informational estimates, not a diagnosis. Height/waist/neck/hip in cm, weight in kg.',
    { height: number(50, 250), weight: number(10, 300), age: integer(18, 120), gender: choice(['male', 'female']), mode: choice(['simple', 'advanced']), waist: number(30, 200), neck: number(20, 100), hip: number(30, 200) }, ['height', 'weight', 'age', 'gender']),
  define('mortgage', ['calculate', 'mortgage'], 'Estimate a repayment schedule. Principal in currency units; annual_rate is percentage; term_years is years. Excludes fees and lender-specific rounding.',
    { principal: number(1, 1e12), term_years: number(1 / 12, 100), annual_rate: number(0.000001, 100), method: choice(['equalPayment', 'equalPrincipal']) }, ['principal', 'term_years', 'annual_rate']),
  define('interest', ['calculate', 'interest'], 'Estimate simple, compound or recurring investment interest; rate in percent and term in years. Recurring deposits occur at the beginning of each month. Excludes fees/tax.',
    { principal: number(0.01, 1e12), regular_amount: number(0.01, 1e9), annual_rate: number(0.000001, 100), term_years: number(1 / 12, 100), mode: choice(['simple', 'compound', 'recurring']), frequency: choice(['yearly', 'monthly', 'daily']) }, ['annual_rate', 'term_years']),
  define('color_convert', ['color', 'convert'], 'Convert an explicit sRGB HEX color into RGB, HSL, HSV, CMYK, XYZ, Lab/LCH D65 and OKLab/OKLCH using the desktop engine.',
    { hex: { type: 'string', pattern: '^#?(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$' } }, ['hex'])
];
