export const AI_TRANSLATE_LIMITS = Object.freeze({
  maxInputChars: 12000,
  maxResponseChars: 100000,
  maxPairs: 300,
  maxSentenceChars: 2000,
  maxTotalChars: 60000
});

export class AiTranslateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AiTranslateError';
    this.code = code;
  }
}

const DETECTABLE_SOURCE_LANGUAGES = Object.freeze([
  ['zh', /[\u4e00-\u9fff]/g],
  ['ja', /[\u3040-\u30ff\u31f0-\u31ff]/g],
  ['ko', /[\uac00-\ud7af]/g],
  ['ru', /[\u0400-\u04ff]/g]
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeSentence(value, field) {
  if (typeof value !== 'string') {
    throw new AiTranslateError('invalid_result', `${field} must be a string.`);
  }
  if (value.length > AI_TRANSLATE_LIMITS.maxSentenceChars) {
    throw new AiTranslateError('result_too_large', `${field} exceeds its allowed length.`);
  }
  return value.replace(/\u0000/g, '').trim();
}

export function normalizeAiTranslatePairs(value) {
  if (!isPlainObject(value) || !Array.isArray(value.pairs) || value.pairs.length === 0) {
    throw new AiTranslateError('invalid_result', 'AI response does not contain translation pairs.');
  }
  if (value.pairs.length > AI_TRANSLATE_LIMITS.maxPairs) {
    throw new AiTranslateError('result_too_large', 'AI response contains too many translation pairs.');
  }
  let totalChars = 0;
  return value.pairs.map((pair, index) => {
    if (!isPlainObject(pair)) {
      throw new AiTranslateError('invalid_result', `Translation pair ${index + 1} must be an object.`);
    }
    const original = normalizeSentence(pair.original, 'Original sentence');
    const translated = normalizeSentence(pair.translated, 'Translated sentence');
    if (!original || !translated) {
      throw new AiTranslateError('invalid_result', 'Translation pairs cannot be empty.');
    }
    totalChars += original.length + translated.length;
    if (totalChars > AI_TRANSLATE_LIMITS.maxTotalChars) {
      throw new AiTranslateError('result_too_large', 'Translation result exceeds the supported length.');
    }
    return { original, translated };
  });
}

/**
 * Only exclude a source language when its script can be identified reliably.
 * Latin script alone cannot tell English, French, German, Spanish, etc. apart.
 */
export function detectAiTranslateSourceLanguage(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let bestCode = null;
  let bestCount = 0;
  for (const [code, pattern] of DETECTABLE_SOURCE_LANGUAGES) {
    const count = (value.match(pattern) || []).length;
    if (count > bestCount) {
      bestCode = code;
      bestCount = count;
    }
  }
  return bestCode;
}

export function aiTranslateOriginalsMatch(source, pairs) {
  if (typeof source !== 'string' || !Array.isArray(pairs)) return false;
  const normalize = value => value.normalize('NFKC').replace(/\s+/g, '');
  return normalize(source) === normalize(pairs.map(pair => pair?.original || '').join(''));
}
