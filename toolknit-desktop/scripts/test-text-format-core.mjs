import assert from 'node:assert/strict';
import { TEXT_FORMAT_LIMITS, TextFormatError, executeTextFormat } from '../src/text-format-core.js';

assert.equal(executeTextFormat('toHalfWidth', 'ＡＢＣ　１２３'), 'ABC 123');
assert.equal(executeTextFormat('toFullWidth', 'ABC 123'), 'ＡＢＣ　１２３');
assert.equal(executeTextFormat('sortAsc', 'item 10\nitem 2\nitem 1'), 'item 1\nitem 2\nitem 10');
assert.equal(executeTextFormat('reverseText', 'A\u0301B'), 'BA\u0301');
assert.equal(executeTextFormat('removeLineNumbers', '1. First\n2、 Second\n2024. Economics'), 'First\nSecond\n2024. Economics');
assert.equal(executeTextFormat('removeLineNumbers', '2024. Economics'), '2024. Economics');
assert.equal(executeTextFormat('removeDuplicateLines', 'a\na\nA'), 'a\nA');
assert.throws(() => executeTextFormat('uppercase', 'x'.repeat(TEXT_FORMAT_LIMITS.maxInputChars + 1)), RangeError);
assert.throws(
  () => executeTextFormat('addLineNumbers', 'x\n'.repeat(Math.ceil(TEXT_FORMAT_LIMITS.maxInputChars / 2))),
  (error) => error instanceof TextFormatError && error.code === 'too_many_lines'
);
assert.throws(
  () => executeTextFormat('addLineNumbers', `${'x'.repeat(TEXT_FORMAT_LIMITS.maxInputChars - 3)}\n`),
  (error) => error instanceof TextFormatError && error.code === 'result_too_long'
);
assert.throws(() => executeTextFormat('unknown', 'text'), RangeError);

console.log('Text format core regression checks passed');
