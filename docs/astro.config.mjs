// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

// GitHub Pages 项目站点部署在 /trailer/ 子路径, 资源路径需带 base 前缀。
// 自定义域名时设 ASTRO_BASE=/ (或改默认值) 即可。
const base = process.env.ASTRO_BASE ?? '/trailer';

export default defineConfig({
  site: 'https://limoncc.github.io',
  base,
  integrations: [
    starlight({
      title: { en: 'Trailer', 'zh-cn': 'Trailer' },
      description: 'Trailer — next-gen ML experiment tracking: Rust core + Python SDK + rich UI.',
      logo: { src: './src/assets/logo.svg', alt: 'Trailer' },
      favicon: '/favicon.svg',
      locales: {
        root: { label: 'English', lang: 'en' },
        'zh-cn': { label: '简体中文', lang: 'zh-CN' },
      },
      defaultLocale: 'root',
      customCss: ['./src/custom.css', '@fontsource-variable/inter'],
      plugins: [starlightLlmsTxt()],
      sidebar: [
        { label: 'Guides', items: [
          'getting-started',
          'core-concepts',
          'deployment',
          'cli',
        ]},
        { label: 'Python SDK', items: [
          'sdk/logging',
          'sdk/advanced-data',
          'sdk/configuration',
          'sdk/modes',
        ]},
        { label: 'Web UI', items: [
          'ui/dashboard',
          'ui/run-details',
          'ui/compare',
          'ui/explore',
          'ui/reports',
        ]},
        { label: 'Project', items: [
          'license',
        ]},
      ],
    }),
  ],
});
