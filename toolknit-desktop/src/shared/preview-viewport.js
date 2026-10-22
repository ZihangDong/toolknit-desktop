import { createLifecycleScope } from '../app/tool-lifecycle.js';

const editable = target => target?.closest?.('input,textarea,select,[contenteditable="true"]');

/** Shared wheel/pan input. The feature owns scale, rendering and document lifetime. */
export function createPreviewViewport({
  viewport, content, getScale, setScale, render = null,
  enabled = () => true, min = .1, max = 4, panPrimary = () => false,
  onError = () => {}, renderDelay = 130, bindWheel = true, manageAnchor = true
}) {
  const scope = createLifecycleScope();
  let frame = 0, delta = 0, point = null, timer = 0, revision = 0;
  let anchor = null, dragging = null, move = null, moveFrame = 0;
  let space = false, hovered = false, suppressClick = false;
  const paper = () => typeof content === 'function' ? content() : content;
  const active = () => !scope.disposed && viewport?.isConnected && enabled() && !viewport.closest('[inert]');
  const capture = position => {
    const rect = paper()?.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    if (!rect?.width || !rect.height) return null;
    const x = position?.clientX ?? view.left + view.width / 2;
    const y = position?.clientY ?? view.top + view.height / 2;
    return { x, y, u: (x - rect.left) / rect.width, v: (y - rect.top) / rect.height };
  };
  function restore(value) {
    const rect = paper()?.getBoundingClientRect();
    if (!value || !rect?.width || !rect.height) return;
    viewport.scrollLeft += rect.left + value.u * rect.width - value.x;
    viewport.scrollTop += rect.top + value.v * rect.height - value.y;
  }
  function scheduleRender() {
    clearTimeout(timer);
    const request = ++revision;
    if (!render) return;
    timer = setTimeout(async () => {
      timer = 0;
      if (!active() || request !== revision) return;
      try {
        await render();
        if (active() && request === revision) restore(anchor);
      } catch (error) { if (active() && request === revision) onError(error); }
    }, renderDelay);
  }
  function zoomTo(value, position = null) {
    if (!active()) return;
    const next = Math.max(min, Math.min(max, value));
    if (!Number.isFinite(next) || Math.abs(next - getScale()) < .00001) return;
    anchor = manageAnchor ? capture(position) : null;
    setScale(next, position);
    if (manageAnchor) restore(anchor);
    scheduleRender();
  }
  function wheel(event) {
    if (!active() || editable(event.target)) return;
    const value = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    if (!Number.isFinite(value) || !value) return;
    // Consume the gesture at either limit as well; never fall through to page scrolling.
    event.preventDefault();
    delta = Math.max(-2400, Math.min(2400, delta + value));
    point = { clientX: event.clientX, clientY: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const change = delta; delta = 0;
      zoomTo(getScale() * Math.exp(Math.max(-.35, Math.min(.35, -change * .0015))), point);
    });
  }
  function endPan(event) {
    if (event?.type === 'pointerup' && dragging && move) {
      viewport.scrollLeft = dragging.left + dragging.x - move.x;
      viewport.scrollTop = dragging.top + dragging.y - move.y;
    }
    if (moveFrame) cancelAnimationFrame(moveFrame);
    moveFrame = 0; move = null;
    const pointer = dragging?.id; dragging = null;
    viewport?.classList.remove('is-preview-panning');
    try { if (pointer != null) viewport.releasePointerCapture(pointer); } catch {}
  }
  function reset() {
    revision++; clearTimeout(timer); timer = 0;
    if (frame) cancelAnimationFrame(frame);
    frame = 0; delta = 0; point = null; anchor = null; space = false; suppressClick = false;
    endPan();
  }
  if (viewport) {
    viewport.classList.add('tk-preview-viewport');
    if (bindWheel) scope.event(viewport, 'wheel', wheel, { passive: false });
    scope.event(viewport, 'pointerenter', () => { hovered = true; });
    scope.event(viewport, 'pointerleave', () => { hovered = false; });
    scope.event(document, 'keydown', event => {
      if (event.code !== 'Space' || editable(event.target) || !active()) return;
      space = true;
      if (hovered || viewport.contains(event.target)) event.preventDefault();
    });
    scope.event(document, 'keyup', event => { if (event.code === 'Space') space = false; });
    scope.event(window, 'blur', reset);
    scope.event(viewport, 'pointerdown', event => {
      suppressClick = false;
      if (!active() || editable(event.target) || !(event.button === 1 || event.button === 0 && (space || panPrimary()))) return;
      event.preventDefault(); event.stopImmediatePropagation();
      dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
      viewport.classList.add('is-preview-panning');
      try { viewport.setPointerCapture(event.pointerId); } catch {}
    }, { capture: true });
    scope.event(viewport, 'pointermove', event => {
      if (!dragging || event.pointerId !== dragging.id) return;
      event.preventDefault(); event.stopImmediatePropagation();
      move = { x: event.clientX, y: event.clientY };
      if (Math.hypot(move.x - dragging.x, move.y - dragging.y) > 3) suppressClick = true;
      if (moveFrame) return;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0;
        if (!dragging || !move) return;
        viewport.scrollLeft = dragging.left + dragging.x - move.x;
        viewport.scrollTop = dragging.top + dragging.y - move.y;
      });
    }, { capture: true, passive: false });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) scope.event(viewport, event, endPan);
    scope.event(viewport, 'click', event => {
      if (!suppressClick) return;
      suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true });
    scope.use(reset);
  }
  return { zoomTo, wheel, reset, dispose: () => scope.dispose() };
}
