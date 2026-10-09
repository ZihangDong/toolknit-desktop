import { editedTextVisualBox, insertedTextVisualBox } from './text-layout.js';

function defaultClone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function componentElementKey(component) {
  if (!component) return '';
  return component.type === 'text' ? component.key : `${component.type}:${component.key}`;
}

export function sameComponent(left, right) {
  return Boolean(left && right
    && left.type === right.type
    && left.pageId === right.pageId
    && componentElementKey(left) === componentElementKey(right));
}

export function snapRotationToAxis(rotationDeg, threshold = 6) {
  const normalized = ((Number(rotationDeg) || 0) % 360 + 360) % 360;
  for (const candidate of [0, 90, 180, 270, 360]) {
    if (Math.abs(normalized - candidate) <= threshold) return candidate % 360;
  }
  return normalized;
}

export function sameTextSegmentLayout(a, b) {
  if (!a || !b) return false;
  const boxA = a.box || {};
  const boxB = b.box || {};
  const epsilon = 0.01;
  return Math.abs((Number(a.baselineX) || 0) - (Number(b.baselineX) || 0)) < epsilon
    && Math.abs((Number(a.baselineY) || 0) - (Number(b.baselineY) || 0)) < epsilon
    && Math.abs((Number(a.fontSize) || 0) - (Number(b.fontSize) || 0)) < epsilon
    && Math.abs((Number(boxA.x) || 0) - (Number(boxB.x) || 0)) < epsilon
    && Math.abs((Number(boxA.y) || 0) - (Number(boxB.y) || 0)) < epsilon
    && Math.abs((Number(boxA.width) || 0) - (Number(boxB.width) || 0)) < epsilon
    && Math.abs((Number(boxA.height) || 0) - (Number(boxB.height) || 0)) < epsilon
    && Math.abs((Number(a.rotation) || 0) - (Number(b.rotation) || 0)) < epsilon
    && Boolean(a.bold) === Boolean(b.bold)
    && Boolean(a.italic) === Boolean(b.italic)
    && JSON.stringify(a.color || null) === JSON.stringify(b.color || null);
}

/**
 * Owns PDF Editor component state transformations without reading or writing
 * DOM. Collections are supplied as getters so undo/redo can replace them
 * without leaving stale references in this model.
 */
export function createPdfEditorComponentModel({
  getTextEdits = () => new Map(),
  getInsertedTexts = () => [],
  getInsertedImages = () => [],
  getInsertedShapes = () => [],
  getTextLinesCache = () => new Map(),
  getSelectedComponent = () => null,
  setSelectedComponent = () => {},
  cloneState = defaultClone,
  onChanged = () => {}
} = {}) {
  function componentCollection(component) {
    if (!component) return null;
    if (component.type === 'inserted-text') return getInsertedTexts() || [];
    if (component.type === 'inserted-image') return getInsertedImages() || [];
    if (component.type === 'inserted-shape') return getInsertedShapes() || [];
    return null;
  }

  function resolveComponentObject(component) {
    const collection = componentCollection(component);
    if (!collection || component.key == null) return null;
    return collection.find(item => item.id === component.key) || null;
  }

  function getComponentRotation(component) {
    if (!component) return 0;
    if (component.type === 'text') {
      const edit = (getTextEdits() || new Map()).get(component.key);
      return Number(edit?.segment?.rotation) || 0;
    }
    return Number(resolveComponentObject(component)?.rotation) || 0;
  }

  function ensureTextEditEntry(component, segment) {
    if (!component?.key) return null;
    const textEdits = getTextEdits() || new Map();
    const existing = textEdits.get(component.key);
    if (existing) {
      if (!existing.baseSegment && segment) existing.baseSegment = cloneState(segment);
      if (!existing.segment && segment) existing.segment = cloneState(segment);
      return existing;
    }
    const next = {
      newText: String(segment?.text ?? ''),
      baseSegment: cloneState(segment || {}),
      segment: cloneState(segment || {})
    };
    textEdits.set(component.key, next);
    return next;
  }

  function setComponentRotation(component, rotationDeg) {
    if (!component) return;
    const normalized = ((Number(rotationDeg) || 0) % 360 + 360) % 360;
    const selected = getSelectedComponent();
    if (component.type === 'text') {
      const baseSegment = cloneState(component.segment || {});
      const edit = ensureTextEditEntry(component, baseSegment);
      if (!edit?.segment) return;
      edit.segment = { ...edit.segment, rotation: normalized };
      edit.newText = String(edit.newText ?? baseSegment.text ?? '');
      (getTextEdits() || new Map()).set(component.key, edit);
      if (selected?.type === 'text' && selected.key === component.key) {
        setSelectedComponent({ ...selected, segment: cloneState(edit.segment) });
      }
      return;
    }
    const object = resolveComponentObject(component);
    if (!object) return;
    object.rotation = normalized;
    if (selected?.type === component.type && selected.key === component.key) {
      setSelectedComponent({ ...selected, object: cloneState(object) });
    }
  }

  function updateComponentFromDelta(
    deltaX,
    deltaY,
    deltaScale = 1,
    baseComponent = getSelectedComponent(),
    { deferRender = false } = {}
  ) {
    if (!baseComponent) return;
    const selected = getSelectedComponent();
    if (baseComponent.type === 'text') {
      const baseSegment = cloneState(baseComponent.segment || selected?.segment || {});
      const edit = ensureTextEditEntry(baseComponent, baseSegment);
      if (!edit?.segment) return;
      const baseBox = baseSegment.box || baseSegment.sourceBox || {};
      const sourceBox = edit.baseSegment?.sourceBox
        || edit.baseSegment?.box
        || baseSegment.sourceBox
        || baseSegment.box;
      const scale = Math.max(0.5, Number(deltaScale) || 1);
      edit.segment = {
        ...baseSegment,
        baselineX: (Number(baseSegment.baselineX) || 0) + deltaX,
        baselineY: (Number(baseSegment.baselineY) || 0) + deltaY,
        fontSize: Math.max(1, (Number(baseSegment.fontSize) || 10) * scale),
        visualTextWidth: baseSegment.visualTextWidth ? baseSegment.visualTextWidth * scale : undefined,
        visualTextHeight: baseSegment.visualTextHeight ? baseSegment.visualTextHeight * scale : undefined,
        box: {
          x: (Number(baseBox.x) || 0) + deltaX,
          y: (Number(baseBox.y) || 0) + deltaY,
          width: Math.max(1, (Number(baseBox.width) || 1) * scale),
          height: Math.max(1, (Number(baseBox.height) || 1) * scale)
        },
        sourceBox: sourceBox ? cloneState(sourceBox) : undefined
      };
      if (!edit.baseSegment) edit.baseSegment = cloneState(baseSegment);
      edit.newText = String(edit.newText ?? baseSegment.text ?? '');
      (getTextEdits() || new Map()).set(baseComponent.key, edit);
      if (selected?.type === 'text' && selected.key === baseComponent.key) {
        setSelectedComponent({ ...selected, segment: cloneState(edit.segment) });
      }
    } else if (baseComponent.type === 'inserted-text') {
      const object = (getInsertedTexts() || []).find(item => item.id === baseComponent.key);
      if (!object) return;
      const baseObject = cloneState(baseComponent.object || object);
      object.x = (Number(baseObject.x) || 0) + deltaX;
      object.y = (Number(baseObject.y) || 0) + deltaY;
      object.fontSize = Math.max(6, (Number(baseObject.fontSize) || 16) * deltaScale);
      if (baseObject.visualTextWidth) object.visualTextWidth = baseObject.visualTextWidth * deltaScale;
      if (baseObject.visualTextHeight) object.visualTextHeight = baseObject.visualTextHeight * deltaScale;
      if (selected?.type === 'inserted-text' && selected.key === baseComponent.key) {
        setSelectedComponent({ ...selected, object: cloneState(object) });
      }
    } else if (baseComponent.type === 'inserted-image') {
      const object = (getInsertedImages() || []).find(item => item.id === baseComponent.key);
      if (!object) return;
      const baseObject = cloneState(baseComponent.object || object);
      object.x = (Number(baseObject.x) || 0) + deltaX;
      object.y = (Number(baseObject.y) || 0) + deltaY;
      object.width = Math.max(12, (Number(baseObject.width) || 1) * deltaScale);
      object.height = Math.max(12, (Number(baseObject.height) || 1) * deltaScale);
      if (selected?.type === 'inserted-image' && selected.key === baseComponent.key) {
        setSelectedComponent({ ...selected, object: cloneState(object) });
      }
    } else if (baseComponent.type === 'inserted-shape') {
      const object = (getInsertedShapes() || []).find(item => item.id === baseComponent.key);
      if (!object) return;
      const baseObject = cloneState(baseComponent.object || object);
      object.x = (Number(baseObject.x) || 0) + deltaX;
      object.y = (Number(baseObject.y) || 0) + deltaY;
      object.width = Math.max(6, (Number(baseObject.width) || 1) * deltaScale);
      object.height = Math.max(6, (Number(baseObject.height) || 1) * deltaScale);
      if (selected?.type === 'inserted-shape' && selected.key === baseComponent.key) {
        setSelectedComponent({ ...selected, object: cloneState(object) });
      }
    }
    onChanged({ deferRender, component: baseComponent });
  }

  function componentBox(component, object) {
    if (component?.type === 'text') {
      const segment = object || (getTextEdits() || new Map()).get(component.key)?.segment || component.segment;
      const edit = (getTextEdits() || new Map()).get(component.key);
      if (edit) return editedTextVisualBox({ ...edit, segment }, segment);
      const sourceBox = segment?.box || segment?.sourceBox;
      if (!sourceBox) return null;
      return {
        x: Number(sourceBox.x) || 0,
        y: Number(sourceBox.y) || 0,
        width: Math.max(1, Number(sourceBox.width) || 1),
        height: Math.max(1, Number(sourceBox.height) || 1)
      };
    }
    if (!object) return null;
    if (component.type === 'inserted-text') return insertedTextVisualBox(object);
    return {
      x: Number(object.x) || 0,
      y: Number(object.y) || 0,
      width: Math.max(1, Number(object.width) || 1),
      height: Math.max(1, Number(object.height) || 1)
    };
  }

  function componentSnapBox(component, object) {
    const box = componentBox(component, object);
    if (!box) return null;
    const radians = (Number(object?.rotation) || 0) * Math.PI / 180;
    const width = box.width * Math.abs(Math.cos(radians)) + box.height * Math.abs(Math.sin(radians));
    const height = box.height * Math.abs(Math.cos(radians)) + box.width * Math.abs(Math.sin(radians));
    return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
  }

  function collectSnapTargets(pageId, excludeType, excludeKey) {
    const targets = [];
    const textCache = (getTextLinesCache() || new Map()).get(pageId);
    if (textCache?.lines?.length) {
      for (let lineIndex = 0; lineIndex < textCache.lines.length; lineIndex++) {
        const line = textCache.lines[lineIndex];
        const segments = Array.isArray(line.segments) && line.segments.length
          ? line.segments
          : [{
            text: line.text,
            baselineX: line.baselineX,
            baselineY: line.baselineY,
            fontSize: line.fontSize,
            box: line.box
          }];
        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
          const key = `${pageId}:${lineIndex}:${segmentIndex}`;
          if (excludeType === 'text' && key === excludeKey) continue;
          const edit = (getTextEdits() || new Map()).get(key);
          const box = componentSnapBox({ type: 'text', key }, edit?.segment || segments[segmentIndex]);
          if (box) targets.push(box);
        }
      }
    }
    for (const object of getInsertedTexts() || []) {
      if (object.pageId !== pageId || (excludeType === 'inserted-text' && object.id === excludeKey)) continue;
      const box = componentSnapBox({ type: 'inserted-text' }, object);
      if (box) targets.push(box);
    }
    for (const object of getInsertedImages() || []) {
      if (object.pageId !== pageId || (excludeType === 'inserted-image' && object.id === excludeKey)) continue;
      const box = componentSnapBox({ type: 'inserted-image' }, object);
      if (box) targets.push(box);
    }
    for (const object of getInsertedShapes() || []) {
      if (object.pageId !== pageId || (excludeType === 'inserted-shape' && object.id === excludeKey)) continue;
      const box = componentSnapBox({ type: 'inserted-shape' }, object);
      if (box) targets.push(box);
    }
    return targets;
  }

  function snapAxisDelta(mine, targets, threshold) {
    let best = 0;
    let bestDistance = threshold + 1;
    for (const value of mine) {
      for (const target of targets) {
        const distance = target - value;
        if (Math.abs(distance) <= threshold && Math.abs(distance) < Math.abs(bestDistance)) {
          bestDistance = Math.abs(distance);
          best = distance;
        }
      }
    }
    return best;
  }

  function snapComponentDrag(component, dx, dy, snapTargets = null, options = {}) {
    const object = component.type === 'text'
      ? component.segment
      : (component.object || resolveComponentObject(component));
    const box = componentSnapBox(component, object);
    if (!object || !box) return { dx, dy };
    const pageId = component.pageId || object.pageId;
    const targets = snapTargets || collectSnapTargets(pageId, component.type, component.key);
    const threshold = 5 / Math.max(0.05, Number(options.scale) || 1);
    const left = box.x + dx;
    const centerX = left + box.width / 2;
    const right = left + box.width;
    const top = box.y + dy;
    const centerY = top + box.height / 2;
    const bottom = top + box.height;
    const xTargets = [];
    const yTargets = [];
    for (const target of targets) {
      xTargets.push(target.x, target.x + target.width / 2, target.x + target.width);
      yTargets.push(target.y, target.y + target.height / 2, target.y + target.height);
    }
    if (options.pageBox) {
      const page = options.pageBox;
      xTargets.push(page.x, page.x + page.width / 2, page.x + page.width);
      yTargets.push(page.y, page.y + page.height / 2, page.y + page.height);
    }
    const snap = (values, anchors, previous) => {
      if (options.disabled) return null;
      // Keep a captured anchor until the pointer leaves an 8px release band.
      if (previous && anchors.includes(previous.target)
        && Math.abs(previous.target - values[previous.index]) <= threshold * 1.6) return previous;
      let best = null;
      let distance = threshold;
      values.forEach((value, index) => anchors.forEach(target => {
        if (Math.abs(target - value) <= distance) {
          distance = Math.abs(target - value);
          best = { index, target };
        }
      }));
      return best;
    };
    const xs = [left, centerX, right];
    const ys = [top, centerY, bottom];
    const x = snap(xs, xTargets, options.previous?.x);
    const y = snap(ys, yTargets, options.previous?.y);
    return {
      dx: dx + (x ? x.target - xs[x.index] : 0),
      dy: dy + (y ? y.target - ys[y.index] : 0),
      guides: { x, y }
    };
  }

  function toggleImageAspectRatio() {
    const component = getSelectedComponent();
    if (component?.type !== 'inserted-image') return false;
    const object = resolveComponentObject(component);
    if (!object) return false;
    object.originalAspectRatio ||= object.width / object.height;
    object.aspectRatioLocked = object.aspectRatioLocked === false;
    if (object.aspectRatioLocked) {
      const height = object.width / object.originalAspectRatio;
      object.y += (object.height - height) / 2;
      object.height = height;
    }
    setSelectedComponent({ ...component, object: cloneState(object) });
    onChanged({ component });
    return true;
  }

  return {
    componentCollection,
    componentElementKey,
    componentBox,
    collectSnapTargets,
    editableComponentKey: component => {
      if (!component) return '';
      return component.type === 'text'
        ? `${component.pageId}:${component.lineIndex}:${component.segmentIndex}`
        : `${component.type}:${component.key}`;
    },
    ensureTextEditEntry,
    getComponentRotation,
    resolveComponentObject,
    sameComponent,
    sameTextSegmentLayout,
    setComponentRotation,
    snapAxisDelta,
    snapComponentDrag,
    snapRotationToAxis,
    toggleImageAspectRatio,
    updateComponentFromDelta
  };
}
