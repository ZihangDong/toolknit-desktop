import { removeError } from './core.js';

function paeth(left, above, corner) {
  const estimate = left + above - corner;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const cornerDistance = Math.abs(estimate - corner);
  if (leftDistance <= aboveDistance && leftDistance <= cornerDistance) return left;
  return aboveDistance <= cornerDistance ? above : corner;
}

function decodeTiffRow(output, row, end, bits, colors, history) {
  if (bits === 8) {
    for (let index = row + colors; index < end; index++) output[index] += output[index - colors];
    return;
  }
  const mask = (1 << bits) - 1;
  history.fill(0);
  let channel = 0;
  for (let index = row; index < end; index++) {
    let restored = 0;
    for (let shift = 8 - bits; shift >= 0; shift -= bits) {
      history[channel] = (history[channel] + ((output[index] >>> shift) & mask)) & mask;
      restored |= history[channel] << shift;
      if (++channel === colors) channel = 0;
    }
    output[index] = restored;
  }
}

/** Reconstruct rows with geometry already validated by the filter reader. */
export function decodeContentPrediction(bytes, { predictor, rowBytes, colors, bits }, limit) {
  const png = predictor !== 2;
  const stride = rowBytes + Number(png);
  if (!bytes.length || bytes.length % stride !== 0) throw removeError('stream');
  const length = (bytes.length / stride) * rowBytes;
  if (length > limit) throw removeError('decoded');
  if (!png) {
    const output = bytes.slice();
    const history = bits === 8 ? null : new Uint8Array(colors);
    for (let row = 0; row < length; row += rowBytes) {
      decodeTiffRow(output, row, row + rowBytes, bits, colors, history);
    }
    return output;
  }
  const pixelBytes = Math.ceil(colors * bits / 8);
  const output = new Uint8Array(length);
  for (let input = 0, row = 0; input < bytes.length; row += rowBytes) {
    const tag = bytes[input++];
    if (tag > 4) throw removeError('stream');
    for (let column = 0; column < rowBytes; column++) {
      const index = row + column;
      const left = column >= pixelBytes ? output[index - pixelBytes] : 0;
      const above = row > 0 ? output[index - rowBytes] : 0;
      const corner = row > 0 && column >= pixelBytes ? output[index - rowBytes - pixelBytes] : 0;
      let prediction = 0;
      switch (tag) {
        case 1: prediction = left; break;
        case 2: prediction = above; break;
        case 3: prediction = (left + above) >>> 1; break;
        case 4: prediction = paeth(left, above, corner); break;
      }
      output[index] = bytes[input++] + prediction;
    }
  }
  return output;
}
