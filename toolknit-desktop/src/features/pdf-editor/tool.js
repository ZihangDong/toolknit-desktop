import { createIcons, icons } from 'lucide';
import { initPdfEditorTool as createPdfEditorTool } from './controller.js';

// The editor markup is mounted lazily, after the application's initial Lucide
// scan. Refresh the mounted subtree immediately so its static chrome is never
// dependent on another feature having rendered icons first.
const refreshIcons = () => createIcons({ icons, attrs: { 'aria-hidden': 'true' } });

export function initPdfEditorTool(context = {}) {
  refreshIcons();
  const native = createPdfEditorTool({ ...context, refreshIcons });
  let structured = null, revision = 0;
  return { ...native,
    async open(...args) { revision++; if (structured && await structured.close() === false) return false; return native.open(...args); },
    async close() { revision++; if (structured && await structured.close() === false) return false; return native.close(); },
    async openWithFile(file) { revision++; if (structured && await structured.close() === false) return false; return native.openWithFile(file); },
    async openDocumentSession(session, createEditor) {
      const epoch = ++revision;
      if(await native.close()===false)return false;
      if(structured&&await structured.close()===false)return false;
      if (epoch !== revision) return false;
      structured ||= createEditor({ ...context, refreshIcons });
      structured.open(session);
      return true;
    },
    dispose() { revision++; structured?.dispose(); structured = null; native.dispose(); }
  };
}
