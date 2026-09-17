<script lang="ts">
  // ─── 信息卡:头部条(状态点+模型名+step+elapsed/started)+ 大数字瓦片格 ───
  // 纯逻辑在 utils/infoCard.ts(有测试)。时长/成本来源于训练数据本身:
  // 全部指标点的 wall_time 跨度——数据在涨时间才在涨,结束/crash 自然停止;
  // 勾选 status 项的卡只显示头部条,其余卡渲染瓦片格。全英文展示。
  import type { InfoWidget, RunInfo } from '$lib/utils/dashboard';
  import {
    formatCell,
    formatElapsed,
    statusFromRunState,
    modelNameFromConfig,
    trainingSeconds,
    type InfoMetrics,
  } from '$lib/utils/infoCard';
  import type { MetricSeries } from './boardsData';

  interface Props {
    widget: InfoWidget;
    metrics: MetricSeries[];
    running?: boolean;
    runState?: string;
    runInfo?: RunInfo;
  }

  let { widget, metrics, running = false, runState = '', runInfo }: Props = $props();

  const gpus = $derived(widget.gpus ?? runInfo?.gpuCount);
  const endAt = $derived(running ? undefined : runInfo?.heartbeatAt);
  const seconds = $derived(
    trainingSeconds({
      metrics: metrics as InfoMetrics[],
      createdAt: runInfo?.createdAt,
      endAt,
      running,
    })
  );
  const hasStatus = $derived(widget.items.some((i) => i.src === 'status'));
  const cells = $derived(
    widget.items
      .filter((item) => item.src !== 'status')
      .map((item) =>
        formatCell({
          item,
          seconds,
          createdAt: runInfo?.createdAt,
          endAt,
          running,
          gpus,
          unitPrice: widget.unitPrice,
          config: runInfo?.config,
          metrics: metrics as InfoMetrics[],
        })
      )
  );

  const modelName = $derived(modelNameFromConfig(runInfo?.config, widget.modelPath) ?? '—');
  const statusText = $derived(statusFromRunState(running ? 'running' : runState));
  const statusDot = $derived(
    running
      ? 'bg-amber-500'
      : runState === 'finished'
        ? 'bg-emerald-500'
        : runState === 'crashed'
          ? 'bg-red-500'
          : 'bg-zinc-400'
  );
  const maxStep = $derived.by(() => {
    let max: number | null = null;
    for (const s of metrics) for (const p of s.points) if (max === null || p.step > max) max = p.step;
    return max;
  });
  const elapsedText = $derived(seconds === null ? null : formatElapsed(seconds));
  const startedText = $derived.by(() => {
    if (typeof runInfo?.createdAt !== 'number') return null;
    const d = new Date(runInfo.createdAt * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  });
</script>

<div class="h-full flex flex-col font-mono">
  <!-- 头部条:状态点 + 模型名 + 状态 | step + elapsed/started(勾选 status 项才显示) -->
  {#if hasStatus}
    <div class="flex items-start gap-3 px-3 py-2 border-b border-border">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <span class="w-2 h-2 rounded-full shrink-0 {statusDot}"></span>
        <span class="font-semibold truncate" title={modelName}>{modelName}</span>
        <span class="text-xs text-muted-foreground truncate">{statusText}</span>
      </div>
      <div class="text-right shrink-0">
        <div class="font-semibold">step {maxStep ?? '—'}</div>
        {#if elapsedText}
          <div class="tabular-nums">{elapsedText}</div>
        {/if}
        {#if startedText}
          <div class="text-[10px] text-muted-foreground">started {startedText}</div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- 主体瓦片格(status 卡只显示头部条) -->
  {#if hasStatus || cells.length === 0}
    {#if !hasStatus}
      <div class="flex-1 flex items-center justify-center text-xs text-muted-foreground">
        No items selected
      </div>
    {/if}
  {:else}
    <div class="flex-1 min-h-0 overflow-auto grid gap-px bg-border" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));">
      {#each cells as cell, i (i)}
        <div class="bg-card p-2.5 flex flex-col justify-center min-h-[64px]">
          <div class="text-[11px] text-muted-foreground truncate" title={cell.label}>{cell.label}</div>
          <div class="flex items-baseline gap-1.5 min-w-0">
            <span class="text-lg font-semibold truncate">{cell.value}</span>
            {#if cell.delta}
              <span class="text-xs shrink-0 {cell.deltaUp ? 'text-emerald-600' : 'text-red-500'}">{cell.delta}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
