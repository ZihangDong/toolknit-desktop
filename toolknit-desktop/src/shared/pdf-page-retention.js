/** Bound decoded-page reuse while keeping in-flight preview/thumbnail users alive. */
export function createPdfPageRetention(limit = 6) {
  const pages = new Map();
  function trim() {
    for (const [page, entry] of pages) {
      if (pages.size <= limit) break;
      if (entry.users) continue;
      pages.delete(page);
      try { page.cleanup(); } catch {}
    }
  }
  return {
    retain(page) {
      const entry = pages.get(page) || { users: 0 };
      entry.users++;
      pages.delete(page); pages.set(page, entry);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (pages.get(page) === entry) entry.users--;
        trim();
      };
    },
    clear() {
      for (const page of pages.keys()) { try { page.cleanup(); } catch {} }
      pages.clear();
    }
  };
}
