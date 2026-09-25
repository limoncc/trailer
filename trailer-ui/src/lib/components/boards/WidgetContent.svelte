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
  import type { MetricRef } from '$lib/utils/explore';
  import type { BoardsData, MediaRow, MetricSeries } from './boardsData';
  import type { FilterPersistState } from '$lib/charts/lineFilter';
  import InfoCard from './InfoCard.svelte';
  // ─── Explore 对比看板分支(scatter/pair/parallel/diff/summary)与多 run line ───
  import ScatterChart from '$lib/charts/ScatterChart.svelte';
  import ParallelChart from '$lib/charts/ParallelChart.svelte';
  import {
    buildScalarScatterRows,
    buildPairScatterRows,
    buildParallelData,
    scalarAxisName,
    safeFieldName,
  } from '$lib/utils/explore';
  import {
    computeConfigDiff,
    buildSummaryRows,
    formatStat,
    lineSeriesKey,
    shortMetricPath,
    fullMetricPath,
    type ExploreCtx,
  } from '$lib/utils/exploreWidgets';

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
    /** line 卡 Select/Exclude 过滤状态变更 → 上抛写回 widget.filter 并入库 */
    onFilterChange?: (filter: FilterPersistState) => void;
    /** 全局回放步(Boards 回放);null = 非回放态 */
    replayStep?: number | null;
    /** 图上 Smooth 快捷按钮 → 写回 widget.smooth(0=关,>0=窗口) */
    onSmoothChange?: (smooth: number) => void;
    /** Explore 对比看板上下文;缺省 = Boards 单 run 原逻辑 */
    explore?: ExploreCtx;
  }

  let { widget, runId, metrics, data, heightPx, running = false, runState = '', runInfo, editing = false, onLabelEdit, onModelLabelEdit, onFilterChange, replayStep = null, onSmoothChange, explore }: Props = $props();

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

  // ─── line 逻辑系列:Boards = 每指标一条(单 run);Explore = 每 (指标 × 可见 run) 一条 ───
  // cv = 该系列所属 run 在 colorBy 维度下的色值,供稳定配色查表
  interface LineSeries {
    name: string;
    /** 系列的 run 显示名(Explore);Boards 单 run 为空串 */
    label: string;
    /** 系列的指标(context/key 完整信息,表格分列用) */
    m: MetricRef;
    cv: string;
    groups: MetricSeries[];
  }
  let lineSeriesList = $derived.by((): LineSeries[] => {
    if (widget.type !== 'line') return [];
    if (explore) {
      // 着色按 run(缺省)时每 (run, 指标) 一个色键 —— 同 run 的多指标不再挤同一种颜色;
      // 选了 config/project 等维度时仍按该维度的值着色(用户主动要按值分组)
      const byRun = !widget.colorBy || widget.colorBy.kind === 'run';
      const raw: Array<{ label: string; m: (typeof widget.metrics)[number]; cv: string; groups: MetricSeries[] }> = [];
      for (const m of widget.metrics) {
        for (const g of metrics) {
          if (g.key !== m.key || g.context !== m.context) continue;
          const runId = g.run_id ?? '';
          const run = explore.runs.find((r) => r.run_id === runId);
          const cv = byRun ? lineSeriesKey(runId, m) : run ? explore.colorValueOf(run, widget.colorBy) : runId;
          // 着色按 run → 显示 run 名;按其他维度 → 显示该维度的值(project 名/config 值)
          const label = byRun ? (runId ? explore.labelOf(runId) : '') : cv;
          raw.push({ label, m, cv, groups: [g] });
        }
      }
      // 显示名:<run>/<context 首段>/<key>(如 midtrain-x/train/loss);
      // 同卡内短名撞车(同 run 的 train/s1 与 train/s2 两级 context)才补全完整 context 消歧
      const short = (x: (typeof raw)[number]) => `${x.label}/${shortMetricPath(x.m)}`;
      const full = (x: (typeof raw)[number]) => `${x.label}/${fullMetricPath(x.m)}`;
      const hits = new Map<string, number>();
      for (const x of raw) hits.set(short(x), (hits.get(short(x)) ?? 0) + 1);
      return raw.map((x) => ({
        name: (hits.get(short(x)) ?? 0) > 1 ? full(x) : short(x),
        label: x.label,
        m: x.m,
        cv: x.cv,
        groups: x.groups,
      }));
    }
    return widget.metrics
      .filter((m) => metrics.some((g) => g.key === m.key && g.context === m.context))
      .map((m) => ({
        name: seriesName(m.key, m.context),
        label: '',
        m,
        cv: '',
        groups: [metrics.find((g) => g.key === m.key && g.context === m.context)!],
      }));
  });
  let lineSeriesNames = $derived(lineSeriesList.map((s) => s.name));
  let lineSmoothOn = $derived(widget.type === 'line' && (widget.smooth ?? 0) > 0);

  // ─── Explore 系列清单(表格化图例):名 = <run>/<context>/<key>,色与曲线同源 ───
  // 首现序 = lineData 排序后的序 = G2 color domain 序 → 表格行序与曲线颜色一一对齐
  // 系列清单按名字母序(= 曲线 color domain 序),**不依赖 lineData** —— 否则被筛掉的
  // 行会从表里消失,就点不回来了
  interface LegendItem {
    name: string;
    run: string;
    context: string;
    metric: string;
    color: string;
    hidden: boolean;
  }
  const seriesLegend = $derived.by((): LegendItem[] => {
    if (widget.type !== 'line' || !explore) return [];
    // 只列**图上真的画了**的系列:batch-query 对无数据的 (run, 指标) 也回一个空组,
    // lineSeriesList 因此会含 6 run × N 指标的全组合,过滤掉空组才是"图有的指标"
    const drawn = (item: LineSeries) => item.groups.some((g) => g.points.length > 0);
    return [...lineSeriesList]
      .filter(drawn)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((item) => ({
        name: item.name,
        run: item.label,
        context: item.m.context,
        metric: item.m.key,
        color: explore.colorOfValue(item.cv),
        hidden: hiddenSeries.has(item.name),
      }));
  });

  /** 层级树的层1:按 run 分组(legend 已按 name 排序 → 组序与组内序都稳定) */
  const seriesGroups = $derived.by((): Array<[string, LegendItem[]]> => {
    const map = new Map<string, LegendItem[]>();
    for (const item of seriesLegend) {
      const list = map.get(item.run);
      if (list) list.push(item);
      else map.set(item.run, [item]);
    }
    return [...map.entries()];
  });

  // smooth>0 时同一逻辑系列的两条线共用一个基色(色板索引按指标序而非 series 序)。
  // Explore:颜色是系列身份的函数(取稳定配色表),按 lineData 出现序展开 → 显隐不换色。
  let lineColors = $derived.by(() => {
    if (widget.type !== 'line') return PALETTE;
    const out: string[] = [];
    if (explore) {
      // 按可见系列在 lineData 中的首现序(= 排序后的 domain 序)取稳定色,
      // 被筛掉的系列不占 range 槽位,G2 domain 与数组一一对齐
      const strip = (s: string) => (lineSmoothOn ? s.replace(/__(raw|smooth)$/, '') : s);
      const seen = new Map<string, string>();
      for (const row of lineData) {
        const key = strip(row.series);
        if (seen.has(key)) continue;
        const item = lineSeriesList.find((x) => x.name === key);
        seen.set(key, item ? explore.colorOfValue(item.cv) : PALETTE[0]);
      }
      for (const color of seen.values()) {
        if (lineSmoothOn) out.push(withAlpha(color, RAW_ALPHA), color);
        else out.push(color);
      }
      return out;
    }
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
    for (const s of lineSeriesList) {
      if (explore && hiddenSeries.has(s.name)) continue; // 筛选:被点掉的系列不画
      const name = s.name;
      for (const g of s.groups) {
        const pts = g.points
          .map((p) => ({ step: xWall && p.wall_time != null ? p.wall_time * 1000 : p.step, value: p.value }))
          .sort((a, b) => a.step - b.step);
        if (lineSmoothOn && pts.length > 1) {
          for (const p of pts) rows.push({ ...p, series: `${name}__raw` });
          const half = Math.floor(win / 2);
          for (let i = 0; i < pts.length; i++) {
            const slice = pts.slice(Math.max(0, i - half), Math.min(pts.length, i + half + 1));
            const avg = slice.reduce((sum, q) => sum + q.value, 0) / slice.length;
            rows.push({ step: pts[i].step, value: avg, series: `${name}__smooth` });
          }
        } else {
          for (const p of pts) rows.push({ ...p, series: name });
        }
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

  // 运行中:每条 series 的最新点做绿色脉冲标记(step 已是绘图坐标,wall_time 视图即 ms)。
  // Explore 多 run:按各系列所属 run 的运行态逐系列判断(卡级 running 只服务 Boards)。
  let lineMarkers = $derived.by(() => {
    if (widget.type !== 'line' || lineData.length === 0) return [];
    const live = new Set<string>();
    for (const s of lineSeriesList) {
      const rid = s.groups[0]?.run_id;
      const on = explore ? (rid ? explore.isRunning(rid) : false) : running;
      if (on) live.add(s.name);
    }
    if (live.size === 0) return [];
    // 平滑关闭时每条逻辑系列一个点;开启时原始线/平滑线各一个(与 Metrics 一致)
    const lastBySeries = new Map<string, { step: number; value: number }>();
    for (const row of lineData) {
      const key = lineSmoothOn ? row.series.replace(/__(raw|smooth)$/, '') : row.series;
      if (!live.has(key)) continue;
      lastBySeries.set(row.series, { step: row.step, value: row.value });
    }
    return [...lastBySeries.values()].map((p) => ({ ...p, color: '#22c55e' }));
  });

  // ─── Explore 专用卡数据(无 explore ctx 时渲染空态) ───
  let scatterRows = $derived.by(() => {
    if (widget.type !== 'scatter' || !explore) return null;
    return buildScalarScatterRows(explore.runs, widget.x, widget.y, widget.colorBy ?? { kind: 'run' });
  });
  let pairRows = $derived.by(() => {
    if (widget.type !== 'scatter-pair' || !explore) return null;
    return buildPairScatterRows(explore.runs, widget.x, widget.y, widget.colorBy ?? { kind: 'run' }, explore.series);
  });
  let parallelData = $derived.by(() => {
    if (widget.type !== 'parallel' || !explore) return null;
    return buildParallelData(explore.runs, widget.dims);
  });
  // parallel 的着色字段:取第一个 summary 维度(如 accuracy.last),缺省按 run
  let parallelMetricField = $derived.by(() => {
    if (widget.type !== 'parallel') return undefined;
    const s = widget.dims.find((d) => d.kind === 'summary');
    return s ? safeFieldName(scalarAxisName(s)) : undefined;
  });
  let diffRows = $derived.by(() => (widget.type === 'diff' && explore ? computeConfigDiff(explore.runs) : []));
  let summaryTable = $derived.by(() =>
    widget.type === 'summary' && explore ? buildSummaryRows(explore.runs, widget.metrics) : null
  );

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

  // ─── Explore 系列筛选(会话态,不入库):点系列表格的行切换显隐 ───
  let hiddenSeries = $state<Set<string>>(new Set());
  function toggleSeries(name: string) {
    const next = new Set(hiddenSeries);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    hiddenSeries = next;
  }

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
       空数据由 G2 graceful 渲染,占位文案仅作 overlay 提示。
       过滤状态经 widget.filter 随 layout 入库(initialFilter 恢复 + onFilterChange 写回)。 -->
  <div class="h-full flex flex-col">
    <!-- 表格化系列清单:色点 + run/context/key,行间横线区分(信息比曲线本身可靠辨认) -->
    <!-- 系列按钮:不占图高;hover 展开层级表格浮层,点行筛选显隐(会话态) -->
    {#if seriesLegend.length > 0}
      <div class="group/series absolute top-1 left-1 z-10" data-series-toggle>
        <button
          type="button"
          class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium border border-border/70 bg-background/95 rounded shadow-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
          title="Series — hover to view and filter"
        >
          <span aria-hidden="true">▤</span>
          Series {seriesLegend.filter((l) => !l.hidden).length}/{seriesLegend.length}
        </button>
        <div data-series-panel class="hidden group-hover/series:block absolute right-0 top-full pt-1">
          <div
            class="w-[min(480px,84vw)] max-h-[55vh] overflow-auto bg-card border border-border rounded-md shadow-lg text-[11px]"
          >
            <div data-series-table data-has-head="true">
              <div
                class="px-2.5 py-1.5 bg-muted/50 border-b border-border/60 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sticky top-0"
              >
                Series · {seriesLegend.length} — click a line to show/hide
              </div>
              <!-- 层级树:层1 = run 分组标题,层2 = 缩进的 context/指标;组间横线 -->
              {#each seriesGroups as [run, items] (run)}
                <div
                  data-series-group
                  class="flex items-center gap-1.5 px-2.5 pt-2 pb-1 border-t border-border/50 first:border-t-0"
                >
                  <span class="size-1.5 rounded-full bg-muted-foreground/40 shrink-0"></span>
                  <span class="font-semibold truncate" title={run}>{run}</span>
                  <span class="text-[10px] font-normal text-muted-foreground shrink-0">
                    {items.filter((i) => !i.hidden).length}/{items.length}
                  </span>
                </div>
                {#each items as s (s.name)}
                  <div
                    class="flex items-center gap-1.5 pl-7 pr-2.5 py-1 border-b border-border/30 last:border-b-0 cursor-pointer hover:bg-accent/50 {s.hidden
                      ? 'opacity-40'
                      : ''}"
                    data-series-row
                    data-series-hidden={s.hidden ? 'true' : 'false'}
                    role="button"
                    tabindex="0"
                    onclick={() => toggleSeries(s.name)}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleSeries(s.name);
                      }
                    }}
                  >
                    <span
                      data-series-dot
                      class="size-2.5 rounded-full border border-black/10 shrink-0"
                      style="background: {s.color}"
                    ></span>
                    <span data-series-leaf class="font-mono truncate" title={s.name}>
                      {s.context ? `${s.context}/${s.metric}` : s.metric}
                    </span>
                  </div>
                {/each}
              {/each}
            </div>
          </div>
        </div>
      </div>
    {/if}
    <div class="relative flex-1 min-h-0">
    <LineChart
      data={lineData}
      height={heightPx}
      seriesField="series"
      colors={lineColors}
      lineWidth={explore ? 2 : undefined}
      xIsTime={widget.xKind === 'wall_time'}
      logX={widget.xLog === true}
      logY={widget.yLog === true}
      smoothOn={lineSmoothOn}
      smoothLabel={lineSmoothOn ? String(widget.smooth ?? 0) : ''}
      onSmoothToggle={onSmoothChange
        ? () => onSmoothChange(lineSmoothOn ? 0 : 5)
        : undefined}
      yFormat={lineYFormat}
      markers={lineMarkers}
      initialFilter={widget.filter}
      {onFilterChange}
    />
    {#if lineData.length === 0}
      <div
        class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground pointer-events-none"
      >
        Waiting for metric data…
      </div>
    {/if}
    </div>
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
{:else if widget.type === 'scatter'}
  {#if !scatterRows}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">Select runs to plot</div>
  {:else}
    <ScatterChart
      data={scatterRows.rows as Array<{ x: number; y: number; [k: string]: unknown }>}
      xField="x"
      yField="y"
      colorField={scatterRows.colorField}
      logX={widget.xLog === true}
      logY={widget.yLog === true}
      regression={widget.regression === true}
      height={heightPx}
    />
  {/if}
{:else if widget.type === 'scatter-pair'}
  {#if !pairRows}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">Select runs to plot</div>
  {:else}
    <ScatterChart
      data={pairRows.rows as Array<{ x: number; y: number; [k: string]: unknown }>}
      xField="x"
      yField="y"
      colorField={pairRows.colorField}
      height={heightPx}
    />
  {/if}
{:else if widget.type === 'parallel'}
  {#if !parallelData}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">Select runs to plot</div>
  {:else}
    <ParallelChart data={parallelData.rows} dimensions={parallelData.dimensions} metricField={parallelMetricField} height={heightPx} title="Parallel" />
  {/if}
{:else if widget.type === 'diff'}
  {#if !explore || explore.runs.length < 2}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">Select 2+ runs to diff</div>
  {:else if diffRows.length === 0}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">No config differences</div>
  {:else}
    <div class="h-full overflow-auto border border-border rounded">
      <table class="w-full text-xs">
        <thead>
          <tr class="border-b border-border bg-muted/50">
            <th class="px-2 py-1.5 text-left text-muted-foreground font-medium sticky left-0 bg-muted/50 z-10">Config key</th>
            {#each explore.runs as r (r.run_id)}
              <th class="px-2 py-1.5 text-left text-muted-foreground font-medium whitespace-nowrap">{explore.labelOf(r.run_id)}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each diffRows as row (row.path)}
            <tr class="border-b border-border/50 hover:bg-accent/30 even:bg-muted/10">
              <td class="px-2 py-1 font-mono sticky left-0 bg-card z-10">{row.path}</td>
              {#each row.values as v, i (i)}
                <td class="px-2 py-1 whitespace-nowrap">{v}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{:else if widget.type === 'summary'}
  {#if !summaryTable || summaryTable.metrics.length === 0}
    <div class="h-full flex items-center justify-center text-xs text-muted-foreground">Runs have no summary yet</div>
  {:else}
    <div class="h-full overflow-auto border border-border rounded">
      <table class="w-full text-xs border-collapse">
        <thead>
          <tr class="border-b border-border bg-muted/50">
            <th class="px-2 py-1.5 text-left text-muted-foreground font-medium sticky left-0 bg-muted/50 z-10">Run</th>
            {#each summaryTable.metrics as m, i (i)}
              <th colspan="4" class="px-2 py-1.5 text-center text-muted-foreground font-medium whitespace-nowrap border-l border-border">
                {m.context ? `${m.context}/${m.key}` : m.key}
              </th>
            {/each}
          </tr>
          <tr class="border-b border-border bg-muted/30">
            <th class="px-2 py-1 sticky left-0 bg-muted/30 z-10"></th>
            {#each summaryTable.metrics as m, i (i)}
              {#each ['Last', 'Best', 'Min', 'Max'] as col, j (j)}
                <th
                  class="px-2 py-1 text-[10px] text-muted-foreground font-normal whitespace-nowrap {j === 0 ? 'border-l border-border' : ''}"
                  title={col === 'Best' ? 'best_step 见 hover 提示' : undefined}
                >{col}</th>
              {/each}
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each summaryTable.rows as row, i (row.runId)}
            <tr class="border-b border-border/50 hover:bg-accent/30 even:bg-muted/10">
              <td class="px-2 py-1 font-medium sticky left-0 bg-card z-10 whitespace-nowrap">{explore?.labelOf(row.runId)}</td>
              {#each row.cells as cell, ci (ci)}
                <td class="px-2 py-1 text-right tabular-nums whitespace-nowrap {ci === 0 ? 'border-l border-border' : ''}">{formatStat(cell?.last)}</td>
                <td class="px-2 py-1 text-right tabular-nums whitespace-nowrap" title={cell?.best_step != null ? `best @ step ${cell.best_step}` : undefined}>{formatStat(cell?.best)}</td>
                <td class="px-2 py-1 text-right tabular-nums whitespace-nowrap">{formatStat(cell?.min)}</td>
                <td class="px-2 py-1 text-right tabular-nums whitespace-nowrap">{formatStat(cell?.max)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{:else if widget.type === 'info'}
  <InfoCard {widget} {metrics} {running} {runState} {runInfo} {editing} {onLabelEdit} {onModelLabelEdit} />
{/if}
</div>
