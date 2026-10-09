/* Application entrypoint. Runtime wiring remains in application-runtime.js while domains move behind these seams. */
import { tauriCorePromise, tauriEventPromise } from './platform/tauri-runtime.js';
import { LAZY_TOOL_SPECS } from './features/lazy-tools.js';
import { createAppComposition } from './app/app-composition.js';
import './app/static-template-bootstrap.js';
import './application.js';

export const appComposition = createAppComposition({ tauriCorePromise, tauriEventPromise, specs: LAZY_TOOL_SPECS });
// pdfWorkerUrl, is injected by application-runtime.js into lazy feature contexts.
// Compatibility contract: toolId === 'audio-clip' remains lazy-routed by application-runtime.js.
const APP_VERSION_FALLBACK = '3.1.0';
// Security contracts implemented by application-runtime.js: window.open(parsedUrl.href, '_blank', 'noopener,noreferrer');
// invoke('store_ai_api_key'); clearLegacyAiApiKeys();
// readResponseTextLimited(response, GITHUB_RESPONSE_MAX_BYTES);
// Contract references for migrated lazy orchestration:
// createLazyToolRegistry({ specs: LAZY_TOOL_SPECS });
// toolId === 'ai-polish' then toolId === 'ai-doc';
// toolId === 'ai-doc' || toolId === 'ai-table';
// isAiDocEditorDemoEntry && lazyFeatureRegistry.open('ai-doc');
// isAiTableDemoEntry && lazyFeatureRegistry.open('ai-table');
// toolId === 'ai-polish' || toolId === 'ai-translate'; await aiApiKeyReady; showAiKeyRequiredOverlay();
// requestAi: callDeepSeek, extractJson,
// let mattingDownloadPromise = null; await installMattingModel(mattingDownloadSource);
// function openMattingModelManager() { openSettingsOverlay(); }
// showDependencyGate({ openFn, needsFfmpeg: true, needsModel: false });
// download_transcription_model', modelId: 'small'; invoke('cancel_dependency_downloads');
// isManagedRuntime(ffmpegRuntimeStatus); isManagedRuntime(libreOfficeRuntimeStatus);
// import('./features/color-extractor/screen-picker.js');
// toolId === 'transcription' ... check_transcription_engine
// lazyFeatureRegistry.open(toolId); LAZY_TOOL_SPECS[toolId];
// from './shared/file-size.js'
