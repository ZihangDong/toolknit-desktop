import { defineConfig } from "vite";

export default defineConfig(async () => ({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // CLI staging replaces bundled binaries and fonts. Watching those output
      // directories can crash chokidar with EBUSY on Windows while Tauri is running.
      ignored: ["**/src-tauri/**", "**/cli/vendor/**", "**/cli/resources/**", "**/cli/*.tgz"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
      },
    },
  },
}));
