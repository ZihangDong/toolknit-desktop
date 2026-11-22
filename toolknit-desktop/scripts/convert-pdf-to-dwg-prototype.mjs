// Explicit research command; no desktop/CLI/MCP registration or engine download.
import { readFile, mkdir, mkdtemp, writeFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { CAD_PROTOTYPE_LIMITS, cadFailure, cadPrototypePages, cadPrototypeSettings, extractCadPrototypePage, writeCadPrototypePage } from './lib/pdf-to-dwg-prototype.mjs';
import { applyCadFont, writeCadFontBundle } from './lib/pdf-dwg-font.mjs';

export async function convertPrototype({ input, outputDirectory, cadModule, range, unit = 'mm', scale = 1, password, check = () => {}, onProgress = () => {} }) {
  const settings = cadPrototypeSettings({ unit, scale });
  const source = path.resolve(input), output = path.resolve(outputDirectory);
  const metadata = await stat(source);
  if (!metadata.isFile() || metadata.size < 5 || metadata.size > CAD_PROTOTYPE_LIMITS.bytes || !/\.pdf$/i.test(source)) throw cadFailure('input');
  const bytes = new Uint8Array(await readFile(source)); check();
  const hash = value => createHash('sha256').update(value).digest('hex');
  const inputHash = hash(bytes);
  const cad = await import(pathToFileURL(path.resolve(cadModule)).href); check();
  const task = getDocument({ data: bytes, password, isEvalSupported: false, useSystemFonts: true, fontExtraProperties: true });
  let staging, fontBundle;
  try {
    const pdf = await task.promise; check();
    const pages = cadPrototypePages(range, pdf.numPages);
    await mkdir(output, { recursive: true });
    staging = await mkdtemp(path.join(output, '.tk-pdf-dwg-'));
    const reports = [];
    for (const number of pages) {
      check(); onProgress({ page: number, completed: reports.length, total: pages.length });
      const page = await pdf.getPage(number); check();
      try {
        const plan = await extractCadPrototypePage(page, { ...settings, check }); check();
        const bundle = await applyCadFont(plan, check); check();
        if (bundle) fontBundle = bundle;
        const dwg = writeCadPrototypePage(plan, cad); check();
        const name = `page-${String(number).padStart(3, '0')}.dwg`;
        await writeFile(path.join(staging, name), dwg, { flag: 'wx' });
        reports.push({ page: number, file: name, bytes: dwg.length, sha256: hash(dwg),
          width: plan.width, height: plan.height, entities: Object.fromEntries(['LINE', 'SPLINE', 'TEXT'].map(type => [type, plan.geometry.filter(item => item.type === type).length])),
          textLayout: plan.geometry.filter(item => item.type === 'TEXT').map(item => ({ start: item.points[0], end: item.points[1], width: item.width, widthFactor: item.widthFactor, capHeight: item.height, capMethod: item.capMethod, rotation: item.rotation })), notices: plan.notices });
      } finally { page.cleanup(); }
    }
    check();
    if (fontBundle) { await writeCadFontBundle(staging, fontBundle); check(); }
    if (hash(await readFile(source)) !== inputHash) throw cadFailure('input-changed');
    const report = { scope: 'research-prototype', format: 'DWG 2018 (AC1032)', codecAdapter: 'acad-ts-3.9.0-root-defaults-and-section-count', textLayout: 'portable-font-cap-height-width-factor', fonts: fontBundle ? [fontBundle.metadata] : [], inputSha256: inputHash, unit, scale, pages: reports, independentCadAcceptance: 'not-tested' };
    await writeFile(path.join(staging, 'conversion.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); check();
    const base = path.basename(source, path.extname(source)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 70) || 'drawing';
    const destination = path.join(output, `${base}-dwg-${randomUUID()}`);
    if (path.dirname(staging) !== output || path.dirname(destination) !== output) throw cadFailure('output-path');
    await rename(staging, destination); staging = null;
    return { directory: destination, ...report };
  } finally {
    try { await task.destroy(); }
    finally {
      if (staging) {
        if (path.dirname(staging) !== output || !path.basename(staging).startsWith('.tk-pdf-dwg-')) throw cadFailure('cleanup-path');
        await rm(staging, { recursive: true, force: true });
      }
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: {
      input: { type: 'string' }, 'out-dir': { type: 'string' }, 'cad-module': { type: 'string' },
      pages: { type: 'string' }, unit: { type: 'string', default: 'mm' }, scale: { type: 'string', default: '1' }, help: { type: 'boolean' },
    } });
    if (values.help) console.log('Research prototype: node scripts/convert-pdf-to-dwg-prototype.mjs --input drawing.pdf --out-dir tmp/cad --cad-module <acad-ts/dist/index.js> [--pages 1-3,5] [--unit mm|m|inch] [--scale 100]\nRejects images, fills, clipping, OCG, forms, dashed lines and nonstandard text rendering. Exports an OFL font and width-calibrated editable text; CAD must resolve the supplied font.');
    else {
      if (!values.input || !values['out-dir'] || !values['cad-module']) throw cadFailure('arguments', '--input, --out-dir and --cad-module are required');
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort());
      const result = await convertPrototype({ input: values.input, outputDirectory: values['out-dir'], cadModule: values['cad-module'], range: values.pages,
        unit: values.unit, scale: Number(values.scale), password: process.env.TOOLKNIT_CAD_PROTOTYPE_PASSWORD,
        check: () => { if (controller.signal.aborted) throw cadFailure('cancelled'); } });
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) { console.error(JSON.stringify({ code: error.code || error.name, message: error.message })); process.exitCode = 1; }
}
