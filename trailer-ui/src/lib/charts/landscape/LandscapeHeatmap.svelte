<script lang="ts">
  import { onDestroy } from 'svelte';
  import { colormap, type ParsedLandscape } from './landscape';

  interface Props {
    data: ParsedLandscape | null;
    height?: number;
    /** 等值线阈值（数据空间）；非空时叠加等高线 */
    contourLevels?: number[];
    /** 等高线闭合环（数据空间坐标，由 buildContourRings 产出） */
    contourRings?: { id: number; points: [number, number][] }[];
    /** 是否绘制热力底色（false = 纯等高线模式） */
    fillHeat?: boolean;
    /** 配色方案名（见 landscape.ts COLORMAP_NAMES） */
    cmap?: string;
    /** 小球滚落路径 (α, β, loss)（由 rollBallPath 产出） */
    ballPath?: [number, number, number][];
    /** 递增令牌：变化即重放滚球 */
    rollToken?: number;
    /** 滚球动画时长 ms（球速 = 4000/该值） */
    ballDuration?: number;
  }

  let {
    data,
    height = 420,
    contourLevels = [],
    contourRings = [],
    fillHeat = true,
    cmap = 'coolwarm',
    ballPath = [],
    rollToken = 0,
    ballDuration = 4000,
  }: Props = $props();

  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let dark = $state(false);
  let hover = $state<{ a: number; b: number; loss: number; mx: number; my: number } | null>(null);

  // dark 模式跟随（与 PCA3DChart 同款 MutationObserver）
  $effect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    dark = isDark;
    const mo = new MutationObserver(() => {
      dark = document.documentElement.classList.contains('dark');
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  });

  // ---- 小球动画（非响应式内部状态；rollToken 变化即重放）----
  let ballIdx = -1;          // 当前帧在 ballPath 中的位置
  let activePath: [number, number, number][] | null = null;
  let activeDur = 4000;
  let ballGen = 0;

  $effect(() => {
    void rollToken;
    if (ballPath.length === 0) return; // rollToken 仅作手动重放信号(⚽),初始 0 时也自动播放一次
    activePath = ballPath;
    activeDur = Math.max(300, ballDuration);
    const gen = ++ballGen;
    const start = performance.now();
    const step = () => {
      if (gen !== ballGen) return; // 已被新一轮动画取代
      const p = Math.min(1, (performance.now() - start) / activeDur);
      ballIdx = Math.round(p * (activePath!.length - 1));
      draw();
      if (p < 1) requestAnimationFrame(step);
    };
    ballIdx = 0;
    requestAnimationFrame(step);
    // 卸载/依赖变更时作废进行中的 rAF
    return () => { ballGen++; };
  });

  const PAD = { top: 10, right: 14, bottom: 34, left: 52 };

  function plotRect() {
    const W = container.clientWidth;
    const H = container.clientHeight;
    return { W, H, x: PAD.left, y: PAD.top, w: Math.max(10, W - PAD.left - PAD.right), h: Math.max(10, H - PAD.top - PAD.bottom) };
  }

  /** 数据坐标 → 像素坐标 */
  function toPx(a: number, b: number, d: ParsedLandscape, R = plotRect()) {
    const px = R.x + ((a - d.xRange[0]) / (d.xRange[1] - d.xRange[0])) * R.w;
    // β 向上为正 → canvas y 向下
    const py = R.y + (1 - (b - d.yRange[0]) / (d.yRange[1] - d.yRange[0])) * R.h;
    return [px, py] as const;
  }

  function draw() {
    if (!canvas || !container) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const R = plotRect();
    canvas.width = Math.round(R.W * dpr);
    canvas.height = Math.round(R.H * dpr);
    canvas.style.width = `${R.W}px`;
    canvas.style.height = `${R.H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, R.W, R.H);

    const axis = dark ? '#94a3b8' : '#64748b';
    const grid = dark ? 'rgba(148,163,184,0.18)' : 'rgba(100,116,139,0.18)';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

    if (!data) return;
    const d = data;

    // ---- 热力图主体：逐格 ImageData → 拉伸到绘图区（平滑 = 连续色彩场）----
    // fillHeat=false 时跳过底色，只画等高线（纯等高线模式）
    if (fillHeat) {
      const img = ctx.createImageData(d.nCols, d.nRows);
      for (let r = 0; r < d.nRows; r++) {
        for (let c = 0; c < d.nCols; c++) {
          const t = d.zmax > d.zmin ? (d.z[r * d.nCols + c] - d.zmin) / (d.zmax - d.zmin) : 0;
          const [cr, cg, cb] = colormap(t, cmap);
          const o = (r * d.nCols + c) * 4;
          img.data[o] = cr; img.data[o + 1] = cg; img.data[o + 2] = cb; img.data[o + 3] = 255;
        }
      }
      const off = document.createElement('canvas');
      off.width = d.nCols; off.height = d.nRows;
      off.getContext('2d')!.putImageData(img, 0, 0);
      // 注意 β 行序：网格 r=0 对应 yRange[0]（底部）→ 翻转绘制
      ctx.imageSmoothingEnabled = true;
      ctx.save();
      ctx.translate(R.x, R.y + R.h);
      ctx.scale(1, -1);
      ctx.drawImage(off, 0, 0, d.nCols, d.nRows, 0, 0, R.w, R.h);
      ctx.restore();
    }

    // ---- 等高线（共享比例尺叠画）----
    if (contourLevels.length > 0 && contourRings.length > 0) {
      ctx.strokeStyle = dark ? 'rgba(226,232,240,0.65)' : 'rgba(15,23,42,0.6)';
      ctx.lineWidth = 1;
      for (const ring of contourRings) {
        ctx.beginPath();
        ring.points.forEach(([a, b], i) => {
          const [px, py] = toPx(a, b, d, R);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.stroke();
      }
    }

    // ---- 小球 + 尾迹 ----
    if (activePath && ballIdx >= 0) {
      const trail = dark ? 'rgba(255,255,255,0.85)' : 'rgba(17,24,39,0.65)';
      ctx.strokeStyle = trail;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const lim = Math.min(ballIdx, activePath.length - 1);
      for (let i = 0; i <= lim; i++) {
        const [px, py] = toPx(activePath[i][0], activePath[i][1], d, R);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      // 起点标记
      const [sx, sy] = toPx(activePath[0][0], activePath[0][1], d, R);
      ctx.strokeStyle = trail;
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.stroke();
      // 小球
      const [bx, by] = toPx(activePath[lim][0], activePath[lim][1], d, R);
      const r = Math.max(4.5, R.w * 0.008);
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
      ctx.strokeStyle = dark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // ---- 绘图区边框 ----
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(R.x, R.y, R.w, R.h);

    // ---- 轴刻度 ----
    ctx.fillStyle = axis;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ticks = 5;
    for (let i = 0; i < ticks; i++) {
      const t = i / (ticks - 1);
      const a = d.xRange[0] + t * (d.xRange[1] - d.xRange[0]);
      const px = R.x + t * R.w;
      ctx.fillText(formatTick(a), px, R.y + R.h + 6);
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(px, R.y); ctx.lineTo(px, R.y + R.h);
      ctx.stroke();
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < ticks; i++) {
      const t = i / (ticks - 1);
      const b = d.yRange[0] + t * (d.yRange[1] - d.yRange[0]);
      const py = R.y + (1 - t) * R.h;
      ctx.fillText(formatTick(b), R.x - 6, py);
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(R.x, py); ctx.lineTo(R.x + R.w, py);
      ctx.stroke();
    }

    // ---- 轴标题 ----
    ctx.fillStyle = axis;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('α (direction 1)', R.x + R.w / 2, R.H - 2);
    ctx.save();
    ctx.translate(12, R.y + R.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'top';
    ctx.fillText('β (direction 2)', 0, 0);
    ctx.restore();
  }

  function formatTick(v: number): string {
    if (Math.abs(v) >= 100 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(1);
    return String(Math.round(v * 1000) / 1000);
  }

  function onMove(e: MouseEvent) {
    if (!data || !container) return;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const R = plotRect();
    if (mx < R.x || mx > R.x + R.w || my < R.y || my > R.y + R.h) { hover = null; return; }
    const d = data;
    const a = d.xRange[0] + ((mx - R.x) / R.w) * (d.xRange[1] - d.xRange[0]);
    const b = d.yRange[0] + (1 - (my - R.y) / R.h) * (d.yRange[1] - d.yRange[0]);
    const c = Math.min(d.nCols - 1, Math.max(0, Math.round(((a - d.xRange[0]) / (d.xRange[1] - d.xRange[0])) * (d.nCols - 1))));
    const r = Math.min(d.nRows - 1, Math.max(0, Math.round(((b - d.yRange[0]) / (d.yRange[1] - d.yRange[0])) * (d.nRows - 1))));
    hover = { a, b, loss: d.z[r * d.nCols + c], mx, my };
  }

  // 数据/等高线/主题/配色/底色开关变化 → 重绘
  $effect(() => {
    void data; void contourLevels; void contourRings; void dark; void cmap; void fillHeat;
    draw();
  });

  let ro: ResizeObserver | null = null;
  $effect(() => {
    if (!container) return;
    ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro?.disconnect();
  });

  onDestroy(() => { ro?.disconnect(); });
</script>

<div class="w-full">
  <div
    bind:this={container}
    class="relative w-full"
    style="height: {height}px;"
    role="img"
    aria-label="Loss landscape heatmap — axes α (direction 1) and β (direction 2), color encodes loss"
    onmousemove={onMove}
    onmouseleave={() => (hover = null)}
  >
    <canvas bind:this={canvas} class="absolute inset-0"></canvas>
    {#if hover}
      <div
        class="pointer-events-none absolute z-20"
        style="left: {hover.mx}px; top: {hover.my}px; transform: translate(12px, 12px);"
      >
        <div class="rounded-md border border-border bg-popover/95 px-2 py-1.5 text-xs shadow-md backdrop-blur">
          <div class="font-mono font-medium text-foreground">loss {hover.loss.toFixed(4)}</div>
          <div class="font-mono text-muted-foreground">α {hover.a.toFixed(3)} · β {hover.b.toFixed(3)}</div>
        </div>
      </div>
    {/if}
    {#if !data}
      <div class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">No landscape data</div>
    {/if}
  </div>
</div>
