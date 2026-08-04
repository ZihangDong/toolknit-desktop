function clahe(data, width, height, tileSize, clipLimit) {
  const tilesX = Math.ceil(width / tileSize);
  const tilesY = Math.ceil(height / tileSize);
  const luts = new Float32Array(tilesX * tilesY * 256);
  for (let tileY = 0; tileY < tilesY; tileY++) {
    for (let tileX = 0; tileX < tilesX; tileX++) {
      const x0 = tileX * tileSize;
      const y0 = tileY * tileSize;
      const x1 = Math.min(x0 + tileSize, width);
      const y1 = Math.min(y0 + tileSize, height);
      const histogram = new Int32Array(256);
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const index = (y * width + x) * 4;
          histogram[Math.round(0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2])]++;
          count++;
        }
      }
      let excess = 0;
      for (let index = 0; index < 256; index++) {
        if (histogram[index] > clipLimit) {
          excess += histogram[index] - clipLimit;
          histogram[index] = clipLimit;
        }
      }
      const addition = Math.floor(excess / 256);
      const remainder = excess % 256;
      for (let index = 0; index < 256; index++) histogram[index] += addition + (index < remainder ? 1 : 0);
      let cdf = 0;
      const offset = (tileY * tilesX + tileX) * 256;
      for (let index = 0; index < 256; index++) {
        cdf += histogram[index];
        luts[offset + index] = (cdf / count) * 255;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const fractionX = x / tileSize - 0.5;
      const fractionY = y / tileSize - 0.5;
      const x0 = Math.max(0, Math.min(tilesX - 1, Math.floor(fractionX)));
      const y0 = Math.max(0, Math.min(tilesY - 1, Math.floor(fractionY)));
      const x1 = Math.min(tilesX - 1, x0 + 1);
      const y1 = Math.min(tilesY - 1, y0 + 1);
      const amountX = Math.max(0, Math.min(1, fractionX - x0));
      const amountY = Math.max(0, Math.min(1, fractionY - y0));
      for (let channel = 0; channel < 3; channel++) {
        const value = data[index + channel];
        const topLeft = luts[(y0 * tilesX + x0) * 256 + value];
        const topRight = luts[(y0 * tilesX + x1) * 256 + value];
        const bottomLeft = luts[(y1 * tilesX + x0) * 256 + value];
        const bottomRight = luts[(y1 * tilesX + x1) * 256 + value];
        const top = topLeft * (1 - amountX) + topRight * amountX;
        const bottom = bottomLeft * (1 - amountX) + bottomRight * amountX;
        data[index + channel] = Math.max(0, Math.min(255, top * (1 - amountY) + bottom * amountY));
      }
    }
  }
}

function sauvolaBinarize(data, width, height, windowSize, k) {
  const halfWindow = windowSize >> 1;
  const gray = new Uint8ClampedArray(width * height);
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel++) {
    gray[pixel] = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
  }
  const integral = new Float64Array((width + 1) * (height + 1));
  const integralSquared = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    let rowSumSquared = 0;
    for (let x = 0; x < width; x++) {
      const value = gray[y * width + x];
      rowSum += value;
      rowSumSquared += value * value;
      integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
      integralSquared[(y + 1) * (width + 1) + (x + 1)] = integralSquared[y * (width + 1) + (x + 1)] + rowSumSquared;
    }
  }
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - halfWindow);
    const y1 = Math.min(height - 1, y + halfWindow);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - halfWindow);
      const x1 = Math.min(width - 1, x + halfWindow);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * (width + 1) + (x1 + 1)] - integral[y0 * (width + 1) + (x1 + 1)] - integral[(y1 + 1) * (width + 1) + x0] + integral[y0 * (width + 1) + x0];
      const sumSquared = integralSquared[(y1 + 1) * (width + 1) + (x1 + 1)] - integralSquared[y0 * (width + 1) + (x1 + 1)] - integralSquared[(y1 + 1) * (width + 1) + x0] + integralSquared[y0 * (width + 1) + x0];
      const mean = sum / area;
      const deviation = Math.sqrt(Math.max(0, sumSquared / area - mean * mean));
      const threshold = mean * (1 + k * (deviation / 128 - 1));
      const value = gray[y * width + x] > threshold ? 255 : 0;
      const index = (y * width + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
    }
  }
}

function sharpen(data, width, height, amount, radius) {
  const original = new Uint8ClampedArray(data);
  const rowStride = width * 4;
  const center = radius === 1 ? 1 + 4 * amount : 1 + 8 * amount;
  const side = -amount;
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let value = original[index + channel] * center
          + (original[index - 4 + channel] + original[index + 4 + channel] + original[index - rowStride + channel] + original[index + rowStride + channel]) * side;
        if (radius === 2) {
          value += (original[index - 8 + channel] + original[index + 8 + channel] + original[index - rowStride * 2 + channel] + original[index + rowStride * 2 + channel]) * (side * 0.5);
        }
        data[index + channel] = Math.max(0, Math.min(255, value));
      }
    }
  }
}

export function enhanceRgbaImage(data, width, height, strength) {
  if (!(data instanceof Uint8ClampedArray) || data.length !== width * height * 4
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('pdf-enhance:enhancement-failed');
  }
  if (strength === 'light') {
    clahe(data, width, height, 64, 20);
    sharpen(data, width, height, 0.4, 1);
    return;
  }
  if (strength === 'medium') {
    for (let index = 0; index < data.length; index += 4) {
      const gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      data[index] = data[index] * 0.4 + gray * 0.6;
      data[index + 1] = data[index + 1] * 0.4 + gray * 0.6;
      data[index + 2] = data[index + 2] * 0.4 + gray * 0.6;
    }
    clahe(data, width, height, 48, 15);
    sharpen(data, width, height, 0.5, 2);
    return;
  }
  if (strength === 'strong') {
    for (let index = 0; index < data.length; index += 4) {
      const gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      data[index] = gray;
      data[index + 1] = gray;
      data[index + 2] = gray;
    }
    clahe(data, width, height, 32, 10);
    sauvolaBinarize(data, width, height, 41, 0.15);
    sharpen(data, width, height, 0.4, 2);
    return;
  }
  throw new Error('pdf-enhance:invalid-strength');
}
