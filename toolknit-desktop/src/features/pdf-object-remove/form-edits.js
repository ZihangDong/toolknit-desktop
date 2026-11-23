import { PDFDict, PDFName } from 'pdf-lib';
import { REMOVE_LIMITS, removeError } from './core.js';

const N = PDFName.of;
const encoder = new TextEncoder();

function replaceContentRanges(bytes, ranges, budget) {
  const sorted = [...ranges].sort((a,b) => a.start-b.start);
  const parts = [];
  let offset = 0;
  for (const range of sorted) {
    if (range.start < offset || range.end > bytes.length || range.end <= range.start) throw removeError('selection');
    parts.push(bytes.subarray(offset, range.start), encoder.encode('\n'+range.replacement+'\n'));
    offset = range.end;
  }
  parts.push(bytes.subarray(offset));
  const length = parts.reduce((size, part) => size+part.length, 0);
  budget.bytes += length;
  if (length>REMOVE_LIMITS.streamBytes || budget.bytes>REMOVE_LIMITS.decodedBytes) throw removeError('output');
  const result = new Uint8Array(length);
  let at = 0;
  for (const part of parts) { result.set(part, at); at += part.length; }
  return result;
}

export function formEditTree(candidates) {
  const root = { ranges: [], children: new Map() };
  for (const candidate of candidates) {
    let node = root;
    for (const step of candidate.formPath || []) {
      if (!node.children.has(step.start)) node.children.set(step.start, { step, ranges: [], children: new Map() });
      node = node.children.get(step.start);
    }
    node.ranges.push(...(candidate.ranges || []));
  }
  return root;
}

export function rewriteFormCalls(context, resources, bytes, edits, decodedForms, budget, check) {
  let newResources = resources;
  const ranges = [...edits.ranges];
  if (edits.children.size) {
    if (!(resources instanceof PDFDict)) throw removeError('selection');
    const xObjects = resources.lookup(N('XObject'));
    if (!(xObjects instanceof PDFDict)) throw removeError('selection');
    newResources = resources.clone(context);
    const newXObjects = xObjects.clone(context);
    newResources.set(N('XObject'), newXObjects);
    let suffix = 0;
    for (const branch of edits.children.values()) {
      check();
      const { name, refKey, start, end } = branch.step;
      const ref = xObjects.get(N(name));
      const form = context.lookup(ref);
      const raw = decodedForms.get(refKey)?.bytes;
      if (String(ref) !== refKey || !form?.dict || !raw) throw removeError('selection');
      const child = rewriteFormCalls(context, form.dict.lookup(N('Resources')), raw, branch, decodedForms, budget, check);
      const dictionary = form.dict.clone(context);
      dictionary.delete(N('DecodeParms'));
      dictionary.delete(N('Length'));
      dictionary.set(N('Filter'), N('FlateDecode'));
      dictionary.set(N('Resources'), child.resources);
      const stream = context.flateStream(child.bytes);
      for (const [key, value] of dictionary.entries()) stream.dict.set(key, value);
      let alias;
      do { alias = N('TKFormEdit'+suffix++); } while (newXObjects.has(alias));
      newXObjects.set(alias, context.register(stream));
      ranges.push({ start, end, replacement: String(alias)+' Do' });
    }
  }
  return { bytes: replaceContentRanges(bytes, ranges, budget), resources: newResources };
}
