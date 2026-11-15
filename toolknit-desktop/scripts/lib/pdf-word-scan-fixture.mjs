import { createCanvas } from '@napi-rs/canvas';

export function createScanFigureFixture({ diagram = true, table = false, scale = 1, offset = 0 } = {}) {
  const width = Math.round(720 * scale), height = Math.round(960 * scale), canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.scale(scale, scale); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 720, 960);
  ctx.fillStyle = 'black'; ctx.strokeStyle = 'black'; ctx.lineWidth = 2;
  const lines = [], rules = [];
  function text(value, x, y, size = 18) {
    ctx.font = `${size}px Arial`; ctx.fillText(value, x, y + size);
    lines.push({ text: value, x: x * scale, y: y * scale, width: ctx.measureText(value).width * scale,
      height: size * 1.2 * scale, confidence: .99 });
  }
  for (let i = 0; i < 3; i++) text('Editable paragraph about the original document.', 40, 40 + i * 36);
  text('Short last line.', 40, 148);
  if (diagram) {
    ctx.beginPath(); ctx.ellipse(290 + offset, 330, 150, 105, 0, 0, Math.PI * 2); ctx.stroke();
    for (const x of [160, 420]) { ctx.beginPath(); ctx.arc(x + offset, 330, 45, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(210 + offset, 330); ctx.lineTo(360 + offset, 330); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(360 + offset, 330); ctx.lineTo(345 + offset, 320); ctx.lineTo(345 + offset, 340); ctx.closePath(); ctx.fill();
    text('Picture label', 250 + offset, 250, 14);
    text('A', 155 + offset, 320, 14); text('B', 414 + offset, 320, 14);
    ctx.fillRect(90 + offset, 400, 24, 14); text('Legend', 120 + offset, 395, 14);
    // The final visible composite covers this raw content completely.
    ctx.fillText('HIDDEN', 280 + offset, 365); ctx.fillStyle = 'white'; ctx.fillRect(275 + offset, 345, 90, 30); ctx.fillStyle = 'black';
  }
  if (table) {
    for (const y of [230, 270, 310, 350]) { ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(600, y); ctx.stroke(); rules.push({ axis: 'h', at: y * scale, from: 80 * scale, to: 600 * scale }); }
    for (const x of [80, 250, 430, 600]) { ctx.beginPath(); ctx.moveTo(x, 230); ctx.lineTo(x, 350); ctx.stroke(); rules.push({ axis: 'v', at: x * scale, from: 230 * scale, to: 350 * scale }); }
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) text(`Cell ${r}${c}`, 90 + c * 175, 238 + r * 40, 16);
  }
  text('Question 1. Keep this neighbouring text editable.', 40, 500);
  const scene = { number: 7, width: 720, height: 960, sources: [], rules: [], characters: 0, risks: ['image-page'], rasterPage: true,
    items: [{ id: 'original-scan', type: 'image', role: 'figure', rect: { x: 0, y: 0, width: 720, height: 960 }, sourceIds: [] }] };
  return { scene, canvas, result: { width, height, lines, rules }, width, height, pixels: ctx.getImageData(0, 0, width, height).data };
}
