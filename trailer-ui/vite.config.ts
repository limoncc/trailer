import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/** 前端版本注入:单一事实来源 = crates/trailer-server/Cargo.toml(与 Server 版本同源,
 *  UI 随 server 一起分发,不存在独立版本)。dev/build 均构建期读取。 */
const appVersion: string = readFileSync(
  new URL('../crates/trailer-server/Cargo.toml', import.meta.url),
  'utf-8',
).match(/^version = "([^"]+)"/m)?.[1] ?? 'dev';

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
