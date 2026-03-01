import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'voicepage-core': path.resolve(__dirname, '../../packages/voicepage-core/src/index.ts'),
      'voicepage-ui': path.resolve(__dirname, '../../packages/voicepage-ui/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'kws-test': path.resolve(__dirname, 'kws-test.html'),
      },
    },
  },
  server: {
    port: 3000,
    open: false,
    headers: {
      // Required for SharedArrayBuffer (needed by onnxruntime-web WASM threads)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
});
