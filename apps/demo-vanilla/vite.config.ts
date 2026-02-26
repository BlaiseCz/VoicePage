import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'voicepage-core': path.resolve(__dirname, '../../packages/voicepage-core/src/index.ts'),
      'voicepage-ui': path.resolve(__dirname, '../../packages/voicepage-ui/src/index.ts'),
    },
  },
  server: {
    port: 3000,
    open: false,
  },
});
