import { PDFArray, PDFDict, PDFName, PDFNull, PDFNumber, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { asciiSpace, scanAsciiFilter } from './ascii-filters.js';
import { REMOVE_LIMITS, removeError } from './core.js';
import { pdfLatin } from './lexer.js';
import { validatePredictionRows } from './inline-predictor.js';
import { decodeRunLength } from './run-length.js';
import { decodeLzw } from './lzw.js';
import { decodeContentPrediction } from './content-predictor.js';

const N = PDFName.of;
const FLATE = 'FlateDecode';
const RUN_LENGTH = 'RunLengthDecode';
const LZW = 'LZWDecode';
const asciiFilters = new Set(['ASCIIHexDecode', 'ASCII85Decode']);
const predictorKeys = new Set(['Predictor', 'Colors', 'BitsPerComponent', 'Columns']);

function readInteger(dict, name, fallback) {
  const key = N(name);
  if (dict.get(key, true) === undefined) return fallback;
  const value = dict.lookup(key);
  if (!(value instanceof PDFNumber) || !Number.isSafeInteger(value.asNumber())) throw removeError('filter');
  return value.asNumber();
}

function readFilters(dict) {
  const filter = dict.lookup(N('Filter'));
  let stages = [];
  if (filter instanceof PDFArray) {
    if (filter.size() < 1 || filter.size() > 2) throw removeError('filter');
    stages = filter.asArray().map(value => filter.context.lookup(value));
  } else if (filter !== undefined && filter !== PDFNull) {
    stages = [filter];
  } else if (filter === undefined && dict.has(N('Filter'))) {
    throw removeError('filter');
  }
  if (stages.some(value => !(value instanceof PDFName))) throw removeError('filter');
  const names = stages.map(value => value.decodeText());
  const [first, second] = names;
  if (names.length === 2 ? !asciiFilters.has(first) || ![FLATE, RUN_LENGTH, LZW].includes(second)
    : names.length === 1 && ![FLATE, RUN_LENGTH, LZW].includes(first) && !asciiFilters.has(first)) throw removeError('filter');

  const parameters = dict.lookup(N('DecodeParms'));
  let settings = names.map(() => PDFNull);
  if (parameters instanceof PDFArray) {
    if (parameters.size() !== names.length || names.length === 0) throw removeError('filter');
    settings = parameters.asArray().map(value => parameters.context.lookup(value));
  } else if (parameters !== undefined && parameters !== PDFNull) {
    if (names.length !== 1) throw removeError('filter');
    settings = [parameters];
  } else if (parameters === undefined && dict.has(N('DecodeParms'))) {
    throw removeError('filter');
  }
  return names.map((name, index) => {
    const value = settings[index];
    if (value === PDFNull) return { name, earlyChange: 1 };
    if (![FLATE, LZW].includes(name) || !(value instanceof PDFDict)) throw removeError('filter');
    const earlyChange = name === LZW ? readInteger(value, 'EarlyChange', 1) : 1;
    if (earlyChange !== 0 && earlyChange !== 1) throw removeError('filter');
    const predictor = readInteger(value, 'Predictor', 1);
    if (name === LZW || predictor !== 1) {
      if ((filter instanceof PDFArray) !== (parameters instanceof PDFArray)) throw removeError('filter');
      for (const key of value.keys()) {
        const setting = key.decodeText();
        if (setting === 'EarlyChange' && name === LZW) continue;
        if (!(predictor === 1 ? setting === 'Predictor' : predictorKeys.has(setting))) throw removeError('filter');
      }
    }
    if (predictor === 1) return { name, earlyChange };
    const columns = readInteger(value, 'Columns', 1);
    const colors = readInteger(value, 'Colors', 1);
    const bits = readInteger(value, 'BitsPerComponent', 8);
    const tiff = predictor === 2;
    if (!(predictor === 2 || (predictor >= 10 && predictor <= 15))
      || colors < 1 || colors > 4 || ![1, 2, 4, 8, 16].includes(bits)
      || columns < 1 || columns > REMOVE_LIMITS.streamBytes * 8) throw removeError('filter');
    const rowBits = columns * colors * bits;
    const rowBytes = Math.ceil(rowBits / 8);
    // Every output byte is a drawing instruction or operand, including the end of a row.
    if (tiff && (bits === 16 || rowBits % 8 !== 0)) throw removeError('filter');
    if (rowBytes + Number(!tiff) > REMOVE_LIMITS.streamBytes) throw removeError('filter');
    return { name, earlyChange, prediction: { predictor, rowBytes, colors, bits } };
  });
}

function decodeAscii(bytes, name, context, limit) {
  const text = pdfLatin(bytes);
  const boundary = scanAsciiFilter(name, text, 0, text.length, limit);
  if (boundary?.oversized) throw removeError('decoded');
  if (!boundary) throw removeError('stream');
  for (let at = boundary.end; at < text.length; at++) {
    if (!asciiSpace(text[at])) throw removeError('stream');
  }
  // The scan checks the terminator and full output length before pdf-lib allocates.
  const input = PDFRawStream.of(context.obj({ Filter: N(name) }), bytes.subarray(0, boundary.end));
  const result = decodePDFRawStream(input).decode();
  if (result.length !== boundary.length) throw removeError('stream');
  return result;
}

async function decodeFlate(bytes, limit) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw removeError('decoded');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error.message === 'pdf-remove:decoded') throw error;
    throw removeError('stream');
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function decodeRemovalStream(stream, budget) {
  const bytes = stream?.getContents?.();
  if (!(bytes instanceof Uint8Array)) throw removeError('stream');
  if (['F', 'FFilter', 'FDecodeParms'].some(key => stream.dict.has(N(key)))) throw removeError('filter');
  const stages = readFilters(stream.dict);
  const remaining = () => Math.min(REMOVE_LIMITS.streamBytes, REMOVE_LIMITS.decodedBytes - budget.bytes);
  if (stages.length === 0) {
    if (bytes.length > remaining()) throw removeError('decoded');
    budget.bytes += bytes.length;
    return bytes.slice();
  }
  let result = bytes;
  for (const { name: stage, earlyChange, prediction } of stages) {
    result = stage === FLATE
      ? await decodeFlate(result, remaining())
      : stage === RUN_LENGTH ? decodeRunLength(result, remaining())
      : stage === LZW ? decodeLzw(result, remaining(), earlyChange)
      : decodeAscii(result, stage, stream.dict.context, remaining());
    budget.bytes += result.length;
    if (prediction) {
      result = decodeContentPrediction(result, prediction, remaining());
      budget.bytes += result.length;
    }
  }
  return result;
}

export async function validateInlineImageSamples(instructions, context, budget) {
  for (const { image } of instructions) {
    if (!image?.flate && !image?.runLength && !image?.lzw) continue;
    const { outerEncoding, length } = image.flate ?? image.runLength ?? image.lzw;
    const encodedLength = image.prediction?.encodedLength ?? length;
    try {
      let packed = image.data;
      if (outerEncoding) {
        const remaining = REMOVE_LIMITS.decodedBytes - budget.bytes;
        packed = decodeAscii(image.data, outerEncoding, context, Math.min(remaining, REMOVE_LIMITS.streamBytes));
        budget.bytes += packed.length;
      }
      if (encodedLength > REMOVE_LIMITS.decodedBytes - budget.bytes) throw removeError('decoded');
      let samples;
      try {
        samples = image.runLength ? decodeRunLength(packed, encodedLength)
          : image.lzw ? decodeLzw(packed, encodedLength, image.lzw.earlyChange) : await decodeFlate(packed, encodedLength);
      } catch {
        throw removeError('inline');
      }
      budget.bytes += samples.length;
      if (samples.length !== encodedLength) throw removeError('inline');
      validatePredictionRows(samples, image.prediction);
    } catch (error) {
      if (error.message === 'pdf-remove:decoded') throw error;
      throw removeError('inline');
    }
  }
}
