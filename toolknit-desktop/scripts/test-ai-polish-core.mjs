import assert from 'node:assert/strict';
import { AI_POLISH_LIMITS, AiPolishError, normalizeAiPolishedText, normalizeAiPolishDirections } from '../src/ai-polish-core.js';

assert.deepEqual(normalizeAiPolishDirections({ directions: [{ name: 'Formal', desc: 'Clear and professional.' }] }), [
  { name: 'Formal', desc: 'Clear and professional.' }
]);
assert.equal(normalizeAiPolishedText('  Refined text.  '), 'Refined text.');
assert.throws(
  () => normalizeAiPolishDirections({ directions: Array(AI_POLISH_LIMITS.maxDirections + 1).fill({ name: 'A', desc: 'B' }) }),
  error => error instanceof AiPolishError && error.code === 'result_too_large'
);
assert.throws(
  () => normalizeAiPolishDirections({ directions: [{ name: {}, desc: 'B' }] }),
  error => error instanceof AiPolishError && error.code === 'invalid_result'
);
assert.throws(
  () => normalizeAiPolishedText('x'.repeat(AI_POLISH_LIMITS.maxPolishedChars + 1)),
  error => error instanceof AiPolishError && error.code === 'result_too_large'
);

console.log('AI polish core regression checks passed');
