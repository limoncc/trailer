// See https://svelte.dev/docs/kit/types#app.d.ts
import type { } from '@sveltejs/kit';

declare global {
  /** Vite define 注入的前端构建版本(来自 package.json) */
  const __APP_VERSION__: string;

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export { };
