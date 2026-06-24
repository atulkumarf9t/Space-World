import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Vite build/dev path. Bundles `three`, `three/addons/*` and `@reactor-team/js-sdk`
// straight from node_modules — replacing the manual esbuild vendor step. In dev,
// /api/* is proxied to the Node server (token minting, Gemini) on :5173.
export default defineConfig({
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:5173' },
  },
  resolve: {
    alias: {
      'three/addons/': fileURLToPath(new URL('./node_modules/three/examples/jsm/', import.meta.url)),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
