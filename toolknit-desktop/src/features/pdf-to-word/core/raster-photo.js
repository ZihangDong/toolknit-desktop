// SPDX-License-Identifier: MIT
// Copyright 2026 Zihang Dong.
// Licensed under the MIT License; see LICENSE and NOTICE.

/** Statistics for an opaque 48x48 composited sample, not semantic document classification. */
export function photographicSample(data) {
  if (!data || data.length !== 48 * 48 * 4) return false;
  const colors = new Set(), shades = new Set();
  let chromatic = 0, difference = 0, pairs = 0, midtones = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] !== 255) return false;
    const red = data[index], green = data[index + 1], blue = data[index + 2];
    if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 24) chromatic++;
    colors.add((red >> 4) << 8 | (green >> 4) << 4 | blue >> 4);
    const tone = (red + green + blue) / 3;
    shades.add(Math.round(tone));
    if (tone > 45 && tone < 225) midtones++;
    if (index % (48 * 4) >= 4) {
      difference += Math.abs(red - data[index - 4]) + Math.abs(green - data[index - 3]) + Math.abs(blue - data[index - 2]); pairs += 3;
    }
  }
  return midtones > 48 * 48 * .35 && (colors.size >= 96 && chromatic >= 48 * 48 / 4
    || shades.size >= 80 && difference / Math.max(1, pairs) < 35);
}
