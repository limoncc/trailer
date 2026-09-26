<script lang="ts">
  // ─── Explore 卡片配置编辑器:对话框外壳 + 按类型 tab 的配置控件 ───
  // 控件抽自旧 ExploreChartCard(line/scatter/scatter-pair/parallel/diff/summary),
  // 数据模型从 ChartDef 换成 DashWidget(dashboard.ts 的 widget schema)。
  // 各类型的只读 $derived 副本负责模板内类型收窄(模板里直接赋值 $state 会破坏收窄),
  // 赋值一律走 draft = { ...typed, ... }。
  import { X } from 'lucide-svelte';
  import MetricPicker from '$lib/components/MetricPicker.svelte';
  import DimPicker from '$lib/components/DimPicker.svelte';
  import { groupMetricsByContext } from '$lib/utils/metricGroups';
  import { displayMetricName } from '$lib/utils/systemMetrics';
  import { widgetTypesFor, widgetTypeAvailability } from '$lib/utils/widgetTypes';
  import type { DashWidget } from '$lib/utils/dashboard';
  import {
    collectConfigPaths,
    collectSummaryOptions,
    parseSummaryKey,
    type ColorSpec,
    type MetricRef,
    type RunRecord,
    type ScalarAxis,
    type SummaryField,
  } from '$lib/utils/explore';

  interface Props {
    /** 被编辑的卡片(挂载时取初值,不跟随后续变化) */
    widget: DashWidget;
    /** 可见 run:配置选项(config 路径 / summary 指标)来源 */
    runs: RunRecord[];
    onConfirm: (w: DashWidget) => void;
    onClose: () => void;
  }
  let { widget, runs, onConfirm, onClose }: Props = $props();

  // 父组件按需挂载(每次打开都是新实例),初始状态直接取自 props。
  // 有意只读初值一次(不参与响应性)——设计如此,显式忽略警告
  // svelte-ignore state_referenced_locally
  let draft = $state<DashWidget>(widget);

  const lineW = $derived(draft.type === 'line' ? draft : null);
  const scatterW = $derived(draft.type === 'scatter' ? draft : null);
  const pairW = $derived(draft.type === 'scatter-pair' ? draft : null);
  const parallelW = $derived(draft.type === 'parallel' ? draft : null);
  const summaryW = $derived(draft.type === 'summary' ? draft : null);
  const diffW = $derived(draft.type === 'diff' ? draft : null);

  const configPaths = $derived(collectConfigPaths(runs));
  const summaryOptions = $derived(collectSummaryOptions(runs));
  const summaryGroups = $derived(groupMetricsByContext(summaryOptions));
  const defaultMetric: MetricRef = $derived.by(() => {
    const first = summaryOptions[0];
    return first ? { key: first.key, context: first.context } : { key: 'loss', context: '' };
  });

  const typeAvail = $derived(
    widgetTypeAvailability({
      metrics: summaryOptions.length,
      config: configPaths.length,
      hists: 0,
      pca: 0,
      landscape: 0,
      figures: 0,
      texts: 0,
      tables: 0,
      media: 0,
      runs: runs.length,
      summaryKeys: summaryOptions.length,
    })
  );
  // Explore 只暴露多 run 语义的类型;编辑中的类型始终保留
  const visibleTypes = $derived(
    widgetTypesFor('explore').filter((t) => typeAvail[t.type] || t.type === draft.type)
  );

  /** 切换类型:保留几何/标题等 base 字段,内容按新类型给默认值 */
  function switchType(type: DashWidget['type']) {
    if (type === draft.type) return;
    const base = { id: draft.id, title: draft.title, color: draft.color, snap: draft.snap, w: draft.w, h: draft.h };
    if (type === 'line') {
      draft = { ...base, type: 'line', metrics: [defaultMetric], xKind: 'step' };
    } else if (type === 'scatter') {
      const first = summaryOptions[0];
      draft = {
        ...base,
        type: 'scatter',
        x: { kind: 'config', path: configPaths[0] ?? 'params' },
        y: first
          ? { kind: 'summary', summaryKey: first.summaryKey, field: 'last' }
          : { kind: 'config', path: configPaths[0] ?? 'params' },
      };
    } else if (type === 'parallel') {
      const dims: ScalarAxis[] = [];
      for (const p of configPaths.slice(0, 2)) dims.push({ kind: 'config', path: p });
      for (const o of summaryOptions.slice(0, 2)) dims.push({ kind: 'summary', summaryKey: o.summaryKey, field: 'last' });
      draft = { ...base, type: 'parallel', dims: dims.length ? dims : [{ kind: 'config', path: 'params' }] };
    } else if (type === 'scatter-pair') {
      draft = {
        ...base,
        type: 'scatter-pair',
        x: defaultMetric,
        y: summaryOptions[1] ? { key: summaryOptions[1].key, context: summaryOptions[1].context } : defaultMetric,
      };
    } else if (type === 'diff') {
      draft = { ...base, type: 'diff' };
    } else {
      draft = { ...base, type: 'summary' };
    }
  }

  function scalarLabel(axis: ScalarAxis): string {
    return axis.kind === 'config' ? `config.${axis.path}` : `${axis.summaryKey}[${axis.field}]`;
  }

  function metricLabel(m: MetricRef): string {
    return m.context ? `${m.context}/${m.key}` : m.key;
  }

  // 展示名:系统指标用友好名,选项 value 仍用 metricLabel 保证 round-trip。
  // 归属 run 由树的 run 层表达(先选指标,再选 run)—— 不再拼 " — runA" 尾巴。
  function metricDisplay(m: MetricRef): string {
    return displayMetricName(m.key, m.context) ?? metricLabel(m);
  }

  /** 该指标有数据的 run(= 选中 runs 中 summary 含该 key 的);树的 run 层数据源 */
  function ownersOf(m: { key: string; context: string }): string[] {
    const summaryKey = `${m.key}/${m.context}`;
    return runs.filter((r) => Object.keys(r.summary ?? {}).includes(summaryKey)).map((r) => r.run_id);
  }

  function runLabelOf(runId: string): string {
    const r = runs.find((x) => x.run_id === runId);
    return r ? (r.name ?? runId.slice(0, 12)) : runId;
  }

  /** Confirm 前归一化 line 卡的 run_ids:剔除已不在 owners 的 run;
   *  收敛到全部 → 缺省(= 全部),删空 → 丢该 metric */
  function confirm() {
    if (draft.type === 'line') {
      const metrics = draft.metrics.flatMap((m) => {
        if (!m.run_ids) return [m];
        const owners = ownersOf(m);
        const cleaned = m.run_ids.filter((id) => owners.includes(id));
        if (cleaned.length === 0) return [];
        if (cleaned.length === owners.length) return [{ key: m.key, context: m.context }];
        return [{ key: m.key, context: m.context, run_ids: cleaned }];
      });
      draft = { ...draft, metrics };
    }
    onConfirm(draft);
  }

  function colorLabel(c: ColorSpec): string {
    if (c.kind === 'run') return 'run_id';
    if (c.kind === 'project') return 'project';
    return scalarLabel(c);
  }

  function scalarAxisFromValue(v: string, fallback: ScalarAxis): ScalarAxis {
    if (v.startsWith('config.')) return { kind: 'config', path: v.slice(7) };
    const i = v.lastIndexOf('[');
    if (i > 0 && v.endsWith(']')) {
      return { kind: 'summary', summaryKey: v.slice(0, i), field: v.slice(i + 1, -1) as SummaryField };
    }
    return fallback;
  }

  function metricFromValue(v: string): MetricRef {
    // 兼容 context/key 与 key/context 两种顺序(metricLabel 用 context/key 展示)
    const opt = summaryOptions.find(
      (o) => `${o.summaryKey}` === v || `${o.key}/${o.context}` === v || `${o.context}/${o.key}` === v
    );
    if (opt) return { key: opt.key, context: opt.context };
    return parseSummaryKey(v);
  }

  function colorFromValue(v: string): ColorSpec {
    if (v === 'run_id') return { kind: 'run' };
    if (v === 'project') return { kind: 'project' };
    if (v.startsWith('config.')) return { kind: 'config', path: v.slice(7) };
    const i = v.lastIndexOf('[');
    if (i > 0 && v.endsWith(']')) {
      return { kind: 'summary', summaryKey: v.slice(0, i), field: v.slice(i + 1, -1) as SummaryField };
    }
    return { kind: 'run' };
  }

/** Diff 可选的 config 键(仅 config 维度;summary 指标不参与超参对比) */
  const diffDims = $derived(
    configPaths.map((p) => ({ axis: { kind: 'config' as const, path: p }, label: `config.${p}` }))
  );
  const diffValue = $derived(
    diffW?.paths?.map((p) => ({ kind: 'config' as const, path: p })) ?? []
  );

  // 可用标量维度(parallel/散点)列表
  const availableDims = $derived.by(() => {
    const out: Array<{ axis: ScalarAxis; label: string }> = [];
    for (const p of configPaths) out.push({ axis: { kind: 'config', path: p }, label: `config.${p}` });
    for (const o of summaryOptions) {
      // context 优先,与 metricLabel/scalarAxisName 一致(summaryKey 是 key/context 顺序)
      const label = o.context ? `${o.context}/${o.key}` : o.key;
      out.push({ axis: { kind: 'summary', summaryKey: o.summaryKey, field: 'last' }, label: `${label}[last]` });
    }
    return out;
  });
</script>

<div
  class="fixed inset-0 bg-black/30 z-40"
  role="presentation"
  onclick={onClose}
  onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
></div>
<div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-xl shadow-xl w-[640px] max-w-[92vw] max-h-[84vh] flex flex-col">
  <div class="flex items-center justify-between px-4 py-3 border-b border-border">
    <h3 class="text-sm font-semibold">Edit Chart</h3>
    <button onclick={onClose} class="text-muted-foreground hover:text-foreground text-sm leading-none">
      <X size={16} />
    </button>
  </div>

  <!-- 类型 tabs(Explore 专属类型) -->
  <div class="flex gap-1 px-4 pt-3 flex-wrap">
    {#each visibleTypes as t (t.type)}
      <button
        class="px-3 py-1.5 text-xs rounded-md transition-colors {draft.type === t.type
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent'}"
        onclick={() => switchType(t.type)}
      >
        {t.label}
      </button>
    {/each}
  </div>

  <div class="flex-1 overflow-auto px-4 py-3">
    {#if lineW}
      <!-- 行1:数据源(Metrics + x 轴);行2:外观(color/log/平滑)—— 用户要求的分组 -->
      <div class="flex flex-wrap items-center gap-2 text-xs" data-editor-row="source">
        <MetricPicker
          options={summaryOptions.map((o) => {
            const owners = ownersOf(o);
            // owners = 树的 run 层(勾选细化到 run);没有任何 run 有数据时退回纯指标叶
            return owners.length > 0
              ? { key: o.key, context: o.context, owners }
              : { key: o.key, context: o.context };
          })}
          value={lineW.metrics}
          onValueChange={(next) => (draft = { ...lineW, metrics: next })}
          formatLabel={metricDisplay}
          formatLeaf={(m) => displayMetricName(m.key, m.context) ?? m.key}
          {runLabelOf}
        />
        <select
          value={lineW.xKind}
          onchange={(e) => (draft = { ...lineW, xKind: (e.target as HTMLSelectElement).value === 'wall_time' ? 'wall_time' : 'step' })}
          class="px-1 py-0.5 border border-border rounded bg-background"
        >
          <option value="step">x: step</option>
          <option value="wall_time">x: wall_time</option>
        </select>
      </div>
      <div class="flex flex-wrap items-center gap-2 text-xs" data-editor-row="style">
        <select
          value={colorLabel(lineW.colorBy ?? { kind: 'run' })}
          onchange={(e) => (draft = { ...lineW, colorBy: colorFromValue((e.target as HTMLSelectElement).value) })}
          class="px-1 py-0.5 border border-border rounded bg-background max-w-[240px]"
        >
          <option value="run_id">color: run</option>
          <option value="project">color: project</option>
          <optgroup label="config">
            {#each configPaths as p}
              <option value={`config.${p}`}>color: config.{p}</option>
            {/each}
          </optgroup>
          {#each summaryGroups as g}
            <optgroup label={g.label}>
              {#each g.items as o}
                <option value={`${o.summaryKey}[last]`}>color: {o.summaryKey}[last]</option>
              {/each}
            </optgroup>
          {/each}
        </select>
        <label class="flex items-center gap-1">
          <input type="checkbox" checked={lineW.xLog === true} onchange={(e) => (draft = { ...lineW, xLog: (e.target as HTMLInputElement).checked })} />
          logX
        </label>
        <label class="flex items-center gap-1">
          <input type="checkbox" checked={lineW.yLog === true} onchange={(e) => (draft = { ...lineW, yLog: (e.target as HTMLInputElement).checked })} />
          logY
        </label>
        <!-- Smooth 单行 stepper(0 = 关,1..20 = SMA 窗口):checkbox + 换行输入框太占行 -->
        <label
          class="inline-flex items-center gap-1 px-1.5 py-0.5 border border-border rounded bg-background select-none"
          title="Moving average window — 0 turns smoothing off"
        >
          <span class="text-muted-foreground">Smooth</span>
          <button
            type="button"
            class="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground disabled:opacity-40"
            disabled={(lineW.smooth ?? 0) <= 0}
            aria-label="Decrease smooth window"
            onclick={() => (draft = { ...lineW, smooth: Math.max(0, (lineW.smooth ?? 0) - 1) })}
          >
            −
          </button>
          <span
            class="w-6 text-center font-mono tabular-nums {(lineW.smooth ?? 0) > 0 ? 'text-primary font-semibold' : 'text-foreground'}"
          >
            {lineW.smooth ?? 0}
          </span>
          <button
            type="button"
            class="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground disabled:opacity-40"
            disabled={(lineW.smooth ?? 0) >= 20}
            aria-label="Increase smooth window"
            onclick={() => (draft = { ...lineW, smooth: Math.min(20, (lineW.smooth ?? 0) + 1) })}
          >
            +
          </button>
        </label>
      </div>
    {:else if scatterW}
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={scalarLabel(scatterW.x)}
          onchange={(e) => (draft = { ...scatterW, x: scalarAxisFromValue((e.target as HTMLSelectElement).value, scatterW.x) })}
          class="px-1 py-0.5 border border-border rounded bg-background"
        >
          <optgroup label="config">
            {#each configPaths as p}
              <option value={`config.${p}`}>x: config.{p}</option>
            {/each}
          </optgroup>
          {#each summaryGroups as g}
            <optgroup label={g.label}>
              {#each g.items as o}
                <option value={`${o.summaryKey}[last]`}>x: {o.summaryKey}[last]</option>
              {/each}
            </optgroup>
          {/each}
        </select>
        <select
          value={scalarLabel(scatterW.y)}
          onchange={(e) => (draft = { ...scatterW, y: scalarAxisFromValue((e.target as HTMLSelectElement).value, scatterW.y) })}
          class="px-1 py-0.5 border border-border rounded bg-background"
        >
          {#each summaryGroups as g}
            <optgroup label={g.label}>
              {#each g.items as o}
                <option value={`${o.summaryKey}[last]`}>y: {o.summaryKey}[last]</option>
              {/each}
            </optgroup>
          {/each}
          <optgroup label="config">
            {#each configPaths as p}
              <option value={`config.${p}`}>y: config.{p}</option>
            {/each}
          </optgroup>
        </select>
        <select
          value={colorLabel(scatterW.colorBy ?? { kind: 'run' })}
          onchange={(e) => (draft = { ...scatterW, colorBy: colorFromValue((e.target as HTMLSelectElement).value) })}
          class="px-1 py-0.5 border border-border rounded bg-background"
        >
          <option value="run_id">color: run</option>
          <option value="project">color: project</option>
          <optgroup label="config">
            {#each configPaths as p}
              <option value={`config.${p}`}>color: config.{p}</option>
            {/each}
          </optgroup>
          {#each summaryGroups as g}
            <optgroup label={g.label}>
              {#each g.items as o}
                <option value={`${o.summaryKey}[last]`}>color: {o.summaryKey}[last]</option>
              {/each}
            </optgroup>
          {/each}
        </select>
        <label class="flex items-center gap-1">
          <input type="checkbox" checked={scatterW.xLog === true} onchange={(e) => (draft = { ...scatterW, xLog: (e.target as HTMLInputElement).checked })} />
          logX
        </label>
        <label class="flex items-center gap-1">
          <input type="checkbox" checked={scatterW.yLog === true} onchange={(e) => (draft = { ...scatterW, yLog: (e.target as HTMLInputElement).checked })} />
          logY
        </label>
        <label class="flex items-center gap-1">
          <input type="checkbox" checked={scatterW.regression === true} onchange={(e) => (draft = { ...scatterW, regression: (e.target as HTMLInputElement).checked })} />
          Regression
        </label>
      </div>
    {:else if parallelW}
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <DimPicker
          options={availableDims}
          value={parallelW.dims}
          onValueChange={(dims) => (draft = { ...parallelW, dims })}
        />
        <select
          value={colorLabel(parallelW.colorBy ?? { kind: 'run' })}
          onchange={(e) => (draft = { ...parallelW, colorBy: colorFromValue((e.target as HTMLSelectElement).value) })}
          class="px-1 py-0.5 border border-border rounded bg-background"
        >
          <option value="run_id">color: run</option>
          <option value="project">color: project</option>
          <optgroup label="config">
            {#each configPaths as p}
              <option value={`config.${p}`}>color: config.{p}</option>
            {/each}
          </optgroup>
          {#each summaryGroups as g}
            <optgroup label={g.label}>
              {#each g.items as o}
                <option value={`${o.summaryKey}[last]`}>color: {o.summaryKey}[last]</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      </div>
    {:else if pairW}
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={metricLabel(pairW.x)}
          onchange={(e) => (draft = { ...pairW, x: metricFromValue((e.target as HTMLSelectElement).value) })}
          class="px-1 py-0.5 border border-border rounded bg-background"
        >
          {#each summaryGroups as g}
            <optgroup label={g.label}>
              {#each g.items as o}
                <option value={metricLabel({ key: o.key, context: o.context })}>x: {metricDisplay({ key: o.key, context: o.context })}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
        <select
          value={metricLabel(pairW.y)}
          onchange={(e) => (draft = { ...pairW, y: metricFromValue((e.target as HTMLSelectElement).value) })}
          class="px-1 py-0.5 border border-border rounded bg-background"
        >
          {#each summaryGroups as g}
            <optgroup label={g.label}>
              {#each g.items as o}
                <option value={metricLabel({ key: o.key, context: o.context })}>y: {metricDisplay({ key: o.key, context: o.context })}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
        <select
          value={colorLabel(pairW.colorBy ?? { kind: 'run' })}
          onchange={(e) => (draft = { ...pairW, colorBy: colorFromValue((e.target as HTMLSelectElement).value) })}
          class="px-1 py-0.5 border border-border rounded bg-background"
        >
          <option value="run_id">color: run</option>
          <option value="project">color: project</option>
        </select>
      </div>
    {:else if summaryW}
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="text-muted-foreground">Metrics</span>
        <MetricPicker
          options={summaryOptions.map((o) => ({ key: o.key, context: o.context }))}
          value={summaryW.metrics ?? []}
          onValueChange={(next) => (draft = { ...summaryW, metrics: next.length > 0 ? next : undefined })}
          formatLabel={metricDisplay}
        />
        <span class="text-muted-foreground">Empty = all summary metrics</span>
      </div>
    {:else if diffW}
      <div class="flex flex-wrap items-center gap-2 text-xs" data-editor-row="diff-paths">
        <DimPicker
          options={diffDims}
          value={diffValue}
          onValueChange={(dims) =>
            (draft = {
              ...diffW,
              paths: dims.filter((d) => d.kind === 'config').map((d) => (d as { path: string }).path),
            })}
        />
        <span class="text-muted-foreground">Pick config keys to diff; empty = all differing keys</span>
      </div>
    {:else}
      <p class="text-xs text-muted-foreground">—</p>
    {/if}
  </div>

  <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
    <button
      onclick={onClose}
      class="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-accent/50 transition-colors"
    >
      Cancel
    </button>
    <button
      onclick={confirm}
      class="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
    >
      Confirm
    </button>
  </div>
</div>
