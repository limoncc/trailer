<script lang="ts">
  import { onDestroy } from 'svelte';
  import { PCA3DViewer } from '$lib/pca/pca3d-viewer';
  import { PCA_THEME } from '$lib/pca/pcaTypes';
  import type { PcaData, PcaHoverInfo } from '$lib/pca/pcaTypes';

  interface Props {
    data: PcaData | null;
    height?: number;
    opacity?: number;
    pointSize?: number;
    /** step 切换时保留相机视角（默认 true） */
    keepView?: boolean;
    showHover?: boolean;
  }

  let {
    data,
    height = 420,
    opacity = 0.85,
    pointSize = 0, // 0 = 按数据范围自适应方块大小
    keepView = true,
    showHover = true,
  }: Props = $props();

  let container: HTMLDivElement;
  let viewer: PCA3DViewer | null = null;
  let hover = $state<PcaHoverInfo | null>(null);
  let dark = $state(false);

  // dark mode：初始检测 + MutationObserver（照抄 ModelGraph.svelte 模式）
  $effect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    dark = isDark;
    const mo = new MutationObserver(() => {
      const d = document.documentElement.classList.contains('dark');
      if (d !== dark) {
        dark = d;
        viewer?.setColors(
          d ? PCA_THEME.dark.bg : PCA_THEME.light.bg,
          d ? PCA_THEME.dark.grid : PCA_THEME.light.grid,
          d ? PCA_THEME.dark.axis : PCA_THEME.light.axis,
        );
      }
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  });

  // 建 viewer + 数据更新合一：data 变化 → setData（step 切换不重建 WebGL 上下文）
  $effect(() => {
    if (!container || !data) return;
    const first = !viewer;
    if (!viewer) {
      viewer = new PCA3DViewer(container, {
        opacity,
        pointSize,
        backgroundColor: dark ? PCA_THEME.dark.bg : PCA_THEME.light.bg,
        gridColor: dark ? PCA_THEME.dark.grid : PCA_THEME.light.grid,
        axisColor: dark ? PCA_THEME.dark.axis : PCA_THEME.light.axis,
        onHover: showHover ? (i) => (hover = i) : undefined,
      });
    }
    // 首次加载用复位视角（fit 斜俯视）；之后 step 切换保留相机视角
    viewer.setData(data, { keepView: first ? false : keepView });
  });

  $effect(() => {
    viewer?.setOpacity(opacity);
  });

  $effect(() => {
    viewer?.setPointSize(pointSize);
  });

  /// 供父组件通过 bind:this 调用：切换预设视角
  export function setView(name: 'front' | 'side' | 'top' | 'reset') {
    viewer?.setView(name);
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
      No PCA data
    </div>
  {/if}
  {#if hover && showHover}
    <div
      class="pointer-events-none absolute z-20"
      style="left: {hover.mx}px; top: {hover.my}px; transform: translate(12px, 12px);"
    >
      <div class="rounded-md border border-border bg-popover/95 px-2 py-1.5 text-xs shadow-md backdrop-blur">
        <div class="font-mono font-medium text-foreground">{hover.cluster}</div>
        <div class="font-mono text-muted-foreground">
          x {hover.x.toFixed(3)} · y {hover.y.toFixed(3)} · z {hover.z.toFixed(3)}
        </div>
      </div>
    </div>
  {/if}
</div>
