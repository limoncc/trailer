<script lang="ts">
  import { onDestroy } from 'svelte';
  import { LandscapeViewer, SURFACE_THEME, type SurfaceHoverInfo } from './landscape-viewer';
  import { rollBallPath } from './surface';
  import type { ParsedLandscape } from './landscape';

  interface Props {
    data: ParsedLandscape | null;
    height?: number;
    /** step 切换时保留相机视角（默认 true） */
    keepView?: boolean;
    wireframe?: boolean;
    /** 配色方案名（默认 coolwarm） */
    cmap?: string;
    showHover?: boolean;
  }

  let {
    data,
    height = 420,
    keepView = true,
    wireframe = false,
    cmap = 'coolwarm',
    showHover = true,
  }: Props = $props();

  let container: HTMLDivElement;
  // 普通变量(非 $state)：仅供闭包/onDestroy 使用,避免 effect 内读写竞争
  let viewer: LandscapeViewer | null = null;
  let hover = $state<SurfaceHoverInfo | null>(null);
  let dark = $state(false);

  // dark mode：初始检测 + MutationObserver（照抄 PCA3DChart 模式）
  $effect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    dark = isDark;
    const mo = new MutationObserver(() => {
      const d = document.documentElement.classList.contains('dark');
      if (d !== dark) {
        dark = d;
        viewer?.setColors(
          d ? SURFACE_THEME.dark.bg : SURFACE_THEME.light.bg,
          d ? SURFACE_THEME.dark.grid : SURFACE_THEME.light.grid,
          d ? SURFACE_THEME.dark.axis : SURFACE_THEME.light.axis,
        );
      }
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  });

  // 唯一的创建/数据 effect：依赖 (container, data, cmap, wireframe)。
  // 之前拆成两个 effect 双重 setData,第二个的 clearBall 会清掉父组件刚 playBall 的小球。
  // initialized 为普通变量(非响应式)：仅表达"是否已做过首次相机复位"。
  let initialized = false;
  $effect(() => {
    if (!container || !data) return;
    if (!viewer) {
      viewer = new LandscapeViewer(container, {
        wireframe,
        cmap,
        backgroundColor: dark ? SURFACE_THEME.dark.bg : SURFACE_THEME.light.bg,
        gridColor: dark ? SURFACE_THEME.dark.grid : SURFACE_THEME.light.grid,
        axisColor: dark ? SURFACE_THEME.dark.axis : SURFACE_THEME.light.axis,
        onHover: showHover ? (info) => (hover = info) : undefined,
      });
    }
    viewer.setWireframe(wireframe);
    viewer.setData(data, { keepView: initialized, cmap });
    initialized = true;
  });

  /// 供父组件通过 bind:this 调用：切换预设视角
  export function setView(name: 'front' | 'side' | 'top' | 'reset') {
    viewer?.setView(name);
  }

  /// 播放小球从最高点沿梯度滚落（durationMs 控制时长,数据变化后可重复调用）
  export function playRoll(durationMs = 4000) {
    if (viewer && data) viewer.playBall(rollBallPath(data), durationMs);
  }

  onDestroy(() => {
    viewer?.destroy();
    viewer = null;
  });
</script>

<div class="relative w-full overflow-hidden rounded-md bg-background" style="height: {height}px;">
  <div bind:this={container} class="absolute inset-0"></div>
  {#if !data}
    <div class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
      No landscape data
    </div>
  {/if}
  {#if hover && showHover}
    <div
      class="pointer-events-none absolute z-20"
      style="left: {hover.mx}px; top: {hover.my}px; transform: translate(12px, 12px);"
    >
      <div class="rounded-md border border-border bg-popover/95 px-2 py-1.5 text-xs shadow-md backdrop-blur">
        <div class="font-mono font-medium text-foreground">loss {hover.loss.toFixed(4)}</div>
        <div class="font-mono text-muted-foreground">
          α {hover.a.toFixed(3)} · β {hover.b.toFixed(3)}
        </div>
      </div>
    </div>
  {/if}
</div>
