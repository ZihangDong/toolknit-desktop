import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { executeTool } from '../cli/lib/tool-registry.mjs';
import { generateTableFromPrompt } from '../cli/lib/ai-table-project-runtime.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'toolknit-ai-failure-'));
const env = { TOOLKNIT_AI_API_KEY: 'local-regression-credential', TOOLKNIT_AI_API_URL: 'https://provider.example.test/', TOOLKNIT_AI_MODEL: 'fixture' };
const call = (name, args, options) => executeTool(`toolknit_${name}`, args, options);
const response = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }));
const table = { ready: true, title: 'Fixture', summary: 'Synthetic data', columns: [{ key: 'name', label: 'Item', type: 'text' }, { key: 'count', label: 'Count', type: 'number' }], rows: [['Alpha', 2], ['Beta', 3]], charts: [] };
const layout = { ready: true, summary: 'Synthetic document', pages: [{ regions: [
  { type: 'title', text: 'Fixture', x: 56, y: 60, w: 682, h: 50, fontSize: 30, bold: true },
  { type: 'body', text: 'This is synthetic document content.', x: 56, y: 150, w: 682, h: 70, fontSize: 14 }
] }] };
async function snapshot(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const rows = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...(await snapshot(target)).map(([name, digest]) => [entry.name + '/' + name, digest]));
    else rows.push([entry.name, createHash('sha256').update(await readFile(target)).digest('hex')]);
  }
  return rows.sort((a, b) => a[0].localeCompare(b[0]));
}
try {
  let started;
  const fetching = new Promise(resolve => { started = resolve; });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const work = generateTableFromPrompt('Synthetic table', { env, fetchImpl: async (_url, { signal }) => {
      started();
      return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
      } }));
    } });
    const check = assert.rejects(work, error => error.code === 'PROVIDER_TIMEOUT');
    await fetching; mock.timers.tick(120001); await check;
  } finally { mock.timers.reset(); }

  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>');
  zip.file('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>');
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
  zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Synthetic fixture</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  await writeFile(path.join(root, 'source.pptx'), await zip.generateAsync({ type: 'nodebuffer' }));
  for (const [name, args] of [
    ['ppt_text', { input_path: path.join(root, 'source.pptx'), output_dir: path.join(root, 'cancelled-ppt'), ai_mode: 'outline' }],
    ['ppt_outline', { prompt: 'Synthetic outline', slide_count: 3, output_dir: path.join(root, 'cancelled-outline') }],
    ['ppt_draft', { prompt: 'Synthetic draft', slide_count: 3, output_dir: path.join(root, 'cancelled-draft') }]
  ]) {
    const controller = new AbortController(); let calls = 0;
    await assert.rejects(call(name, args, { env, signal: controller.signal, fetchImpl: async (_url, { signal }) => {
      calls++; controller.abort(); assert.ok(signal.aborted); throw new DOMException('Aborted', 'AbortError');
    } }), error => error.code === 'CANCELLED');
    assert.equal(calls, 1, 'Cancellation must not retry a paid request.');
    const attempts = name === 'ppt_text' ? 1 : 3;
    const arrivals = Array.from({ length: attempts }, () => {
      let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve };
    });
    calls = 0; mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const timed = call(name, args, { env, retryDelayMs: 0, fetchImpl: async (_url, { signal }) => {
        arrivals[calls++].resolve();
        return new Response(new ReadableStream({ start(stream) {
          signal.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')), { once: true });
        } }));
      } });
      const check = assert.rejects(timed, error => error.code === 'PROVIDER_TIMEOUT');
      for (const arrival of arrivals) { await arrival.promise; mock.timers.tick(120001); }
      await check; assert.equal(calls, attempts);
    } finally { mock.timers.reset(); }
  }
  const pptArgs = { input_path: path.join(root, 'source.pptx'), output_dir: path.join(root, 'ppt'), ai_mode: 'outline' };
  for (const status of [400, 401, 403, 404, 429, 503]) {
    await assert.rejects(call('ppt_text', pptArgs, { env, fetchImpl: async () => new Response('{}', { status }) }),
      error => error.code === 'PROVIDER_ERROR' && error.details.retryable === (status === 429 || status === 503));
  }
  for (const at of [72, 94]) {
    const controller = new AbortController();
    await assert.rejects(call('ppt_text', pptArgs, { env, signal: controller.signal,
      fetchImpl: async () => response('Synthetic outline'), reportProgress: value => { if (value === at) controller.abort(); }
    }), error => error.code === 'CANCELLED');
    assert.deepEqual(await readdir(pptArgs.output_dir), []);
  }
  await assert.rejects(generateTableFromPrompt('Synthetic table', { env: { ...env, TOOLKNIT_AI_API_URL: 'invalid-url' },
    fetchImpl: () => assert.fail('Invalid configuration must not contact the provider.') }), error => error.code === 'ENGINE_UNAVAILABLE' && error.details.retryable === false);

  for (const [kind, data, extension, renderedAt] of [['document', layout, 'pdf', 90], ['table', table, 'xlsx', 75]]) {
    const args = { prompt: 'Synthetic fixture', output_path: path.join(root, `${kind}.${extension}`), ...(kind === 'document' ? { page_count: 1 } : { format: 'xlsx' }) };
    const fetchImpl = async () => response(data);
    const before = await snapshot(root), cancelled = new AbortController();
    await assert.rejects(call(`ai_${kind}`, args, { env, fetchImpl, signal: cancelled.signal, reportProgress: value => {
      if (value === renderedAt) cancelled.abort();
    } }), error => error.code === 'CANCELLED');
    assert.deepEqual(await snapshot(root), before, 'Cancellation after rendering must not publish any artifacts.');
    const generated = await call(`ai_${kind}`, args, { env, fetchImpl });
    await assert.rejects(call(`ai_${kind}`, args, { env, fetchImpl: () => assert.fail('Existing output must be checked before calling AI.') }), error => error.code === 'OUTPUT_EXISTS');
    const project_path = generated.project.path;
    const stable = await snapshot(root);
    const operations = kind === 'document' ? [{ type: 'update_text', control: 'P1-01', text: 'Edited' }]
      : [{ type: 'update_cell', row: 'R01', column: 'C01', value: 'Edited' }];
    for (const [action, extra, at] of [['edit', { operations }, 70], ['render', {}, 75]]) {
      const controller = new AbortController();
      await assert.rejects(call(`ai_${kind}_${action}`, { project_path, ...extra }, { signal: controller.signal, reportProgress: value => {
        if (value === at) controller.abort();
      } }), error => error.code === 'CANCELLED');
      assert.deepEqual(await snapshot(root), stable, 'Cancelled edits/renders must preserve every existing file and revision.');
    }
  }
  if (process.platform === 'win32' && process.env.APPDATA && !process.env.XDG_CONFIG_HOME) {
    const code = 'import {listTranscriptionModels} from "./cli/lib/transcription-runtime.mjs"; console.log(JSON.stringify(await listTranscriptionModels()));';
    const minimalEnv = { ...process.env }; delete minimalEnv.APPDATA;
    const regular = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true });
    const minimal = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true, env: minimalEnv });
    assert.deepEqual(JSON.parse(minimal.stdout), JSON.parse(regular.stdout), 'MCP hosts without APPDATA must find the existing Windows model configuration.');
  }
  console.log('AI failure regression passed: body-read deadline, PPT cancellation without retries, generation/edit/render cancellation with unchanged artifacts.');
} finally { mock.timers.reset(); await rm(root, { recursive: true, force: true }); }
