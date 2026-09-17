<script lang="ts">
  // ─── 信息卡:超参数 / 当前步数下指标 / 当前步数 / 训练时长 / 训练成本 ───
  // 纯展示:行渲染逻辑全部在 utils/infoCard.ts(有测试);这里只负责 tick 与排版。
  import { onMount, onDestroy } from 'svelte';
  import type { InfoWidget, RunInfo } from '$lib/utils/dashboard';
  import { formatInfoValue, type InfoMetrics } from '$lib/utils/infoCard';
  import type { MetricSeries } from './boardsData';

  interface Props {
    widget: InfoWidget;
    metrics: MetricSeries[];
    running?: boolean;
    runInfo?: RunInfo;
  }

  let { widget, metrics, running = false, runInfo }: Props = $props();

  // 每秒 tick 驱动时长/成本重算;终态 run 终点固定,重算结果不变(冻结显示)。
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
  const rows = $derived.by(() => {
    void now; // 依赖 tick,时长/成本每秒重算
    return widget.items.map((item) =>
      formatInfoValue({
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
</script>

{#if rows.length === 0}
  <div class="h-full flex items-center justify-center text-xs text-muted-foreground">
    No items selected
  </div>
{:else}
  <div class="h-full overflow-auto grid gap-x-3 gap-y-1 content-start" style="grid-template-columns: auto 1fr;">
    {#each rows as row (row.label)}
      <span class="text-xs text-muted-foreground truncate" title={row.label}>{row.label}</span>
      <span class="text-xs font-mono text-foreground text-right tabular-nums truncate" title={row.value}
        >{row.value}</span
      >
    {/each}
  </div>
{/if}
