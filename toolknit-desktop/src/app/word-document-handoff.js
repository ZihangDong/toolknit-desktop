/** A detached structured document has exactly one owner across tool navigation. */
export async function openWordDocumentSession(session, openLazyTool, loadEditor=()=>import('../features/pdf-to-word/document-editor.js')) {
  try {
    const { createWordDocumentEditor } = await loadEditor();
    if (session.canTransfer && !session.canTransfer()) { session.release(); return; }
    const instance = await openLazyTool('pdf-editor');
    const editor = instance?.raw || instance;
    if (typeof editor?.openDocumentSession !== 'function') throw new Error('document-editor-unavailable');
    if(await editor.openDocumentSession(session, createWordDocumentEditor)===false)throw new Error('document-editor-unavailable');
  } catch (error) { if (!session.restore?.()) session.release(); throw error; }
}
