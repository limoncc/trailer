import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import path from 'path';

// 与 vite.config.ts 保持一致的版本注入,保证测试里 __APP_VERSION__ 有真实值
const appVersion: string = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
).version;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [svelte({ hot: false })],
  resolve: {
    // 让 svelte 解析到 client 版,支持组件测试里的 mount()
    conditions: ['browser'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,js}', 'src/**/*.spec.{ts,js}'],
    alias: {
      $lib: path.resolve(__dirname, 'src/lib'),
    },
  },
});
