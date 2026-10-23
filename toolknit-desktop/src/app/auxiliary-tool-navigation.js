export function createAuxiliaryToolNavigation({ getActivePage, closePages, openTool }) {
  let pending;
  return toolId => {
    if (pending) return pending;
    pending = (async () => {
      // Closing a settings child can reveal its parent; unwind each owner in order.
      for (let count = 0; count < 8; count++) {
        const page = getActivePage();
        const close = closePages[page?.id];
        if (!close) break;
        await close();
      }
      await openTool(toolId);
    })().finally(() => { pending = null; });
    return pending;
  };
}
