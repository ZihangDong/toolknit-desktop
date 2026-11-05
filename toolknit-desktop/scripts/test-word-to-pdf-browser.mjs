// Interactive browser regression; the fixture tests injected native transport
// separately from test-word-to-pdf-native.mjs, which executes real Office jobs.
import { createServer } from 'vite';
import { access } from 'node:fs/promises';
import { pdfjsAssets } from './lib/pdfjs-assets.mjs';
await access('tmp/word-pdf-native/single.pdf').catch(() => {
  throw new Error(
    'Run npm run test:word-to-pdf-native first to create the real PDF fixture.',
  );
});
const server = await createServer({
  configFile: false,
  plugins: [pdfjsAssets()],
  server: { host: '127.0.0.1', port: 0, open: false, hmr: false, watch: { ignored: ['**/tmp/**', '**/src-tauri/**', '**/cli/vendor/**', '**/cli/resources/**'] } },
  optimizeDeps: { entries: ['scripts/fixtures/word-to-pdf-browser.html'] },
});
await server.listen();
console.log(
  server.resolvedUrls.local[0] + 'scripts/fixtures/word-to-pdf-browser.html',
);
console.log(
  'Open the local page and click Run regression. Check Light/Dark and English/中文. Ctrl+C closes the server.',
);
