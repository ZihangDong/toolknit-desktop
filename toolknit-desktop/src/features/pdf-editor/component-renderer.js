import {
  editedTextVisualBox,
  insertedTextVisualBox,
  rectToViewport,
  sourceTextBox
} from './text-layout.js';

/**
 * Owns the PDF Editor text layer and generated component DOM. State mutation,
 * selection and pointer sessions stay injected in the UI orchestrator.
 */
export function createPdfEditorComponentRenderer({
  getTextLayer = () => null,
  getEditMode = () => false,
  getComponentMode = () => false,
  getInsertMode = () => null,
  getSelectedComponent = () => null,
  getTextEdits = () => new Map(),
  getInsertedTexts = () => [],
  getInsertedImages = () => [],
  getInsertedShapes = () => [],
  t = key => key,
  listenerOptions = {},
  documentRef = globalThis.document,
  selectComponent = () => {},
  handleCanvasPlacement = () => {},
  openEditModal = () => {},
  sameComponent = () => false,
  beginComponentDrag = () => {},
  beginComponentResize = () => {},
  appendResizeHandles = () => {},
  buildShapeSvg = () => null,
  syncComponentMenu = () => {}
} = {}) {
  let lastRender = null;
  let measureContext;

  function measureText(object, text, fontSize) {
    if (measureContext === undefined) measureContext = documentRef?.createElement('canvas')?.getContext?.('2d') || null;
    if (!measureContext) return;
    const family = documentRef.defaultView?.getComputedStyle(getTextLayer())
      .getPropertyValue('--tk-font-pdf').trim() || '"Microsoft YaHei", Helvetica, Arial, sans-serif';
    measureContext.font = `500 ${fontSize}px ${family}`;
    const metrics = measureContext.measureText(String(text ?? ''));
    object.visualTextWidth = metrics.width;
    object.visualTextHeight = (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent)
      || fontSize * 1.2;
  }

  function syncSelection() {
    const layer = getTextLayer();
    if (!layer || !lastRender) return;
    const selected = getSelectedComponent();
    const { pageId } = lastRender;
    for (const element of layer.querySelectorAll('[data-segment-type]')) {
      const type = element.dataset.segmentType;
      const key = type === 'text' ? element.dataset.segmentKey : element.dataset.objectId;
      const active = getComponentMode() && sameComponent(selected, { type, key, pageId });
      element.classList.toggle('is-selected', Boolean(active));
      element.querySelectorAll('.pdf-editor-component-handle').forEach(handle => handle.remove());
      if (!active) continue;
      if (type === 'text' || type === 'inserted-text') {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = 'pdf-editor-component-handle';
        button.dataset.handle = 'se';
        button.setAttribute('aria-label', t('home.pdfEditor.resizeComponent'));
        button.addEventListener('pointerdown', event => {
          const current = getSelectedComponent();
          if (current) beginComponentResize(event, current);
        }, listenerOptions);
        element.appendChild(button);
      } else {
        const object = (type === 'inserted-image' ? getInsertedImages() : getInsertedShapes())
          .find(item => item.id === key);
        if (object) appendResizeHandles(element, { type }, pageId, object);
      }
    }
    syncComponentMenu();
  }

  function syncTextLayerAccessibility() {
    const textLayer = getTextLayer();
    if (!textLayer) return;
    const interactive = Boolean(getComponentMode() || getEditMode() || getInsertMode());
    textLayer.setAttribute('aria-hidden', String(!interactive));
  }

  function applyRelativeViewportRect(element, rect, parentRect) {
    if (!element || !rect || !parentRect) return;
    element.style.left = (rect.left - parentRect.left) + 'px';
    element.style.top = (rect.top - parentRect.top) + 'px';
    element.style.width = Math.max(1, rect.width) + 'px';
    element.style.height = Math.max(1, rect.height) + 'px';
  }

  function ensureTextMask(lineElement, key, sourceBox, lineBox, cssViewport, rotation = 0, rotationBox = sourceBox) {
    if (!lineElement || !sourceBox || !lineBox || !cssViewport) return null;
    let mask = Array.from(lineElement.children).find(child => child.dataset?.maskKey === key) || null;
    if (!mask) {
      mask = documentRef.createElement('div');
      mask.className = 'pdf-editor-text-mask';
      mask.dataset.maskKey = key;
      lineElement.insertBefore(mask, lineElement.firstChild || null);
    }
    const sourceRect = rectToViewport(cssViewport, sourceBox);
    const parentRect = rectToViewport(cssViewport, lineBox);
    applyRelativeViewportRect(mask, sourceRect, parentRect);

    // Cover the original glyphs and a rotated replacement around its own box.
    const normalizedRotation = ((Number(rotation) || 0) % 360 + 360) % 360;
    let rotatedMask = Array.from(lineElement.children)
      .find(child => child.dataset?.maskKey === `${key}:rotated`) || null;
    if (normalizedRotation === 0) {
      rotatedMask?.remove();
      return mask;
    }
    if (!rotatedMask) {
      rotatedMask = documentRef.createElement('div');
      rotatedMask.className = 'pdf-editor-text-mask pdf-editor-text-mask-rotated';
      rotatedMask.dataset.maskKey = `${key}:rotated`;
      lineElement.insertBefore(rotatedMask, mask.nextSibling || null);
    }
    const replacementRect = rectToViewport(cssViewport, rotationBox || sourceBox);
    applyRelativeViewportRect(rotatedMask, replacementRect, parentRect);
    rotatedMask.style.transformOrigin = '50% 50%';
    rotatedMask.style.transform = `rotate(${normalizedRotation}deg)`;
    return mask;
  }

  function render(lines, cssViewport, scale, pageId) {
    const textLayer = getTextLayer();
    if (!textLayer) return;
    lastRender = { pageId };
    const editMode = Boolean(getEditMode());
    const componentMode = Boolean(getComponentMode());
    const insertMode = getInsertMode();
    const selectedComponent = getSelectedComponent();
    const textEdits = getTextEdits();
    textLayer.replaceChildren();
    textLayer.classList.toggle('is-edit-mode', editMode);
    textLayer.classList.toggle('is-object-mode', componentMode);
    textLayer.classList.toggle('is-insert-mode', Boolean(insertMode));
    syncTextLayerAccessibility();

    for (let index = 0; index < (Array.isArray(lines) ? lines.length : 0); index += 1) {
      const line = lines[index];
      const rect = rectToViewport(cssViewport, line.box);
      const lineElement = documentRef.createElement('div');
      lineElement.className = 'pdf-editor-text-line';
      lineElement.dataset.lineKey = `${pageId}:${index}`;
      lineElement.style.left = rect.left + 'px';
      lineElement.style.top = rect.top + 'px';
      lineElement.style.height = Math.max(0, rect.height) + 'px';
      lineElement.style.width = Math.max(0, rect.width) + 'px';
      lineElement.style.fontSize = Math.max(1, line.fontSize * scale) + 'px';
      lineElement.style.lineHeight = Math.max(0, rect.height) + 'px';

      const segments = Array.isArray(line.segments) && line.segments.length
        ? line.segments
        : [{
          text: line.text,
          baselineX: line.baselineX,
          baselineY: line.baselineY,
          fontSize: line.fontSize,
          fontName: line.fontName,
          bold: line.bold,
          italic: line.italic,
          box: line.box
        }];

      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex];
        const key = `${pageId}:${index}:${segmentIndex}`;
        const edit = textEdits.get(key);
        const segmentData = edit?.segment || segment;
        if (edit) measureText(segmentData, edit.newText, segmentData.fontSize || line.fontSize);
        const visualBox = edit
          ? (editedTextVisualBox(edit, segmentData) || segmentData.box || line.box)
          : (segmentData.box || line.box);
        const segmentRect = rectToViewport(cssViewport, visualBox);
        if (edit) {
          ensureTextMask(
            lineElement,
            key,
            sourceTextBox(edit, segment),
            line.box,
            cssViewport,
            Number(segmentData.rotation) || 0,
            visualBox
          );
        }
        const segmentElement = documentRef.createElement('div');
        segmentElement.className = 'pdf-editor-text-segment';
        segmentElement.dataset.segmentKey = key;
        segmentElement.dataset.segmentType = 'text';
        segmentElement.setAttribute('aria-label', segment.text || t('home.pdfEditor.textComponent'));
        const isSelected = Boolean(componentMode
          && selectedComponent?.type === 'text'
          && selectedComponent.pageId === pageId
          && selectedComponent.key === key);
        segmentElement.classList.toggle('is-selected', isSelected);
        applyRelativeViewportRect(segmentElement, segmentRect, rect);
        segmentElement.style.fontSize = Math.max(1, (segmentData.fontSize || line.fontSize) * scale) + 'px';
        segmentElement.style.lineHeight = Math.max(1, segmentRect.height) + 'px';
        segmentElement.style.transformOrigin = '50% 50%';
        segmentElement.style.transform = `rotate(${Number(segmentData.rotation) || 0}deg)`;
        const content = documentRef.createElement('span');
        content.className = 'pdf-editor-text-content';
        segmentElement.appendChild(content);
        if (edit) {
          segmentElement.classList.add('is-edited');
          content.textContent = edit.newText || '';
          segmentElement.style.width = Math.max(1, segmentRect.width) + 'px';
        } else {
          content.textContent = segment.text;
        }
        segmentElement.addEventListener('click', event => {
          event.stopPropagation();
          if (editMode) {
            openEditModal(key, segmentData, segmentData);
          } else if (componentMode) {
            selectComponent({ type: 'text', pageId, key, lineIndex: index, segmentIndex,
              segment: getTextEdits().get(key)?.segment || segment });
          } else if (insertMode) {
            handleCanvasPlacement(event);
          }
        }, listenerOptions);
        segmentElement.addEventListener('dblclick', event => {
          if (!getComponentMode() || getInsertMode() || event.target.closest('.pdf-editor-component-handle')) return;
          event.preventDefault();
          event.stopPropagation();
          const live = getTextEdits().get(key)?.segment || segment;
          openEditModal(key, live, live);
        }, listenerOptions);
        segmentElement.addEventListener('pointerdown', event => {
          if (!componentMode || editMode || insertMode) return;
          const component = { type: 'text', pageId, key, lineIndex: index, segmentIndex,
            segment: getTextEdits().get(key)?.segment || segment };
          beginComponentDrag(event, component);
        }, listenerOptions);
        if (isSelected) {
          const handle = documentRef.createElement('button');
          handle.type = 'button';
          handle.className = 'pdf-editor-component-handle';
          handle.dataset.handle = 'se';
          handle.setAttribute('aria-label', t('home.pdfEditor.selectComponent'));
          handle.addEventListener('pointerdown', event => {
            beginComponentResize(event, {
              type: 'text', pageId, key, lineIndex: index, segmentIndex, segment: segmentData
            });
          }, listenerOptions);
          segmentElement.appendChild(handle);
        }
        lineElement.appendChild(segmentElement);
      }
      textLayer.appendChild(lineElement);
    }

    for (const object of getInsertedTexts().filter(item => item.pageId === pageId)) {
      measureText(object, object.text, object.fontSize);
      const visualBox = insertedTextVisualBox(object);
      const rect = rectToViewport(cssViewport, visualBox);
      const element = documentRef.createElement('div');
      element.className = 'pdf-editor-inserted-text';
      element.dataset.objectId = object.id;
      element.dataset.segmentType = 'inserted-text';
      element.dataset.segmentKey = `inserted-text:${object.id}`;
      const isSelected = Boolean(componentMode
        && selectedComponent?.type === 'inserted-text'
        && selectedComponent.pageId === pageId
        && selectedComponent.key === object.id);
      element.classList.toggle('is-selected', isSelected);
      element.textContent = object.text;
      element.style.left = rect.left + 'px';
      element.style.top = rect.top + 'px';
      element.style.width = Math.max(1, rect.width) + 'px';
      element.style.height = Math.max(1, rect.height) + 'px';
      element.style.fontSize = Math.max(1, object.fontSize * scale) + 'px';
      element.style.lineHeight = Math.max(1, rect.height) + 'px';
      element.style.transformOrigin = '50% 50%';
      element.style.transform = `rotate(${Number(object.rotation) || 0}deg)`;
      element.addEventListener('click', event => {
        event.stopPropagation();
        if (editMode) openEditModal(object.id, object, object, 'edit-inserted-text');
        else if (componentMode) selectComponent({ type: 'inserted-text', pageId, key: object.id, object });
        else if (insertMode) handleCanvasPlacement(event);
      }, listenerOptions);
      element.addEventListener('dblclick', event => {
        if (!getComponentMode() || getInsertMode() || event.target.closest('.pdf-editor-component-handle')) return;
        event.preventDefault();
        event.stopPropagation();
        openEditModal(object.id, object, object, 'edit-inserted-text');
      }, listenerOptions);
      element.addEventListener('pointerdown', event => {
        if (!componentMode || editMode || insertMode) return;
        const component = { type: 'inserted-text', pageId, key: object.id, object };
        beginComponentDrag(event, component);
      }, listenerOptions);
      if (isSelected) {
        const handle = documentRef.createElement('button');
        handle.type = 'button';
        handle.className = 'pdf-editor-component-handle';
        handle.dataset.handle = 'se';
        handle.setAttribute('aria-label', t('home.pdfEditor.selectComponent'));
        handle.addEventListener('pointerdown', event => {
          beginComponentResize(event, { type: 'inserted-text', pageId, key: object.id, object });
        }, listenerOptions);
        element.appendChild(handle);
      }
      textLayer.appendChild(element);
    }

    for (const object of getInsertedImages().filter(item => item.pageId === pageId)) {
      const rect = rectToViewport(cssViewport, { x: object.x, y: object.y, width: object.width, height: object.height });
      const wrapper = documentRef.createElement('div');
      wrapper.className = 'pdf-editor-inserted-image-wrap';
      wrapper.dataset.objectId = object.id;
      wrapper.dataset.segmentType = 'inserted-image';
      wrapper.dataset.segmentKey = `inserted-image:${object.id}`;
      const isSelected = Boolean(componentMode
        && selectedComponent?.type === 'inserted-image'
        && selectedComponent.pageId === pageId
        && selectedComponent.key === object.id);
      wrapper.classList.toggle('is-selected', isSelected);
      wrapper.style.left = rect.left + 'px';
      wrapper.style.top = rect.top + 'px';
      wrapper.style.width = Math.max(1, rect.width) + 'px';
      wrapper.style.height = Math.max(1, rect.height) + 'px';
      wrapper.style.transform = `rotate(${Number(object.rotation) || 0}deg)`;
      const image = documentRef.createElement('img');
      image.className = 'pdf-editor-inserted-image';
      image.src = object.previewUrl;
      image.alt = t('home.pdfEditor.insertedImage');
      image.style.width = '100%';
      image.style.height = '100%';
      image.addEventListener('click', event => {
        event.stopPropagation();
        if (componentMode) selectComponent({ type: 'inserted-image', pageId, key: object.id, object });
        else if (insertMode) handleCanvasPlacement(event);
      }, listenerOptions);
      image.addEventListener('pointerdown', event => {
        if (!componentMode || editMode || insertMode) return;
        const component = { type: 'inserted-image', pageId, key: object.id, object };
        beginComponentDrag(event, component);
      }, listenerOptions);
      if (isSelected) appendResizeHandles(wrapper, { type: 'inserted-image' }, pageId, object);
      wrapper.appendChild(image);
      textLayer.appendChild(wrapper);
    }

    for (const object of getInsertedShapes().filter(item => item.pageId === pageId)) {
      const rect = rectToViewport(cssViewport, {
        x: object.x,
        y: object.y,
        width: Math.max(1, object.width),
        height: Math.max(1, object.height)
      });
      const wrapper = documentRef.createElement('div');
      wrapper.className = 'pdf-editor-inserted-shape';
      if (object.shapeType === 'line') wrapper.classList.add('pdf-editor-inserted-shape--line');
      wrapper.dataset.objectId = object.id;
      wrapper.dataset.segmentType = 'inserted-shape';
      wrapper.dataset.segmentKey = `inserted-shape:${object.id}`;
      const isSelected = Boolean(componentMode
        && selectedComponent?.type === 'inserted-shape'
        && selectedComponent.pageId === pageId
        && selectedComponent.key === object.id);
      wrapper.classList.toggle('is-selected', isSelected);
      wrapper.style.left = rect.left + 'px';
      wrapper.style.top = rect.top + 'px';
      wrapper.style.width = Math.max(1, rect.width) + 'px';
      wrapper.style.height = Math.max(1, rect.height) + 'px';
      wrapper.style.transform = `rotate(${Number(object.rotation) || 0}deg)`;
      const svg = buildShapeSvg(object, rect.width, rect.height, scale);
      if (svg) wrapper.appendChild(svg);
      wrapper.addEventListener('click', event => {
        event.stopPropagation();
        if (componentMode) selectComponent({ type: 'inserted-shape', pageId, key: object.id, object });
        else if (insertMode) handleCanvasPlacement(event);
      }, listenerOptions);
      wrapper.addEventListener('pointerdown', event => {
        if (!componentMode || editMode || insertMode) return;
        const component = { type: 'inserted-shape', pageId, key: object.id, object };
        beginComponentDrag(event, component);
      }, listenerOptions);
      if (isSelected) appendResizeHandles(wrapper, { type: 'inserted-shape' }, pageId, object);
      textLayer.appendChild(wrapper);
    }
    syncComponentMenu();
  }

  return {
    applyRelativeViewportRect,
    ensureTextMask,
    render,
    syncSelection,
    syncTextLayerAccessibility
  };
}
