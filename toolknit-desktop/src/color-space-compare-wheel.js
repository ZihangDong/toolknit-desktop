/**
 * Dual colour wheels for the colour-space comparison tool.
 *
 * HSV renders a hue ring around an SV square; HSL renders a hue ring around
 * an SL triangle. Both wheels read from and write to the same linked colour
 * model as the sliders, so dragging either wheel moves every other control.
 *
 * All geometry lives in color-space-compare-core.js. This module only owns
 * canvas rasterisation and pointer wiring, which keeps the maths testable in
 * a plain Node environment.
 */

import {
  COLOR_SPACE_SLIDER_CONFIG,
  COLOR_WHEEL_GEOMETRY,
  fmtColorNumber,
  hslToRgb,
  hslToWheelPoint,
  hsvToRgb,
  hsvToWheelPoint,
  hueToWheelPoint,
  normalizeSliderValue,
  rgbToHex,
  wheelPointToHsl,
  wheelPointToHsv,
  wheelPointToHue,
  wheelRadiusIsRing,
  wheelSquareToHsv,
  wheelTriangleBarycentric,
} from './color-space-compare-core.js';

export const COLOR_WHEEL_KINDS = Object.freeze([
  Object.freeze({ id: 'hsv', label: 'HSV', roleKey: 'hsv' }),
  Object.freeze({ id: 'hsl', label: 'HSL', roleKey: 'hsl' }),
]);

function channelConfig(kind) {
  const config = {};
  for (const channel of COLOR_SPACE_SLIDER_CONFIG[kind].channels) config[channel.key] = channel;
  return config;
}

function createWheelEntry(kind) {
  const item = document.createElement('div');
  item.className = 'color-space-compare-wheel';
  item.dataset.wheel = kind.id;

  const head = document.createElement('div');
  head.className = 'color-space-compare-wheel-top';
  const name = document.createElement('span');
  name.className = 'color-space-compare-wheel-name';
  name.textContent = kind.label;
  const role = document.createElement('span');
  role.className = 'color-space-compare-wheel-role';
  head.append(name, role);

  const wrap = document.createElement('div');
  wrap.className = 'color-space-compare-wheel-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'color-space-compare-wheel-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const overlay = document.createElement('div');
  overlay.className = 'color-space-compare-wheel-overlay';
  overlay.dataset.role = 'wheel-hit';
  overlay.tabIndex = 0;
  overlay.setAttribute('role', 'application');
  const hueDot = document.createElement('span');
  hueDot.className = 'color-space-compare-wheel-hue';
  hueDot.setAttribute('aria-hidden', 'true');
  const handle = document.createElement('span');
  handle.className = 'color-space-compare-wheel-handle';
  handle.setAttribute('aria-hidden', 'true');
  wrap.append(canvas, overlay, hueDot, handle);

  const readout = document.createElement('div');
  readout.className = 'color-space-compare-wheel-readout';

  item.append(head, wrap, readout);

  return {
    kind,
    item,
    role,
    canvas,
    overlay,
    hueDot,
    handle,
    readout,
    ring: document.createElement('canvas'),
    inner: document.createElement('canvas'),
    config: channelConfig(kind.id),
    size: 0,
    hue: null,
    mode: null,
    pointerId: null,
  };
}

/** Rasterise the hue ring. It only depends on size, so it is cached. */
function drawRing(wheel) {
  const size = wheel.size;
  const context = wheel.ring.getContext('2d');
  if (!context) return;
  const image = context.createImageData(size, size);
  const data = image.data;
  const half = size / 2;
  const innerRadius = half * COLOR_WHEEL_GEOMETRY.ringInnerRadius;

  for (let y = 0; y < size; y += 1) {
    const py = y + 0.5 - half;
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5 - half;
      const index = (y * size + x) * 4;
      const radius = Math.sqrt(px * px + py * py);
      const alpha = Math.min(1, half - radius) * Math.min(1, radius - innerRadius);
      if (alpha <= 0) {
        data[index + 3] = 0;
        continue;
      }
      const color = hsvToRgb(wheelPointToHue(px, py), 100, 100);
      data[index] = color.r;
      data[index + 1] = color.g;
      data[index + 2] = color.b;
      data[index + 3] = alpha * 255;
    }
  }
  context.putImageData(image, 0, 0);
}

/** Rasterise the inner pick shape. It depends on the current hue. */
function drawInner(wheel, hue) {
  const size = wheel.size;
  const context = wheel.inner.getContext('2d');
  if (!context) return;
  const image = context.createImageData(size, size);
  const data = image.data;
  const half = size / 2;
  const hueColor = hsvToRgb(hue, 100, 100);
  const hueR = hueColor.r / 255;
  const hueG = hueColor.g / 255;
  const hueB = hueColor.b / 255;
  const radius = half * (wheel.kind.id === 'hsv'
    ? COLOR_WHEEL_GEOMETRY.squareRadius
    : COLOR_WHEEL_GEOMETRY.triangleRadius);
  const squareHalf = radius / Math.SQRT2;

  for (let y = 0; y < size; y += 1) {
    const py = y + 0.5 - half;
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5 - half;
      const index = (y * size + x) * 4;
      let alpha = 0;
      let r = 0;
      let g = 0;
      let b = 0;

      if (wheel.kind.id === 'hsv') {
        const insideX = squareHalf - Math.abs(px);
        const insideY = squareHalf - Math.abs(py);
        if (insideX > 0 && insideY > 0) {
          alpha = Math.min(1, insideX) * Math.min(1, insideY);
          // px/py are pixel offsets. wheelPointToHsv expects normalised
          // unit-circle coordinates, so the pixel path uses wheelSquareToHsv.
          const point = wheelSquareToHsv(px, py, squareHalf);
          const color = hsvToRgb(hue, point.s, point.v);
          r = color.r;
          g = color.g;
          b = color.b;
        }
      } else {
        const barycentric = wheelTriangleBarycentric(px / radius, py / radius);
        const minimum = Math.min(barycentric.bW, barycentric.bK, barycentric.bC);
        if (minimum > 0) {
          alpha = Math.min(1, minimum * 1.5 * radius);
          r = (barycentric.bW + barycentric.bC * hueR) * 255;
          g = (barycentric.bW + barycentric.bC * hueG) * 255;
          b = (barycentric.bW + barycentric.bC * hueB) * 255;
        }
      }

      if (alpha <= 0) {
        data[index + 3] = 0;
        continue;
      }
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = alpha * 255;
    }
  }
  context.putImageData(image, 0, 0);
}

function renderWheel(wheel) {
  const context = wheel.canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, wheel.size, wheel.size);
  context.drawImage(wheel.ring, 0, 0);
  context.drawImage(wheel.inner, 0, 0);
}

export function createColorWheels(mount, {
  getValues,
  applyValues,
  getDisplayRgb,
} = {}) {
  const wheels = COLOR_WHEEL_KINDS.map(createWheelEntry);
  if (mount) mount.replaceChildren(...wheels.map(wheel => wheel.item));

  function layout(wheel) {
    const rect = wheel.canvas.getBoundingClientRect();
    if (!rect.width) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.max(16, Math.round(rect.width * dpr));
    if (size !== wheel.size) {
      wheel.size = size;
      for (const canvas of [wheel.canvas, wheel.ring, wheel.inner]) {
        canvas.width = size;
        canvas.height = size;
      }
      drawRing(wheel);
      wheel.hue = null;
    }
    return true;
  }

  function pointerToNorm(wheel, event) {
    const rect = wheel.overlay.getBoundingClientRect();
    const radius = rect.width / 2;
    if (!radius) return { x: 0, y: 0, r: 0 };
    const x = (event.clientX - (rect.left + radius)) / radius;
    const y = (event.clientY - (rect.top + radius)) / radius;
    return { x, y, r: Math.sqrt(x * x + y * y) };
  }

  function applyFromPointer(wheel, event) {
    const { x, y, r } = pointerToNorm(wheel, event);
    const values = getValues(wheel.kind.id);
    if (wheel.mode === 'ring') {
      values.h = normalizeSliderValue(wheelPointToHue(x, y), wheel.config.h);
    } else if (wheel.kind.id === 'hsv') {
      const point = wheelPointToHsv(x, y);
      values.s = normalizeSliderValue(point.s, wheel.config.s);
      values.v = normalizeSliderValue(point.v, wheel.config.v);
    } else {
      const point = wheelPointToHsl(x, y);
      values.s = normalizeSliderValue(point.s, wheel.config.s);
      values.l = normalizeSliderValue(point.l, wheel.config.l);
    }
    if (values.h === null || values.s === null
      || (wheel.kind.id === 'hsv' ? values.v : values.l) === null) return;
    applyValues(wheel.kind.id, values);
  }

  function bindPointer(wheel) {
    wheel.overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const { r } = pointerToNorm(wheel, event);
      // The wheel is a circle inside a square box; ignore the empty corners
      // so pressing beside the wheel cannot jump the hue.
      if (r > 1) return;
      wheel.mode = wheelRadiusIsRing(r) ? 'ring' : 'inner';
      wheel.pointerId = event.pointerId;
      try { wheel.overlay.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
      event.preventDefault();
      applyFromPointer(wheel, event);
    });
    wheel.overlay.addEventListener('pointermove', (event) => {
      if (wheel.pointerId !== event.pointerId) return;
      event.preventDefault();
      applyFromPointer(wheel, event);
    });
    const stop = (event) => {
      if (wheel.pointerId !== event.pointerId) return;
      try { wheel.overlay.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      wheel.pointerId = null;
      wheel.mode = null;
    };
    wheel.overlay.addEventListener('pointerup', stop);
    wheel.overlay.addEventListener('pointercancel', stop);
    wheel.overlay.addEventListener('lostpointercapture', stop);
    wheel.overlay.addEventListener('keydown', (event) => {
      const horizontal = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      const vertical = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
      if (!horizontal && !vertical) return;
      event.preventDefault();
      const values = getValues(wheel.kind.id);
      if (horizontal) {
        values.h = normalizeSliderValue(values.h + horizontal * 5, wheel.config.h);
      } else if (wheel.kind.id === 'hsv') {
        values.s = normalizeSliderValue(values.s + vertical * 2, wheel.config.s);
        values.v = normalizeSliderValue(values.v + vertical * 2, wheel.config.v);
      } else {
        values.s = normalizeSliderValue(values.s + vertical * 2, wheel.config.s);
        values.l = normalizeSliderValue(values.l + vertical * 2, wheel.config.l);
      }
      applyValues(wheel.kind.id, values);
    });
  }

  for (const wheel of wheels) bindPointer(wheel);

  function sync(wheel) {
    if (!layout(wheel)) return;
    const values = getValues(wheel.kind.id);
    if (wheel.hue !== values.h) {
      wheel.hue = values.h;
      drawInner(wheel, values.h);
      renderWheel(wheel);
    }

    const point = wheel.kind.id === 'hsv'
      ? hsvToWheelPoint(values.s, values.v)
      : hslToWheelPoint(values.s, values.l);
    wheel.handle.style.left = `${50 + point.x * 50}%`;
    wheel.handle.style.top = `${50 + point.y * 50}%`;

    const rgb = getDisplayRgb();
    wheel.handle.style.background = rgbToHex(rgb.r, rgb.g, rgb.b);
    const luminance = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    wheel.handle.classList.toggle('is-over-bright', luminance > 165);

    const huePoint = hueToWheelPoint(values.h);
    const hueColor = hsvToRgb(values.h, 100, 100);
    wheel.hueDot.style.left = `${50 + huePoint.x * 50}%`;
    wheel.hueDot.style.top = `${50 + huePoint.y * 50}%`;
    wheel.hueDot.style.background = rgbToHex(hueColor.r, hueColor.g, hueColor.b);

    const readout = wheel.kind.id === 'hsv'
      ? { third: 'V', value: values.v }
      : { third: 'L', value: values.l };
    wheel.readout.textContent = `H ${fmtColorNumber(values.h, 0)} · S ${fmtColorNumber(values.s, 0)} · ${readout.third} ${fmtColorNumber(readout.value, 0)}`;
    wheel.overlay.setAttribute('aria-label', `${wheel.kind.label} colour wheel`);
  }

  return {
    sync() {
      for (const wheel of wheels) sync(wheel);
    },
    /** Drop cached rasters so the next sync redraws at the new size. */
    relayout() {
      for (const wheel of wheels) {
        wheel.size = 0;
        sync(wheel);
      }
    },
    refreshLabels(getText) {
      for (const wheel of wheels) {
        wheel.role.textContent = getText(wheel.kind.roleKey);
      }
    },
    destroy() {
      for (const wheel of wheels) {
        wheel.pointerId = null;
        wheel.mode = null;
        // Reset the cached size so the next sync redraws into the resized
        // buffers instead of reusing the shrunken ones.
        wheel.size = 0;
        wheel.hue = null;
        for (const canvas of [wheel.canvas, wheel.ring, wheel.inner]) {
          canvas.width = 1;
          canvas.height = 1;
        }
      }
    },
  };
}
