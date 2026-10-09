import { resizePdfBoxFromHandle, rotatePdfDeltaToLocal } from '../../pdf-editor-geometry.js';
import {
  editedTextVisualBox,
  insertedTextVisualBox,
  rectToViewport,
  sourceTextBox
} from './text-layout.js';

/**
 * Owns pointer sessions for component editing. Mutable editor collections stay
 * in the orchestrator and are accessed through callbacks so undo/redo can
 * replace them without leaving stale references in a session.
 */
export function createPdfEditorComponentInteraction({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  getComponentMode = () => false,
  getEditMode = () => false,
  getInsertMode = () => null,
  getActiveOperation = () => null,
  hasDocument = () => false,
  getSelectedComponent = () => null,
  getCurrentPage = () => null,
  getCurrentTextLayerCache = () => null,
  getCanvasWrap = () => null,
  getTextLayer = () => null,
  getTextLinesCache = () => new Map(),
  getTextEdits = () => new Map(),
  getInsertedTexts = () => [],
  getInsertedImages = () => [],
  getInsertedShapes = () => [],
  cloneState = value => value,
  selectComponent = () => {},
  componentElement = () => null,
  resolveComponentObject = () => null,
  getComponentRotation = () => 0,
  snapRotationToAxis = value => value,
  setComponentRotation = () => {},
  collectSnapTargets = () => [],
  snapComponentDrag = (_component, dx, dy) => ({ dx, dy }),
  updateComponentFromDelta = () => {},
  applyRelativeViewportRect = () => {},
  ensureTextMask = () => {},
  buildShapeSvg = () => null,
  positionComponentMenu = () => {},
  flushComponentVisualRefresh = () => {},
  updateControls = () => {},
  commitEditorHistory = () => {},
  listenerOptions = {}
} = {}) {
  let dragState = null;
  let pointerCleanup = null;
  let rotateTimer = null;
  let rotateState = null;
  let moveFrame = 0;
  let pendingMove = null;
  const guideElements = [];

  function clearGuides() {
    guideElements.splice(0).forEach(element => element.remove());
  }

  function drawGuides(guides, viewport) {
    clearGuides();
    const box = viewport?.viewBox;
    const layer = getTextLayer();
    if (!box || !layer || !documentRef?.createElement) return;
    for (const axis of ['x', 'y']) {
      const anchor = guides?.[axis];
      if (!anchor) continue;
      const start = axis === 'x' ? [anchor.target, box[1]] : [box[0], anchor.target];
      const end = axis === 'x' ? [anchor.target, box[3]] : [box[2], anchor.target];
      const [x, y] = viewport.convertToViewportPoint(...start);
      const [right, bottom] = viewport.convertToViewportPoint(...end);
      const line = documentRef.createElement('div');
      line.className = 'pdf-editor-snap-guide';
      line.setAttribute('aria-hidden', 'true');
      Object.assign(line.style, { left: `${x}px`, top: `${y}px`,
        width: `${Math.hypot(right - x, bottom - y)}px`,
        transform: `rotate(${Math.atan2(bottom - y, right - x)}rad)` });
      layer.appendChild(line);
      guideElements.push(line);
    }
  }

  function flushPointerMove() {
    if (moveFrame) windowRef?.cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    const move = pendingMove;
    pendingMove = null;
    move?.();
  }

  function queuePointerMove(callback) {
    pendingMove = callback;
    if (!windowRef?.requestAnimationFrame) return flushPointerMove();
    if (!moveFrame) moveFrame = windowRef.requestAnimationFrame(flushPointerMove);
  }

  function stopComponentRotate() {
    if (rotateTimer) {
      clearInterval(rotateTimer);
      rotateTimer = null;
    }
    rotateState = null;
  }

  function stopComponentPointerSession() {
    if (moveFrame) windowRef?.cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    pendingMove = null;
    clearGuides();
    if (pointerCleanup) {
      pointerCleanup();
      pointerCleanup = null;
    }
  }

  function bindComponentPointerSession(onMove, onUp) {
    if (!documentRef?.addEventListener) return () => {};
    const cleanup = () => {
      documentRef.removeEventListener('pointermove', onMove, true);
      documentRef.removeEventListener('pointerup', onUp, true);
      documentRef.removeEventListener('pointercancel', onUp, true);
      if (pointerCleanup === cleanup) pointerCleanup = null;
    };
    stopComponentPointerSession();
    pointerCleanup = cleanup;
    documentRef.addEventListener('pointermove', onMove, { ...listenerOptions, capture: true });
    documentRef.addEventListener('pointerup', onUp, { ...listenerOptions, capture: true });
    documentRef.addEventListener('pointercancel', onUp, { ...listenerOptions, capture: true });
    return cleanup;
  }

  function applyComponentResize(component, baseObject, handle, localDx, localDy) {
    if (!component || !baseObject) return;
    if (component.type === 'text' || component.type === 'inserted-text') {
      // The text control is the south-east handle. In PDF space a screen drag
      // downward produces a negative y delta, so subtract localDy.
      const factor = Math.max(0.5, 1 + ((localDx - localDy) / 80));
      updateComponentFromDelta(0, 0, factor, component);
      return;
    }

    const object = resolveComponentObject(component);
    if (!object) return;
    const isLine = component.type === 'inserted-shape' && baseObject.shapeType === 'line';
    const resized = resizePdfBoxFromHandle(
      baseObject,
      handle,
      localDx,
      localDy,
      { minWidth: isLine ? 2 : 10, minHeight: isLine ? 0.5 : 10,
        aspectRatio: component.type === 'inserted-image' && baseObject.aspectRatioLocked !== false
          ? baseObject.originalAspectRatio : undefined }
    );
    object.x = resized.x;
    object.y = resized.y;
    object.width = resized.width;
    object.height = resized.height;
    const selected = getSelectedComponent();
    if (selected?.type === component.type && selected.key === component.key) {
      selected.object = cloneState(object);
    }
  }

  function applyComponentDomVisual(component) {
    const textLayer = getTextLayer();
    if (!textLayer || !component) return;
    const page = getCurrentPage();
    const textLinesCache = getTextLinesCache() || new Map();
    const cache = page ? textLinesCache.get(page.id) : null;
    if (!page || !cache) return;
    if (component.type === 'text') {
      if (component.pageId !== page.id) return;
      const line = cache.lines?.[component.lineIndex];
      const sourceSegment = line?.segments?.[component.segmentIndex] || component.segment;
      const textEdits = getTextEdits() || new Map();
      const edit = textEdits.get(component.key);
      const segment = edit?.segment || component.segment || sourceSegment;
      const element = componentElement(component);
      if (!line || !segment || !element) return;
      const lineRect = rectToViewport(cache.cssViewport, line.box);
      const visualBox = edit
        ? (editedTextVisualBox(edit, segment) || segment.box || line.box)
        : (segment.box || line.box);
      const segmentRect = rectToViewport(cache.cssViewport, visualBox);
      applyRelativeViewportRect(element, segmentRect, lineRect);
      element.style.fontSize = Math.max(1, (segment.fontSize || line.fontSize) * cache.scale) + 'px';
      element.style.lineHeight = Math.max(1, segmentRect.height) + 'px';
      element.style.transformOrigin = '50% 50%';
      element.style.transform = `rotate(${Number(segment.rotation) || 0}deg)`;
      if (edit) {
        element.classList.add('is-edited');
        const content = element.querySelector('.pdf-editor-text-content');
        if (content && content.textContent !== (edit.newText || '')) content.textContent = edit.newText || '';
        element.style.width = Math.max(1, segmentRect.width) + 'px';
        ensureTextMask(
          element.parentElement,
          component.key,
          sourceTextBox(edit, sourceSegment),
          line.box,
          cache.cssViewport,
          Number(segment.rotation) || 0,
          visualBox
        );
      }
      positionComponentMenu();
      return;
    }

    const object = resolveComponentObject(component);
    if (!object) return;
    const element = componentElement(component);
    if (!element) return;
    const box = component.type === 'inserted-text'
      ? insertedTextVisualBox(object)
      : {
        x: Number(object.x) || 0,
        y: Number(object.y) || 0,
        width: Math.max(1, Number(object.width) || 1),
        height: Math.max(1, Number(object.height) || 1)
      };
    const rect = rectToViewport(cache.cssViewport, box);
    element.style.left = rect.left + 'px';
    element.style.top = rect.top + 'px';
    element.style.width = Math.max(1, rect.width) + 'px';
    element.style.height = Math.max(1, rect.height) + 'px';
    element.style.transform = `rotate(${Number(object.rotation) || 0}deg)`;
    if (component.type === 'inserted-text') {
      element.style.fontSize = Math.max(1, (Number(object.fontSize) || 16) * cache.scale) + 'px';
      element.style.lineHeight = Math.max(1, rect.height) + 'px';
    } else if (component.type === 'inserted-shape') {
      const existing = element.querySelector('svg');
      if (existing) existing.remove();
      const svg = buildShapeSvg(object, rect.width, rect.height, cache.scale);
      if (svg) element.appendChild(svg);
    }
    positionComponentMenu();
  }

  function scaleSelectedComponent(factor) {
    const selected = getSelectedComponent();
    if (!selected || !getComponentMode() || getActiveOperation()) return;
    updateComponentFromDelta(0, 0, factor, selected);
    commitEditorHistory();
  }

  function beginComponentRotate(event) {
    const selected = getSelectedComponent();
    if (!getComponentMode() || !selected || getActiveOperation()) return;
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stopComponentRotate();
    const target = componentElement(selected);
    const targetRect = target?.getBoundingClientRect();
    let centerX = event.clientX;
    let centerY = event.clientY;
    if (targetRect) {
      centerX = targetRect.left + targetRect.width / 2;
      centerY = targetRect.top + targetRect.height / 2;
    }
    const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI;
    rotateState = {
      component: cloneState(selected),
      pointerId: event.pointerId,
      centerX,
      centerY,
      startAngle,
      baseRotation: getComponentRotation(selected)
    };
    const onMove = moveEvent => {
      if (!rotateState || moveEvent.pointerId !== rotateState.pointerId) return;
      moveEvent.preventDefault();
      const angle = Math.atan2(
        moveEvent.clientY - rotateState.centerY,
        moveEvent.clientX - rotateState.centerX
      ) * 180 / Math.PI;
      const rotation = snapRotationToAxis(rotateState.baseRotation + (angle - rotateState.startAngle));
      setComponentRotation(getSelectedComponent(), rotation);
      updateControls();
      applyComponentDomVisual(getSelectedComponent());
    };
    const onUp = upEvent => {
      if (!rotateState || upEvent.pointerId !== rotateState.pointerId) return;
      pointerCleanup?.();
      stopComponentRotate();
      flushComponentVisualRefresh();
      commitEditorHistory();
    };
    bindComponentPointerSession(onMove, onUp);
  }

  function beginComponentDrag(event, component) {
    if (!getComponentMode() || getEditMode() || getInsertMode() || !hasDocument() || getActiveOperation()) return;
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectComponent(component);
    const cache = getCurrentTextLayerCache();
    if (!cache) return;
    dragState = {
      mode: 'drag',
      component: cloneState(getSelectedComponent() || component),
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      cache,
      snapTargets: collectSnapTargets(component.pageId, component.type, component.key),
      started: false
    };
    const onMove = moveEvent => {
      if (!dragState || moveEvent.pointerId !== dragState.pointerId) return;
      moveEvent.preventDefault();
      queuePointerMove(() => {
        if (!dragState) return;
        if (!dragState.started) {
          const distance = Math.hypot(
            moveEvent.clientX - dragState.startClientX,
            moveEvent.clientY - dragState.startClientY
          );
          if (distance < 4) return;
          dragState.started = true;
        }
        const bounds = getCanvasWrap()?.getBoundingClientRect();
        const startCss = dragState.cache.cssViewport.convertToPdfPoint(
          dragState.startClientX - (bounds?.left || 0),
          dragState.startClientY - (bounds?.top || 0)
        );
        const nextCss = dragState.cache.cssViewport.convertToPdfPoint(
          moveEvent.clientX - (bounds?.left || 0),
          moveEvent.clientY - (bounds?.top || 0)
        );
        const snapped = snapComponentDrag(
          dragState.component,
          nextCss[0] - startCss[0],
          nextCss[1] - startCss[1],
          dragState.snapTargets,
          { scale: dragState.cache.scale, previous: dragState.guides, disabled: moveEvent.altKey,
            pageBox: dragState.cache.cssViewport.viewBox ? {
              x: dragState.cache.cssViewport.viewBox[0], y: dragState.cache.cssViewport.viewBox[1],
              width: dragState.cache.cssViewport.viewBox[2] - dragState.cache.cssViewport.viewBox[0],
              height: dragState.cache.cssViewport.viewBox[3] - dragState.cache.cssViewport.viewBox[1]
            } : null }
        );
        dragState.guides = snapped.guides;
        updateComponentFromDelta(snapped.dx, snapped.dy, 1, dragState.component, { deferRender: true });
        drawGuides(snapped.guides, dragState.cache.cssViewport);
      });
    };
    const onUp = upEvent => {
      if (!dragState || upEvent.pointerId !== dragState.pointerId) return;
      flushPointerMove();
      const moved = Boolean(dragState.started);
      pointerCleanup?.();
      clearGuides();
      if (moved) flushComponentVisualRefresh();
      dragState = null;
      if (moved) commitEditorHistory();
    };
    bindComponentPointerSession(onMove, onUp);
  }

  function beginComponentResize(event, component, handle = 'se') {
    if (!getComponentMode() || getEditMode() || getInsertMode() || !hasDocument() || getActiveOperation()) return;
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectComponent(component);
    const cache = getCurrentTextLayerCache();
    if (!cache) return;
    const liveObject = resolveComponentObject(component);
    dragState = {
      mode: 'resize',
      component: cloneState(component),
      baseObject: component.type === 'text'
        ? cloneState(component.segment || {})
        : cloneState(liveObject || {}),
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      handle,
      rotation: Number(liveObject?.rotation) || getComponentRotation(component),
      cache
    };
    const onMove = moveEvent => {
      if (!dragState || moveEvent.pointerId !== dragState.pointerId) return;
      moveEvent.preventDefault();
      const bounds = getCanvasWrap()?.getBoundingClientRect();
      const startPdf = dragState.cache.cssViewport.convertToPdfPoint(
        dragState.startClientX - (bounds?.left || 0),
        dragState.startClientY - (bounds?.top || 0)
      );
      const currentPdf = dragState.cache.cssViewport.convertToPdfPoint(
        moveEvent.clientX - (bounds?.left || 0),
        moveEvent.clientY - (bounds?.top || 0)
      );
      const localDelta = rotatePdfDeltaToLocal(
        currentPdf[0] - startPdf[0],
        currentPdf[1] - startPdf[1],
        dragState.rotation
      );
      applyComponentResize(
        dragState.component,
        dragState.baseObject,
        dragState.handle,
        localDelta.x,
        localDelta.y
      );
      applyComponentDomVisual(dragState.component);
    };
    const onUp = upEvent => {
      if (!dragState || upEvent.pointerId !== dragState.pointerId) return;
      pointerCleanup?.();
      flushComponentVisualRefresh();
      dragState = null;
      commitEditorHistory();
    };
    bindComponentPointerSession(onMove, onUp);
  }

  function reset() {
    stopComponentPointerSession();
    stopComponentRotate();
    dragState = null;
  }

  return {
    applyComponentResize,
    applyComponentDomVisual,
    beginComponentDrag,
    beginComponentResize,
    beginComponentRotate,
    reset,
    scaleSelectedComponent,
    stopComponentPointerSession,
    stopComponentRotate
  };
}
