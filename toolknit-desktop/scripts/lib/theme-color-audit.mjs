// Run in the page. Ratios over image/gradient surfaces need screenshot review.
export function auditVisibleColors(rootSelector = 'body') {
  const root = document.querySelector(rootSelector);
  if (!root) return { checked: 0, findings: [] };
  const parse = value => {
    const values = String(value).match(/[\d.]+/g)?.map(Number);
    if (!values || values.length < 3) return null;
    const scale = String(value).startsWith('color(srgb ') ? 255 : 1;
    return [...values.slice(0, 3).map(n => n * scale), values[3] ?? 1];
  };
  const over = (a, b) => a.slice(0, 3).map((n, i) => n * a[3] + b[i] * (1 - a[3]));
  const luminance = rgb => rgb.map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const findings = [];
  let checked = 0;
  for (const node of root.querySelectorAll('*')) {
    const directText = [...node.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim();
    const icon = node instanceof SVGElement && node.tagName.toLowerCase() === 'svg'
      && node.matches('.lucide,[data-lucide],.tk-nav-button svg,.tk-empty-hero-icon svg,[class*="-icon"]');
    const input = node.matches('input:not([type="hidden"],[type="checkbox"],[type="radio"],[type="range"],[type="color"],[type="file"]),textarea,select');
    if (!directText && !icon && !input) continue;
    if (node.matches('script,style,option') || node.closest('[hidden],[inert],:disabled,[aria-disabled="true"]')) continue;
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    if (box.width < 3 || box.height < 3 || style.visibility !== 'visible' || style.display === 'none') continue;
    const x = Math.max(0, box.left) + Math.min(box.width, innerWidth - Math.max(0, box.left)) / 2;
    const y = Math.max(0, box.top) + Math.min(box.height, innerHeight - Math.max(0, box.top)) / 2;
    if (box.bottom < 0 || box.right < 0 || box.top >= innerHeight || box.left >= innerWidth) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(node === hit || node.contains(hit))) continue;
    const layers = [];
    let ambiguous = false, opacity = 1;
    for (let parent = node; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      opacity *= Number(css.opacity);
      if (css.backgroundImage !== 'none') ambiguous = true;
      const color = parse(css.backgroundColor);
      if (color) layers.push(color);
      if (color?.[3] === 1) break;
    }
    if (opacity < 0.05) continue;
    let background = [255, 255, 255];
    for (const color of layers.reverse()) background = over(color, background);
    const placeholder = input && !node.value && node.getAttribute('placeholder');
    const inkStyle = placeholder ? getComputedStyle(node, '::placeholder') : style;
    const foreground = parse(icon ? style.stroke === 'none' ? style.color : style.stroke : inkStyle.webkitTextFillColor || inkStyle.color);
    if (!foreground) continue;
    foreground[3] *= opacity * (placeholder ? Number(inkStyle.opacity) : 1);
    const contrast = ratio(over(foreground, background), background);
    const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
    const minimum = icon || large ? 3 : 4.5;
    const id = node.id ? `#${node.id}` : `${node.tagName.toLowerCase()}.${[...node.classList].join('.')}`;
    const missingArrow = node.matches('select') && style.appearance === 'none' && style.backgroundImage === 'none';
    checked++;
    if (contrast < minimum || missingArrow) findings.push({ id, kind: missingArrow ? 'select-arrow' : icon ? 'icon' : placeholder ? 'placeholder' : 'text',
      text: (input ? node.value || node.getAttribute('placeholder') || '' : directText).slice(0, 70),
      contrast: +contrast.toFixed(2), minimum, foreground: inkStyle.color, background: background.map(Math.round),
      ambiguous, opacity, box: { x: +box.x.toFixed(1), y: +box.y.toFixed(1), width: +box.width.toFixed(1), height: +box.height.toFixed(1) } });
  }
  return { checked, findings };
}
