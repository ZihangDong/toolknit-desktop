export const OUTPUT_ROOT_KEY = 'toolknit.output-root.v1';

function joinOutputSubFolder(root, child) {
  const base = String(root || '').trim();
  const separator = base.includes('\\') ? '\\' : '/';
  const normalizedChild = String(child || '')
    .replace(/[\\/]+/g, separator)
    .replace(separator === '\\' ? /^\\+|\\+$/g : /^\/+|\/+$/g, '');
  const normalizedRoot = base.replace(/[\/]+$/, '');
  return normalizedChild ? normalizedRoot + separator + normalizedChild : normalizedRoot;
}

export function displayFilesystemPath(path) {
  const value = String(path || '').trim();
  if (!value) return '';
  const cleaned = value
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/i, '')
    .replace(/^\/\/\?\/UNC\//i, '//')
    .replace(/^\/\/\?\//i, '');
  const windowsPath = /^[a-z]:[\\/]/i.test(cleaned) || /^\\\\/.test(cleaned) || /^\/\//.test(cleaned);
  return windowsPath ? cleaned.replace(/\//g, '\\') : cleaned;
}

function outputParentFolder(outputPath) {
  const value = String(outputPath || '').trim();
  if (!value) return '';
  const normalized = value.replace(/[\\/]+$/, '');
  const parent = normalized.replace(/[/\\][^/\\]+$/, '');
  return parent && parent !== normalized ? parent : normalized;
}

/** Shared output-root persistence and safe output reveal/open behavior. */
export function createOutputRuntime({
  isTauri = false,
  tauriCorePromise,
  storage = globalThis.localStorage,
  windowRef = globalThis.window,
  notify = () => {},
  translate = key => key
} = {}) {
  const configuredRoot = () => {
    try { return storage?.getItem(OUTPUT_ROOT_KEY)?.trim() || ''; } catch { return ''; }
  };

  const syncConfiguredRoot = async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await tauriCorePromise;
      const browserRoot = configuredRoot();
      let nativeRoot = await invoke('get_output_root');
      if (!nativeRoot && browserRoot) {
        await invoke('set_output_root', { outputDir: browserRoot });
        nativeRoot = browserRoot;
      }
      if (nativeRoot) storage?.setItem(OUTPUT_ROOT_KEY, nativeRoot);
      else storage?.removeItem(OUTPUT_ROOT_KEY);
    } catch (error) { console.error('Failed to sync output folder:', error); }
  };

  const getOutputDir = async subFolder => {
    let root = configuredRoot();
    if (isTauri) {
      try {
        const { invoke } = await tauriCorePromise;
        const nativeRoot = await invoke('get_output_root');
        root = typeof nativeRoot === 'string' ? nativeRoot.trim() : '';
        if (root) storage?.setItem(OUTPUT_ROOT_KEY, root);
        else storage?.removeItem(OUTPUT_ROOT_KEY);
      } catch (error) { console.error('Failed to read output folder:', error); }
    }
    if (root) return joinOutputSubFolder(root, subFolder);
    if (!isTauri) return `~/Downloads/ToolKnit/${subFolder}`;
    try {
      const { invoke } = await tauriCorePromise;
      return joinOutputSubFolder(await invoke('get_default_output_root'), subFolder);
    } catch (error) {
      console.error('Failed to get default output folder:', error);
      return `C:\\Users\\Downloads\\ToolKnit\\${subFolder}`;
    }
  };

  const openFolder = async outputPath => {
    if (!isTauri || !outputPath) return false;
    const targetPath = String(outputPath).trim();
    if (!targetPath) return false;
    try {
      const { invoke } = await tauriCorePromise;
      await invoke('open_path', { path: targetPath });
      return true;
    } catch (error) {
      console.error('Open output folder failed:', error);
      notify(translate('common.openFolderFailed'));
      return false;
    }
  };

  return Object.freeze({
    configuredRoot,
    displayFilesystemPath,
    displayOutputParentFolder: path => displayFilesystemPath(outputParentFolder(path)),
    getOutputDir,
    openFolder,
    outputParentFolder,
    syncConfiguredRoot
  });
}
