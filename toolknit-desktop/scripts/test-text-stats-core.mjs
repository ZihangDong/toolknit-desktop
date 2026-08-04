import assert from 'node:assert/strict';
import { TEXT_STATS_LIMITS, calculateTextStats } from '../src/text-stats-core.js';

const stats = calculateTextStats('你好，world!\nitem 10\n最后一句');
assert.equal(stats.chineseChars, 6);
assert.equal(stats.englishWords, 2);
assert.equal(stats.words, 8);
assert.equal(stats.sentences, 2);
assert.equal(stats.lines, 3);
assert.equal(stats.longestLine, 9);
assert.equal(calculateTextStats('🙂').chars, 1);
assert.equal(calculateTextStats('a\na\na').longestLine, 1);
assert.equal(calculateTextStats('a\na\na').avgLineLength, 1);
assert.equal(calculateTextStats('a\n\nb').paragraphs, 2);
assert.equal(calculateTextStats('An unfinished sentence').sentences, 1);
assert.equal(calculateTextStats('𠮷野家').chineseChars, 3);
assert.deepEqual(
  (({ charsNoSpace, spaces, lines, longestLine }) => ({ charsNoSpace, spaces, lines, longestLine }))(calculateTextStats('a\t b\r\nc')),
  { charsNoSpace: 3, spaces: 1, lines: 2, longestLine: 4 }
);
assert.throws(() => calculateTextStats('x'.repeat(TEXT_STATS_LIMITS.maxInputChars + 1)), RangeError);

console.log('Text statistics core regression checks passed');
