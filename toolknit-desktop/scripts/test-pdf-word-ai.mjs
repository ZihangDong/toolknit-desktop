import assert from 'node:assert/strict';
import { planAiScopes, aiScopePayload, validateAiScope, applyAiScope } from '../src/features/pdf-to-word/core/ai-v2.js';
import { createWordAiCache, runWordAi, wordInputDigest, boundedAiWork } from '../src/features/pdf-to-word/ai-runtime.js';
import { LIMITS, wordError } from '../src/features/pdf-to-word/core/input.js';
import { validateCoverage } from '../src/features/pdf-to-word/core/layout.js';
import { aiBatchRequest, validateAiBatch, planAiBatches, compactAiBatch, layoutInstruction } from '../src/features/pdf-to-word/core/ai-batch.js';
import { requestAiCompletion } from '../src/ai-provider-core.js';
import { resultTargets, applyResultEdits } from '../src/features/pdf-to-word/core/result-edit.js';

const rect = (x, y, width = 45, height = 10) => ({ x, y, width, height });
const paragraph = (id, x, y) => ({ id: `${id}:paragraph`, type: 'paragraph', role: 'paragraph', sourceIds: [id], rect: rect(x, y),
  lines: [{ text: id, sourceIds: [id], rect: rect(x, y), items: [{ id, type: 'text', text: id, sourceIds: [id], rect: rect(x, y) }] }] });
const page = (number = 1) => {
  const a = paragraph(`a${number}`, 10, 20), b = paragraph(`b${number}`, 80, 20), c = paragraph(`c${number}`, 10, 60);
  const column = { id: `columns${number}`, type: 'columns', rect: rect(10, 20, 115, 10), sourceIds: [...a.sourceIds, ...b.sourceIds],
    columns: [{ rect: a.rect, blocks: [a] }, { rect: b.rect, blocks: [b] }] };
  const table = { id: `table${number}`, type: 'table', rect: c.rect, sourceIds: c.sourceIds,
    cells: [{ row: 0, col: 0, rect: c.rect, blocks: [c] }] };
  return { number, width: 200, height: 300, header: [], footer: [], blocks: [column, table],
    content: rect(10, 20, 115, 50), risks: [], evidence: ['columns'],
    sources: [a, b, c].map(block => ({ id: block.sourceIds[0], text: block.lines[0].text, disposition: 'editable' }))
      .concat({ id: `hidden${number}`, text: 'PRIVATE-REDACTED-SENTINEL', disposition: 'excluded-hidden' }) };
};
const document = { schemaVersion: 1, pages: [page()] };
const identity = request => Object.fromEntries(['schemaVersion', 'requestId', 'inputDigest', 'sourceDigest', 'page', 'scopeId'].map(key => [key, request[key]]));
const response = request => ({ ...identity(request), groups: request.regions.map((region, i) => ({ id: `g${i}`, role: 'paragraph', sourceIds: [region.id] })),
  readingOrder: request.regions.map((_, i) => `g${i}`) });
const batchResponse = request => request.schemaVersion === 2 ? response(request)
  : { schemaVersion: 3, requestId: request.requestId, inputDigest: request.inputDigest, sourceDigest: request.sourceDigest, page: request.page,
    scopes: request.scopes.map(scope => ({ scopeId: scope.scopeId, groups: response(scope).groups, readingOrder: response(scope).readingOrder })) };
const digest = await wordInputDigest(new Uint8Array([1, 2, 3]));
const scopes = planAiScopes(document, [1]);
assert.equal(scopes.length, 3);
assert(scopes.every(scope => scope.path.length === 1));
const request = { ...aiScopePayload(document.pages[0], scopes[0]), requestId: 'request', inputDigest: digest, sourceDigest: digest };
assert(!JSON.stringify(request).includes('PRIVATE-REDACTED-SENTINEL'));
assert.equal(request.regions.length, 1);
assert(!request.allowedRoles.includes('columns'), 'nested Word columns are not supported by the flow writer');
let suggestion = validateAiScope(JSON.stringify(response(request)), request);
const applied = applyAiScope(document, scopes[0], request, suggestion);
assert.equal(validateCoverage(applied).editableCharacters, validateCoverage(document).editableCharacters);
assert.deepEqual(applied.pages[0].blocks[0].columns[1], document.pages[0].blocks[0].columns[1]);
assert.deepEqual(applied.pages[0].blocks[1], document.pages[0].blocks[1]);
for (const change of [value => { value.scopeId = 'other'; }, value => { value.sourceDigest = 'changed'; },
  value => { value.inputDigest = 'changed'; }, value => { value.requestId = 'stale'; }, value => { value.page = 2; },
  value => { value.schemaVersion = 1; }, value => { value.text = 'rewritten'; },
  value => { value.groups[0].sourceIds.push('b1:paragraph'); }, value => { value.groups[0].sourceIds.push(value.groups[0].sourceIds[0]); },
  value => { value.groups[0].text = 'rewrite'; }, value => { value.groups[0].role = 'xml'; },
  value => { value.readingOrder.push('invented'); }, value => { value.mathCandidates = []; }]) {
  const invalid = response(request); change(invalid); assert.throws(() => validateAiScope(JSON.stringify(invalid), request), /ai-response/);
}
assert.throws(() => validateAiScope(' '.repeat(LIMITS.aiResponseBytes + 1), request), /ai-response/);

const math = { id: 'formula', type: 'image', role: 'math', rect: rect(10, 100), sourceIds: ['x'], reasons: [],
  mathGlyphs: [{ id: 'x', text: 'x', rect: rect(10, 100, 7, 9), baseline: 109, size: 12, bold: false, italic: true }], mathStrokes: [] };
const withMath = structuredClone(document);
withMath.pages[0].blocks.push(math); withMath.pages[0].sources.push({ id: 'x', text: 'x', disposition: 'visible-image' });
const mathScope = planAiScopes(withMath).find(scope => scope.kind === 'math');
const mathRequest = { ...aiScopePayload(withMath.pages[0], mathScope), requestId: 'math', inputDigest: digest, sourceDigest: digest };
const ast = { type: 'symbol', sourceId: 'x', text: 'x', bold: false, italic: true };
const mathResponse = { ...identity(mathRequest), mathCandidates: [{ id: 'formula', ast }] };
validateAiScope(JSON.stringify(mathResponse), mathRequest);
const mathResult = applyAiScope(withMath, mathScope, mathRequest, mathResponse);
assert.equal(mathResult.pages[0].blocks.at(-1).type, 'image');
assert.equal(mathResult.pages[0].blocks.at(-1).aiReview.status, 'needs-review');
assert.equal(mathResult.quality.editableCharacters, validateCoverage(document).editableCharacters);
assert.equal(mathResult.quality.imageCharacters, 1);
for (const candidate of [{ ...ast, text: 'y' }, { ...ast, sourceId: 'hidden1' }, { ...ast, latex: '\\input{secret}' },
  { type: 'row', children: [ast, ast] }, { type: 'matrix', rows: [] }]) {
  assert.throws(() => validateAiScope(JSON.stringify({ ...mathResponse, mathCandidates: [{ id: 'formula', ast: candidate }] }), mathRequest), /ai-response/);
}
let deep = ast;
for (let i = 0; i < 30; i++) deep = { type: 'script', base: deep, superscript: ast };
assert.throws(() => validateAiScope(JSON.stringify({ ...mathResponse, mathCandidates: [{ id: 'formula', ast: deep }] }), mathRequest));
const bracketRequest = structuredClone(mathRequest);
bracketRequest.math.glyphs = [['open', '('], ['value', 'x'], ['close', ')'], ['power', '2']].map(([id, text], index) =>
  ({ ...mathRequest.math.glyphs[0], id, text, italic: false, bold: false, rect: rect(10 + index * 6, 100, 5, 8) }));
const bracketSymbols = bracketRequest.math.glyphs.map(({ id, text }) => ({ type: 'symbol', sourceId: id, text, italic: false, bold: false }));
Object.assign(bracketRequest.math.glyphs[3], { size: 7, baseline: 104, rect: rect(29, 99, 4, 5) });
const bracketAst = { type: 'script', base: { type: 'row', children: bracketSymbols.slice(0, 3) }, superscript: bracketSymbols[3] };
validateAiScope(JSON.stringify({ ...identity(bracketRequest), mathCandidates: [{ id: 'formula', ast: bracketAst }] }), bracketRequest);
const badBracketAst = { type: 'row', children: [...bracketSymbols.slice(0, 2),
  { type: 'script', base: bracketSymbols[2], superscript: bracketSymbols[3] }] };
assert.throws(() => validateAiScope(JSON.stringify({ ...identity(bracketRequest),
  mathCandidates: [{ id: 'formula', ast: badBracketAst }] }), bracketRequest), /ai-response/,
  'an AI candidate with all source symbols still cannot attach a power only to the closing delimiter');
const limitRequest = structuredClone(mathRequest);
limitRequest.math.glyphs = [
  { ...mathRequest.math.glyphs[0], id: 'operator', text: 'min', italic: false, bold: false, size: 12, baseline: 110, rect: rect(10, 101.6, 18, 8.4) },
  { ...mathRequest.math.glyphs[0], id: 'index', text: 'i', italic: true, bold: false, size: 7, baseline: 117, rect: rect(17, 112.1, 4, 4.9) },
];
const limitAst = { type: 'limit', base: { type: 'symbol', sourceId: 'operator', text: 'min', italic: false, bold: false },
  lower: { type: 'symbol', sourceId: 'index', text: 'i', italic: true, bold: false } };
validateAiScope(JSON.stringify({ ...identity(limitRequest), mathCandidates: [{ id: 'formula', ast: limitAst }] }), limitRequest);
for (const wrong of [{ type: 'script', base: limitAst.base, subscript: limitAst.lower },
  { type: 'limit', base: limitAst.base, upper: limitAst.lower }]) {
  assert.throws(() => validateAiScope(JSON.stringify({ ...identity(limitRequest),
    mathCandidates: [{ id: 'formula', ast: wrong }] }), limitRequest), /ai-response/, 'centered lower evidence cannot become a side index or upper limit');
}
const uncertain = structuredClone(withMath); uncertain.pages[0].blocks.at(-1).mathGlyphs[0].raster = true;
assert(!planAiScopes(uncertain).some(scope => scope.kind === 'math'));
const hiddenMath = structuredClone(withMath); hiddenMath.pages[0].blocks.at(-1).mathGlyphs[0].id = 'hidden1';
assert(!planAiScopes(hiddenMath).some(scope => scope.kind === 'math'));
const styled = structuredClone(withMath), styledRegion = styled.pages[0].blocks.at(-1);
Object.assign(styledRegion.mathGlyphs[0], { text: 'F', italic: false, alphabet: 'script' });
styled.pages[0].sources.find(item => item.id === 'x').text = 'F';
const styledScope = planAiScopes(styled).find(scope => scope.kind === 'math');
const styledRequest = { ...mathRequest, ...aiScopePayload(styled.pages[0], styledScope) };
assert.equal(styledRequest.math.glyphs[0].alphabet, 'script');
const styledAst = { ...ast, text: 'F', italic: false, alphabet: 'script' };
const styledResponse = { ...identity(styledRequest), mathCandidates: [{ id: 'formula', ast: styledAst }] };
validateAiScope(JSON.stringify(styledResponse), styledRequest);
const flattenedStyle = structuredClone(styledResponse); delete flattenedStyle.mathCandidates[0].ast.alphabet;
assert.throws(() => validateAiScope(JSON.stringify(flattenedStyle), styledRequest), /ai-response/);
styledRegion.mathGlyphs[0].mathStyleUncertain = true;
assert(!planAiScopes(styled).some(scope => scope.kind === 'math'));
const withRoot = structuredClone(withMath), rootRegion = withRoot.pages[0].blocks.at(-1);
const rootPoints = [[2, 106], [3, 105], [5, 110], [8, 98], [20, 98]];
rootRegion.mathStrokes = rootPoints.slice(0, -1).map((from, segment) => {
  const to = rootPoints[segment + 1];
  return { id: `root-${segment}`, thin: true, rect: rect(Math.min(from[0], to[0]), Math.min(from[1], to[1]),
    Math.abs(from[0] - to[0]) + .2, Math.abs(from[1] - to[1]) + .2),
  path: { id: 'root', segment, from, to, paint: 'stroke', color: '000000', complete: true } };
});
rootRegion.rect = rect(2, 98, 20, 12);
const rootScope = planAiScopes(withRoot).find(scope => scope.kind === 'math');
const rootRequest = { ...aiScopePayload(withRoot.pages[0], rootScope), requestId: 'root', inputDigest: digest, sourceDigest: digest };
const rootResponse = { ...identity(rootRequest), mathCandidates: [{ id: 'formula', ast: {
  type: 'radical', strokeIds: rootRegion.mathStrokes.map(stroke => stroke.id), radicand: ast } }] };
validateAiScope(JSON.stringify(rootResponse), rootRequest);
assert.equal(applyAiScope(withRoot, rootScope, rootRequest, rootResponse).pages[0].blocks.at(-1).aiReview.status, 'needs-review',
  'source-bound radicals remain pending review, not automatically native output');
const partialRoot = structuredClone(withRoot);
partialRoot.pages[0].blocks.at(-1).mathStrokes[0].path.complete = false;
partialRoot.pages[0].blocks.at(-1).mathStrokes[0].path.from = [12345, 67890];
const partialRequest = { ...rootRequest, ...aiScopePayload(partialRoot.pages[0], rootScope) };
assert.equal(partialRequest.math.strokes[0].path, undefined, 'clipped path coordinates cannot leave the local scene');
assert(!JSON.stringify(partialRequest).includes('12345'));
assert.throws(() => validateAiScope(JSON.stringify(rootResponse), partialRequest), /ai-response/,
  'incomplete path evidence cannot justify a radical candidate');

const provider = { url: 'https://fixture.invalid/v1/chat/completions', model: 'fixture' };
const operation = () => ({ abort: new AbortController(), check() { if (this.abort.signal.aborted) throw wordError('cancelled'); } });
const image = 'data:image/png;base64,fixture';
const cache = createWordAiCache(); let calls = 0, renders = 0;
const options = { document, inputDigest: digest, expectedProvider: provider, cache,
  renderRegion: async () => { renders++; return image; },
  requestAi: async messages => { calls++; return JSON.stringify(batchResponse(JSON.parse(messages[1].content[0].text))); } };
const run = extra => runWordAi({ ...options, operation: operation(), ...extra });
const first = await run(); assert.equal(first.review.reviewed, 3); assert.equal(first.review.remaining, 0);
const firstTargets = resultTargets(first.document.pages[0]);
assert.equal(new Set(firstTargets.map(target => target.key)).size, firstTargets.length, 'same group ids from different scopes cannot alias edit targets');
const oneDeleted = applyResultEdits(first.document, { [firstTargets[0].key]: { type: 'delete' } });
assert.equal(validateCoverage(oneDeleted).editableCharacters, 4, 'deleting one AI result must leave other scopes intact');
assert.equal(calls, 1); assert.equal(renders, 1);
const layoutOnly = await run({ document: withMath, cache: createWordAiCache(), layoutOnly: true,
  renderRegion: async () => image,
  requestAi: async messages => {
    const request = JSON.parse(messages[1].content[0].text);
    assert.notEqual(request.kind, 'math', 'the workbench does not request unusable formula proposals');
    return JSON.stringify(batchResponse(request));
  } });
assert.equal(layoutOnly.review.total, 3); assert.equal(layoutOnly.review.pendingMath, 0);
assert.equal(layoutOnly.document.pages[0].blocks.at(-1).aiReview, undefined);
assert.equal(layoutOnly.document.pages[0].blocks.at(-1).type, 'image');
const second = await run(); assert.equal(second.review.cached, 3); assert.equal(calls, 1); assert.equal(renders, 1);
await run({ expectedProvider: { ...provider, model: 'other' } }); assert.equal(calls, 2);
await run({ inputDigest: await wordInputDigest(new Uint8Array([4])) }); assert.equal(calls, 3);
cache.clear(); await run(); assert.equal(calls, 4);

const partialCache = createWordAiCache(); let failedCalls = 0;
const twoPages = { schemaVersion: 1, pages: [page(1), page(2)] };
await assert.rejects(run({ document: twoPages, cache: partialCache, requestAi: async messages => {
  failedCalls++; if (failedCalls === 2) throw wordError('network_error');
  return JSON.stringify(batchResponse(JSON.parse(messages[1].content[0].text)));
} }), /network_error/);
assert.equal(partialCache.size, 3);
const retried = await run({ document: twoPages, cache: partialCache }); assert.equal(retried.review.cached, 3); assert.equal(retried.requests, 1);
const limited = await run({ document: twoPages, cache: createWordAiCache(), limits: { ...LIMITS, aiRegions: 1 } });
assert.equal(limited.requests, 1); assert.equal(limited.review.remaining, 3); assert.equal(limited.review.reason, 'budget');
const clock = { value: 0 };
const deadlineCache = createWordAiCache();
const timeLimited = await run({ document: twoPages, cache: deadlineCache, now: () => clock.value, limits: { ...LIMITS, aiTotalMs: 10 },
  requestAi: async messages => { clock.value += 7; return JSON.stringify(batchResponse(JSON.parse(messages[1].content[0].text))); } });
assert.equal(timeLimited.review.reason, 'budget'); assert.equal(timeLimited.review.remaining, 3);
assert.equal(validateCoverage(timeLimited.document).characters, validateCoverage(twoPages).characters,
  'a total-budget boundary keeps verified regions and the complete remaining local document');
assert.equal(deadlineCache.size, 3, 'late results never enter the cache');
assert.equal(validateCoverage(document).editableCharacters, 6, 'input document is never partially mutated');

const waiting = [];
const timers = { setTimer: callback => { waiting.push(callback); return callback; }, clearTimer: callback => { const index = waiting.indexOf(callback); if (index >= 0) waiting.splice(index, 1); } };
let lateResolve, childSignal;
const hanging = boundedAiWork(signal => { childSignal = signal; return new Promise(resolve => { lateResolve = resolve; }); },
  { signal: new AbortController().signal, timeoutMs: 1, ...timers });
await Promise.resolve(); waiting[0](); await assert.rejects(hanging, /timeout/); assert(childSignal.aborted); lateResolve('late');
assert.equal(waiting.length, 0);
const aborted = new AbortController();
const pending = boundedAiWork(() => new Promise(() => {}), { signal: aborted.signal, timeoutMs: 1, ...timers });
aborted.abort(); await assert.rejects(pending, /cancelled/); assert.equal(waiting.length, 0);
const changedCache = createWordAiCache();
await assert.rejects(run({ cache: changedCache, requestAi: async messages => {
  changedCache.clear(); return JSON.stringify(batchResponse(JSON.parse(messages[1].content[0].text)));
} }), /cancelled/); assert.equal(changedCache.size, 0);
let currentProvider = provider;
await assert.rejects(run({ cache: createWordAiCache(), getProvider: () => currentProvider, requestAi: async messages => {
  currentProvider = { ...provider, model: 'changed-mid-request' }; return JSON.stringify(batchResponse(JSON.parse(messages[1].content[0].text)));
} }), /ai-config/);
await assert.rejects(run({ cache: createWordAiCache(), limits: { ...LIMITS, aiRequestBytes: 10 } }), /ai-request-large/);
const boundedCache = createWordAiCache();
for (let i = 0; i < 12; i++) boundedCache.set(`k${i}`, { value: 'x'.repeat(250_000) }, boundedCache.revision);
assert(boundedCache.size <= 32 && boundedCache.bytes <= 2 * 1024 * 1024); assert.equal(boundedCache.get('k0'), null);
const detached = boundedCache.get('k11'); detached.value = 'mutated'; assert.notEqual(boundedCache.get('k11').value, 'mutated');
console.log('PDF Word AI v2 passed: nested ownership, hidden evidence, hostile responses, formula review, scoped cache, deadlines, cancellation and late results.');

const batchRequests = scopes.map(scope => ({ ...aiScopePayload(document.pages[0], scope), ...identity(request), scopeId: scope.id }));
const batchRequest = aiBatchRequest(batchRequests), validBatch = batchResponse(batchRequest);
assert.equal(validateAiBatch('```json\n' + JSON.stringify(validBatch) + '\n```', batchRequest, batchRequests).length, 3);
assert.equal(validateAiBatch(JSON.stringify(response(request)), request, [request]).length, 1);
const compact = compactAiBatch(batchRequest, batchRequests), compactReply = batchResponse(compact.request);
assert(compact.request.scopes.every(scope => scope.regions.every(region => /^r\d+$/.test(region.id))));
assert.deepEqual(compact.decode(JSON.stringify(compactReply)).map(value => value.groups[0].sourceIds[0]), batchRequests.map(value => value.regions[0].id));
assert.deepEqual(compact.decode(JSON.stringify(compactReply)).map(value => value.scopeId), batchRequests.map(value => value.scopeId));
const badAlias = structuredClone(compactReply); badAlias.scopes[0].groups[0].sourceIds[0] = 'r999';
assert.throws(() => compact.decode(JSON.stringify(badAlias)), /ai-response/);
const originalAlias = structuredClone(compactReply); originalAlias.scopes[0].groups[0].sourceIds[0] = batchRequests[0].regions[0].id;
assert.throws(() => compact.decode(JSON.stringify(originalAlias)), /ai-response/);
assert(!layoutInstruction(batchRequest).includes('radical'), 'layout prompts do not carry formula reconstruction instructions');
assert(!JSON.stringify(batchRequest).includes('PRIVATE-REDACTED-SENTINEL'));
for (const mutate of [value => value.scopes.pop(), value => { value.scopes[1] = value.scopes[0]; },
  value => { value.requestId = 'stale'; }, value => { value.scopes[0].groups[0].sourceIds = [batchRequests[1].regions[0].id]; },
  value => { value.scopes[0].text = 'rewritten'; }, value => { value.scopes[0].groups[0].rect = rect(0, 0); }]) {
  const invalid = structuredClone(validBatch); mutate(invalid);
  assert.throws(() => validateAiBatch(JSON.stringify(invalid), batchRequest, batchRequests), /ai-response/);
}
assert.throws(() => validateAiBatch('Explanation\n' + JSON.stringify(validBatch), batchRequest, batchRequests), /ai-response/);
assert.throws(() => validateAiBatch(JSON.stringify(validBatch) + JSON.stringify(validBatch), batchRequest, batchRequests), /ai-response/);
assert(planAiBatches(Array.from({ length: 7 }, (_, i) => ({ ...scopes[0], id: 's' + i, ids: Array(20).fill('id') })))
  .every(batch => batch.count <= 64 && batch.scopes.length <= 4));
assert.equal(planAiBatches(scopes, () => 25000).length, 3, 'batching must not overflow the shared text-message limit');
const interleaved = [2, 1, 2, 3, 1].map((page, index) => ({ ...scopes[0], page, id: 's' + index }));
const groupedPages = planAiBatches(interleaved);
assert.deepEqual(groupedPages.map(batch => batch.page), [2, 1, 3]);
assert.deepEqual(groupedPages.map(batch => batch.scopes.map(scope => scope.id)), [['s0', 's2'], ['s1', 's4'], ['s3']],
  'page indexing preserves priority order and independent scope order');

const atomicCache = createWordAiCache();
await assert.rejects(run({ cache: atomicCache, requestAi: async messages => {
  const value = batchResponse(JSON.parse(messages[1].content[0].text)); value.scopes[2].groups[0].sourceIds = ['unknown']; return JSON.stringify(value);
} }), /ai-response/);
assert.equal(atomicCache.size, 0, 'a rejected batch does not cache incomplete suggestions');

const fractionalClock = { value: 0 }; let providerCalls = 0;
const validImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVQImWNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=';
await run({ document: twoPages, cache: createWordAiCache(), now: () => fractionalClock.value,
  renderRegion: async () => validImage, limits: { ...LIMITS, aiTotalMs: 90000, aiRequestMs: 30000 },
  requestAi: async (messages, signal, maxTokens, options) => {
    assert(Number.isInteger(options.timeoutMs));
    const result = await requestAiCompletion({ ...provider, apiKey: 'fixture', messages, signal, maxTokens, timeoutMs: options.timeoutMs,
      nativeRequestImpl: async body => {
        providerCalls++; assert(Number.isInteger(body.timeoutMs));
        if (providerCalls === 2) assert.equal(body.timeoutMs, 29499, 'remaining performance.now budget is floored before native serialization');
        return { content: JSON.stringify(batchResponse(JSON.parse(messages[1].content[0].text))) };
      } });
    fractionalClock.value += providerCalls === 1 ? 60500.5 : 1000;
    return result;
  } });
assert.equal(providerCalls, 2);
console.log('AI batching passed: compact prompts, strict per-scope ownership, fenced JSON, atomic caching and fractional-timeout native boundary.');

const gridPage = page();
gridPage.blocks = [paragraph('top-left', 10, 20), paragraph('top-right', 80, 20),
  paragraph('bottom-left', 10, 60), paragraph('bottom-right', 80, 60)];
gridPage.sources = gridPage.blocks.map(block => ({ id: block.sourceIds[0], text: block.lines[0].text, disposition: 'editable' }));
const gridDocument = { schemaVersion: 1, pages: [gridPage] }, gridScope = planAiScopes(gridDocument)[0];
const gridRequest = { ...aiScopePayload(gridPage, gridScope), requestId: 'grid', inputDigest: digest, sourceDigest: digest };
const gridSuggestion = { ...identity(gridRequest), groups: [{ id: 'table', role: 'table',
  cells: gridPage.blocks.map((block, index) => ({ row: Math.floor(index / 2), col: index % 2,
    rowSpan: 1, colSpan: 1, sourceIds: [block.id] })) }], readingOrder: ['table'] };
assert.equal(applyAiScope(gridDocument, gridScope, gridRequest, gridSuggestion).pages[0].blocks[0].rows, 2);
assert.equal(applyAiScope(gridDocument, gridScope, gridRequest, gridSuggestion).pages[0].blocks[0].borderless, true);
const leftTable = { ...identity(gridRequest), groups: [
  { id: 'left', role: 'table', cells: [0, 2].map((index, row) => ({ row, col: 0, rowSpan: 1, colSpan: 1, sourceIds: [gridPage.blocks[index].id] })) },
  ...[1, 3].map(index => ({ id: 'right' + index, role: 'paragraph', sourceIds: [gridPage.blocks[index].id] }))
], readingOrder: ['left', 'right1', 'right3'] };
const leftResult = applyAiScope(gridDocument, gridScope, gridRequest, leftTable).pages[0].blocks[0];
assert.equal(leftResult.rect.x + leftResult.rect.width, 55, 'an inferred left-column table cannot stretch across the rest of its scope');
const upsideDown = structuredClone(gridSuggestion);
upsideDown.groups[0].cells.forEach(cell => { cell.row = 1 - cell.row; });
assert.throws(() => applyAiScope(gridDocument, gridScope, gridRequest, upsideDown), /ai-response/,
  'complete source coverage must not allow AI to invert invoice/table rows');

const overlapPage = page();
overlapPage.blocks = [paragraph('upper', 10, 20), { id: 'fixed', type: 'image', rect: rect(10, 25), sourceIds: [] }, paragraph('lower', 10, 60)];
overlapPage.sources = overlapPage.blocks.filter(block => block.type === 'paragraph')
  .map(block => ({ id: block.sourceIds[0], text: block.lines[0].text, disposition: 'editable' }));
const overlapDocument = { schemaVersion: 1, pages: [overlapPage] }, overlapScope = planAiScopes(overlapDocument)[0];
const overlapRequest = { ...aiScopePayload(overlapPage, overlapScope), requestId: 'overlap', inputDigest: digest, sourceDigest: digest };
assert.equal(applyAiScope(overlapDocument, overlapScope, overlapRequest, response(overlapRequest)).quality.characters, 10,
  'role-only changes retain pre-existing overlap without moving source text');
const crossedPage = structuredClone(overlapPage);
crossedPage.blocks = [crossedPage.blocks[0], crossedPage.blocks[2], { ...crossedPage.blocks[1], rect: rect(10, 40) }];
const crossedDocument = { schemaVersion: 1, pages: [crossedPage] }, crossedScope = planAiScopes(crossedDocument)[0];
const crossedRequest = { ...aiScopePayload(crossedPage, crossedScope), requestId: 'cross', inputDigest: digest, sourceDigest: digest };
const crossing = { ...identity(crossedRequest), groups: [{ id: 'merged', role: 'paragraph', sourceIds: crossedScope.ids }], readingOrder: ['merged'] };
assert.throws(() => applyAiScope(crossedDocument, crossedScope, crossedRequest, crossing), /ai-response/,
  'new grouping cannot bridge through a fixed object even if every text source is present');
