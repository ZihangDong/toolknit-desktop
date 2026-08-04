export const TEXT_STATS_LIMITS = Object.freeze({
  maxInputChars: 1_000_000
});

const LINE_BREAK = /\r\n?|\n/;
const HAN_CHARACTER = /\p{Script=Han}/u;
const WHITESPACE = /\s/u;
const SENTENCE_PUNCTUATION = new Set(['。', '！', '？', '.', '!']);
const PUNCTUATION = new Set(['，', '。', '！', '？', '、', '；', '：', '“', '”', '‘', '’', '（', '）', '【', '】', '《', '》', '…', '—', '·', ',', '.', '!', '?', ';', ':', '"', "'", '(', ')', '[', ']', '{', '}']);

function assertTextStatsInput(text) {
  if (typeof text !== 'string') throw new TypeError('Text statistics input must be a string.');
  if (text.length > TEXT_STATS_LIMITS.maxInputChars) {
    throw new RangeError(`Text statistics input exceeds ${TEXT_STATS_LIMITS.maxInputChars} UTF-16 code units.`);
  }
}

export function calculateTextStats(text) {
  assertTextStatsInput(text);
  if (!text) {
    return {
      chars: 0, charsNoSpace: 0, spaces: 0, words: 0, englishWords: 0,
      lines: 0, paragraphs: 0, sentences: 0, chineseChars: 0, letters: 0,
      uppercase: 0, lowercase: 0, digits: 0, punctuation: 0, longestLine: 0,
      avgLineLength: 0, readingTime: 0
    };
  }

  let chars = 0;
  let charsNoSpace = 0;
  let spaces = 0;
  let chineseChars = 0;
  let letters = 0;
  let uppercase = 0;
  let lowercase = 0;
  let digits = 0;
  let punctuation = 0;
  let sentences = 0;
  let lines = 1;
  let currentLineLength = 0;
  let longestLine = 0;
  let lineChars = 0;
  let previousWasCarriageReturn = false;
  let sentenceHasContent = false;

  for (const character of text) {
    chars += 1;
    const isWhitespace = WHITESPACE.test(character);
    if (!isWhitespace) charsNoSpace += 1;
    if (character === ' ') spaces += 1;
    if (HAN_CHARACTER.test(character)) chineseChars += 1;
    const code = character.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      letters += 1;
      uppercase += 1;
    } else if (code >= 97 && code <= 122) {
      letters += 1;
      lowercase += 1;
    } else if (code >= 48 && code <= 57) {
      digits += 1;
    }
    if (PUNCTUATION.has(character)) punctuation += 1;

    if (character === '\r') {
      lineChars += currentLineLength;
      longestLine = Math.max(longestLine, currentLineLength);
      currentLineLength = 0;
      lines += 1;
      previousWasCarriageReturn = true;
      continue;
    }
    if (character === '\n') {
      if (!previousWasCarriageReturn) {
        lineChars += currentLineLength;
        longestLine = Math.max(longestLine, currentLineLength);
        currentLineLength = 0;
        lines += 1;
      }
      previousWasCarriageReturn = false;
      continue;
    }
    previousWasCarriageReturn = false;
    currentLineLength += 1;
    if (SENTENCE_PUNCTUATION.has(character)) {
      if (sentenceHasContent) sentences += 1;
      sentenceHasContent = false;
    } else if (!isWhitespace) {
      sentenceHasContent = true;
    }
  }

  lineChars += currentLineLength;
  longestLine = Math.max(longestLine, currentLineLength);
  if (sentenceHasContent) sentences += 1;

  // Count English word runs without allocating an array proportional to the input size.
  let englishWords = 0;
  for (const _match of text.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)) englishWords += 1;
  const words = chineseChars + englishWords;
  let paragraphs = 0;
  let inParagraph = false;
  for (const line of text.split(LINE_BREAK)) {
    if (line.trim()) {
      if (!inParagraph) paragraphs += 1;
      inParagraph = true;
    } else {
      inParagraph = false;
    }
  }
  const avgLineLength = lines > 0 ? Math.round(lineChars / lines) : 0;
  const readingTime = words > 0 ? Math.max(1, Math.ceil(words / 300)) : 0;

  return {
    chars, charsNoSpace, spaces, words, englishWords, lines, paragraphs,
    sentences, chineseChars, letters, uppercase, lowercase, digits, punctuation,
    longestLine,
    avgLineLength, readingTime
  };
}
