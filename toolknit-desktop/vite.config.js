import { defineConfig } from "vite";
import { pdfjsAssets } from './scripts/lib/pdfjs-assets.mjs';

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
      // CLI staging replaces bundled binaries and fonts. Watching those output
      // directories can crash chokidar with EBUSY on Windows while Tauri is running.
      ignored: ["**/src-tauri/**", "**/cli/vendor/**", "**/cli/resources/**", "**/cli/*.tgz"],
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
