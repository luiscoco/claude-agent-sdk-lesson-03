import { defineConfig } from 'vite';
export default defineConfig({
  server: { hmr: { port: 24680 } },
  build: { outDir: 'dist/client', emptyOutDir: true },
});
