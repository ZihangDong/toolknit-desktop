import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPageTransitionRuntime } from '../src/app/page-transition-runtime.js';

const [runtime, styles, registry, shell, app, help] = await Promise.all([
  readFile('src/app/page-transition-runtime.js', 'utf8'),
  readFile('src/styles/components/page-transitions.css', 'utf8'),
  readFile('src/app/lazy-tool-registry.js', 'utf8'),
  readFile('src/shared/tool-page-shell.js', 'utf8'),
  readFile('src/application-runtime.js', 'utf8'),
  readFile('src/app/help-center-runtime.js', 'utf8')
]);

assert.match(runtime, /createLifecycleScope/);
assert.match(runtime, /dataset\.tkPageTransitionVeil/);
assert.match(runtime, /setAttribute\('inert', ''\)/);
assert.match(runtime, /request === sequence/);
assert.match(runtime, /tk-theme-switching/);
assert.match(styles, /tk-theme-switching/);
assert.match(runtime, /finally/);
assert.match(runtime, /prefers-reduced-motion/);
assert.match(styles, /\.tk-page-transition-veil\.is-active/);
assert.match(styles, /\.tk-page-transition-veil\.is-revealing/);
assert.match(styles, /pointer-events:\s*auto/);
assert.match(styles, /background:\s*var\(--tk-page-bg\)/);
assert.match(styles, /\.tk-page-transition-veil\.is-active[\s\S]*?opacity:\s*1/);
assert.match(styles, /transition:\s*opacity\s+250ms\s+ease/);
assert.match(styles, /transition-duration:\s*350ms/);
assert.match(runtime, /DEFAULT_COVER_MS\s*=\s*250/);
assert.match(runtime, /DEFAULT_REVEAL_MS\s*=\s*350/);
assert.match(styles, /prefers-reduced-motion/);
assert.match(styles, /html:not\(\.tk-theme-switching\) \.tk-page-transition-veil/);
assert.match(registry, /pageTransition/);
assert.match(shell, /onToolBack/);
assert.match(app, /createPageTransitionRuntime/);
assert.match(app, /pageTransition/);
assert.match(help, /pageTransition/);

function fakeElement() {
  const classes = new Set();
  return {
    classList: {
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    dataset: {},
    style: { removeProperty(name) { delete this[name]; } },
    attributes: {},
    isConnected: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    append() {},
    remove() { this.isConnected = false; }
  };
}

const documentRef = {
  body: {
    children: [],
    append(node) { node.isConnected = true; this.children.push(node); }
  },
  createElement() { return fakeElement(); }
};
const windowRef = { matchMedia: () => ({ matches: false }) };
const transition = createPageTransitionRuntime({ documentRef, windowRef, coverMs: 1, revealMs: 1 });
assert.equal(await transition.run(() => 'completed'), 'completed');
assert.equal(documentRef.body.children.length, 1);
assert.equal(documentRef.body.children[0].classList.contains('is-active'), false);
assert.equal(documentRef.body.children[0].attributes['aria-hidden'], 'true');
transition.dispose();

const reducedDocument = { ...documentRef, body: { children: [], append() {} } };
const reducedTransition = createPageTransitionRuntime({
  documentRef: reducedDocument,
  windowRef: { matchMedia: () => ({ matches: true }) }
});
assert.equal(await reducedTransition.run(() => 'reduced'), 'reduced');
assert.equal(reducedDocument.body.children.length, 0);
reducedTransition.dispose();

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function harness() {
  const doc = {
    ...documentRef,
    body: { children: [], append(node) { node.isConnected = true; this.children.push(node); } },
    getAnimations: () => []
  };
  const startStyles = [];
  const view = { ...windowRef, getComputedStyle(node) {
    startStyles.push(node.classList.contains('is-active'));
    return { opacity: node.classList.contains('is-active') ? '1' : '0' };
  } };
  const runtime = createPageTransitionRuntime({ documentRef: doc, windowRef: view, coverMs: 1, revealMs: 1 });
  return { doc, runtime, startStyles, veil: () => doc.body.children.at(-1) };
}
{
  const themeAction = deferred();
  const reducedThemeDocument = {
    ...documentRef,
    body: { children: [], append(node) { node.isConnected = true; this.children.push(node); } },
    documentElement: { classList: { toggle() {} } },
    getAnimations: () => []
  };
  const reducedTheme = createPageTransitionRuntime({
    documentRef: reducedThemeDocument,
    windowRef: { matchMedia: () => ({ matches: true }) },
    coverMs: 1,
    revealMs: 1
  });
  const pendingTheme = reducedTheme.run(() => themeAction.promise, { replaceable: false, mode: 'theme' });
  await tick();
  const themeVeil = reducedThemeDocument.body.children[0];
  assert.ok(themeVeil, 'theme changes must still create a veil under reduced motion');
  assert.equal(themeVeil.classList.contains('is-active'), true, 'theme changes must stay covered before apply');
  themeAction.resolve('theme-ready');
  assert.equal(await pendingTheme, 'theme-ready');
  assert.equal(themeVeil.style.visibility, 'hidden');
  reducedTheme.dispose();
}
{
  const h = harness();
  const pageFade = deferred();
  const backgroundLoop = new Promise(() => {});
  h.doc.getAnimations = () => [
    { effect: { target: { matches: () => true } }, transitionProperty: 'opacity', finished: pageFade.promise },
    { effect: { target: { matches: () => false } }, transitionProperty: 'opacity', finished: backgroundLoop },
    { effect: { target: { matches: () => true } }, finished: backgroundLoop }
  ];
  const action = deferred();
  const pending = h.runtime.run(() => action.promise);
  await tick();
  assert.deepEqual(h.startStyles, [false], 'first cover must establish a transparent start style');
  assert.equal(h.veil().classList.contains('is-active'), true, 'async action stays covered');
  action.resolve('ready');
  await tick();
  assert.equal(h.veil().classList.contains('is-active'), true, 'JS readiness is not CSS readiness');
  assert.equal(h.veil().classList.contains('is-revealing'), false, 'never reveal a translucent page');
  pageFade.resolve();
  assert.equal(await pending, 'ready', 'page fade completion must release the curtain without waiting on background loops');
  assert.equal(h.veil().style.visibility, 'hidden');
  await assert.rejects(h.runtime.run(() => { throw new Error('test failure'); }), /test failure/);
  assert.equal(h.veil().style.opacity, '0', 'failed navigation must also remove the curtain');
  h.runtime.dispose();
}
{
  const h = harness();
  const calls = [];
  const old = h.runtime.run(() => calls.push('old'));
  const latest = h.runtime.run(() => calls.push('latest'));
  await Promise.all([old, latest]);
  assert.deepEqual(calls, ['latest']);
  h.runtime.dispose();
}
{
  const h = harness();
  const calls = [];
  const old = h.runtime.run(() => calls.push('old'));
  const theme = h.runtime.run(() => calls.push('theme'), { replaceable: false });
  const latest = h.runtime.run(() => calls.push('latest'));
  await Promise.all([old, theme, latest]);
  assert.deepEqual(calls, ['theme', 'latest'], 'theme and latest navigation both execute');
  calls.length = 0;
  await Promise.all([
    h.runtime.run(() => calls.push('navigation')),
    h.runtime.run(() => calls.push('theme'), { replaceable: false })
  ]);
  assert.deepEqual(calls, ['navigation', 'theme'], 'theme does not discard navigation');
  h.runtime.dispose();
}
for (const phase of ['cover', 'action', 'page-fade']) {
  const h = harness();
  const pendingAction = deferred();
  h.doc.getAnimations = () => phase === 'page-fade'
    ? [{ effect: { target: { matches: () => true } }, transitionProperty: 'opacity', finished: new Promise(() => {}) }]
    : [];
  const pending = h.runtime.run(() => phase === 'action' ? pendingAction.promise : undefined);
  if (phase === 'cover') await Promise.resolve();
  else await tick();
  h.runtime.dispose();
  pendingAction.resolve();
  await pending;
  assert.equal(h.doc.body.children.length, 1, `${phase}: disposal must not recreate a veil`);
  assert.equal(h.veil().isConnected, false);
  h.runtime.dispose();
}
{
  const h = harness();
  h.doc.getAnimations = () => [{ effect: { target: { matches: () => true } },
    transitionProperty: 'opacity', finished: new Promise(() => {}) }];
  assert.equal(await h.runtime.run(() => 'restored'), 'restored', 'lost animation completion cannot strand navigation');
  assert.equal(h.veil().style.visibility, 'hidden');
  h.doc.getAnimations = () => [];
  assert.equal(await h.runtime.run(() => 'next'), 'next', 'navigation still works after animation timeout');
  h.runtime.dispose();
}
console.log('Page transition runtime ownership, cancellation and integration contracts passed');
