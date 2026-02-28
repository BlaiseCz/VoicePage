import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'voicepage-core': path.resolve(__dirname, '../../packages/voicepage-core/src/index.ts'),
    },
  },
  server: {
    port: 3001,
    open: false,
    proxy: {
      // Proxy API calls to the bench backend (Python FastAPI)
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
});
