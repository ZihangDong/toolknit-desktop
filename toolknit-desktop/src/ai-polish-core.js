export const AI_POLISH_LIMITS = Object.freeze({
  maxInputChars: 12000,
  maxResponseChars: 50000,
  maxDirections: 5,
  maxDirectionNameChars: 60,
  maxDirectionDescriptionChars: 300,
  maxPolishedChars: 30000
});

export class AiPolishError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AiPolishError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanString(value, maxLength, fieldName) {
  if (typeof value !== 'string') throw new AiPolishError('invalid_result', `${fieldName} must be a string.`);
  if (value.length > maxLength) throw new AiPolishError('result_too_large', `${fieldName} is too long.`);
  return value.replace(/\u0000/g, '').trim();
}

export function normalizeAiPolishDirections(value) {
  if (!isPlainObject(value) || !Array.isArray(value.directions) || value.directions.length === 0) {
    throw new AiPolishError('invalid_result', 'AI response does not contain polish directions.');
  }
  if (value.directions.length > AI_POLISH_LIMITS.maxDirections) {
    throw new AiPolishError('result_too_large', 'AI response contains too many directions.');
  }
  return value.directions.map((direction, index) => {
    if (!isPlainObject(direction)) {
      throw new AiPolishError('invalid_result', `Direction ${index + 1} must be an object.`);
    }
    const name = cleanString(direction.name, AI_POLISH_LIMITS.maxDirectionNameChars, 'Direction name');
    const desc = cleanString(direction.desc, AI_POLISH_LIMITS.maxDirectionDescriptionChars, 'Direction description');
    if (!name || !desc) throw new AiPolishError('invalid_result', 'A direction cannot be empty.');
    return { name, desc };
  });
}

export function normalizeAiPolishedText(value) {
  const text = cleanString(value, AI_POLISH_LIMITS.maxPolishedChars, 'Polished text');
  if (!text) throw new AiPolishError('invalid_result', 'AI returned an empty polished result.');
  return text;
}
