import { operation, schema, inputPath, outputPath, overwrite, integer, choice, textSource, oneTextSource } from './operation-schema.mjs';
const define = (name, command, description, fields, required = [], extra = {}, writes = false) => operation(name, command, description,
  schema(fields, required, extra), './ai-text-runtime.mjs', name, { readOnly: !writes, network: true });
export const AI_TEXT_OPERATIONS = [
  define('ai_polish', ['ai', 'polish'], 'Polish up to 12000 characters using an explicitly chosen style. Sends only the supplied text/style to the AI provider configured in process environment. Returns text without writing files; never reads desktop credentials.',
    { ...textSource, style: { type: 'string', minLength: 1, maxLength: 300 } }, ['style'], oneTextSource),
  define('ai_translate', ['ai', 'translate'], 'Translate up to 12000 characters with the environment-configured AI provider. Validates aligned originals against caller input; returns translated text and pairs. Sends the supplied text to the configured endpoint.',
    { ...textSource, target_language: choice(['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'pt', 'it', 'ar']) }, ['target_language'], oneTextSource),
  define('pdf_ai_markdown', ['pdf', 'ai-markdown'], 'Use the configured vision AI to transcribe up to 20 selected PDF pages and build a Markdown reading guide. Sends rendered page images and extracted model fragments to that provider. This is an explicit network operation; use pdf text for offline extraction.',
    { input_path: inputPath, output_path: outputPath, pages: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: integer(1, 300) }, locale: choice(['zh-CN', 'en']), overwrite }, ['input_path', 'output_path'], {}, true)
];
