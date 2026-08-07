import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    proxy: {
      // 前端独立开发:把 /api/v1 转发到已运行的 trailer-server
      '/api/v1': 'http://127.0.0.1:5120',
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@antv/g2')) {
              return 'vendor-g2';
            }
            if (id.includes('@antv/g6') || id.includes('@antv/g-plugin-')) {
              return 'vendor-g6';
            }
            if (id.includes('@antv')) {
              return 'vendor-antv-core';
            }
            if (id.includes('d3-')) {
              return 'vendor-d3';
            }
          }
        },
      },
    },
  },
});
