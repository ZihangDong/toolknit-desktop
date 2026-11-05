// Exercise the real scroll/RAF rendering path in a browser, not a DOM stub.
export async function checkSearchScroll(list, { loadMore = false } = {}) {
  const checks = [];
  const assert = (ok, message) => { if (!ok) throw Error(message); checks.push(message); };
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))));
  const scroll = async top => { list.scrollTop = top; list.dispatchEvent(new Event('scroll')); await settle(); };
  await scroll(740);
  assert(Math.abs(list.scrollTop - 740) < 2, 'scroll remains below the first page after virtual redraw');
  assert(Number(list.querySelector('[data-fs-row]')?.dataset.fsRow) > 0, 'scroll renders later rows');
  for (let i = 0; i < 12; i++) {
    const target = i % 2 ? 444 : 1036;
    await scroll(target);
    if (Math.abs(list.scrollTop - target) >= 2) throw Error('repeated scrolling jumps or jitters');
  }
  checks.push('repeated upward/downward scroll keeps its position');
  await scroll(list.scrollHeight);
  assert(Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop) < 2, 'last loaded row and footer are reachable');
  assert(list.querySelectorAll('.fs-row').length < 30, 'scrolled results retain bounded DOM');
  if (loadMore) {
    const oldTop = list.scrollTop, oldHeight = list.scrollHeight;
    list.querySelector('[data-fs-more]').click();
    await settle();
    assert(list.scrollHeight > oldHeight, 'loading another page grows the available scroll range');
    assert(Math.abs(list.scrollTop - oldTop) < 2, 'appending a page preserves the current scroll position');
    await scroll(list.scrollHeight);
    assert(Number([...list.querySelectorAll('[data-fs-row]')].at(-1)?.dataset.fsRow) >= 99, 'second page is reachable without snapping to the first');
  }
  list.dispatchEvent(new KeyboardEvent('keydown', { key:'Home', bubbles:true, cancelable:true })); await settle();
  assert(list.scrollTop === 0, 'Home returns to the first result');
  list.dispatchEvent(new KeyboardEvent('keydown', { key:'End', bubbles:true, cancelable:true })); await settle();
  assert(list.scrollTop > 740 && !!list.querySelector('.fs-row.is-selected'), 'End brings the selected last result into view');
  await scroll(0);
  return checks;
}
