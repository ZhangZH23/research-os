import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    rollupOptions: {
      output: {
        manualChunks: {
          graph: ['@xyflow/react'],
          katex: ['katex'],
          markdown: ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex'],
        },
      },
    },
  },
});
