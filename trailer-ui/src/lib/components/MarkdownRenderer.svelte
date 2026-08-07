<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { marked } from 'marked';
  import hljs from 'highlight.js';
  import 'highlight.js/styles/github-dark.css';

  interface Props {
    content: string;
    className?: string;
    onHeadings?: (headings: { id: string; text: string; depth: number }[]) => void;
  }
  let { content, className = '', onHeadings }: Props = $props();

  // 标题 slug 化(保留中文), 供 TOC 锚点使用
  function slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w一-龥]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  let headingsList: { id: string; text: string; depth: number }[] = [];
  let headingCount: Record<string, number> = {};

  let container: HTMLDivElement;

  // Configure marked with code highlighting
  marked.use({
    renderer: {
      code({ text, lang }: { text: string; lang?: string }) {
        const language = (lang || '').split(' ')[0] || 'plaintext';
        let highlighted: string;
        try {
          highlighted = hljs.getLanguage(language)
            ? hljs.highlight(text, { language }).value
            : hljs.highlightAuto(text).value;
        } catch {
          highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        const cls = language && language !== 'plaintext' ? ` class="hljs language-${language}"` : ' class="hljs"';
        return `<pre><code${cls}>${highlighted}</code></pre>`;
      },
      heading({ depth, text }: { depth: number; text: string }) {
        // 生成标题锚点 id(去重), 并收集到 headingsList 供 TOC
        const id = slugify(text);
        headingCount[id] = (headingCount[id] || 0) + 1;
        const finalId = headingCount[id] > 1 ? `${id}-${headingCount[id] - 1}` : id;
        headingsList.push({ id: finalId, text, depth });
        return `<h${depth} id="${finalId}">${text}</h${depth}>`;
      },
    },
    gfm: true,
    breaks: true,
  });

  // 动态加载 MathJax：$..$ / $$..$$ + \(..\) / \[..\] 分隔符、AMS tags、常用宏
  async function ensureMathJax() {
    if ((window as any).MathJax) return;
    (window as any).MathJax = {
      chtml: { scale: 1.05, minScale: 0.1 },
      tex: {
        inlineMath: [
          ['$', '$'],
          ['\\(', '\\)'],
        ],
        displayMath: [
          ['$$', '$$'],
          ['\\[', '\\]'],
        ],
        processEscapes: true,
        tags: 'ams',
        macros: {
          bm: '\\boldsymbol',
          T: '\\intercal',
          oiint: '{\\iint\\kern{-23.5mu}{\\unicode{x2B2D}}}',
          oiiint: '{\\iiint\\kern{-30.5mu}\\large{\\unicode{x2B2D}}}',
        },
      },
      options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] },
    };
    await new Promise<void>((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }

  // ── 数学保护: marked 会破坏 LaTeX(_ 当强调、$$ 多行变 <br>), 故 parse 前把公式
  //    替换成占位符, parse 后恢复; 恢复时转义 <>& 防止被当 HTML 标签
  const mathTokens: string[] = [];
  function protectMath(src: string): string {
    mathTokens.length = 0;
    const push = (m: string): string => {
      mathTokens.push(m);
      return `MATH${mathTokens.length - 1}`;
    };
    let out = src;
    // 避免 setext 标题: 文本行紧跟 ---/=== 时, marked 会把整段当 h2(粗体大标题);
    // 补空行使其作为水平线 hr
    out = out.replace(/^([^\n]*[^\s\n#])\n(-{3,}|={3,})\s*$/gm, (_m, text, ul) => `${text}\n\n${ul}`);
    // 块级 $$...$$(可多行)
    out = out.replace(/\$\$([\s\S]+?)\$\$/g, push);
    // 行内 $...$(单行, 避免匹配 $$ 内部)
    out = out.replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_m, pre, inner) => pre + push('$' + inner + '$'));
    // \[...\] 块级 与 \(...\) 行内(用户启用了这些分隔符)
    out = out.replace(/\\\[([\s\S]+?)\\\]/g, push);
    out = out.replace(/\\\(([^\\]+?)\\\)/g, push);
    return out;
  }
  function restoreMath(html: string): string {
    return html.replace(/MATH(\d+)/g, (_m, i) => {
      const t = mathTokens[Number(i)];
      return t ? t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
    });
  }

  let html = $derived.by(() => {
    headingsList = [];
    headingCount = {};
    const h = marked.parse(protectMath(content)) as string;
    return restoreMath(h);
  });

  // content 变化时 headingsList 已更新, 通知父组件(用于 TOC)
  $effect(() => {
    html;
    onHeadings?.(headingsList);
  });

  function typeset() {
    const M = (window as any).MathJax;
    // 容器必须仍在 DOM 中(内容更新/组件重挂载时旧节点会被移除, MathJax 处理会报 parent null)
    if (M && typeof M.typesetPromise === 'function' && container?.isConnected) {
      // typesetPromise 是异步的, 渲染中途容器被卸载会 reject; 必须 catch 兜底避免 unhandled rejection
      M.typesetPromise([container]).catch(() => {});
    }
  }

  onMount(async () => {
    await ensureMathJax();
    await tick();
    typeset();
  });

  $effect(() => {
    content;
    typeset();
  });
</script>

<div bind:this={container} class={`markdown-body ${className}`}>
  {@html html}
</div>

<style>
  .markdown-body {
    /* 与全局 text-sm(0.875rem) 协调, 标题用 em 相对缩放 */
    font-size: 0.875rem;
    line-height: 1.6;
    color: hsl(var(--foreground));
    /* 长文本 / 长公式自动换行, 避免横向溢出 */
    overflow-wrap: break-word;
    word-break: break-word;
    /* 防御: 显式常规字重, 排除父级/继承导致的整篇粗体 */
    font-weight: 400;
  }
  .markdown-body :global(h1), .markdown-body :global(h2), .markdown-body :global(h3) {
    margin: 0.6em 0 0.4em;
    font-weight: 600;
    line-height: 1.25;
    /* 锚点跳转时留出顶部空间, 避免被 sticky 头部遮挡 */
    scroll-margin-top: 1rem;
  }
  .markdown-body :global(h1) { font-size: 1.4em; }
  .markdown-body :global(h2) { font-size: 1.25em; }
  .markdown-body :global(h3) { font-size: 1.1em; }
  .markdown-body :global(p) { margin: 0.4em 0; }
  .markdown-body :global(ul), .markdown-body :global(ol) { margin: 0.4em 0; padding-left: 1.5em; }
  .markdown-body :global(li) { margin: 0.2em 0; }
  .markdown-body :global(pre) {
    background: #0d1117;
    padding: 0.6em 0.8em;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0.5em 0;
  }
  .markdown-body :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
  }
  .markdown-body :global(:not(pre) > code) {
    background: hsl(var(--muted));
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  .markdown-body :global(pre code) { background: transparent; padding: 0; }
  .markdown-body :global(table) {
    border-collapse: collapse;
    margin: 0.5em 0;
    font-size: 0.9em;
    width: 100%;
  }
  .markdown-body :global(th), .markdown-body :global(td) {
    border: 1px solid hsl(var(--border));
    padding: 4px 10px;
    text-align: left;
  }
  .markdown-body :global(th) { background: hsl(var(--muted) / 0.5); font-weight: 600; }
  .markdown-body :global(blockquote) {
    border-left: 3px solid hsl(var(--border));
    margin: 0.5em 0;
    padding-left: 1em;
    color: hsl(var(--muted-foreground));
  }
  .markdown-body :global(a) { color: hsl(var(--primary)); text-decoration: underline; }
  .markdown-body :global(hr) { border: 0; border-top: 1px solid hsl(var(--border)); margin: 1em 0; }
</style>
