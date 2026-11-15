import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { saveDonationQr } from '../src/app/donation-qr-runtime.js';

for (const [kind, name] of [['alipay', 'ToolKnit-Alipay.png'], ['wechat', 'ToolKnit-WeChat.png']]) {
  const png = await readFile(new URL(`../public/assets/donate/${name}`, import.meta.url));
  const written = [];
  const options = {
    isTauri: true,
    loadDialog: async () => ({ save: async options => {
      assert.equal(options.defaultPath, name);
      assert.deepEqual(options.filters, [{ name: 'PNG', extensions: ['png'] }]);
      return `C:/synthetic-output/${name}`;
    } }),
    fetchAsset: async (url, options) => {
      assert.equal(url, `/assets/donate/${name}`);
      assert.ok(Object.hasOwn(options, 'signal'));
      return { ok: true, arrayBuffer: async () => png };
    },
    core: Promise.resolve({ invoke: async (command, value) => { written.push({ command, value }); } })
  };
  assert.equal(await saveDonationQr(kind, options), true);
  assert.equal(written.length, 1);
  assert.equal(written[0].command, 'write_file_bytes');
  assert.deepEqual(Buffer.from(written[0].value.bytes), png, 'save preserves the supplied PNG exactly');
  assert.equal(await saveDonationQr(kind, { ...options, loadDialog: async () => ({ save: async () => null }) }), false);
  const owner = new AbortController();
  assert.equal(await saveDonationQr(kind, { ...options, signal: owner.signal,
    loadDialog: async () => ({ save: async () => { owner.abort(); return 'C:/synthetic-output/late.png'; } }) }), false);
  assert.equal(written.length, 1, 'cancel/close does not write a file');
  await assert.rejects(saveDonationQr(kind, { ...options,
    fetchAsset: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1,2,3]) }) }), /Invalid support image/);
  const elements = [];
  assert.equal(await saveDonationQr(kind, {
    documentRef: { createElement: () => ({ click() { this.clicked = true; }, remove() { this.removed = true; } }),
      body: { append: node => elements.push(node) } }
  }), true);
  assert.equal(elements[0].href, `/assets/donate/${name}`);
  assert.equal(elements[0].download, name);
  assert(elements[0].clicked && elements[0].removed);
}
for (const invalid of ['__proto__', 'constructor', '../private.png', 'other']) {
  await assert.rejects(saveDonationQr(invalid), /Unknown support image/);
}
console.log('Support QR download passed: both original PNGs, browser/native save, cancellation, stale session and invalid inputs.');
