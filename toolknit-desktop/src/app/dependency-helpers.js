export function formatDependencyBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1) return '--';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

export function isManagedRuntime(status) {
  return status?.source === 'managed';
}

export function normalizeLibreOfficeAvailability(value) {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object') {
    if (typeof value.available === 'boolean') return value.available;
    if (typeof value.installed === 'boolean') return value.installed;
  }
  return Boolean(value);
}

export function dependencyProgressPercent(progress) {
  if (!progress) return 0;
  if (['installing', 'verifying', 'complete'].includes(progress.phase)) return 100;
  return Math.max(0, Math.min(100, Math.round(
    (Number(progress.downloaded_bytes) || 0) / Math.max(1, Number(progress.total_bytes) || 0) * 100
  )));
}

const dependencyFields = Object.freeze({
  ffmpeg: ['needsFfmpeg', 'ffmpegProgress', 'ffmpegComplete'],
  model: ['needsModel', 'modelProgress', 'modelComplete'],
  libreoffice: ['needsLibreOffice', 'libreOfficeProgress', 'libreOfficeComplete']
});

export function updateDependencyProgress(state, type, progress) {
  const fields = dependencyFields[type];
  if (!fields || !state?.downloading || !state[fields[0]]) return false;
  state[fields[1]] = progress || null;
  state[fields[2]] = progress?.phase === 'complete';
  return true;
}

export function overallDependencyProgress(state) {
  const fields = Object.values(dependencyFields).filter(([needed]) => state?.[needed]);
  return fields.length ? Math.round(fields.reduce((sum, [, progress, complete]) =>
    sum + (state[complete] ? 100 : dependencyProgressPercent(state[progress])), 0) / fields.length) : 100;
}

export function createDependencyHelpers({ translate = key => key, getLanguage = () => 'zh', displayPath = value => value } = {}) {
  const dependencyErrorMessage = error => {
    const message = String(error?.message || error || '');
    const download = /dependency-download:(timeout|network|range|size|http|storage|verify|cancelled)\b/.exec(message);
    if (download) {
      const key = { timeout: 'downloadTimeout', network: 'downloadNetwork', http: 'downloadNetwork',
        range: 'downloadIntegrity', size: 'downloadIntegrity', verify: 'downloadIntegrity',
        storage: 'downloadStorage', cancelled: 'downloadCancelled' }[download[1]];
      return translate(`home.dependencies.${key}`);
    }
    const match = /^libreoffice-runtime:([a-z-]+)(?::([A-Za-z0-9_.=-]+))?$/.exec(message);
    if (!match) return message;
    const key = {
      'missing-library': 'officeMissingLibrary',
      'incompatible-system': 'officeIncompatibleSystem',
      'invalid-architecture': 'officeInvalidArchitecture',
      'timeout': 'officeTimeout',
      'runtime-files': 'officeRuntimeFiles',
      'extract': 'officeExtract',
      'extract-stalled': 'officeExtractStalled',
      'extract-timeout': 'officeExtractTimeout',
      'installer-busy': 'officeInstallerBusy',
      'installer-policy': 'officeInstallerPolicy',
      'publish': 'officePublish'
    }[match[1]] || 'officeStartup';
    return `${translate(`home.dependencies.${key}`)} (${match[1]}${match[2] ? `: ${match[2]}` : ''})`;
  };
  const detectedRuntimeLabel = status => {
    if (!status?.installed) return '';
    if (status.source === 'bundled') return getLanguage() === 'en' ? 'Included with the app' : '随应用内置';
    if (!isManagedRuntime(status)) return getLanguage() === 'en' ? 'Detected system dependency' : '已检测到系统依赖';
    const size = formatDependencyBytes(status.bytes);
    return size === '--'
      ? (getLanguage() === 'en' ? 'Installed' : '已安装')
      : (getLanguage() === 'en' ? `Installed (${size})` : `已安装 (${size})`);
  };
  const runtimeMetadata = status => status?.installed
    ? [status.version, displayPath(status.path)].filter(Boolean).join(' · ')
    : '';
  const dependencyStatusText = (type, progress, complete, failed = false) => {
    if (failed) return translate('home.dependencies.failedStatus');
    if (complete || progress?.phase === 'complete') return translate('home.dependencies.ready');
    if (!progress) return translate('home.dependencies.waiting');
    if (progress.phase === 'installing') return translate('home.dependencies.installing');
    if (progress.phase === 'verifying') return translate('home.dependencies.verifying');
    return `${translate('home.dependencies.downloading')} ${dependencyProgressPercent(progress)}%`;
  };
  const dependencyInstallingDetail = (name, progress) => {
    const extraction = progress?.extraction;
    if (!extraction || !Number.isFinite(extraction.elapsed_seconds)) return translate('home.dependencies.installingDetail', { name });
    const seconds = Math.max(0, Math.floor(extraction.elapsed_seconds));
    const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const files = Math.max(0, Math.floor(Number(extraction.extracted_files) || 0));
    return files > 0
      ? translate('home.dependencies.officeExtractingDetail', { files, size: formatDependencyBytes(extraction.extracted_bytes), elapsed })
      : translate('home.dependencies.officePreparingDetail', { elapsed });
  };
  return Object.freeze({ detectedRuntimeLabel, dependencyStatusText, dependencyErrorMessage, dependencyInstallingDetail, runtimeMetadata });
}
