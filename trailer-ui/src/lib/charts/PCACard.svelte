<script lang="ts">
  import { onDestroy } from 'svelte';
  import PCA3DChart from './PCA3DChart.svelte';
  import { parsePcaBody } from '$lib/pca/pca';
  import type { PcaGroup, PcaData } from '$lib/pca/pcaTypes';

  interface Props {
    group: PcaGroup;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onRemove?: () => void;
    compact?: boolean;
  }

  let { group, onMoveUp, onMoveDown, onRemove, compact = false }: Props = $props();

  let expanded = $state(true);
  // 默认选最新 step（group 按 name 重建时初始化一次）
  let selectedIndex = $state(0);
  let init = true; // 一次性标志：仅首次设置默认 step，避免覆盖用户点击 step 0
  // 用 $derived 同步最新 index，避免 $state 初始化直接引用 prop 触发警告
  const idx = $derived(Math.min(selectedIndex, Math.max(0, group.rows.length - 1)));

  const steps = $derived(group.rows.map((r) => r.step));
  const currentRow = $derived(group.rows[idx]);
  const current = $derived<PcaData | null>(currentRow ? parsePcaBody(currentRow.body) : null);
  const sliderPct = $derived(group.rows.length > 1 ? (idx / (group.rows.length - 1)) * 100 : 0);

  // rows 首次就绪时默认选最新 step（一次性标志，避免误伤用户点击 step 0）
  $effect(() => {
    if (init && group.rows.length > 0) {
      init = false;
      selectedIndex = group.rows.length - 1;
    }
  });

  let sliderWrap = $state<HTMLDivElement | null>(null);
  let dragging = false; // 非响应式：避免闭包读取旧值
  // 视角按钮通过 bind:this 调用 PCA3DChart 暴露的 setView
  let chart = $state<{ setView: (name: 'front' | 'side' | 'top' | 'reset') => void } | undefined>(undefined);

  // 自动播放：循环切换 step
  let playing = $state(false);
  let playTimer: ReturnType<typeof setInterval> | undefined;

  function togglePlay() {
    if (group.rows.length < 2) return;
    playing = !playing;
    if (playing) {
      playTimer = setInterval(() => {
        selectedIndex = (selectedIndex + 1) % group.rows.length;
      }, 700);
    } else {
      if (playTimer) clearInterval(playTimer);
      playTimer = undefined;
    }
  }

  onDestroy(() => {
    if (playTimer) clearInterval(playTimer);
  });

  function setIdxFromPointer(clientX: number) {
    if (!sliderWrap || group.rows.length < 2) return;
    const rect = sliderWrap.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    selectedIndex = Math.round(ratio * (group.rows.length - 1));
  }
</script>

<div class="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
  <!-- header -->
  <div class="flex items-center gap-2 px-3 py-2">
    <button
      type="button"
      class="text-xs text-muted-foreground hover:text-foreground"
      onclick={() => (expanded = !expanded)}
      aria-label={expanded ? 'Collapse' : 'Expand'}
    >{expanded ? '▾' : '▸'}</button>
    <button
      type="button"
      class="flex-1 text-left font-mono text-sm font-semibold truncate hover:text-foreground"
      onclick={() => (expanded = !expanded)}
    >{group.name}</button>
    <span class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{group.rows.length} steps</span>
    {#if onMoveUp}
      <button type="button" class="text-xs text-muted-foreground hover:text-foreground" onclick={onMoveUp} aria-label="Move up">↑</button>
    {/if}
    {#if onMoveDown}
      <button type="button" class="text-xs text-muted-foreground hover:text-foreground" onclick={onMoveDown} aria-label="Move down">↓</button>
    {/if}
    {#if onRemove}
      <button type="button" class="text-xs text-muted-foreground hover:text-destructive" onclick={onRemove} aria-label="Remove">✕</button>
    {/if}
  </div>

  {#if expanded}
    <div class="px-3 pb-3 space-y-3">
      <!-- step 滑块（1 step 时禁用但保留高度，与多 step 卡片对齐） -->
      <div class="flex items-center gap-3 px-1 {group.rows.length < 2 ? 'opacity-40' : ''}">
        <span class="shrink-0 text-xs text-muted-foreground font-medium">Step {steps[idx]}</span>
        <div
          bind:this={sliderWrap}
          role="slider"
          tabindex={group.rows.length > 1 ? 0 : -1}
          aria-label="Step"
          aria-valuemin={steps[0]}
          aria-valuemax={steps[steps.length - 1]}
          aria-valuenow={steps[idx]}
          aria-valuetext={`Step ${steps[idx]} of ${steps[steps.length - 1]}`}
          class="trailer-slider relative h-5 flex-1 cursor-pointer touch-none select-none"
          onpointerdown={(e) => { if (group.rows.length < 2) return; dragging = true; setIdxFromPointer(e.clientX); }}
          onpointermove={(e) => { if (dragging) setIdxFromPointer(e.clientX); }}
          onpointerup={() => { dragging = false; }}
          onpointerleave={() => { dragging = false; }}
          onkeydown={(e) => {
            if (group.rows.length < 2) return;
            const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
            if (step === 0) return;
            e.preventDefault();
            selectedIndex = Math.min(group.rows.length - 1, Math.max(0, selectedIndex + step));
          }}
        >
          <div class="absolute inset-y-0 left-0 my-auto h-1 w-full rounded-full bg-border"></div>
          <div class="absolute inset-y-0 left-0 my-auto h-1 rounded-full bg-primary" style="width: {sliderPct}%"></div>
          <div
            class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow"
            style="left: {sliderPct}%"
          ></div>
        </div>
        <span class="shrink-0 text-xs text-muted-foreground font-medium">{steps[idx]} / {steps[steps.length - 1]}</span>
        {#if group.rows.length > 1}
          <button
            type="button"
            class="shrink-0 px-1.5 text-[11px] border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onclick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
          >{playing ? '⏸' : '▶'}</button>
        {/if}
      </div>

      <!-- 视角切换（对应 pca-viewer 的 正/侧/俯/复位），放图表上方 -->
      <div class="flex items-center gap-1 flex-wrap">
        {#each [['front', 'Front'], ['side', 'Side'], ['top', 'Top'], ['reset', 'Reset']] as [k, l]}
          <button
            type="button"
            class="px-2 py-0.5 text-[11px] border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onclick={() => chart?.setView(k as 'front' | 'side' | 'top' | 'reset')}
          >{l}</button>
        {/each}
      </div>

      <PCA3DChart bind:this={chart} data={current} height={compact ? 300 : 400} keepView />

      <!-- meta 信息在图表下方：一行 PCA + 一行 Cluster -->
      {#if current?.meta}
        <div class="space-y-1 text-[10px]">
          {#if current.meta.explained_variance?.length || current.meta.n_samples != null}
            <div class="flex items-center gap-2 flex-wrap">
              {#each (current.meta.explained_variance ?? []).slice(0, 3) as v, i}
                {@const pct = Math.round((v ?? 0) * 1000) / 10}
                <span class="inline-flex items-center gap-1 font-mono text-muted-foreground">
                  <span class="size-1.5 rounded-sm" style="background:{['#5B8FF9', '#5AD8A6', '#F6BD16'][i]}"></span>
                  PC{i + 1} {pct}%
                </span>
              {/each}
              {#if current.meta.n_samples != null}
                <span class="text-muted-foreground">· {current.meta.n_samples} samples</span>
              {/if}
            </div>
          {/if}
          {#if current.meta.clusters?.length}
            <div class="flex items-center gap-2 flex-wrap">
              {#each current.meta.clusters as c}
                <span class="inline-flex items-center gap-1 font-mono text-muted-foreground">
                  <span class="size-2 rounded-sm" style="background:{c.color}"></span>
                  {c.label} n={c.count}
                </span>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
