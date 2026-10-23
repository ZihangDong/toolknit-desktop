import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inferMathAst } from '../src/features/pdf-to-word/core/math.js';
import { validRect, contains } from '../src/features/pdf-to-word/core/geometry.js';

const [sourcePath, layoutPath, annotationPath, reportPath] = process.argv.slice(2);
if (!sourcePath || !layoutPath || !annotationPath || !reportPath) throw Error('Usage: check-pdf-word-math-semantics.mjs source.pdf layout.json annotations.json report.json');
const digest = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
const document = JSON.parse(await readFile(layoutPath, 'utf8')), annotations = JSON.parse(await readFile(annotationPath, 'utf8'));
assert([1, 2].includes(annotations.schemaVersion));
assert.equal(annotations.sourceSha256, digest, 'Annotations must belong to this source document');
assert.equal(document.sourceSha256, digest, 'Layout evidence must belong to this source document');
const whole = annotations.schemaVersion === 2;
assert.equal(annotations.unit, whole ? 'complete-formula' : 'formula-fragment', 'Fragment evidence must not be reported as whole-formula coverage');
assert(Array.isArray(annotations.entries) && annotations.entries.length > 0 && annotations.entries.length <= 2000);
const regions = new Map(), seen = new Set(), annotatedSources = new Set(), results = [];
const symbolStyles = {
  roman: { bold: false, italic: false, alphabet: 'roman' }, bold: { bold: true, italic: false, alphabet: 'roman' },
  italic: { bold: false, italic: true, alphabet: 'roman' }, boldItalic: { bold: true, italic: true, alphabet: 'roman' },
  script: { bold: false, italic: false, alphabet: 'script' }, boldScript: { bold: true, italic: false, alphabet: 'script' },
  doubleStruck: { bold: false, italic: false, alphabet: 'doubleStruck' },
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const structuresKey = values => JSON.stringify(values.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
const collect = (value, page) => {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'image') regions.set(value.id, { region: value, page });
  for (const child of Object.values(value)) if (child && typeof child === 'object') {
    if (Array.isArray(child)) child.forEach(value => collect(value, page)); else collect(child, page);
  }
};
document.pages.forEach(page => collect(page, page.number));
const evidence = (ast, region) => {
  const glyphs = new Map((region.mathGlyphs || []).map(glyph => [glyph.id, glyph]));
  const roles = {}, order = [], bars = {}, styles = {}, texts = {}, structures = [];
  const ids = node => node.type === 'symbol' ? [node.sourceId] : node.type === 'row' ? node.children.flatMap(ids)
    : node.type === 'matrix' ? [...node.leftGlyphIds, ...node.rows.flat().flatMap(ids), ...node.rightGlyphIds]
    : node.type === 'fraction' ? [...ids(node.numerator), ...ids(node.denominator)]
      : node.type === 'radical' ? [...(node.glyphIds || []), ...(node.degree ? ids(node.degree) : []), ...ids(node.radicand)]
        : ['nary', 'integral'].includes(node.type) ? [...ids(node.operator), ...(node.lower ? ids(node.lower) : []), ...(node.upper ? ids(node.upper) : []), ...ids(node.body), ...(node.differential ? ids(node.differential) : [])]
        : node.type === 'limit' ? [...ids(node.base), ...(node.lower ? ids(node.lower) : []), ...(node.upper ? ids(node.upper) : [])]
        : [...ids(node.base), ...(node.subscript ? ids(node.subscript) : []), ...(node.superscript ? ids(node.superscript) : [])];
  const visit = (node, path = []) => {
    if (node.type === 'symbol') {
      roles[node.sourceId] = path; order.push(node.sourceId);
      styles[node.sourceId] = { bold: node.bold, italic: node.italic, alphabet: node.alphabet || 'roman' };
      texts[node.sourceId] = node.text;
    }
    else if (node.type === 'row') node.children.forEach(child => visit(child, path));
    else if (node.type === 'matrix') {
      structures.push({ type: 'matrix', brackets: node.brackets, left: node.leftGlyphIds, right: node.rightGlyphIds,
        rows: node.rows.map(row => row.map(ids)) });
      const delimiter = (id, side) => {
        const glyph = glyphs.get(id);
        visit({ type: 'symbol', sourceId: id, text: glyph.text, italic: Boolean(glyph.italic), bold: Boolean(glyph.bold) }, [...path, `${side}Delimiter`]);
      };
      node.leftGlyphIds.forEach(id => delimiter(id, 'left'));
      node.rows.forEach((row, i) => row.forEach((cell, j) => visit(cell, [...path, `matrix[${i},${j}]`])));
      node.rightGlyphIds.forEach(id => delimiter(id, 'right'));
    }
    else if (node.type === 'fraction') {
      structures.push({ type: 'fraction', strokeId: node.strokeId, numerator: ids(node.numerator), denominator: ids(node.denominator) });
      bars[node.strokeId] = path; visit(node.numerator, [...path, 'numerator']); visit(node.denominator, [...path, 'denominator']);
    } else if (node.type === 'radical') {
      structures.push({ type: 'radical', strokeIds: node.strokeIds, ...(node.glyphIds ? { glyphIds: node.glyphIds } : {}),
        radicand: ids(node.radicand), degree: node.degree ? ids(node.degree) : [] });
      for (const id of node.strokeIds) bars[id] = [...path, 'radical'];
      for (const id of node.glyphIds || []) {
        const glyph = glyphs.get(id);
        visit({ type: 'symbol', sourceId: id, text: glyph.text, italic: Boolean(glyph.italic), bold: Boolean(glyph.bold),
          ...(glyph.alphabet ? { alphabet: glyph.alphabet } : {}) }, [...path, 'radicalPart']);
      }
      if (node.degree) visit(node.degree, [...path, 'degree']);
      visit(node.radicand, [...path, 'radicand']);
    } else if (node.type === 'nary' || node.type === 'integral') {
      structures.push({ type: node.type, operator: ids(node.operator), lower: node.lower ? ids(node.lower) : [],
        upper: node.upper ? ids(node.upper) : [], body: ids(node.body), ...(node.differential ? { differential: ids(node.differential) } : {}) });
      visit(node.operator, path);
      if (node.lower) visit(node.lower, [...path, 'lowerLimit']);
      if (node.upper) visit(node.upper, [...path, 'upperLimit']);
      visit(node.body, [...path, 'body']);
      if (node.differential) visit(node.differential, [...path, 'differential']);
    } else if (node.type === 'limit') {
      structures.push({ type: 'limit', base: ids(node.base), lower: node.lower ? ids(node.lower) : [], upper: node.upper ? ids(node.upper) : [] });
      visit(node.base, path);
      if (node.lower) visit(node.lower, [...path, 'lowerLimit']);
      if (node.upper) visit(node.upper, [...path, 'upperLimit']);
    } else {
      structures.push({ type: 'script', base: ids(node.base), subscript: node.subscript ? ids(node.subscript) : [], superscript: node.superscript ? ids(node.superscript) : [] });
      visit(node.base, path);
      if (node.subscript) visit(node.subscript, [...path, 'subscript']);
      if (node.superscript) visit(node.superscript, [...path, 'superscript']);
    }
  };
  visit(ast); return { roles, order, bars, styles, texts, structures };
};
for (const entry of annotations.entries) {
  const key = whole ? entry.id : entry.regionId;
  assert(typeof key === 'string' && !seen.has(key)); seen.add(key);
  assert(entry.expected && Array.isArray(entry.expected.order) && entry.expected.order.length > 0);
  const expectedIds = new Set(entry.expected.order);
  assert.equal(expectedIds.size, entry.expected.order.length, 'Annotation cannot duplicate a symbol');
  assert.deepEqual(Object.keys(entry.expected.roles).sort(), [...expectedIds].sort(), 'Every symbol needs a role');
  const styleTruth = Object.entries(entry.symbolStyles || {});
  assert(styleTruth.every(([id, label]) => expectedIds.has(id) && Object.hasOwn(symbolStyles, label)), 'Style annotations must refer to known symbols and styles');
  const textTruth = Object.entries(entry.symbolTexts || {});
  assert(textTruth.every(([id, text]) => expectedIds.has(id) && typeof text === 'string' && text.length > 0 && text.length <= 1000));
  assert(entry.structures === undefined || Array.isArray(entry.structures) && entry.structures.length <= 1024);
  let record = regions.get(entry.regionId);
  const identity = whole ? { annotationId: entry.id } : { regionId: entry.regionId };
  if (whole) {
    for (const id of expectedIds) {
      const sourceKey = `${entry.page}:${id}`;
      assert(!annotatedSources.has(sourceKey), 'Whole formulas must not count the same source symbol twice'); annotatedSources.add(sourceKey);
    }
    const page = document.pages.find(page => page.number === entry.page);
    assert(page, 'Annotation page must exist'); assert(validRect(entry.rect) && entry.rect.width > 0 && entry.rect.height > 0);
    const boundedIds = page.sources.filter(source => validRect(source.rect) && contains(entry.rect, source.rect, 0)
      && !['excluded-hidden', 'redraw'].includes(source.disposition) && source.text?.trim()).map(source => source.id);
    assert.deepEqual([...new Set(boundedIds)].sort(), [...expectedIds].sort(), 'Whole-formula bounds must cover exactly the annotated visible symbols');
    const sources = new Map(page.sources.map(source => [source.id, source]));
    const wrongSymbols = textTruth.filter(([id, text]) => sources.get(id)?.text !== text)
      .map(([id, text]) => ({ id, expected: text, actual: sources.get(id)?.text }));
    if (wrongSymbols.length) { results.push({ ...identity, status: 'source-symbol-mismatch', differences: { texts: wrongSymbols } }); continue; }
    const owners = [...regions.values()].filter(item => item.page === entry.page && item.region.sourceIds?.some(id => expectedIds.has(id)));
    if (owners.length !== 1) {
      results.push({ ...identity, status: owners.length ? 'fragmented' : 'missing-region', owners: owners.map(item => item.region.id) }); continue;
    }
    record = owners[0];
    const ids = new Set(record.region.sourceIds);
    assert.equal(ids.size, record.region.sourceIds.length, 'A formula owner cannot duplicate source symbols');
    const extra = [...ids].filter(id => !expectedIds.has(id)), missing = [...expectedIds].filter(id => !ids.has(id));
    if (extra.length || missing.length) {
      results.push({ ...identity, regionId: record.region.id, status: 'mixed-content', extraSourceIds: extra, missingSourceIds: missing }); continue;
    }
    identity.boundaryComplete = true; identity.regionId = record.region.id;
  }
  if (!record) { results.push({ ...identity, status: 'missing-region' }); continue; }
  assert.equal(entry.page, record.page, 'Annotation page must match its region');
  const { region } = record;
  const ast = inferMathAst(region);
  if (!ast) { results.push({ ...identity, status: 'fallback' }); continue; }
  let matches = true;
  const { styles, texts, structures, ...actual } = evidence(ast, region);
  try { assert.deepEqual(actual, entry.expected); } catch { matches = false; }
  const styleDifferences = styleTruth.filter(([id, label]) => JSON.stringify(styles[id]) !== JSON.stringify(symbolStyles[label]))
    .map(([id, label]) => ({ id, expected: symbolStyles[label], actual: styles[id] }));
  if (styleDifferences.length) matches = false;
  const textDifferences = textTruth.filter(([id, text]) => texts[id] !== text).map(([id, text]) => ({ id, expected: text, actual: texts[id] }));
  const wrongStructure = entry.structures !== undefined && structuresKey(entry.structures) !== structuresKey(structures);
  if (textDifferences.length || wrongStructure) matches = false;
  const differing = key => [...new Set([...Object.keys(actual[key]), ...Object.keys(entry.expected[key] || {})])]
    .filter(id => JSON.stringify(actual[key][id]) !== JSON.stringify(entry.expected[key]?.[id]))
    .map(id => ({ id, expected: entry.expected[key]?.[id], actual: actual[key][id] }));
  results.push({ ...identity, status: matches ? 'matched' : 'semantic-mismatch',
    ...(whole ? { styleLabels: styleTruth.length, stylesComplete: styleTruth.length === expectedIds.size,
      symbolTextsComplete: textTruth.length === expectedIds.size, structuresComplete: entry.structures !== undefined } : {}),
    ...(!matches ? { differences: { roles: differing('roles'), bars: differing('bars'),
      order: JSON.stringify(actual.order) !== JSON.stringify(entry.expected.order), ...(styleDifferences.length ? { styles: styleDifferences } : {}),
      ...(textDifferences.length ? { texts: textDifferences } : {}), ...(wrongStructure ? { structures: { expected: entry.structures, actual: structures } } : {}) } } : {}) });
}
const matched = results.filter(result => result.status === 'matched').length;
const report = { schemaVersion: annotations.schemaVersion, sourceSha256: digest, unit: annotations.unit, annotated: results.length, matched,
  mismatched: results.filter(result => result.status === 'semantic-mismatch').length,
  fallback: results.filter(result => result.status === 'fallback').length,
  missing: results.filter(result => result.status === 'missing-region').length,
  ...(whole ? { boundaryComplete: results.filter(result => result.boundaryComplete).length,
    fragmented: results.filter(result => result.status === 'fragmented').length,
    mixedContent: results.filter(result => result.status === 'mixed-content').length,
    sourceSymbolMismatched: results.filter(result => result.status === 'source-symbol-mismatch').length,
    symbolStylesVerified: results.every(result => result.stylesComplete && result.status === 'matched'),
    annotatedSemanticsVerified: results.every(result => result.status === 'matched' && result.boundaryComplete
      && result.stylesComplete && result.symbolTextsComplete && result.structuresComplete) } : {}),
  independentCorpusComplete: false, overallAccepted: false, results };
await writeFile(reportPath, JSON.stringify(report, null, 2));
const { results: details, sourceSha256, ...summary } = report; console.log(JSON.stringify(summary, null, 2));
if (matched !== results.length) process.exitCode = 2;
