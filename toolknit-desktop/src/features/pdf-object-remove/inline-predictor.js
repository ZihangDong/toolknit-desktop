import { REMOVE_LIMITS, removeError } from './core.js';

const names = new Set(['Predictor', 'Colors', 'BitsPerComponent', 'BPC', 'Columns']);
const isNull = token => token?.type === 'constant' && token.raw === 'null';

/** Only direct, unambiguous parameters with the image's own geometry. */
export function inlinePrediction(token, filterCount, supportsPrediction, image) {
  const fail = () => { throw removeError('inline'); };
  if (!token || isNull(token)) return undefined;
  let parameters = token;
  if (token.type === 'array') {
    if (token.children.length !== filterCount || token.children.slice(0, -1).some(item => !isNull(item))) fail();
    parameters = token.children.at(-1);
  } else if (filterCount !== 1) fail();
  if (isNull(parameters)) return undefined;
  if (!supportsPrediction) fail();
  if (parameters?.type !== 'dict' || parameters.children.length % 2) fail();
  const values = new Map();
  for (let at = 0; at < parameters.children.length; at += 2) {
    const key = parameters.children[at], value = parameters.children[at + 1];
    const name = key.name === 'BPC' ? 'BitsPerComponent' : key.name;
    if (key.type !== 'name' || !names.has(key.name) || values.has(name)
      || value.type !== 'number' || !Number.isSafeInteger(value.value) || value.value < 1) fail();
    // Some readers ignore BPC inside DecodeParms and fall back to 8 bits.
    // Accept this alias only when both interpretations use that same depth.
    if (key.name === 'BPC' && value.value !== 8) fail();
    values.set(name, value.value);
  }
  const predictor = values.get('Predictor') ?? 1;
  if (predictor === 1) return undefined;
  const colors = values.get('Colors') ?? 1, bits = values.get('BitsPerComponent') ?? 8;
  const columns = values.get('Columns') ?? 1;
  // The independent 16-bit TIFF carry probe currently disagrees across readers.
  if (!(predictor === 2 || (predictor >= 10 && predictor <= 15))
    || colors !== image.components || bits !== image.bits || columns !== image.width
    || (predictor === 2 && bits === 16)) fail();
  const rowBytes = image.length / image.height;
  const encodedLength = image.length + (predictor >= 10 ? image.height : 0);
  if (!Number.isSafeInteger(encodedLength) || encodedLength > REMOVE_LIMITS.streamBytes) fail();
  return { predictor, colors, bits, columns, rowBytes, encodedLength };
}

export function validatePredictionRows(bytes, prediction) {
  // Every byte value is a valid TIFF/PNG residual. Only PNG has row tags;
  // each row can choose a filter regardless of the declared PNG predictor.
  if (!prediction || prediction.predictor < 10) return;
  for (let at = 0; at < bytes.length; at += prediction.rowBytes + 1) {
    if (bytes[at] > 4) throw removeError('inline');
  }
}
