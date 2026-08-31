import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/** 前端版本注入:dev/build 均从 package.json 读取,与发布版本同步 */
const appVersion: string = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
).version;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
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
