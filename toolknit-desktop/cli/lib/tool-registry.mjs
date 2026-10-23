import { PDF_TOOL_HANDLERS } from './pdf-runtime.mjs';
import { convertPdfToImages } from './pdf-to-image-runtime.mjs';
import { convertAudioBatch } from './audio-runtime.mjs';
import { detectAudioBpm } from './bpm-runtime.mjs';
import { clipAudio } from './audio-clip-runtime.mjs';
import { extractAudio } from './audio-extract-runtime.mjs';
import { installTranscriptionModel, listTranscriptionModels, setCurrentTranscriptionModel, transcribeMedia } from './transcription-runtime.mjs';
import { convertVideoBatch } from './video-runtime.mjs';
import { extractVideoFrame } from './video-frame-runtime.mjs';
import { extractVideoGif } from './video-gif-runtime.mjs';
import { analyzeTextFile } from './text-stats-runtime.mjs';
import { extractColorPalette } from './color-extract-runtime.mjs';
import { stitchImages } from './image-stitch-runtime.mjs';
import { extractPptImages } from './ppt-image-extract-runtime.mjs';
import { extractPptText } from './ppt-text-extract-runtime.mjs';
import { compressPpt } from './ppt-compress-runtime.mjs';
import { convertPptToPdf } from './ppt-to-pdf-runtime.mjs';
import { convertPptToImages } from './ppt-to-image-runtime.mjs';
import { generatePptOutline } from './ppt-outline-runtime.mjs';
import { generatePptDraft } from './ppt-draft-runtime.mjs';
import {
  inspectCpuMemoryInfo,
  inspectCpuMemoryLiveStats,
  inspectGpuDisplayInfo,
  inspectHardwareOverview,
  inspectMainboardFirmwareInfo,
  inspectNetworkDevicesInfo,
  inspectPowerSensorsInfo,
  inspectStorageHealthInfo
} from './hardware-runtime.mjs';
import { generateAiDocument } from './ai-document-runtime.mjs';
import {
  editAiDocumentProject,
  inspectAiDocumentProject,
  renderAiDocumentProject
} from './ai-document-project-runtime.mjs';
import {
  editAiTableProject,
  generateAiTableProject,
  inspectAiTableProjectFile,
  renderAiTableProject
} from './ai-table-project-runtime.mjs';
import { ToolKnitError, throwIfAborted } from './errors.mjs';
import { validateToolArguments } from './schema-validation.mjs';
import { EXTENDED_HANDLERS } from './extended-tools.mjs';

import { TOOL_DEFINITIONS } from './tool-definitions.mjs';
export { TOOL_DEFINITIONS } from './tool-definitions.mjs';

const TOOL_BY_NAME = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, tool]));
const TOOL_HANDLERS = Object.freeze({
  ...EXTENDED_HANDLERS,
  ...PDF_TOOL_HANDLERS,
  toolknit_pdf_to_image: convertPdfToImages,
  toolknit_audio_convert: convertAudioBatch,
  toolknit_audio_bpm: detectAudioBpm,
  toolknit_audio_clip: clipAudio,
  toolknit_audio_extract: extractAudio,
  toolknit_model_list: listTranscriptionModels,
  toolknit_model_install: installTranscriptionModel,
  toolknit_model_use: setCurrentTranscriptionModel,
  toolknit_transcribe: transcribeMedia,
  toolknit_video_convert: convertVideoBatch,
  toolknit_video_frame: extractVideoFrame,
  toolknit_video_gif: extractVideoGif,
  toolknit_text_stats: analyzeTextFile,
  toolknit_color_extract: extractColorPalette,
  toolknit_image_stitch: stitchImages,
  toolknit_ppt_images: extractPptImages,
  toolknit_ppt_text: extractPptText,
  toolknit_ppt_compress: compressPpt,
  toolknit_ppt_to_pdf: convertPptToPdf,
  toolknit_ppt_to_image: convertPptToImages,
  toolknit_ppt_outline: generatePptOutline,
  toolknit_ppt_draft: generatePptDraft,
  toolknit_hardware_overview: (_args, options) => inspectHardwareOverview(options),
  toolknit_hardware_cpu_memory: (_args, options) => inspectCpuMemoryInfo(options),
  toolknit_hardware_cpu_memory_live_stats: (_args, options) => inspectCpuMemoryLiveStats(options),
  toolknit_hardware_gpu_display: (_args, options) => inspectGpuDisplayInfo(options),
  toolknit_hardware_mainboard_firmware: (_args, options) => inspectMainboardFirmwareInfo(options),
  toolknit_hardware_storage_health: (_args, options) => inspectStorageHealthInfo(options),
  toolknit_hardware_network_devices: (_args, options) => inspectNetworkDevicesInfo(options),
  toolknit_hardware_power_sensors: (_args, options) => inspectPowerSensorsInfo(options),
  toolknit_ai_document: generateAiDocument,
  toolknit_ai_document_inspect: inspectAiDocumentProject,
  toolknit_ai_document_edit: editAiDocumentProject,
  toolknit_ai_document_render: renderAiDocumentProject,
  toolknit_ai_table: generateAiTableProject,
  toolknit_ai_table_inspect: inspectAiTableProjectFile,
  toolknit_ai_table_edit: editAiTableProject,
  toolknit_ai_table_render: renderAiTableProject
});

export function listTools() {
  return TOOL_DEFINITIONS;
}

export async function executeTool(name, argumentsValue, options = {}) {
  throwIfAborted(options.signal);
  if (!TOOL_BY_NAME.has(name) || !TOOL_HANDLERS[name]) {
    throw new ToolKnitError('INVALID_ARGUMENT', `Unknown ToolKnit tool: ${name}`);
  }
  validateToolArguments(TOOL_BY_NAME.get(name), argumentsValue ?? {});
  return TOOL_HANDLERS[name](argumentsValue ?? {}, options);
}
