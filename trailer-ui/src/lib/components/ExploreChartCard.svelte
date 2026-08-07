<script lang="ts">
  import type { ChartDef, RunRecord, SeriesData, ScalarAxis, ColorSpec, MetricRef, SummaryField } from '$lib/utils/explore';
  import {
    collectConfigPaths,
    collectSummaryOptions,
    buildLineRows,
    buildScalarScatterRows,
    buildPairScatterRows,
    buildParallelData,
    scalarAxisName,
    safeFieldName,
    parseSummaryKey,
  } from '$lib/utils/explore';
  import ExploreChart from '$lib/charts/ExploreChart.svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import MetricPicker from '$lib/components/MetricPicker.svelte';
  import DimPicker from '$lib/components/DimPicker.svelte';
  import { groupMetricsByContext } from '$lib/utils/metricGroups';

  interface Props {
    def: ChartDef;
    runs: RunRecord[];
    series: SeriesData;
    onChange: (def: ChartDef) => void;
    onRemove: () => void;
    onCopy?: () => void;
    readOnly?: boolean;
  }
  let { def, runs, series, onChange, onRemove, onCopy, readOnly = false }: Props = $props();

  const typeLabel = $derived(
    def.type === 'line' ? 'Line' : def.type === 'scatter' ? 'Scatter' : def.type === 'scatter-pair' ? 'Pair' : 'Parallel',
  );

  const description = $derived(
    def.type === 'line'
      ? `${def.metrics.map(metricLabel).join(', ')} · ${colorLabel(def.color)}`
      : def.type === 'scatter'
        ? `${scalarLabel(def.x)} → ${scalarLabel(def.y)}`
        : def.type === 'scatter-pair'
          ? `${metricLabel(def.x.metric)} vs ${metricLabel(def.y.metric)}`
          : `${def.dims.length} dims`,
  );

  const configPaths = $derived(collectConfigPaths(runs));
  const summaryOptions = $derived(collectSummaryOptions(runs));
  const summaryGroups = $derived(groupMetricsByContext(summaryOptions));

  const chartData = $derived.by(() => {
    switch (def.type) {
      case 'line':
        return { ...buildLineRows(runs, def.metrics, def.color, series), dimensions: [] };
      case 'scatter':
        return { ...buildScalarScatterRows(runs, def.x, def.y, def.color), dimensions: [] };
      case 'scatter-pair':
        return { ...buildPairScatterRows(runs, def.x.metric, def.y.metric, def.color, series), dimensions: [] };
      case 'parallel':
        return { ...buildParallelData(runs, def.dims), colorField: 'run_id' };
    }
  });

  const defaultMetric: MetricRef = $derived.by(() => {
    const first = summaryOptions[0];
    return first ? { key: first.key, context: first.context } : { key: 'loss', context: '' };
  });

  // parallel 的目标指标:取第一个 summary dim(如 "accuracy.last")用于统计/着色
  const parallelMetricField = $derived.by(() => {
    if (def.type !== 'parallel') return undefined;
    const s = def.dims.find((d) => d.kind === 'summary');
    return s ? safeFieldName(scalarAxisName(s)) : undefined;
  });

  function scalarLabel(axis: ScalarAxis): string {
    return axis.kind === 'config' ? `config.${axis.path}` : `${axis.summaryKey}[${axis.field}]`;
  }

  function metricLabel(m: MetricRef): string {
    return m.context ? `${m.context}/${m.key}` : m.key;
  }

  function colorLabel(c: ColorSpec): string {
    if (c.kind === 'run') return 'run_id';
    if (c.kind === 'project') return 'project';
    return scalarLabel(c);
  }

  function switchType(type: string) {
    if (type === def.type) return;
    if (type === 'line') {
      onChange({ type: 'line', x: { kind: 'step' }, metrics: [defaultMetric], color: { kind: 'run' } });
    } else if (type === 'scatter') {
      const first = summaryOptions[0];
      onChange({
        type: 'scatter',
        x: { kind: 'config', path: configPaths[0] ?? 'params' },
        y: first ? { kind: 'summary', summaryKey: first.summaryKey, field: 'last' } : { kind: 'config', path: configPaths[0] ?? 'params' },
        color: { kind: 'run' },
      });
    } else if (type === 'parallel') {
      const dims: ScalarAxis[] = [];
      for (const p of configPaths.slice(0, 2)) dims.push({ kind: 'config', path: p });
      for (const o of summaryOptions.slice(0, 2)) dims.push({ kind: 'summary', summaryKey: o.summaryKey, field: 'last' });
      onChange({ type: 'parallel', dims: dims.length ? dims : [{ kind: 'config', path: 'params' }] });
    } else {
      onChange({
        type: 'scatter-pair',
        x: { kind: 'metric', metric: defaultMetric },
        y: { kind: 'metric', metric: summaryOptions[1] ? { key: summaryOptions[1].key, context: summaryOptions[1].context } : defaultMetric },
        color: { kind: 'run' },
      });
    }
  }

  // 可用标量维度(parallel/散点)列表
  const availableDims = $derived.by(() => {
    const out: Array<{ axis: ScalarAxis; label: string }> = [];
    for (const p of configPaths) out.push({ axis: { kind: 'config', path: p }, label: `config.${p}` });
    for (const o of summaryOptions) {
      out.push({ axis: { kind: 'summary', summaryKey: o.summaryKey, field: 'last' }, label: `${o.summaryKey}[last]` });
    }
    return out;
  });

  // 通用标量轴下拉:返回新的轴
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
</script>

<div class="border border-border rounded-lg overflow-hidden bg-card">
  <div class="px-3 py-2 bg-muted/20 border-b border-border flex items-center gap-2">
    <span class="text-xs font-semibold text-foreground">{typeLabel}</span>
    <span class="text-xs text-muted-foreground truncate flex-1">{description}</span>
    {#if !readOnly}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="inline-flex items-center justify-center size-6 rounded hover:bg-accent/50 text-muted-foreground"
        >
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-32">
          <DropdownMenu.Item onSelect={onCopy} disabled={!onCopy}>Duplicate</DropdownMenu.Item>
          <DropdownMenu.Item variant="destructive" onSelect={onRemove}>Delete</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>

  <div class="p-2">
    {#if !readOnly}
    <div class="flex items-center gap-1.5 mb-2">
      <select
        value={def.type}
        onchange={(e) => switchType((e.target as HTMLSelectElement).value)}
        class="text-xs px-1.5 py-1 border border-border rounded-md bg-background"
      >
        <option value="line">Line</option>
        <option value="scatter">Scatter</option>
        <option value="scatter-pair">Pair</option>
        <option value="parallel">Parallel</option>
      </select>
    </div>

  {#if def.type === 'line'}
    <div class="flex flex-wrap items-center gap-2 text-xs mb-2">
      <MetricPicker
        options={summaryOptions.map((o) => ({ key: o.key, context: o.context }))}
        value={def.metrics}
        onValueChange={(next) => onChange({ ...def, metrics: next })}
        formatLabel={metricLabel}
      />
      <select
        value={def.x.kind}
        onchange={(e) => onChange({ ...def, x: { kind: (e.target as HTMLSelectElement).value === 'wall_time' ? 'wall_time' : 'step' } })}
        class="px-1 py-0.5 border border-border rounded bg-background"
      >
        <option value="step">x: step</option>
        <option value="wall_time">x: wall_time</option>
      </select>
      <select
        value={colorLabel(def.color)}
        onchange={(e) => onChange({ ...def, color: colorFromValue((e.target as HTMLSelectElement).value) })}
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
        <input type="checkbox" checked={def.yLog ?? false} onchange={(e) => onChange({ ...def, yLog: (e.target as HTMLInputElement).checked })} />
        logY
      </label>
      <label class="flex items-center gap-1">
        <input
          type="checkbox"
          checked={def.smooth ?? false}
          onchange={(e) =>
            onChange({
              ...def,
              smooth: (e.target as HTMLInputElement).checked,
              smoothWindow: (e.target as HTMLInputElement).checked ? (def.smoothWindow ?? 5) : 0,
            })}
        />
        Smooth
      </label>
      {#if def.smooth}
        <label class="flex items-center gap-1">
          <input
            type="number"
            min="2"
            max="200"
            value={def.smoothWindow ?? 5}
            onchange={(e) =>
              onChange({ ...def, smoothWindow: Math.max(2, Math.min(200, Number((e.target as HTMLInputElement).value) || 5)) })}
            class="w-16 px-1 py-0.5 border border-border rounded bg-background text-right"
          />
          MA
        </label>
      {/if}
    </div>
  {:else if def.type === 'scatter'}
    <div class="flex flex-wrap items-center gap-2 text-xs mb-2">
      <select
        value={scalarLabel(def.x)}
        onchange={(e) => onChange({ ...def, x: scalarAxisFromValue((e.target as HTMLSelectElement).value, def.x) })}
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
        value={scalarLabel(def.y)}
        onchange={(e) => onChange({ ...def, y: scalarAxisFromValue((e.target as HTMLSelectElement).value, def.y) })}
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
      <label class="flex items-center gap-1">
        <input type="checkbox" checked={def.yLog ?? false} onchange={(e) => onChange({ ...def, yLog: (e.target as HTMLInputElement).checked })} />
        logY
      </label>
      <label class="flex items-center gap-1">
        <input type="checkbox" checked={def.xLog ?? false} onchange={(e) => onChange({ ...def, xLog: (e.target as HTMLInputElement).checked })} />
        logX
      </label>
      <label class="flex items-center gap-1">
        <input type="checkbox" checked={def.regression ?? false} onchange={(e) => onChange({ ...def, regression: (e.target as HTMLInputElement).checked })} />
        Regression
      </label>
    </div>
  {:else if def.type === 'parallel'}
    <div class="flex flex-wrap items-center gap-2 text-xs mb-2">
      <DimPicker
        options={availableDims}
        value={def.dims}
        onValueChange={(dims) => onChange({ ...def, dims })}
      />
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-2 text-xs mb-2">
      <select
        value={metricLabel(def.x.metric)}
        onchange={(e) => onChange({ ...def, x: { kind: 'metric', metric: metricFromValue((e.target as HTMLSelectElement).value) } })}
        class="px-1 py-0.5 border border-border rounded bg-background"
      >
        {#each summaryGroups as g}
          <optgroup label={g.label}>
            {#each g.items as o}
              <option value={metricLabel({ key: o.key, context: o.context })}>x: {metricLabel({ key: o.key, context: o.context })}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
      <select
        value={metricLabel(def.y.metric)}
        onchange={(e) => onChange({ ...def, y: { kind: 'metric', metric: metricFromValue((e.target as HTMLSelectElement).value) } })}
        class="px-1 py-0.5 border border-border rounded bg-background"
      >
        {#each summaryGroups as g}
          <optgroup label={g.label}>
            {#each g.items as o}
              <option value={metricLabel({ key: o.key, context: o.context })}>y: {metricLabel({ key: o.key, context: o.context })}</option>
            {/each}
          </optgroup>
        {/each}
      </select>
    </div>
  {/if}
    {/if}

    <ExploreChart
      {def}
      rows={chartData.rows}
      colorField={chartData.colorField}
      dimensions={chartData.dimensions}
      metricField={parallelMetricField}
      height={280}
    />
  </div>
</div>
