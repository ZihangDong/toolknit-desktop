import { defineConfig } from "vite";
import { fileURLToPath } from 'node:url';
import { pdfjsAssets } from './scripts/lib/pdfjs-assets.mjs';

const desktopRoot = fileURLToPath(new URL('.', import.meta.url)).replaceAll('\\', '/');
const generatedPaths = ['cli/lib/core', 'cli/lib/shared', 'tmp', 'output', '.cache', '.codex-build']
  .map(directory => desktopRoot + directory + '/**');

export default defineConfig(async ({ mode }) => ({
  plugins: [pdfjsAssets()],
  clearScreen: false,
  server: {
    // Tauri's Windows WebView resolves the trusted development origin as
    // localhost. Listen on IPv4 so that the WebView can reach it even when
    // Node's default localhost binding prefers IPv6.
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    hmr: mode !== 'tauri-debug',
    watch: {
      // Generated files are replaced or locked by conversion/build tasks.
      // Keep them out of HMR to avoid redundant reloads and Windows EBUSY.
      ignored: [
        "**/src-tauri/**", "**/cli/vendor/**", "**/cli/resources/**", "**/cli/*.tgz",
        ...generatedPaths,
      ],
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        main: "index.html",
        screenshot: "screenshot.html",
        fileSearch: "file-search.html",
      },
    },
  },
}));
