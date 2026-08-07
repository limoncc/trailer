import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
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
