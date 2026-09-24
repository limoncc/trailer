<script lang="ts">
  // ─── Widget 内容渲染分发(唯一扩展点:新增类型加一个分支) ───
  import { untrack } from 'svelte';
  import LineChart from '$lib/charts/LineChart.svelte';
  import HistogramChart from '$lib/charts/HistogramChart.svelte';
  import G2SpecChart from '$lib/charts/G2SpecChart.svelte';
  import PCACard from '$lib/charts/PCACard.svelte';
  import type { PcaFigureRow, PcaGroup } from '$lib/pca/pcaTypes';
  import LandscapeCard from '$lib/charts/landscape/LandscapeCard.svelte';
  import type { LandscapeFigureRow, LandscapeGroup } from '$lib/charts/landscape/landscape';
  import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
  import {
    displayMetricName,
    canonicalKey,
    isSystemContext,
  } from '$lib/utils/systemMetrics';
  import { metricId } from '$lib/utils/metricGroups';
  import type { DashWidget, RunInfo } from '$lib/utils/dashboard';
  import type { BoardsData, MediaRow, MetricSeries } from './boardsData';
  import InfoCard from './InfoCard.svelte';

  interface Props {
    widget: DashWidget;
    runId: string;
    metrics: MetricSeries[];
    data: BoardsData;
    /** 卡片内容区可用高度(px,line 图需要显式高度) */
    heightPx: number;
    /** run 运行中:line 图最新点显示绿色脉冲标记(同 Metrics 卡片) */
    running?: boolean;
    /** 信息卡状态文本用 */
    runState?: string;
    /** 信息卡所需的 run 元信息 */
    runInfo?: RunInfo;
    /** info 卡编辑态:瓦片 label 双击改名 */
    editing?: boolean;
    onLabelEdit?: (itemIdx: number, label: string) => void;
    /** info 卡编辑态:双击模型名改显示别名 */
    onModelLabelEdit?: (label: string) => void;
    /** 全局回放步(Boards 回放);null = 非回放态 */
    replayStep?: number | null;
  }

  let { widget, runId, metrics, data, heightPx, running = false, runState = '', runInfo, editing = false, onLabelEdit, onModelLabelEdit, replayStep = null }: Props = $props();

  // ─── 视口内懒挂载:G2/Three 实例创建贵(单卡 100ms+),新增卡/整板加载时
  // 只渲染视口附近的卡,滚到附近(300px 预载)才挂载真实内容;一次性闩,之后保持
  // 挂载(指标轮询持续更新)。info 卡轻量,不参与懒挂载。
  // 400ms 轮询 rect 直到命中——不依赖 scroll/IO 事件(嵌入式环境事件不可靠),
  // 未命中卡片只有个位数,开销可忽略。 ───
  let hostEl = $state<HTMLElement | null>(null);
  let inView = $state(false);
  $effect(() => {
    if (!hostEl || inView || widget.type === 'info') return;
    const MARGIN = 300;
    const check = () => {
      if (inView || !hostEl) return;
      const r = hostEl.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.bottom > -MARGIN && r.top < vh + MARGIN) inView = true;
    };
    check();
    const timer = setInterval(check, 400);
    return () => clearInterval(timer);
  });

  const PALETTE = ['#3b82f6', '#f97316', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f59e0b', '#6366f1'];

  function seriesName(key: string, context: string): string {
    return displayMetricName(key, context) ?? (context ? `${key} [${context}]` : key);
  }

  // 单位族:所有指标同为系统指标且单位一致时,y 轴/tooltip 统一格式化
  function unitFamily(key: string, context: string): string | null {
    if (!isSystemContext(context)) return null;
    const c = canonicalKey(key, context);
    if (c === 'vram_used' || c === 'mem_used') return 'gb';
    if (c.endsWith('_util')) return 'pct';
    if (c === 'power_w') return 'w';
    if (c === 'temp_c') return 'c';
    return null;
  }

  const UNIT_FMT: Record<string, (v: number) => string> = {
    gb: (v) => `${(v / 1024).toFixed(1)} GB`,
    pct: (v) => `${Math.round(v * 100)}%`,
    w: (v) => `${Math.round(v)} W`,
    c: (v) => `${Math.round(v)}°C`,
  };

  // ─── line ───
  // 与 Metrics 卡片同款观感:smooth>0 时每条指标画「原始半透明线 + 平滑实线」两条。
  // series 命名 "<指标名>__raw" / "<指标名>__smooth",色板按指标序分配(同一指标两线同色),
  // 颜色由下方 lineColors 展开成成对色值({ name: [rawColor, solidColor] })。
  const RAW_ALPHA = '40';
  function withAlpha(hex: string, alphaHex: string): string {
    return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alphaHex}` : hex;
  }

  let lineSeriesNames = $derived.by(() => {
    if (widget.type !== 'line') return [];
    return widget.metrics
      .filter((m) => metrics.some((g) => g.key === m.key && g.context === m.context))
      .map((m) => seriesName(m.key, m.context));
  });
  let lineSmoothOn = $derived(widget.type === 'line' && (widget.smooth ?? 0) > 0);
  // smooth>0 时同一指标的两条线共用一个基色(色板索引按指标序而非 series 序)
  let lineColors = $derived.by(() => {
    if (widget.type !== 'line') return PALETTE;
    const out: string[] = [];
    lineSeriesNames.forEach((_, i) => {
      const base = PALETTE[i % PALETTE.length];
      if (lineSmoothOn) out.push(withAlpha(base, RAW_ALPHA), base);
      else out.push(base);
    });
    return out;
  });

  let lineData = $derived.by(() => {
    if (widget.type !== 'line') return [];
    const rows: Array<{ step: number; value: number; series: string }> = [];
    const xWall = widget.xKind === 'wall_time';
    const win = (widget.smooth ?? 0) * 2 + 1;
    for (const m of widget.metrics) {
      const g = metrics.find((g) => g.key === m.key && g.context === m.context);
      if (!g) continue;
      const name = seriesName(m.key, m.context);
      const pts = g.points
        .map((p) => ({ step: xWall && p.wall_time != null ? p.wall_time * 1000 : p.step, value: p.value }))
        .sort((a, b) => a.step - b.step);
      if (lineSmoothOn && pts.length > 1) {
        for (const p of pts) rows.push({ ...p, series: `${name}__raw` });
        const half = Math.floor(win / 2);
        for (let i = 0; i < pts.length; i++) {
          const slice = pts.slice(Math.max(0, i - half), Math.min(pts.length, i + half + 1));
          const avg = slice.reduce((s, q) => s + q.value, 0) / slice.length;
          rows.push({ step: pts[i].step, value: avg, series: `${name}__smooth` });
        }
      } else {
        for (const p of pts) rows.push({ ...p, series: name });
      }
    }
    // 按 series 分组排序,保证 G2 连线连续(series 序:同指标的 raw 在 smooth 前)
    return rows.sort((a, b) => (a.series === b.series ? a.step - b.step : a.series < b.series ? -1 : 1));
  });
  let lineYFormat = $derived.by(() => {
    if (widget.type !== 'line') return undefined;
    const fams = widget.metrics.map((m) => unitFamily(m.key, m.context));
    if (fams.length === 0 || fams.some((f) => f === null)) return undefined;
    const first = fams[0]!;
    return fams.every((f) => f === first) ? UNIT_FMT[first] : undefined;
  });

  // 运行中:每条 series 的最新点做绿色脉冲标记(step 已是绘图坐标,wall_time 视图即 ms)
  let lineMarkers = $derived.by(() => {
    if (!running || widget.type !== 'line' || lineData.length === 0) return [];
    // 平滑关闭时每条指标一个点;开启时原始线/平滑线各一个(与 Metrics 一致)
    const lastBySeries = new Map<string, { step: number; value: number }>();
    for (const row of lineData) lastBySeries.set(row.series, { step: row.step, value: row.value });
    return [...lastBySeries.values()].map((p) => ({ ...p, color: '#22c55e' }));
  });

  // ─── hist ───
  let histFrames = $derived.by(() => {
    if (widget.type !== 'hist') return [];
    return data.histograms
      .filter((h) => h.key === widget.key && h.context === widget.context)
      .sort((a, b) => a.step - b.step);
  });

  // ─── pca:figures 表 kind='pca' 按 name 取整组(卡内滑块浏览 step);step 为数字时只看该步 ───
  let pcaGroup = $derived.by(() => {
    if (widget.type !== 'pca') return null;
    const rows = data.figures
      .filter((f) => f.kind === 'pca' && f.name === widget.name)
      .sort((a, b) => a.step - b.step) as PcaFigureRow[];
    const group: PcaGroup = {
      name: widget.name,
      rows: typeof widget.step === 'number' ? rows.filter((r) => r.step === widget.step) : rows,
    };
    return group;
  });

  // ─── landscape:figures 表 kind='landscape',结构与 pca 同法 ───
  let landscapeGroup = $derived.by(() => {
    if (widget.type !== 'landscape') return null;
    const rows: LandscapeFigureRow[] = data.figures
      .filter((f) => f.kind === 'landscape' && f.name === widget.name)
      .sort((a, b) => a.step - b.step);
    const group: LandscapeGroup = {
      name: widget.name,
      rows: typeof widget.step === 'number' ? rows.filter((r) => r.step === widget.step) : rows,
    };
    return group;
  });

  // ─── figure / text:name(+step,'latest'/缺省取最新) ───
  function resolveByName<T extends { name: string; step: number }>(
    rows: T[],
    name: string,
    step: 'latest' | number | undefined
  ): T | null {
    const matches = rows.filter((r) => r.name === name);
    if (matches.length === 0) return null;
    if (typeof step === 'number') {
      const hit = matches.find((r) => r.step === step);
      if (hit) return hit;
    }
    return matches.reduce((a, b) => (a.step >= b.step ? a : b));
  }

  let figureRow = $derived(
    widget.type === 'figure' ? resolveByName(data.figures, widget.name, widget.step) : null
  );
  let textRow = $derived(widget.type === 'text' ? resolveByName(data.texts, widget.name, widget.step) : null);
  let figureSpec = $derived.by(() => {
    if (!figureRow || figureRow.kind !== 'g2') return null;
    try {
      return JSON.parse(figureRow.body) as Record<string, unknown>;
    } catch {
      return null;
    }
  });

  // ─── table / media:按数字 id ───
  let tableRow = $derived(
    widget.type === 'table' ? (data.tables.find((t) => t.id === widget.tableId) ?? null) : null
  );
  let mediaRow = $derived(
    widget.type === 'media' ? (data.media.find((m) => m.id === widget.mediaId) ?? null) : null
  );

  function formatCell(val: unknown): string {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'number') return val.toPrecision(4);
    return String(val);
  }

  let tableVisibleRows = $state(50);

  // 媒体文件流需鉴权:fetch(带 token)→ object URL(同 MediaExplorer)。
  // 网络请求属于 effect 的合法用途;缓存读用 untrack 包住,避免 effect 读写自身依赖的状态。
  let blobUrls = $state<Map<number, string>>(new Map());
  $effect(() => {
    if (!mediaRow) return;
    const id = mediaRow.id;
    if (untrack(() => blobUrls.has(id))) return;
    const url = `/api/v1/runs/${encodeURIComponent(runId)}/media/${id}/file`;
    fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => {
        untrack(() => {
          blobUrls = new Map(blobUrls).set(id, URL.createObjectURL(b));
        });
      })
      .catch(() => {});
  });
</script>

<div bind:this={hostEl} class="h-full">
{#if widget.type !== 'info' && !inView}
  <!-- 未进入视口:占位(卡片高度由网格保证),滚到附近再挂载重型内容 -->
{:else if widget.type === 'line'}
  <!-- LineChart 始终挂载:回放从全局 min step 截断时本卡可能瞬时变空,
       用 {#if} 卸载会销毁组件 → 框选窗口/排除状态全部丢失(用户反馈:回放后排除消失)。
       空数据由 G2 graceful 渲染,占位文案仅作 overlay 提示。 -->
  <div class="relative h-full">
    <LineChart
      data={lineData}
      height={heightPx}
      seriesField="series"
      colors={lineColors}
      xIsTime={widget.xKind === 'wall_time'}
      logY={widget.yLog === true}
      yFormat={lineYFormat}
      markers={lineMarkers}
    />
    {#if lineData.length === 0}
      <div
        class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground pointer-events-none"
      >
        Waiting for metric data…
      </div>
    {/if}
  </div>
{:else if widget.type === 'hist'}
  {#if histFrames.length === 0}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">
      No histogram frames yet
    </div>
  {:else}
    <!-- 完整分布视图可能高于卡片:容器可滚动;≤12 列(约 1/3 板宽)用 compact 模式隐藏坐标轴,挤成竖排不可读 -->
    <div class="h-full overflow-auto">
      <HistogramChart data={histFrames} key={widget.key} context={widget.context} compact={widget.w <= 12} followStep={replayStep} />
    </div>
  {/if}
{:else if widget.type === 'pca'}
  {#if !pcaGroup || pcaGroup.rows.length === 0}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">
      PCA data not found
    </div>
  {:else}
    <PCACard group={pcaGroup} chromeless chartHeight={Math.max(160, heightPx - 120)} followStep={replayStep} />
  {/if}
{:else if widget.type === 'landscape'}
  {#if !landscapeGroup || landscapeGroup.rows.length === 0}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">
      Landscape data not found
    </div>
  {:else}
    <LandscapeCard group={landscapeGroup} chromeless chartHeight={Math.max(160, heightPx - 130)} followStep={replayStep} />
  {/if}
{:else if widget.type === 'figure'}
  {#if !figureRow}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">
      Figure not found
    </div>
  {:else if figureRow.kind === 'png'}
    <div class="h-full overflow-auto flex items-start justify-center">
      <img
        src="data:image/png;base64,{figureRow.body}"
        alt={figureRow.name}
        class="max-w-full h-auto rounded"
        loading="lazy"
      />
    </div>
  {:else if figureSpec}
    <G2SpecChart spec={figureSpec} height={Math.max(200, heightPx)} />
  {:else}
    <div class="h-full flex items-center justify-center text-xs text-destructive">Invalid G2 spec</div>
  {/if}
{:else if widget.type === 'text'}
  {#if !textRow}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">
      Text entry not found
    </div>
  {:else}
    <div class="h-full overflow-auto px-1 text-sm leading-relaxed">
      <MarkdownRenderer content={textRow.body} />
    </div>
  {/if}
{:else if widget.type === 'table'}
  {#if !tableRow}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">
      Table not found
    </div>
  {:else}
    <div class="h-full overflow-auto border border-border rounded">
      <table class="w-full text-xs">
        <thead>
          <tr>
            <th class="px-2 py-1.5 text-left text-muted-foreground font-medium sticky top-0 bg-muted/50 border-b border-border">#</th>
            {#each tableRow.columns as col}
              <th class="px-2 py-1.5 text-left text-muted-foreground font-medium sticky top-0 bg-muted/50 border-b border-border whitespace-nowrap">{col}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each tableRow.data.slice(0, tableVisibleRows) as row, i}
            <tr class="border-b border-border/50 hover:bg-accent/30 even:bg-muted/10">
              <td class="px-2 py-1 text-muted-foreground">{i}</td>
              {#each row as cell}
                <td class="px-2 py-1 whitespace-nowrap">{formatCell(cell)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if tableRow.data.length > tableVisibleRows}
        <div class="text-center py-1.5 border-t border-border">
          <button
            class="px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            onclick={() => (tableVisibleRows += 50)}
          >
            Show more ({tableRow.data.length - tableVisibleRows} remaining)
          </button>
        </div>
      {/if}
    </div>
  {/if}
{:else if widget.type === 'media'}
  {#if !mediaRow}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">
      Media not found
    </div>
  {:else if !blobUrls.has(mediaRow.id)}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">Loading media…</div>
  {:else if mediaRow.kind === 'image'}
    <div class="h-full overflow-auto flex items-start justify-center">
      <img src={blobUrls.get(mediaRow.id)} alt={mediaRow.name} class="max-w-full h-auto rounded border border-border" />
    </div>
  {:else if mediaRow.kind === 'video'}
    <video controls class="max-w-full max-h-full rounded" preload="metadata">
      <source src={blobUrls.get(mediaRow.id)} />
    </video>
  {:else}
    <audio controls class="w-full" preload="metadata">
      <source src={blobUrls.get(mediaRow.id)} />
    </audio>
  {/if}
{:else if widget.type === 'info'}
  <InfoCard {widget} {metrics} {running} {runState} {runInfo} {editing} {onLabelEdit} {onModelLabelEdit} />
{/if}
</div>
