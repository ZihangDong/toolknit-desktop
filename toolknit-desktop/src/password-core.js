export const PASSWORD_LIMITS = Object.freeze({ minLength: 4, maxLength: 64 });

export const PASSWORD_CHARSETS = Object.freeze({
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?~'
});

const SIMILAR_CHARACTERS = new Set('0O1lI');

export function secureRandomInt(max, getRandomValues = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto)) {
  if (!Number.isInteger(max) || max <= 0 || max > 0x1_0000_0000) {
    throw new RangeError('Random range must be a positive 32-bit integer.');
  }
  if (typeof getRandomValues !== 'function') {
    throw new Error('Secure random generation is unavailable in this runtime.');
  }
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const values = new Uint32Array(1);
  do {
    getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % max;
}

function shuffle(items, getRandomValues) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomInt(index + 1, getRandomValues);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function buildPasswordCharsets(options) {
  const selections = ['uppercase', 'lowercase', 'numbers', 'symbols']
    .filter(name => options?.[name])
    .map(name => PASSWORD_CHARSETS[name]);
  const filtered = options?.excludeSimilar
    ? selections.map(charset => [...charset].filter(character => !SIMILAR_CHARACTERS.has(character)).join(''))
    : selections;
  return filtered.filter(Boolean);
}

export function generatePassword(options, getRandomValues) {
  const length = Number(options?.length);
  if (!Number.isInteger(length) || length < PASSWORD_LIMITS.minLength || length > PASSWORD_LIMITS.maxLength) {
    throw new RangeError(`Password length must be between ${PASSWORD_LIMITS.minLength} and ${PASSWORD_LIMITS.maxLength}.`);
  }
  const characterSets = buildPasswordCharsets(options);
  if (characterSets.length === 0) throw new Error('At least one character category must be selected.');
  if (length < characterSets.length) throw new RangeError('Password length is too short for the selected character categories.');

  const combined = characterSets.join('');
  const characters = characterSets.map(charset => charset[secureRandomInt(charset.length, getRandomValues)]);
  while (characters.length < length) {
    characters.push(combined[secureRandomInt(combined.length, getRandomValues)]);
  }
  return {
    password: shuffle(characters, getRandomValues).join(''),
    charsetSize: combined.length,
    categoryCount: characterSets.length
  };
}

export function assessPasswordStrength(length, charsetSize) {
  const entropy = length * Math.log2(charsetSize);
  if (entropy < 40) return { label: 'weak', percent: 25, color: '#ef4444' };
  if (entropy < 60) return { label: 'fair', percent: 50, color: '#f59e0b' };
  if (entropy < 80) return { label: 'strong', percent: 75, color: '#22c55e' };
  return { label: 'veryStrong', percent: 100, color: '#10b981' };
}
