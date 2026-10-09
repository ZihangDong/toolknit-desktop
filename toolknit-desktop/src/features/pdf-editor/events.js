import { loadTauriWebview } from '../../platform/tauri-runtime.js';

/**
 * Binds the PDF Editor's DOM and native drag/drop events. The callbacks are
 * injected so this module owns listener wiring without owning editor state.
 */
export function createPdfEditorEvents({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  listenerOptions = {},
  isTauri = false,
  overlay,
  dropZone,
  fileInput,
  appendInput,
  imageInput,
  back,
  cta,
  appendBtn,
  replaceBtn,
  editTextBtn,
  editTextSidebarBtn,
  insertTextBtn,
  insertImageBtn,
  insertRectBtn,
  insertEllipseBtn,
  insertLineBtn,
  selectComponentBtn,
  componentScaleDownBtn,
  componentScaleUpBtn,
  componentEditBtn,
  componentRotateBtn,
  componentDeleteBtn,
  shapeFillInput,
  shapeStrokeInput,
  shapeStrokeWidth,
  resetBtn,
  undoBtn,
  redoBtn,
  editModalSave,
  editModalCancel,
  editModalClose,
  editModalInput,
  rotateCcwBtn,
  rotateCwBtn,
  moveUpBtn,
  moveDownBtn,
  duplicateBtn,
  blankPageBtn,
  selectAllBtn,
  invertSelectionBtn,
  deleteBtn,
  extractBtn,
  exportBtn,
  processCancel,
  successOk,
  successOpenFolder,
  zoomOutBtn,
  zoomInBtn,
  fitWidthBtn,
  zoomValueBtn,
  canvasScroll,
  zoom,
  exporter,
  getLastOutputFolder = () => '',
  getLastSuccess = () => null,
  getInvoke = async () => async () => {},
  t = key => key,
  getEditMode = () => false,
  getComponentMode = () => false,
  getSelectedComponent = () => null,
  getCurrentOperation = () => null,
  isDisposed = () => false,
  hexToRgb01 = () => [0, 0, 0],
  updateSelectedShapeProperty = () => {},
  commitEditorHistory = () => {},
  setEditMode = () => {},
  chooseMainFile = () => {},
  chooseAppendFile = () => {},
  openInsertTextModal = () => {},
  chooseInsertImage = async () => {},
  insertShape = () => {},
  setComponentMode = () => {},
  scaleSelectedComponent = () => {},
  editSelectedComponent = () => {},
  beginComponentRotate = () => {},
  deleteSelected = () => {},
  resetEditorState = () => {},
  undoEditorChange = () => {},
  redoEditorChange = () => {},
  saveEditModal = () => {},
  handleEditModalCancel = () => {},
  rotateSelected = () => {},
  moveCurrent = () => {},
  duplicateSelectedPages = () => {},
  insertBlankPage = async () => {},
  selectAllPages = () => {},
  invertPageSelection = () => {},
  targetIds = () => [],
  cancelActiveOperation = async () => {},
  closeOverlay = () => {},
  closeSuccess = () => {},
  loadMainFile = async () => {},
  appendPdfBytes = async () => {},
  prepareInsertImage = async () => {},
  cancelInsertMode = () => {},
  showDropZone = () => {},
  hideDropZone = () => {},
  openOverlay = () => {},
  positionComponentMenu = () => {},
  showToast = () => {}
} = {}) {
  const add = (element, event, handler, options = listenerOptions) => {
    element?.addEventListener?.(event, handler, options);
  };

  add(back, 'click', closeOverlay);
  add(cta, 'click', chooseMainFile);
  add(appendBtn, 'click', chooseAppendFile);
  add(replaceBtn, 'click', chooseMainFile);
  add(editTextBtn, 'click', () => setEditMode(!getEditMode()));
  add(editTextSidebarBtn, 'click', () => setEditMode(!getEditMode()));
  add(insertTextBtn, 'click', openInsertTextModal);
  add(insertImageBtn, 'click', () => { void chooseInsertImage(); });
  add(insertRectBtn, 'click', () => insertShape('rect'));
  add(insertEllipseBtn, 'click', () => insertShape('ellipse'));
  add(insertLineBtn, 'click', () => insertShape('line'));
  add(selectComponentBtn, 'click', () => setComponentMode(!getComponentMode()));
  add(componentScaleDownBtn, 'click', () => scaleSelectedComponent(0.9));
  add(componentScaleUpBtn, 'click', () => scaleSelectedComponent(1.1));
  add(componentEditBtn, 'click', editSelectedComponent);
  add(componentRotateBtn, 'pointerdown', beginComponentRotate);
  add(componentDeleteBtn, 'click', deleteSelected);
  add(shapeFillInput, 'input', event => updateSelectedShapeProperty('fill', hexToRgb01(event.target.value)));
  add(shapeStrokeInput, 'input', event => updateSelectedShapeProperty('stroke', hexToRgb01(event.target.value)));
  add(shapeStrokeWidth, 'input', event => updateSelectedShapeProperty('strokeWidth', Number(event.target.value) || 0));
  add(shapeFillInput, 'change', commitEditorHistory);
  add(shapeStrokeInput, 'change', commitEditorHistory);
  add(shapeStrokeWidth, 'change', commitEditorHistory);
  add(resetBtn, 'click', resetEditorState);
  add(undoBtn, 'click', undoEditorChange);
  add(redoBtn, 'click', redoEditorChange);
  add(editModalSave, 'click', saveEditModal);
  add(editModalCancel, 'click', handleEditModalCancel);
  add(editModalClose, 'click', handleEditModalCancel);
  add(editModalInput, 'keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveEditModal();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleEditModalCancel();
    }
  });
  add(rotateCcwBtn, 'click', () => rotateSelected(-90));
  add(rotateCwBtn, 'click', () => rotateSelected(90));
  add(moveUpBtn, 'click', () => moveCurrent(-1));
  add(moveDownBtn, 'click', () => moveCurrent(1));
  add(duplicateBtn, 'click', duplicateSelectedPages);
  add(blankPageBtn, 'click', () => { void insertBlankPage(); });
  add(selectAllBtn, 'click', selectAllPages);
  add(invertSelectionBtn, 'click', invertPageSelection);
  add(deleteBtn, 'click', deleteSelected);
  add(extractBtn, 'click', () => { void exporter.extractSelected(targetIds()); });
  add(exportBtn, 'click', () => { void exporter.exportPdf(); });
  add(processCancel, 'click', () => { void cancelActiveOperation(); });
  add(successOk, 'click', () => closeSuccess());
  add(successOpenFolder, 'click', async () => {
    const outputTarget = getLastSuccess()?.outputPath || getLastOutputFolder();
    if (!isTauri || !outputTarget) return;
    try {
      const invoke = await getInvoke();
      await invoke('open_path', { path: outputTarget });
    } catch (_) {
      showToast(t('home.pdfEditor.openFolderFailed'));
    }
  });

  zoom?.bindButton?.(zoomOutBtn, 1 / 1.25);
  zoom?.bindButton?.(zoomInBtn, 1.25);
  add(fitWidthBtn, 'click', () => zoom?.setZoom?.('fit', zoom.getState().zoomPercent));
  add(zoomValueBtn, 'click', () => zoom?.setZoom?.('fit', zoom.getState().zoomPercent));
  add(canvasScroll, 'wheel', zoom?.handleWheel, { ...listenerOptions, passive: false });
  add(canvasScroll, 'scroll', () => {
    if (getSelectedComponent()) requestAnimationFrame(positionComponentMenu);
  });

  add(fileInput, 'change', () => {
    const files = Array.from(fileInput.files || []);
    if (files.length > 1) {
      showToast(t('home.pdfEditor.singlePdfOnly'));
      return;
    }
    void loadMainFile(files[0]);
  });
  add(appendInput, 'change', () => {
    const files = Array.from(appendInput.files || []);
    if (files.length > 1) {
      showToast(t('home.pdfEditor.singlePdfOnly'));
      return;
    }
    const file = files[0];
    if (!file) return;
    void file.arrayBuffer().then(buffer => appendPdfBytes(new Uint8Array(buffer), file.name, file.size));
  });
  add(imageInput, 'change', () => {
    const file = Array.from(imageInput.files || [])[0];
    void prepareInsertImage(file);
  });
  add(imageInput, 'cancel', cancelInsertMode);

  add(overlay, 'dragover', event => {
    if (!overlay.classList.contains('visible') || isTauri) return;
    event.preventDefault();
    showDropZone();
  });
  add(overlay, 'dragleave', event => {
    if (event.relatedTarget && overlay.contains(event.relatedTarget)) return;
    hideDropZone();
  });
  add(overlay, 'drop', event => {
    if (isTauri) return;
    event.preventDefault();
    hideDropZone();
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length !== 1) {
      showToast(t('home.pdfEditor.singlePdfOnly'));
      return;
    }
    void loadMainFile(files[0]);
  });

  let nativeDragUnlisten = null;
  if (isTauri) {
    void (async () => {
      try {
        const { getCurrentWebview } = await loadTauriWebview();
        const unlisten = await getCurrentWebview().onDragDropEvent(event => {
          if (isDisposed() || !overlay.classList.contains('visible') || getCurrentOperation()) return;
          const payload = event.payload || {};
          if (payload.type === 'enter' || payload.type === 'over') {
            showDropZone();
          } else if (payload.type === 'leave') {
            hideDropZone();
          } else if (payload.type === 'drop') {
            hideDropZone();
            const paths = Array.from(payload.paths || []);
            if (paths.length !== 1) {
              showToast(t('home.pdfEditor.singlePdfOnly'));
              return;
            }
            const path = paths[0];
            void loadMainFile({ name: path.split(/[\\/]/).pop() || path, path, size: 0 });
          }
        });
        if (isDisposed()) {
          try { unlisten(); } catch (_) {}
          return;
        }
        nativeDragUnlisten = unlisten;
      } catch (error) {
        if (!isDisposed()) console.error('[PDF Editor] Native drag-drop setup failed:', error);
      }
    })();
  }

  documentRef?.querySelectorAll?.('.audio-list-item[data-tool="pdf-editor"]').forEach(item => {
    add(item, 'click', openOverlay);
    add(item, 'keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openOverlay();
    });
  });

  return {
    dispose() {
      try { nativeDragUnlisten?.(); } catch (_) {}
      nativeDragUnlisten = null;
    }
  };
}
