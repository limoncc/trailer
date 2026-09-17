<script lang="ts">
  // ─── 信息卡:头部条(状态点+模型名+step+elapsed/started)+ 大数字瓦片格 ───
  // 纯逻辑在 utils/infoCard.ts(有测试);这里只负责 tick 与排版。全英文展示。
  import { onMount, onDestroy } from 'svelte';
  import type { InfoWidget, RunInfo } from '$lib/utils/dashboard';
  import {
    formatCell,
    formatElapsed,
    statusFromRunState,
    modelNameFromConfig,
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

  // 每秒 tick 驱动 elapsed/成本重算;终态终点固定,重算结果不变(冻结显示)。
  // 不能按 running 条件启动:Resume 后 running 才翻转,挂载时的条件会漏启定时器。
  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  onMount(() => {
    timer = setInterval(() => (now = Date.now()), 1000);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  const gpus = $derived(widget.gpus ?? runInfo?.gpuCount);
  const endAt = $derived(running ? undefined : runInfo?.heartbeatAt);
  // status item = 头部条(模型名+状态+step+时长/started);其余项渲染成瓦片格。
  // 头部条是可选项——只有勾了它的卡才显示,其他卡只显示自己的内容。
  const hasStatus = $derived(widget.items.some((i) => i.src === 'status'));
  const cells = $derived.by(() => {
    void now; // 依赖 tick,成本每秒重算
    return widget.items
      .filter((item) => item.src !== 'status')
      .map((item) =>
        formatCell({
          item,
          now,
          createdAt: runInfo?.createdAt,
          endAt,
          running,
          gpus,
          unitPrice: widget.unitPrice,
          config: runInfo?.config,
          metrics: metrics as InfoMetrics[],
        })
      );
  });

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
  const elapsedText = $derived.by(() => {
    void now;
    if (typeof runInfo?.createdAt !== 'number') return null;
    const nowSec = now / 1000;
    const endSec = running ? nowSec : (runInfo.heartbeatAt ?? nowSec);
    return formatElapsed(Math.max(0, endSec - runInfo.createdAt));
  });
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

  <!-- 主体瓦片格 -->
  {#if cells.length === 0}
    <div class="flex-1 flex items-center justify-center text-xs text-muted-foreground">
      No items selected
    </div>
  {:else}
    <div class="flex-1 min-h-0 overflow-auto grid gap-px bg-border" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));">
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
