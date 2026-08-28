<script lang="ts">
  import { onDestroy } from 'svelte';
  import LandscapeHeatmap from './LandscapeHeatmap.svelte';
  import LandscapeSurface from './LandscapeSurface.svelte';
  import {
    parseFigureToLandscape,
    makeLandscapeScaler,
    buildContourLevelsScaled,
    COLORMAP_NAMES,
    type LandscapeScale,
  } from './landscape';
  import { buildContourRings } from './contour';
  import { rollBallPath } from './surface';
  import type { LandscapeGroup, ParsedLandscape } from './landscape';

  interface Props {
    group: LandscapeGroup;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onRemove?: () => void;
    compact?: boolean;
  }

  let { group, onMoveUp, onMoveDown, onRemove, compact = false }: Props = $props();

  type ViewMode = 'heat' | 'contour' | 'both' | 'surf';
  const VIEW_TABS: [ViewMode, string][] = [
    ['heat', 'Heat'],
    ['contour', 'Contour'],
    ['both', 'Both'],
    ['surf', '3D'],
  ];

  let expanded = $state(true);
  let view = $state<ViewMode>('both'); // 默认等高线+热力图叠加
  let wireframe = $state(false);
  let cmap = $state('coolwarm');
  let zscale = $state<LandscapeScale>('log'); // 默认对数:碗底细节可见,墙不压扁色阶
  let rollSpeed = $state(1); // 滚球速度倍率
  let surfView = $state<'front' | 'side' | 'top' | 'reset'>('reset');
  const ROLL_BASE_MS = 4000;
  // 默认选最新 step（一次性 init 标志，避免覆盖用户点击 step 0——导航指南 §4.7 踩坑）
  let selectedIndex = $state(0);
  let init = true;
  const idx = $derived(Math.min(selectedIndex, Math.max(0, group.rows.length - 1)));

  const steps = $derived(group.rows.map((r) => r.step));
  const currentRow = $derived(group.rows[idx]);
  const current = $derived<ParsedLandscape | null>(
    currentRow ? parseFigureToLandscape(currentRow) : null,
  );
  const sliderPct = $derived(group.rows.length > 1 ? (idx / (group.rows.length - 1)) * 100 : 0);

  // 首次就绪时默认选最新 step（一次性）
  $effect(() => {
    if (init && group.rows.length > 0) {
      init = false;
      selectedIndex = group.rows.length - 1;
    }
  });

  let sliderWrap = $state<HTMLDivElement | null>(null);
  let dragging = false; // 非响应式：避免闭包读旧值
  // Surface 模式视角/滚球通过 bind:this 调用组件暴露的方法
  let surfaceChart = $state<{ setView: (name: 'front' | 'side' | 'top' | 'reset') => void; playRoll: (durationMs?: number) => void } | undefined>(undefined);

  // 滚球：rollToken 只在 ⚽ 点击处理器里递增(不在 effect 内写状态——Svelte 5 反模式)。
  // 自动重放由数据驱动：新帧 → current 变化 → ballPath 新数组身份 → 各视图自身 effect 重放。
  let rollToken = $state(0);
  const ballPath = $derived(current ? rollBallPath(current) : []);

  $effect(() => {
    void rollToken;
    void zscale; // 刻度切换会重建 3D 曲面,顺带重放滚球
    if (view === 'surf' && current && surfaceChart) surfaceChart.playRoll(ROLL_BASE_MS / rollSpeed);
  });

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

  // Contour 模式：阈值 + 环数据随当前帧派生（等高线分级随值域缩放联动）
  const CONTOUR_COUNT = 8;
  const scaler = $derived(current ? makeLandscapeScaler(current.zmin, current.zmax, zscale) : null);
  const levels = $derived(scaler ? buildContourLevelsScaled(scaler, CONTOUR_COUNT) : []);
  const rings = $derived(
    current && levels.length > 0 ? buildContourRings(current.z, current.nRows, current.nCols, levels, current.xs, current.ys) : [],
  );

  // meta 徽标（已知键优先，展示前 6 个）
  const metaBadges = $derived.by(() => {
    if (!current) return [];
    const preferred = ['normalization', 'direction', 'seed', 'split', 'loss_fn', 'precision'];
    const out: [string, string][] = [];
    for (const k of preferred) {
      const v = (current.meta as Record<string, unknown>)[k];
      if (v !== undefined && v !== null && typeof v !== 'object') out.push([k, String(v)]);
    }
    for (const [k, v] of Object.entries(current.meta)) {
      if (out.length >= 6) break;
      if (preferred.includes(k)) continue;
      if (v !== undefined && v !== null && typeof v !== 'object') out.push([k, String(v)]);
    }
    return out;
  });
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
            const s = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
            if (s === 0) return;
            e.preventDefault();
            selectedIndex = Math.min(group.rows.length - 1, Math.max(0, selectedIndex + s));
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

      <!-- 视图切换 + 滚球 + 配色（单行紧凑布局）-->
      <div class="flex items-center gap-1 flex-wrap text-[11px]">
        <div class="flex items-center gap-px border border-border rounded-md overflow-hidden">
          {#each VIEW_TABS as [k, l]}
            <button
              type="button"
              class="px-1.5 py-0.5 {view === k ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'}"
              onclick={() => (view = k)}
            >{l}</button>
          {/each}
        </div>
        <button
          type="button"
          class="px-1.5 py-0.5 border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onclick={() => rollToken++}
          aria-label="Roll ball"
          title="小球梯度滚落"
        >⚽</button>
        <select
          bind:value={rollSpeed}
          aria-label="Roll speed"
          title="滚球速度"
          class="px-0.5 py-0.5 border border-border rounded-md bg-background text-muted-foreground"
        >
          {#each [0.5, 1, 2, 4] as s}
            <option value={s}>{s}×</option>
          {/each}
        </select>
        {#if view === 'surf'}
          <select
            bind:value={surfView}
            onchange={() => surfaceChart?.setView(surfView)}
            aria-label="Camera view"
            title="视角"
            class="px-0.5 py-0.5 border border-border rounded-md bg-background text-muted-foreground"
          >
            {#each [['front', 'Front'], ['side', 'Side'], ['top', 'Top'], ['reset', 'Reset']] as [k, l]}
              <option value={k}>{l}</option>
            {/each}
          </select>
          <button
            type="button"
            class="px-1.5 py-0.5 border border-border rounded-md {wireframe ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'}"
            onclick={() => (wireframe = !wireframe)}
            aria-label="Wireframe"
            title="线框"
          >▦</button>
        {/if}
        <select
          bind:value={zscale}
          aria-label="Z scale"
          title="loss 刻度：log 放大碗底细节，lin 常规线性"
          class="px-0.5 py-0.5 border border-border rounded-md bg-background text-muted-foreground"
        >
          <option value="log">log</option>
          <option value="linear">lin</option>
        </select>
        <select
          bind:value={cmap}
          aria-label="Colormap"
          title="配色"
          class="ml-auto px-0.5 py-0.5 border border-border rounded-md bg-background text-muted-foreground"
        >
          {#each COLORMAP_NAMES as name}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </div>

      {#if view === 'surf'}
        <LandscapeSurface
          bind:this={surfaceChart}
          data={current}
          height={compact ? 300 : 400}
          keepView
          {wireframe}
          {cmap}
          scale={zscale}
        />
      {:else}
        <LandscapeHeatmap
          data={current}
          height={compact ? 300 : 400}
          contourLevels={view === 'contour' || view === 'both' ? levels : []}
          contourRings={view === 'contour' || view === 'both' ? rings : []}
          fillHeat={view !== 'contour'}
          {cmap}
          scale={zscale}
          {ballPath}
          {rollToken}
          ballDuration={ROLL_BASE_MS / rollSpeed}
        />
      {/if}

      <!-- meta 徽标 -->
      {#if metaBadges.length > 0}
        <div class="flex items-center gap-2 flex-wrap">
          {#each metaBadges as [k, v]}
            <span class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {k}={v}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
