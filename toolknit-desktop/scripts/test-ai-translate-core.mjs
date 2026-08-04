import assert from 'node:assert/strict';
import {
  AI_TRANSLATE_LIMITS,
  AiTranslateError,
  aiTranslateOriginalsMatch,
  detectAiTranslateSourceLanguage,
  normalizeAiTranslatePairs
} from '../src/ai-translate-core.js';

const pairs = normalizeAiTranslatePairs({
  pairs: [{ original: 'Hello, world.', translated: '你好，世界。' }]
});
assert.deepEqual(pairs, [{ original: 'Hello, world.', translated: '你好，世界。' }]);
assert.equal(detectAiTranslateSourceLanguage('这是中文。'), 'zh');
assert.equal(detectAiTranslateSourceLanguage('これは日本語です。'), 'ja');
assert.equal(detectAiTranslateSourceLanguage('Bonjour le monde.'), null);
assert.equal(aiTranslateOriginalsMatch('Hello world', [{ original: 'Hello ', translated: 'x' }, { original: 'world', translated: 'y' }]), true);
assert.equal(aiTranslateOriginalsMatch('Hello world', [{ original: 'Different text', translated: 'x' }]), false);

assert.throws(
  () => normalizeAiTranslatePairs({ pairs: Array(AI_TRANSLATE_LIMITS.maxPairs + 1).fill({ original: 'A', translated: 'B' }) }),
  error => error instanceof AiTranslateError && error.code === 'result_too_large'
);
assert.throws(
  () => normalizeAiTranslatePairs({ pairs: [{ original: {}, translated: 'B' }] }),
  error => error instanceof AiTranslateError && error.code === 'invalid_result'
);
assert.throws(
  () => normalizeAiTranslatePairs({ pairs: [{ original: 'A', translated: 'x'.repeat(AI_TRANSLATE_LIMITS.maxSentenceChars + 1) }] }),
  error => error instanceof AiTranslateError && error.code === 'result_too_large'
);

console.log('AI translation core regression checks passed');
