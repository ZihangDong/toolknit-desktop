import { rectToViewport } from './text-layout.js';

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function rgb01ToHex(color) {
  const values = Array.isArray(color) ? color : [];
  const toHex = value => Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
  return `#${toHex(values[0] ?? 0)}${toHex(values[1] ?? 0)}${toHex(values[2] ?? 0)}`;
}

/**
 * Owns the floating component controls and shape editing affordances. The
 * editor orchestrator supplies state accessors and pointer/selection actions;
 * this module only translates that state into controls and SVG DOM.
 */
export function createPdfEditorComponentControls({
  componentMenu = null,
  componentEditBtn = null,
  componentAspectBtn = null,
  resolveComponentObject = () => null,
  shapePanel = null,
  shapeFillField = null,
  shapeFillInput = null,
  shapeStrokeInput = null,
  shapeStrokeWidth = null,
  canvasStage = null,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  listenerOptions = {},
  t = key => key,
  cloneState = value => value,
  getSelectedComponent = () => null,
  getComponentMode = () => false,
  hasDocument = () => false,
  componentElement = () => null,
  getInsertedShapes = () => [],
  beginComponentResize = () => {},
  updateControls = () => {},
  refreshCurrentTextLayer = () => {}
} = {}) {
  const requestFrame = callback => {
    if (typeof windowRef?.requestAnimationFrame === 'function') {
      return windowRef.requestAnimationFrame(callback);
    }
    callback();
    return 0;
  };

  function positionComponentMenu() {
    const selectedComponent = getSelectedComponent();
    if (!componentMenu || componentMenu.hidden || !selectedComponent || !canvasStage) return;
    const target = componentElement(selectedComponent);
    if (!target) {
      componentMenu.hidden = true;
      return;
    }
    const stageRect = canvasStage.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const menuWidth = componentMenu.offsetWidth || 180;
    const menuHeight = componentMenu.offsetHeight || 38;
    const gap = 8;
    const maxLeft = Math.max(8, canvasStage.clientWidth - menuWidth - 8);
    const maxTop = Math.max(8, canvasStage.clientHeight - menuHeight - 8);
    let left = targetRect.right - stageRect.left + gap;
    let top = targetRect.top - stageRect.top - menuHeight - gap;
    if (left > maxLeft) left = targetRect.left - stageRect.left - menuWidth - gap;
    if (top < 8) top = targetRect.bottom - stageRect.top + gap;
    componentMenu.style.left = `${Math.round(Math.max(8, Math.min(maxLeft, left)))}px`;
    componentMenu.style.top = `${Math.round(Math.max(8, Math.min(maxTop, top)))}px`;
  }

  function positionShapePanel() {
    if (!shapePanel || shapePanel.hidden || !canvasStage) return;
    const stageRect = canvasStage.getBoundingClientRect();
    const menuRect = componentMenu?.hidden ? null : componentMenu?.getBoundingClientRect();
    const panelWidth = shapePanel.offsetWidth || 200;
    const panelHeight = shapePanel.offsetHeight || 46;
    const maxLeft = Math.max(8, canvasStage.clientWidth - panelWidth - 8);
    const maxTop = Math.max(8, canvasStage.clientHeight - panelHeight - 8);
    let left = menuRect ? menuRect.left - stageRect.left : 8;
    let top = menuRect ? menuRect.bottom - stageRect.top + 8 : 8;
    left = Math.max(8, Math.min(maxLeft, left));
    top = Math.max(8, Math.min(maxTop, top));
    shapePanel.style.left = `${Math.round(left)}px`;
    shapePanel.style.top = `${Math.round(top)}px`;
  }

  function syncShapePanel() {
    if (!shapePanel) return;
    const selectedComponent = getSelectedComponent();
    const visible = Boolean(
      getComponentMode()
      && selectedComponent?.type === 'inserted-shape'
      && hasDocument()
    );
    shapePanel.hidden = !visible;
    if (!visible) return;
    const object = (getInsertedShapes() || []).find(item => item.id === selectedComponent.key);
    if (!object) return;
    if (shapeFillField) shapeFillField.hidden = object.shapeType === 'line';
    if (shapeFillInput) shapeFillInput.value = rgb01ToHex(Array.isArray(object.fill) ? object.fill : [1, 1, 1]);
    if (shapeStrokeInput) shapeStrokeInput.value = rgb01ToHex(object.stroke);
    if (shapeStrokeWidth) shapeStrokeWidth.value = String(Number(object.strokeWidth) || 0);
    requestFrame(positionShapePanel);
  }

  function syncComponentMenu() {
    if (!componentMenu) return;
    const selectedComponent = getSelectedComponent();
    const visible = Boolean(getComponentMode() && selectedComponent && hasDocument());
    componentMenu.hidden = !visible;
    if (componentEditBtn) {
      componentEditBtn.hidden = visible
        && !['text', 'inserted-text'].includes(selectedComponent?.type);
    }
    if (componentAspectBtn) {
      componentAspectBtn.hidden = !visible || selectedComponent?.type !== 'inserted-image';
      const locked = resolveComponentObject(selectedComponent)?.aspectRatioLocked !== false;
      const label = t(locked ? 'home.pdfEditor.unlockAspectRatio' : 'home.pdfEditor.lockAspectRatio');
      componentAspectBtn.setAttribute('aria-pressed', String(locked));
      componentAspectBtn.setAttribute('aria-label', label);
      componentAspectBtn.title = label;
      componentAspectBtn.classList.toggle('is-active', locked);
    }
    if (visible) requestFrame(positionComponentMenu);
    syncShapePanel();
  }

  function updateSelectedShapeProperty(property, value) {
    const selectedComponent = getSelectedComponent();
    if (!selectedComponent || selectedComponent.type !== 'inserted-shape') return;
    const object = (getInsertedShapes() || []).find(item => item.id === selectedComponent.key);
    if (!object) return;
    if (property === 'strokeWidth') {
      object.strokeWidth = Math.max(0, Math.min(80, Number(value) || 0));
    } else {
      object[property] = Array.isArray(value) ? value.map(clamp01) : value;
    }
    selectedComponent.object = cloneState(object);
    updateControls();
    refreshCurrentTextLayer();
  }

  function shapeStrokeCss(strokeWidth, scale) {
    return Math.max(1, (Number(strokeWidth) || 0) * (scale || 1));
  }

  function buildShapeSvg(object, cssWidth, cssHeight, scale) {
    if (!documentRef?.createElementNS) return null;
    const xmlns = 'http://www.w3.org/2000/svg';
    const svg = documentRef.createElementNS(xmlns, 'svg');
    const width = Math.max(1, cssWidth);
    const height = Math.max(1, cssHeight);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('overflow', 'visible');
    svg.style.display = 'block';
    const fill = Array.isArray(object?.fill) ? rgb01ToHex(object.fill) : 'none';
    const stroke = Array.isArray(object?.stroke) ? rgb01ToHex(object.stroke) : '#111111';
    const strokeWidth = shapeStrokeCss(object?.strokeWidth, scale);
    let node;
    if (object?.shapeType === 'ellipse') {
      node = documentRef.createElementNS(xmlns, 'ellipse');
      node.setAttribute('cx', (width / 2).toFixed(2));
      node.setAttribute('cy', (height / 2).toFixed(2));
      node.setAttribute('rx', Math.max(0.5, width / 2 - strokeWidth / 2).toFixed(2));
      node.setAttribute('ry', Math.max(0.5, height / 2 - strokeWidth / 2).toFixed(2));
      node.setAttribute('fill', fill);
      node.setAttribute('stroke', stroke);
      node.setAttribute('stroke-width', strokeWidth);
    } else if (object?.shapeType === 'line') {
      node = documentRef.createElementNS(xmlns, 'line');
      node.setAttribute('x1', '0');
      node.setAttribute('y1', '0');
      node.setAttribute('x2', width.toFixed(2));
      node.setAttribute('y2', height.toFixed(2));
      node.setAttribute('stroke', stroke);
      node.setAttribute('stroke-width', strokeWidth);
    } else {
      node = documentRef.createElementNS(xmlns, 'rect');
      const inset = strokeWidth / 2;
      node.setAttribute('x', inset.toFixed(2));
      node.setAttribute('y', inset.toFixed(2));
      node.setAttribute('width', Math.max(0.5, width - strokeWidth).toFixed(2));
      node.setAttribute('height', Math.max(0.5, height - strokeWidth).toFixed(2));
      node.setAttribute('fill', fill);
      node.setAttribute('stroke', stroke);
      node.setAttribute('stroke-width', strokeWidth);
    }
    svg.appendChild(node);
    return svg;
  }

  function appendResizeHandles(container, component, pageId, object) {
    if (!container || !documentRef?.createElement) return;
    const isLine = component.type === 'inserted-shape' && object?.shapeType === 'line';
    const handles = isLine ? ['nw', 'se'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    for (const handle of handles) {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'pdf-editor-component-handle';
      button.dataset.handle = handle;
      button.setAttribute('aria-label', t('home.pdfEditor.resizeComponent'));
      button.addEventListener('pointerdown', event => {
        event.stopPropagation();
        beginComponentResize(event, { type: component.type, pageId, key: object.id, object }, handle);
      }, listenerOptions);
      container.appendChild(button);
    }
  }

  return {
    appendResizeHandles,
    buildShapeSvg,
    positionComponentMenu,
    positionShapePanel,
    shapeStrokeCss,
    syncComponentMenu,
    syncShapePanel,
    updateSelectedShapeProperty
  };
}
