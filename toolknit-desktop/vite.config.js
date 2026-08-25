import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: false,
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
      },
    },
  },
});
