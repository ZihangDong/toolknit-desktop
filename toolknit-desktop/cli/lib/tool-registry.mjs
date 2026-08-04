import { PDF_TOOL_HANDLERS } from './pdf-runtime.mjs';
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
import { ToolKnitError } from './errors.mjs';

const PDF_PATH = { type: 'string', minLength: 1, description: 'Absolute or current-directory-relative path to a PDF file.' };
const OUTPUT_PATH = { type: 'string', minLength: 1, description: 'Explicit destination path for a new PDF. In an IDE, resolve the active workspace root and pass an absolute path inside that workspace; do not rely on the MCP process working directory. Existing files are refused unless overwrite is true.' };
const TABLE_OUTPUT_PATH = { type: 'string', minLength: 1, description: 'Explicit destination path for a new CSV, XLSX, PDF, or PNG export. In an IDE, resolve the active workspace root and pass an absolute path inside that workspace; do not rely on the MCP process working directory. Existing files are refused unless overwrite is true.' };
const OVERWRITE = { type: 'boolean', default: false, description: 'Replace an existing output file only when explicitly true.' };
const PROJECT_PATH = { type: 'string', minLength: 1, description: 'Path to a ToolKnit editable document project.' };
const TABLE_PROJECT_PATH = { type: 'string', minLength: 1, description: 'Path to a ToolKnit editable table project.' };
const AUDIO_INPUT_PATH = { type: 'string', minLength: 1, description: 'Absolute or current-directory-relative path to a local audio file. Supported inputs: MP3, AAC, M4A, WAV, FLAC, ALAC, OGG, and WMA.' };
const AUDIO_OUTPUT_DIR = { type: 'string', minLength: 1, description: 'Explicit directory for converted audio. In an IDE, resolve the active workspace root and use an absolute path inside <workspace>/toolknit-output. Existing files are never replaced; ToolKnit allocates a unique name.' };
const VIDEO_INPUT_PATH = { type: 'string', minLength: 1, description: 'Absolute or current-directory-relative path to a local MP4, AVI, MKV, MOV, WebM, FLV, WMV, TS, or M4V file.' };
const VIDEO_OUTPUT_DIR = { type: 'string', minLength: 1, description: 'Explicit directory for converted video. In an IDE, resolve the workspace root and use an absolute path inside <workspace>/toolknit-output. Existing files are never replaced; ToolKnit allocates a unique name.' };
const UTF8_TEXT_PATH = { type: 'string', minLength: 1, description: 'Absolute or current-directory-relative path to one regular UTF-8 text file. Resolve it from the IDE file tree; content is analyzed locally and never returned.' };
const COLOR_IMAGE_PATH = { type: 'string', minLength: 1, description: 'Absolute or current-directory-relative path to one regular PNG, JPEG, or WebP image. Resolve it from the IDE file tree.' };
const CONTROL_REFERENCE = { type: 'string', minLength: 1, description: 'Stable control number such as P1-01, or its internal stable id.' };
const CONTROL_STYLE = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    fontSize: { type: 'number', minimum: 6, maximum: 96 },
    bold: { type: 'boolean' },
    align: { enum: ['left', 'center', 'right'] },
    textColor: { anyOf: [{ type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }, { type: 'null' }] },
    backgroundColor: { anyOf: [{ type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }, { type: 'null' }] },
    borderColor: { anyOf: [{ type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }, { type: 'null' }] },
    borderWidth: { type: 'number', minimum: 0, maximum: 12 },
    dividerColor: { anyOf: [{ type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }, { type: 'null' }] },
    dividerWidth: { type: 'number', minimum: 0, maximum: 12 },
    padding: { type: 'number', minimum: 0, maximum: 80 },
    opacity: { type: 'number', minimum: 0.05, maximum: 1 },
    lineHeight: { type: 'number', minimum: 1, maximum: 3 }
  }
};
const INSERT_CONTROL = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { enum: ['title', 'subtitle', 'section-heading', 'sub-heading', 'body', 'body-indent', 'list-item', 'image', 'signature', 'date', 'divider', 'table-row', 'note', 'emphasis'] },
    text: { type: 'string', maxLength: 2000 },
    label: { type: 'string', maxLength: 300 },
    source_path: { type: 'string', minLength: 1, description: 'Absolute path to a regular PNG or JPEG file, required when type is image. Relative paths and base64 data are rejected.' },
    x: { type: 'number', minimum: 0, maximum: 794 },
    y: { type: 'number', minimum: 0, maximum: 1123 },
    w: { type: 'number', minimum: 2, maximum: 794 },
    h: { type: 'number', minimum: 2, maximum: 1123 },
    layoutMode: { enum: ['flow', 'absolute'], default: 'flow' },
    fontSize: { type: 'number', minimum: 6, maximum: 96 },
    bold: { type: 'boolean' },
    align: { enum: ['left', 'center', 'right'] },
    style: CONTROL_STYLE
  }
};
const EDIT_OPERATION = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { enum: ['update_text', 'update_style', 'swap_positions', 'move', 'resize', 'insert_control', 'delete_control', 'lock_control', 'group_controls', 'ungroup_controls', 'align_controls', 'resolve_overlaps', 'undo'] },
    control: { anyOf: [CONTROL_REFERENCE, INSERT_CONTROL] },
    controls: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: CONTROL_REFERENCE },
    text: { type: 'string', maxLength: 2000 },
    style: CONTROL_STYLE,
    first: CONTROL_REFERENCE,
    second: CONTROL_REFERENCE,
    before: CONTROL_REFERENCE,
    after: CONTROL_REFERENCE,
    page: { type: 'integer', minimum: 1 },
    x: { type: 'number', minimum: 0, maximum: 794 },
    y: { type: 'number', minimum: 0, maximum: 1123 },
    w: { type: 'number', minimum: 2, maximum: 794 },
    h: { type: 'number', minimum: 2, maximum: 1123 },
    layoutMode: { enum: ['flow', 'absolute'] },
    locked: { type: 'boolean' },
    group: { type: 'string', minLength: 1, maxLength: 120 },
    anchor: CONTROL_REFERENCE,
    alignment: { enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'] },
    direction: { enum: ['vertical', 'horizontal'] },
    gap: { type: 'number', minimum: 0, maximum: 100 },
    steps: { type: 'integer', minimum: 1 }
  }
};
const TABLE_CHART = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { enum: ['bar', 'line', 'pie'] },
    title: { type: 'string', maxLength: 120 },
    labelColumnId: { type: 'string', minLength: 1, description: 'Stable column number, column key, column label, or internal id for chart labels, such as C01.' },
    valueColumnIds: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 1 }, description: 'Stable numeric column numbers, keys, labels, or internal ids for chart values, such as C02.' }
  }
};
const TABLE_OPERATION = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { enum: ['update_title', 'update_summary', 'update_cell', 'update_row', 'update_column', 'insert_row', 'delete_row', 'swap_rows', 'move_row', 'sort_rows', 'insert_column', 'delete_column', 'swap_columns', 'move_column', 'insert_chart', 'update_chart', 'delete_chart'] },
    row: { type: 'string', minLength: 1 },
    column: { type: 'string', minLength: 1 },
    chart: { anyOf: [{ type: 'string', minLength: 1 }, TABLE_CHART] },
    first: { type: 'string', minLength: 1 },
    second: { type: 'string', minLength: 1 },
    before: { type: 'string', minLength: 1 },
    after: { type: 'string', minLength: 1 },
    index: { type: 'integer', minimum: 0 },
    value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] },
    values: { type: 'array', maxItems: 20, items: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] } },
    title: { type: 'string', maxLength: 160 },
    summary: { type: 'string', maxLength: 500 },
    chartType: { enum: ['bar', 'line', 'pie'] },
    label: { type: 'string', maxLength: 80 },
    key: { type: 'string', maxLength: 64 },
    columnType: { enum: ['text', 'number', 'date'] },
    direction: { enum: ['asc', 'desc'] },
    steps: { type: 'integer', minimum: 1 }
  }
};

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'toolknit_pdf_inspect',
    description: 'Inspect a local PDF without writing files. Returns its absolute path, byte size, and page count.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['input_path'], properties: { input_path: PDF_PATH } }
  },
  {
    name: 'toolknit_pdf_merge',
    description: 'Merge two or more local PDFs. Output is created only at output_path. page_selections is optional; omitted inputs contribute every page in source order.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['input_paths', 'output_path'],
      properties: {
        input_paths: { type: 'array', minItems: 2, maxItems: 25, items: PDF_PATH },
        output_path: OUTPUT_PATH,
        page_selections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['input_index', 'pages'], properties: { input_index: { type: 'integer', minimum: 0 }, pages: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1 } } } } },
        overwrite: OVERWRITE
      }
    }
  },
  {
    name: 'toolknit_pdf_split',
    description: 'Export selected pages from one local PDF as individual PDFs in output_dir. The input PDF is never modified.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['input_path', 'output_dir', 'pages'], properties: { input_path: PDF_PATH, output_dir: { type: 'string', minLength: 1 }, pages: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1 } }, overwrite: OVERWRITE } }
  },
  {
    name: 'toolknit_pdf_rotate',
    description: 'Create a rotated PDF. Use rotation to rotate every page, or page_rotations for explicit per-page rotations. Rotation is a multiple of 90 degrees.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['input_path', 'output_path'], properties: { input_path: PDF_PATH, output_path: OUTPUT_PATH, rotation: { type: 'number', multipleOf: 90, default: 90 }, page_rotations: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['page', 'rotation'], properties: { page: { type: 'integer', minimum: 1 }, rotation: { type: 'number', multipleOf: 90 } } } }, overwrite: OVERWRITE } }
  },
  {
    name: 'toolknit_pdf_encrypt',
    description: 'Create an encrypted PDF using a password of at least 8 characters. The password is handled in memory and is never included in result data or logs.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['input_path', 'output_path', 'password'], properties: { input_path: PDF_PATH, output_path: OUTPUT_PATH, password: { type: 'string', minLength: 8, description: 'Secret. Do not place it in output paths or logs.' }, permissions: { type: 'object', additionalProperties: false, properties: { printing: { enum: [false, 'lowResolution', 'highResolution'] }, modifying: { type: 'boolean' }, copying: { type: 'boolean' }, annotating: { type: 'boolean' }, fillingForms: { type: 'boolean' }, contentAccessibility: { type: 'boolean' }, documentAssembly: { type: 'boolean' } } }, overwrite: OVERWRITE } }
  },
  {
    name: 'toolknit_pdf_decrypt',
    description: 'Create an unprotected copy of a local PDF. The optional password is handled only in memory and is never included in result data or logs.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['input_path', 'output_path'], properties: { input_path: PDF_PATH, output_path: OUTPUT_PATH, password: { type: 'string', description: 'Optional secret. Omit when no open password is set.' }, overwrite: OVERWRITE } }
  },
  {
    name: 'toolknit_pdf_compress',
    description: 'Create a smaller PDF using qpdf. If optimization cannot reduce the file size, no output file is created and a warning is returned.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['input_path', 'output_path'], properties: { input_path: PDF_PATH, output_path: OUTPUT_PATH, level: { enum: ['low', 'medium', 'high'], default: 'medium' }, overwrite: OVERWRITE } }
  },
  {
    name: 'toolknit_pdf_enhance',
    description: 'Render and enhance a scanned or image-based PDF locally. Output pages are rasterized; searchable text, links, and forms are not preserved.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['input_path', 'output_path'], properties: { input_path: PDF_PATH, output_path: OUTPUT_PATH, strength: { enum: ['light', 'medium', 'strong'], default: 'medium' }, overwrite: OVERWRITE } }
  },
  {
    name: 'toolknit_audio_convert',
    description: 'Convert one to 100 local audio files with FFmpeg. Supports MP3, AAC, WAV, FLAC, ALAC, and OGG targets. AAC and ALAC produce .m4a. Output files are created only in output_dir, use unique names, and are published only after a successful encode.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['input_paths', 'output_dir', 'target_format'],
      properties: {
        input_paths: { type: 'array', minItems: 1, maxItems: 100, items: AUDIO_INPUT_PATH },
        output_dir: AUDIO_OUTPUT_DIR,
        target_format: { enum: ['mp3', 'aac', 'wav', 'flac', 'alac', 'ogg'], description: 'Explicit target audio format.' },
        quality: { enum: ['low', 'medium', 'high'], default: 'medium', description: 'Encoding quality for MP3, AAC, FLAC, and OGG. WAV and ALAC use fixed lossless encoders.' }
      }
    }
  },
  {
    name: 'toolknit_audio_bpm',
    description: 'Analyze BPM locally from one supported audio file. It uses only the first 120 seconds, never uploads, changes, or creates audio files, and returns the primary BPM, confidence, and up to five candidates. Resolve the input path from the IDE file tree; do not infer it from the MCP working directory.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['input_path'],
      properties: {
        input_path: { type: 'string', minLength: 1, description: 'Absolute or current-directory-relative MP3, WAV, FLAC, AAC, OGG, or M4A file. Must be a regular file no larger than 50 MB and no longer than 5 minutes.' }
      }
    }
  },
  {
    name: 'toolknit_audio_clip',
    description: 'Trim one local audio file between explicit start_seconds and end_seconds. The source is never changed. By default ToolKnit preserves its source container with stream copying when possible, otherwise it publishes a clearly reported MP3 fallback. Resolve paths from the IDE file tree; never infer times or paths from chat context.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['input_path', 'output_dir', 'start_seconds', 'end_seconds'],
      properties: {
        input_path: AUDIO_INPUT_PATH,
        output_dir: AUDIO_OUTPUT_DIR,
        start_seconds: { type: 'number', minimum: 0, description: 'First retained timestamp in seconds.' },
        end_seconds: { type: 'number', exclusiveMinimum: 0, description: 'First excluded timestamp in seconds; it must be at least 0.1 seconds after start_seconds and no later than source duration.' },
        target_format: { enum: ['mp3'], description: 'Optional. Omit to preserve the source container when stream copying is safe; mp3 explicitly re-encodes as MP3.' }
      }
    }
  },
  { name: 'toolknit_audio_extract', description: 'Extract a selected local video audio track into an explicit output directory without modifying the source.', inputSchema: { type: 'object', additionalProperties: false, required: ['input_path', 'output_dir', 'target_format'], properties: { input_path: { type: 'string', minLength: 1 }, output_dir: AUDIO_OUTPUT_DIR, target_format: { enum: ['mp3', 'aac', 'wav', 'flac', 'ogg'] }, track_index: { type: 'integer', minimum: 0, maximum: 31 }, quality: { enum: ['low', 'medium', 'high'], default: 'medium' } } } },
  { name: 'toolknit_model_list', description: 'List the local offline transcription models shared by ToolKnit desktop and CLI. This does not download or modify files.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'toolknit_model_install', description: 'Download and integrity-verify one offline Whisper model. The model is installed locally and shared with ToolKnit desktop. Use small unless the user explicitly needs faster base or higher-quality medium.', inputSchema: { type: 'object', additionalProperties: false, required: ['model_id'], properties: { model_id: { enum: ['base', 'small', 'medium'] }, source: { enum: ['auto', 'official', 'china'], default: 'auto' } } } },
  { name: 'toolknit_model_use', description: 'Choose an already installed offline transcription model as the current ToolKnit model.', inputSchema: { type: 'object', additionalProperties: false, required: ['model_id'], properties: { model_id: { enum: ['base', 'small', 'medium'] } } } },
  { name: 'toolknit_transcribe', description: 'Transcribe one explicit local audio or video file with the installed offline model. The source is never uploaded or changed. It creates original JSON, SRT, and TXT in output_dir with unique names. refine=true additionally sends recognized subtitle text, never the media, to the configured AI provider; timecodes and IDs are preserved. First call toolknit_model_list and, only if needed, ask the user before downloading a model.', inputSchema: { type: 'object', additionalProperties: false, required: ['input_path', 'output_dir'], properties: { input_path: { type: 'string', minLength: 1, description: 'Absolute path to one explicit MP3, M4A, WAV, FLAC, OGG, MP4, MKV, MOV, AVI, WebM, or similar supported local media file.' }, output_dir: { type: 'string', minLength: 1, description: 'Explicit directory for JSON, SRT, and TXT outputs. In an IDE, use an absolute directory inside the workspace.' }, language: { enum: ['auto', 'zh', 'en'], default: 'auto' }, refine: { type: 'boolean', default: false, description: 'Optional. Send only recognized subtitle text to the configured AI provider for constrained punctuation and grammar refinement; every segment ID and timecode is preserved.' } } } },
  { name: 'toolknit_video_convert', description: 'Convert one to 30 explicit local video files with local FFmpeg processing. Supported inputs are MP4, AVI, MKV, MOV, WebM, FLV, WMV, TS, and M4V; targets are MP4, AVI, MKV, MOV, WebM, FLV, WMV, or TS. The source is never modified. Outputs are published with unique names only after a non-empty successful encode. Resolve paths from the IDE file tree; do not infer them from the MCP process directory.', inputSchema: { type: 'object', additionalProperties: false, required: ['input_paths', 'output_dir', 'target_format'], properties: { input_paths: { type: 'array', minItems: 1, maxItems: 30, items: VIDEO_INPUT_PATH }, output_dir: VIDEO_OUTPUT_DIR, target_format: { enum: ['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', 'ts'] } } } },
  { name: 'toolknit_video_frame', description: 'Extract one frame from one explicit local video at timestamp_ms. PNG is lossless; JPG uses high quality. The source is never changed, and the output is published with a unique name only after FFmpeg produces a non-empty image. In an IDE, resolve the requested timestamp explicitly from the user or video preview; never guess it.', inputSchema: { type: 'object', additionalProperties: false, required: ['input_path', 'output_dir', 'timestamp_ms'], properties: { input_path: VIDEO_INPUT_PATH, output_dir: VIDEO_OUTPUT_DIR, timestamp_ms: { type: 'integer', minimum: 0, description: 'Exact frame timestamp in milliseconds.' }, format: { enum: ['png', 'jpg'], default: 'png' } } } },
  { name: 'toolknit_video_gif', description: 'Create one palette-optimized GIF from an explicit start_ms to end_ms segment of one local video. The selection must be 30 seconds or shorter. The source is never changed; the GIF is first verified as non-empty and then published under a unique name. In an IDE, resolve the video path and both frame times from the file tree and user preview. Do not infer a highlight or guess a range; use quality small or tiny when the user asks for a smaller GIF.', inputSchema: { type: 'object', additionalProperties: false, required: ['input_path', 'output_dir', 'start_ms', 'end_ms'], properties: { input_path: VIDEO_INPUT_PATH, output_dir: VIDEO_OUTPUT_DIR, start_ms: { type: 'integer', minimum: 0, description: 'First included frame timestamp in milliseconds.' }, end_ms: { type: 'integer', minimum: 1, description: 'First excluded frame timestamp in milliseconds. It must be after start_ms, within the video, and no more than 30 seconds later.' }, frame_rate: { type: 'integer', minimum: 1, maximum: 20, default: 12 }, width: { type: 'integer', minimum: 160, maximum: 1920, default: 640 }, quality: { enum: ['high', 'balanced', 'small', 'tiny'], default: 'balanced', description: 'Palette/dither preset. high is clearest; small and tiny reduce file size.' } } } },
  { name: 'toolknit_text_stats', description: 'Calculate deterministic local statistics for one explicit UTF-8 text file without writing files or returning its text content. Returns Unicode character, word, line, paragraph, sentence, punctuation, and reading-time counts. Rejects symbolic links, invalid UTF-8, binary data, and text above 1,000,000 UTF-16 code units.', inputSchema: { type: 'object', additionalProperties: false, required: ['input_path'], properties: { input_path: UTF8_TEXT_PATH } } },
  { name: 'toolknit_color_extract', description: 'Extract a deterministic dominant palette from one explicit local PNG, JPEG, or WebP image without writing files. Returns ordered HEX, RGB, HSL, population, and percentage values; the source image is not uploaded or returned.', inputSchema: { type: 'object', additionalProperties: false, required: ['input_path'], properties: { input_path: COLOR_IMAGE_PATH, count: { type: 'integer', minimum: 2, maximum: 9, default: 9 } } } },
  {
    name: 'toolknit_image_stitch',
    description: 'Stitch 2 to 100 explicit local images vertically or horizontally. Processing is local, source files are never modified, animated GIF is rejected, and a completed PNG/JPG is published with a unique name in output_dir. Preserve the user or IDE file-tree order exactly unless they explicitly request reordering.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['input_paths', 'output_dir'],
      properties: {
        input_paths: { type: 'array', minItems: 2, maxItems: 100, items: { type: 'string', minLength: 1, description: 'Absolute path to one JPG, JPEG, PNG, WebP, BMP, or static GIF image.' } },
        output_dir: { type: 'string', minLength: 1, description: 'Explicit output directory. In an IDE, resolve an absolute directory inside the active workspace; never rely on the MCP working directory.' },
        output_name: { type: 'string', minLength: 1, maxLength: 96, pattern: '^[^\\\\/:*?"<>|\\u0000-\\u001F]+$', description: 'Optional file name stem without a path or extension. ToolKnit still adds a numeric suffix rather than overwriting an existing file.' },
        mode: { enum: ['vertical', 'horizontal'], default: 'vertical' },
        reference: { enum: ['first', 'smallest', 'largest'], default: 'first', description: 'Reference width for vertical mode or reference height for horizontal mode.' },
        spacing_px: { type: 'integer', minimum: 0, maximum: 500, default: 0 },
        scale_percent: { type: 'integer', minimum: 10, maximum: 100, default: 100 },
        background_rgba: { type: 'string', pattern: '^#[0-9A-Fa-f]{8}$', default: '#FFFFFFFF' },
        format: { enum: ['png', 'jpg'], default: 'png' },
        jpeg_quality: { type: 'integer', minimum: 60, maximum: 100, default: 92 }
      }
    }
  },
  {
    name: 'toolknit_ai_document',
    description: 'Generate a polished A4 document project from a natural-language brief. Returns the PDF, editable .toolknit.json project, clean previews, a high-resolution numbered map for every page, an overview, and revision history. For IDE requests such as "save in this project", resolve the workspace root and pass an absolute output_path inside it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt', 'output_path'],
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 12000, description: 'Complete document brief. Never include API keys or other secrets.' },
        output_path: OUTPUT_PATH,
        page_count: { type: 'integer', minimum: 1, maximum: 8, default: 3, description: 'Exact number of pages required in the rendered PDF.' },
        locale: { enum: ['zh-CN', 'en'], default: 'zh-CN' },
        overwrite: OVERWRITE
      }
    }
  },
  {
    name: 'toolknit_ai_document_inspect',
    description: 'Inspect an editable ToolKnit AI document without changing files. Returns every stable control number, type, text, style, position, lock state, artifact path, and diagnostic.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['project_path'],
      properties: { project_path: PROJECT_PATH }
    }
  },
  {
    name: 'toolknit_ai_document_edit',
    description: 'Atomically edit a ToolKnit AI document by stable control number. Resolve a natural-language target by inspecting exact control text/type first; ask the user when multiple controls match. Supports single-control text/style changes, document-wide typography/color/alignment rules, position swaps, move/resize, image or content insertion, deletion, locking, grouping, relative alignment, overlap resolution, and undo. Use update_document_style only for explicit global requests; it skips images, dividers, headers, footers, and locked controls unless types is supplied. Image insertion requires an absolute local PNG/JPEG source_path. A successful non-dry-run edit creates a new revision and refreshes all artifacts.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['project_path', 'operations'],
      properties: {
        project_path: PROJECT_PATH,
        operations: { type: 'array', minItems: 1, maxItems: 100, items: EDIT_OPERATION },
        dry_run: { type: 'boolean', default: false, description: 'Validate and render the proposed edit without writing any file.' }
      }
    }
  },
  {
    name: 'toolknit_ai_document_render',
    description: 'Deterministically regenerate the bound PDF, clean previews, and numbered control maps from an existing ToolKnit AI document project without creating a new revision.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['project_path'],
      properties: { project_path: PROJECT_PATH }
    }
  },
  {
    name: 'toolknit_ai_table',
    description: 'Generate an editable ToolKnit AI table project from a natural-language brief. Returns the export file, editable .toolknit-table.json project, preview, and revision history. For IDE requests such as "save in this project", resolve the workspace root and pass an absolute output_path inside it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt', 'output_path'],
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 12000, description: 'Complete table brief. Never include API keys or other secrets.' },
        output_path: TABLE_OUTPUT_PATH,
        format: { enum: ['csv', 'xlsx', 'pdf', 'png'] },
        locale: { enum: ['zh-CN', 'en'], default: 'zh-CN' },
        overwrite: OVERWRITE
      }
    }
  },
  {
    name: 'toolknit_ai_table_inspect',
    description: 'Inspect an editable ToolKnit AI table project without changing files. Returns stable row, column, and chart numbers plus the export and preview artifact paths.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['project_path'],
      properties: { project_path: TABLE_PROJECT_PATH }
    }
  },
  {
    name: 'toolknit_ai_table_edit',
    description: 'Atomically edit a ToolKnit AI table by stable row, column, or chart reference. Supports cell updates, row and column inserts or deletes, swaps, reordering, sorting, chart updates, and undo. A successful non-dry-run edit creates a new revision and refreshes all artifacts.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['project_path', 'operations'],
      properties: {
        project_path: TABLE_PROJECT_PATH,
        operations: { type: 'array', minItems: 1, maxItems: 100, items: TABLE_OPERATION },
        dry_run: { type: 'boolean', default: false, description: 'Validate and render the proposed edit without writing any file.' }
      }
    }
  },
  {
    name: 'toolknit_ai_table_render',
    description: 'Deterministically regenerate the export file and preview from an existing ToolKnit AI table project without creating a new revision.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['project_path'],
      properties: { project_path: TABLE_PROJECT_PATH }
    }
  }
]);

const TOOL_BY_NAME = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, tool]));
const TOOL_HANDLERS = Object.freeze({
  ...PDF_TOOL_HANDLERS,
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
  if (!TOOL_BY_NAME.has(name) || !TOOL_HANDLERS[name]) {
    throw new ToolKnitError('INVALID_ARGUMENT', `Unknown ToolKnit tool: ${name}`);
  }
  return TOOL_HANDLERS[name](argumentsValue ?? {}, options);
}
