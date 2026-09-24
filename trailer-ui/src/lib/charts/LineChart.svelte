<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chart } from '@antv/g2';
  import { g2Theme, onChartThemeChange, adaptiveTicks } from './chartTheme.svelte';
  import { filterLineData, findNearestDatum, pointKey, toNum, loadFilterState, saveFilterState } from './lineFilter';
  import type { ExcludeRange, XWindow } from './lineFilter';

  interface DataPoint {
    step: number;
    value: number;
    [key: string]: unknown;
  }

  interface Props {
    data: DataPoint[];
    xField?: string;
    yField?: string;
    xIsTime?: boolean;
    seriesField?: string;
    colors?: string[];
    height?: number;
    smooth?: boolean;
    color?: string;
    lineWidth?: number;
    point?: boolean;
    title?: string;
    /// Log scale on x axis (ignored when xIsTime)
    logX?: boolean;
    /// Log scale on y axis
    logY?: boolean;
    /// Metric name shown in tooltip (e.g. "train/loss")
    metricLabel?: string;
    /// Y 值格式化(轴刻度与 tooltip),如系统指标的 GB/百分比
    yFormat?: (v: number) => string;
    /// Moving-average window (SMA) applied per series (>1 enables)
    smoothWindow?: number;
    /// Points to highlight on the chart (e.g. latest data point marker)
    markers?: Array<{ step: number; value: number; color?: string }>;
    /// 持久化标识：传入后 Select/Exclude 状态写入 localStorage 并在挂载时恢复
    /// （键 trailer-line-filter-<key>，按图表实例区分；缺省不持久化）
    storageKey?: string;
  }

  let {
    data = [],
    xField = 'step',
    yField = 'value',
    xIsTime = false,
    seriesField,
    colors,
    height = 350,
    smooth = false,
    color = '#2563eb',
    lineWidth = 1.5,
    point = false,
    title = '',
    logX = false,
    logY = false,
    metricLabel = '',
    yFormat,
    smoothWindow = 0,
    markers = [],
    storageKey,
  }: Props = $props();

  let container: HTMLDivElement;
  let chart: Chart | null = null;

  // ─── 框选窗口/排除(会话内经回放/热更新/主题重建保留;传 storageKey 时另存
  //     localStorage,刷新/重开浏览器后恢复——不入库,仅浏览器本地) ───
  const restored = storageKey ? loadFilterState(storageKey) : null;
  /// 交互模式:none=默认无手势(与 tooltip 零冲突);select=框选过滤 x 窗口;exclude=框选排除区段+点选排除单点。
  /// 需先点按钮进入模式再操作(用户反馈:先加按钮,然后选择)。select/exclude 互斥。
  type BrushMode = 'none' | 'select' | 'exclude';
  let brushMode = $state<BrushMode>(restored?.brushMode ?? 'none');
  /// 框选的 x 显示窗口(数据域,time 轴为 ms)。双击图内还原
  let xWindow = $state<XWindow | null>(restored?.xWindow ?? null);
  /// 排除的 x 区段与单点((series,x) key)
  let excludeRanges = $state<ExcludeRange[]>(restored?.excludeRanges ?? []);
  let excludePoints = $state<Set<string>>(new Set(restored?.excludePoints ?? []));
  const excludeCount = $derived(excludeRanges.length + excludePoints.size);
  /// buildOptions 最近一次过滤后的可见行:点选排除时按其找最近点
  let lastPlotData: Array<Record<string, unknown>> = [];
  /// brush 结束时间戳:其后短窗内的 click 视为拖拽副产物,防止误触发点选排除
  let lastBrushAt = 0;
  let clickExcludeTimer: ReturnType<typeof setTimeout> | null = null;

  /// 结构性选项(log 轴/平滑等)变化需销毁重建,确保 G2 scale 干净切换;纯数据变化走热更新
  function structKey(): string {
    return JSON.stringify([seriesField ?? null, xIsTime, logX, logY, smooth, smoothWindow]);
  }
  let prevStructKey = '';

  /// Custom tick method: integer tick values honoring the requested count.
  /// G2 把 scale.tickCount 作为 tickMethod 的 count 传入;旧实现忽略 count 逐整数
  /// 返回(0..80 → 81 个),窄卡片网格密集。现在按 count 取 1/2/5×10^k 整数步长。
  function integerTick(min: number, max: number, count: number): number[] {
    if (!(max > min)) return [min];
    const rawStep = (max - min) / Math.max(2, count || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const step = Math.max(1, (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag);
    const start = Math.ceil(min / step) * step;
    const ticks: number[] = [];
    for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Math.round(v));
    return ticks.length > 1 ? ticks : [Math.floor(min), Math.ceil(max)];
  }

  /// Simple moving average per series (window > 1 enables)
  function applySMA(rows: Array<Record<string, unknown>>, window: number): Array<Record<string, unknown>> {
    if (window <= 1 || rows.length === 0) return rows;
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const r of rows) {
      const key = seriesField ? String(r[seriesField] ?? '') : '_single';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const out: Array<Record<string, unknown>> = [];
    for (const group of groups.values()) {
      group.forEach((r, i) => {
        const start = Math.max(0, i - window + 1);
        const slice = group.slice(start, i + 1);
        const avg = slice.reduce((s, x) => s + Number(x[yField] ?? 0), 0) / slice.length;
        out.push({ ...r, [yField]: avg });
      });
    }
    return out;
  }

  function buildOptions(): Record<string, unknown> {
    // G2 v5 time scale requires Date objects (not numeric timestamps).
    // Convert second/ms timestamps to Date objects so G2 auto-detects time scale.
    let plotData: Array<Record<string, unknown>> = data as unknown as Array<Record<string, unknown>>;
    if (xIsTime && data.length > 0) {
      plotData = data.map(d => {
        const raw = Number(d[xField]);
        const ms = !isNaN(raw) && raw > 0 && raw < 1e11 ? raw * 1000 : raw;
        return { ...d, [xField]: new Date(ms) };
      });
    }
    // 框选窗口 + 排除(行级过滤 → scale.y 不钉 domain,y 随可见数据自适应)。
    // 放在 SMA 前:被排除的异常点不污染平滑窗口。
    plotData = filterLineData(plotData, { xField, seriesField, xWindow, excludeRanges, excludePoints });
    // 移动平均平滑(按 series 分组)
    if (smoothWindow > 1) {
      plotData = applySMA(plotData, smoothWindow);
    }
    lastPlotData = plotData;

    // 网格/刻度随容器尺寸自适应:卡片缩小(Boards 拖拽缩放/列数切换)时自动变稀,
    // 避免 tick 数固定导致网格密集。ResizeObserver 会在尺寸变化时重建触发重算。
    const xTicks = adaptiveTicks(container?.clientWidth ?? 600, 70, 12);
    const yTicks = adaptiveTicks(height, 55, 8);

    const scaleX: Record<string, unknown> = xIsTime
      ? { nice: false, tickCount: xTicks }
      : { nice: false, tickMethod: integerTick, tickCount: xTicks };
    const scaleY: Record<string, unknown> = { nice: true, tickCount: yTicks };
    if (logX && !xIsTime) scaleX.type = 'log';
    if (logY) scaleY.type = 'log';

    const options: Record<string, unknown> = {
      type: 'line',
      data: plotData,
      encode: {
        x: xField,
        y: yField,
      },
      scale: {
        x: scaleX,
        y: scaleY,
      },
      axis: {
        x: xIsTime ? { title: false, labelFormatter: (d: any) => { const dt = d instanceof Date ? d : new Date(d); return dt.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }, labelAutoHide: true, labelAutoRotate: false } : { title: false, labelAutoHide: true, labelAutoRotate: false },
        y: yFormat ? { title: false, labelAutoHide: true, labelAutoRotate: false, labelFormatter: yFormat } : { title: false, labelAutoHide: true, labelAutoRotate: false },
      },
      legend: false,
      tooltip: {
        // x 轴信息显示在 title(多 series 时只显示一次)；items 只列 y(各 series 值)
        title: (d: any) => {
          if (xIsTime) {
            const dt = d[xField] instanceof Date ? d[xField] : new Date(Number(d[xField]));
            return dt.toLocaleString();
          }
          return `${xField}: ${d[xField]}`;
        },
        items: [{ channel: 'y', name: metricLabel || yField, valueFormatter: yFormat ?? ((v: number) => { const s = String(v); const i = s.indexOf('.'); return i < 0 || s.length - i - 1 <= 6 ? s : v.toFixed(6); }) }],
      },
      // crosshair 需配在 interaction.tooltip 而非 tooltip：crosshairsY(竖线)默认开，crosshairsX(水平线)需显式开启
      interaction: {
        tooltip: {
          crosshairsX: true,
          crosshairsY: true,
          crosshairsXStroke: '#94a3b8',
          crosshairsYStroke: '#94a3b8',
        },
        // TensorBoard 式 x 向框选手势:只借其 drag 手势与 brush:end(selection 已是数据域,
        // selectionOf 完成像素→invert→scale.invert,Date/log 均正确)。仅 Select/Exclude
        /// 模式激活时注入(false 时 G2 update 会销毁旧实例)——默认无手势,与 tooltip 零冲突。
        // 不用 brushXFilter:它会钉死 y domain,行级过滤后 y 无法自适应。
        // 排除/过滤完成后立刻 chart.emit('brush:remove') 清 mask 与 active/inactive 态。
        brushXHighlight:
          brushMode !== 'none'
            ? {
                maskFill: '#3b82f6',
                maskFillOpacity: 0.22,
                maskStroke: '#3b82f6',
                maskStrokeOpacity: 0.85,
                maskLineWidth: 1.5,
              }
            : false,
      },
      animate: { enter: { type: 'waveIn' } }
    };

    if (seriesField) {
      const palette = colors ?? ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4898', '#06b6d4', '#f97316', '#6366f1', '#14b8a6'];
      options.encode = {
        x: xField,
        y: yField,
        color: seriesField,
      };
      options.type = 'line';
      options.scale = { ...options.scale, color: { range: palette } };
      // lineWidth is safe to set with seriesField (doesn't override color encoding)
      options.style = { lineWidth, ...(smooth ? { shape: 'smooth' } : {}) };
    } else {
      options.style = {
        stroke: color,
        lineWidth,
        ...(smooth ? { shape: 'smooth' } : {}),
      };
    }

    if (point) {
      options.point = {
        size: 3,
        shape: 'point',
      };
    }

    // Add latest-point markers as big green dots (G2 native, no white border)
    if (markers.length > 0) {
      // Markers may be in sec/ms — convert to Date objects to match time axis.
      // pulseMarker 标记随数据行进入渲染元素的 __data__,供元素级脉冲动画定位。
      let plotMarkers: Array<Record<string, unknown>> = markers.map(m => ({ ...m, pulseMarker: 1 }));
      if (xIsTime && markers.length > 0) {
        plotMarkers = plotMarkers.map(m => {
          const raw = Number(m.step);
          const ms = !isNaN(raw) && raw > 0 && raw < 1e11 ? raw * 1000 : raw;
          return { ...m, step: new Date(ms) };
        });
      }
      // 窗口/排除区段外的最新点标记不画(markers 无 series 信息,点选排除不参与)
      plotMarkers = filterLineData(plotMarkers, { xField: 'step', xWindow, excludeRanges });
      const lineSpec = { ...options };
      delete lineSpec.animate;
      options.type = 'view';
      options.children = [
        lineSpec,
        {
          type: 'point',
          data: plotMarkers,
          encode: { x: xField, y: yField },
          style: {
            fill: '#22c55e',
            r: 18,
            stroke: null,
            lineWidth: 0,
            cursor: 'pointer',
            opacity: 0.9,
          },
          animate: false,
        },
      ];
    }

    return options;
  }

  let pulseAnims: Array<{ cancel(): void }> = [];

  function stopPulse() {
    for (const a of pulseAnims) { try { a.cancel(); } catch { /* ignore */ } }
    pulseAnims = [];
  }

  /// 在 G2 场景图中找最新点标记的图形对象。标记渲染结构:层组 g 的 __data__.data
  /// 携带 pulseMarker 数据行,圆点是其下的 path 元素(数据 join 后非 circle)。
  /// 桥接 G2 内部结构,保持 any。
  function findMarkerShapes(): any[] {
    if (!chart) return [];
    try {
      const root: any = (chart as any).getContext?.().canvas?.document?.documentElement;
      if (!root) return [];
      const out: any[] = [];
      const walk = (n: any) => {
        for (const c of n.childNodes ?? []) {
          const d = c?.__data__;
          if (d && Array.isArray(d.data) && d.data.some((x: any) => x?.pulseMarker)) {
            for (const p of c.childNodes ?? []) if (p.nodeName === 'path') out.push(p);
          }
          walk(c);
        }
      };
      walk(root);
      return out;
    } catch {
      return [];
    }
  }

  /// 脉冲用 @antv/g 的 WAAPI 无限动画直接驱动标记图形(transform scale + opacity),
  /// 绝不整图重渲染——整图 render() 会销毁 tooltip 状态,这是运行中 run 悬停闪烁的根因。
  /// path 几何在渲染期已定,不能动画 r;scale 配 transformOrigin:'center' 原位缩放。
  function startPulse() {
    stopPulse();
    if (!chart || markers.length === 0) return;
    for (const shape of findMarkerShapes()) {
      try {
        shape.style.transformOrigin = 'center';
        shape.style.transformBox = 'fill-box';
        const anim = shape.animate(
          [
            { transform: 'scale(1)', opacity: 1 },
            { transform: 'scale(1.2)', opacity: 0.25 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          { duration: 900, iterations: Infinity, easing: 'ease-in-out' },
        );
        if (anim) pulseAnims.push(anim);
      } catch { /* 渲染环境不支持 WAAPI 时跳过 */ }
    }
  }

  /// render() 是异步的,元素就绪后再挂脉冲;epoch 比对防止过期 promise 给新图挂旧动画
  function renderAndPulse() {
    if (!chart) return;
    const c = chart;
    Promise.resolve(c.render())
      .then(() => { if (chart === c) startPulse(); })
      .catch(() => {});
  }

  /// 本地交互(框选/点选/按钮)引发的重渲染:绕过 hoverPause——这是用户主动操作,
  /// 立即生效优先于保护 tooltip;pending 一并清掉防止随后重复渲染。
  function requestUpdate() {
    if (!chart) return;
    pendingHotUpdate = false;
    hotUpdate();
  }

  /// 任一过滤状态变更后写 localStorage(storageKey 缺省时 no-op)
  function persistFilter() {
    if (!storageKey) return;
    saveFilterState(storageKey, {
      brushMode,
      xWindow,
      excludeRanges,
      excludePoints: [...excludePoints],
    });
  }

  // ─── 框选:brushXHighlight 手势完成 → selection[0] 即 x 数据域(selectionOf 已做换算) ───
  function onBrushEnd(e: any) {
    if (brushMode === 'none') return;
    const selection = e?.data?.selection;
    if (!Array.isArray(selection)) return;
    const domainX = selection[0] as [unknown, unknown];
    if (!Array.isArray(domainX)) return;
    // Date(time 轴)→ms;零宽(单击误触)忽略
    let x0 = toNum(domainX[0]);
    let x1 = toNum(domainX[1]);
    if (!Number.isFinite(x0) || !Number.isFinite(x1) || x0 === x1) return;
    if (x0 > x1) [x0, x1] = [x1, x0];
    lastBrushAt = Date.now();
    if (brushMode === 'exclude') {
      excludeRanges = [...excludeRanges, [x0, x1] as ExcludeRange];
    } else {
      xWindow = [x0, x1];
    }
    // 清手势残留 mask(带 active/inactive 态),源码:onRemove 仅 !nativeEvent 时执行
    try { chart?.emit('brush:remove'); } catch { /* 尚未注册 interaction 时忽略 */ }
    persistFilter();
    requestUpdate();
  }

  // ─── 点选排除:用 plot:click(图内任意单击都触发,不必命中 1.5px 的线——
  ///     element:click 命中率过低是"点选不灵敏"的根因之一),按坐标找最近点。
  ///     延迟执行:双击序列会先发 detail=1 的 click,由 dblclick 在窗口内取消 ───
  function onPlotClick(e: any) {
    if (brushMode !== 'exclude') return;
    // 框选拖完浏览器仍会补发 click——短窗内忽略,防框选后误排除最近点
    if (Date.now() - lastBrushAt < 350) return;
    if (clickExcludeTimer) clearTimeout(clickExcludeTimer);
    const ox = e?.offsetX;
    const oy = e?.offsetY;
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) return;
    clickExcludeTimer = setTimeout(() => {
      clickExcludeTimer = null;
      applyPointExclude(ox, oy);
    }, 140);
  }

  function applyPointExclude(ox: number, oy: number) {
    if (!chart || brushMode !== 'exclude') return;
    try {
      const coordinate = (chart as any).getCoordinate?.();
      const scales = (chart as any).getScale?.();
      if (!coordinate?.invert || !scales?.x?.invert || !scales?.y?.invert) return;
      const plotRect = getPlotRect();
      if (!plotRect) return;
      // offsetX/offsetY 相对 canvas → plot 内坐标;coordinate.invert 得到的是 scale range
      // 空间,**必须再 scale.invert 才是数据域**(selectionOf 同款两步换算——
      // 之前漏了第二步,点选排除用像素值当数据坐标比对,几乎点不中,用户反馈不灵敏)。
      const px = ox - plotRect.x;
      const py = oy - plotRect.y;
      const [rangeX, rangeY] = coordinate.invert([px, py]);
      const dataX = toNum(scales.x.invert(rangeX));
      const dataY = toNum(scales.y.invert(rangeY));
      if (!Number.isFinite(dataX) || !Number.isFinite(dataY)) return;
      const rows = lastPlotData;
      if (rows.length === 0) return;
      // 域跨度:可见行数据域归一化(找最近点用)
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      for (const r of rows) {
        const rx = toNum(r[xField]);
        const ry = Number(r[yField]);
        if (Number.isFinite(rx)) { if (rx < xMin) xMin = rx; if (rx > xMax) xMax = rx; }
        if (Number.isFinite(ry)) { if (ry < yMin) yMin = ry; if (ry > yMax) yMax = ry; }
      }
      const hit = findNearestDatum(rows, {
        xField, yField,
        clickX: dataX, clickY: dataY,
        xMin, xMax, yMin, yMax,
        // 像素阈值:点太远视为误点(排除模式下点击空白不动作)
        plotW: plotRect.w, plotH: plotRect.h, maxPixelDist: 48,
      });
      if (!hit) return;
      const s = seriesField ? String(hit[seriesField] ?? '') : null;
      excludePoints = new Set(excludePoints).add(pointKey(s, toNum(hit[xField])));
      persistFilter();
      requestUpdate();
    } catch { /* 坐标换算失败静默,不影响图 */ }
  }

  /// plot 区域(canvas 内)原点与尺寸:遍历 G 场景找 className='plot' 的 rect。
  /// G 的 getBoundingClientRect 返回 viewport 相对,须再减 canvas 的 viewport 偏移。
  function getPlotRect(): { x: number; y: number; w: number; h: number } | null {
    const root: any = (chart as any)?.getContext?.().canvas?.document?.documentElement;
    if (!root) return null;
    let plot: any = null;
    const walk = (n: any) => {
      if (plot) return;
      if (n?.className === 'plot') { plot = n; return; }
      for (const c of n?.childNodes ?? []) walk(c);
    };
    walk(root);
    if (!plot?.getBoundingClientRect) return null;
    const canvasEl = (container?.querySelector('canvas') ?? null) as HTMLCanvasElement | null;
    const canvasRect = canvasEl?.getBoundingClientRect();
    const rect = plot.getBoundingClientRect();
    const originX = canvasRect ? (rect.x ?? rect.left) - canvasRect.left : (rect.x ?? rect.left ?? 0);
    const originY = canvasRect ? (rect.y ?? rect.top) - canvasRect.top : (rect.y ?? rect.top ?? 0);
    return { x: originX, y: originY, w: Number(rect.width) || 0, h: Number(rect.height) || 0 };
  }

  function cancelPointExclude() {
    if (clickExcludeTimer) {
      clearTimeout(clickExcludeTimer);
      clickExcludeTimer = null;
    }
  }

  function clearXWindow() {
    cancelPointExclude();
    if (xWindow === null) return;
    xWindow = null;
    persistFilter();
    requestUpdate();
  }

  function restoreExcluded() {
    if (excludeRanges.length === 0 && excludePoints.size === 0) return;
    excludeRanges = [];
    excludePoints = new Set();
    persistFilter();
    requestUpdate();
  }

  function toggleSelectMode() {
    cancelPointExclude();
    brushMode = brushMode === 'select' ? 'none' : 'select';
    persistFilter();
    requestUpdate(); // interaction 开关随 options 重建(G2 update 会销毁/注入 brush 手势)
  }

  function toggleExcludeMode() {
    cancelPointExclude();
    brushMode = brushMode === 'exclude' ? 'none' : 'exclude';
    persistFilter();
    requestUpdate();
  }

  function fmtBound(v: number): string {
    if (xIsTime) {
      return new Date(v).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return String(Math.round(v * 1000) / 1000);
  }

  /// G2 emitter 事件统一挂载/卸载(createChart 重建时旧实例已 destroy,只需新挂)。
  /// ?.防御:测试环境中 Chart mock 可能无 emitter 方法。
  function bindChartEvents(c: Chart) {
    c.on?.('brush:end', onBrushEnd);
    c.on?.('plot:click', onPlotClick);
  }

  function createChart() {
    stopPulse();
    chart?.destroy();
    const theme = g2Theme();
    chart = new Chart({
      container,
      autoFit: true,
      height,
      animate: true,
      ...(theme ? { theme } : {}),
    });
    chart.options(buildOptions());
    bindChartEvents(chart);
    prevStructKey = structKey();
    pendingHotUpdate = false;
    renderAndPulse();
  }

  /// 数据/标记热更新:只换 options 重渲染,不重建 Chart 实例
  function hotUpdate() {
    if (!chart) return;
    chart.options(buildOptions());
    renderAndPulse();
  }

  // ─── 悬停期间推迟热更新(轮询渲染会打断 tooltip),移开后补一次渲染 ───
  let hoverPause = false;
  let pendingHotUpdate = false;

  function flushPendingHotUpdate() {
    hoverPause = false;
    if (pendingHotUpdate) {
      pendingHotUpdate = false;
      hotUpdate();
    }
  }

  /// props 变化 → 图表更新的命令式通道:use: action 的 update 在参数表达式
  /// 变化时被模板调用,不经过 $effect。悬停监听也挂在这里(action 挂载即注册)。
  function chartSync(node: HTMLDivElement, _params: { data: DataPoint[]; markers: Props['markers'] }) {
    const onEnter = () => { hoverPause = true; };
    node.addEventListener('pointerenter', onEnter);
    node.addEventListener('pointerleave', flushPendingHotUpdate);
    // 图内松开指针(拖框选/调手柄)也补一次 flush——hoverPause 只在 leave 恢复,
    // 手停在卡片上时 pending 永不执行,回放/实时流视觉上会"卡死"。拖完即恢复数据流,
    // 之后继续悬停看 tooltip 若被下一 tick 刷新,以「图继续运行」优先。
    const onWindowPointerUp = () => flushPendingHotUpdate();
    window.addEventListener('pointerup', onWindowPointerUp);
    // 双击还原显示窗口(TensorBoard 习惯);顺带取消挂起的点选排除(双击≠两次点选)
    node.addEventListener('dblclick', clearXWindow);
    return {
      update() {
        if (!chart) return; // onMount 尚未建图,由 onMount 用最新 props 创建
        if (structKey() !== prevStructKey) {
          createChart();
        } else if (hoverPause) {
          pendingHotUpdate = true;
        } else {
          hotUpdate();
        }
      },
      destroy() {
        node.removeEventListener('pointerenter', onEnter);
        node.removeEventListener('pointerleave', flushPendingHotUpdate);
        window.removeEventListener('pointerup', onWindowPointerUp);
        node.removeEventListener('dblclick', clearXWindow);
      },
    };
  }

  let offChartTheme: (() => void) | null = null;
  let resizeObs: ResizeObserver | null = null;

  onMount(() => {
    createChart();
    // 容器尺寸变化(如列数切换)时销毁重建,让 G2 autoFit 重新计算
    if (container && typeof ResizeObserver !== 'undefined') {
      resizeObs = new ResizeObserver(() => createChart());
      resizeObs.observe(container);
    }
    // 主题切换销毁重建(外部事件订阅,非 effect)
    offChartTheme = onChartThemeChange(() => createChart());
  });

  onDestroy(() => {
    offChartTheme?.();
    resizeObs?.disconnect();
    cancelPointExclude();
    stopPulse();
    chart?.destroy();
    chart = null;
  });
</script>

<div class="w-full">
  {#if title}
    <h3 class="text-sm font-semibold mb-2 text-foreground">{title}</h3>
  {/if}
  <div class="relative w-full">
    <div
      bind:this={container}
      class="w-full {brushMode !== 'none' ? 'cursor-crosshair' : ''}"
      style="height: {height}px;"
      use:chartSync={{ data, markers }}
    ></div>
    <!-- 图内工具条(卡片右上):Select/Exclude 模式按钮(互斥,需先点按钮再操作)、
         恢复排除、显示窗口提示。仅图会话状态,文案英文。 -->
    <div class="absolute top-1 right-1 z-10 flex items-center gap-1">
      {#if xWindow}
        <button
          type="button"
          class="flex items-center gap-1 px-1.5 py-0.5 text-[10px] leading-none border border-border rounded bg-background/90 text-muted-foreground hover:text-foreground transition-colors"
          title="Visible range — click to reset (double-click chart also resets)"
          onclick={clearXWindow}
        >
          {fmtBound(xWindow[0])} ~ {fmtBound(xWindow[1])}
          <span aria-hidden="true">×</span>
        </button>
      {/if}
      {#if excludeCount > 0}
        <button
          type="button"
          class="flex items-center gap-1 px-1.5 py-0.5 text-[10px] leading-none border border-border rounded bg-background/90 text-muted-foreground hover:text-foreground transition-colors"
          title="Restore all exclusions"
          onclick={restoreExcluded}
        >
          Restore ({excludeCount})
        </button>
      {/if}
      <button
        type="button"
        class="flex items-center px-1.5 py-0.5 text-[10px] leading-none border rounded transition-colors {brushMode === 'select'
          ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
          : 'border-border bg-background/90 text-muted-foreground hover:text-foreground'}"
        title={brushMode === 'select'
          ? 'Selecting: drag on chart to filter the x range (double-click to reset)'
          : 'Select mode: drag on chart to show only a range'}
        aria-pressed={brushMode === 'select'}
        onclick={toggleSelectMode}
      >
        Select
      </button>
      <button
        type="button"
        class="flex items-center px-1.5 py-0.5 text-[10px] leading-none border rounded transition-colors {brushMode === 'exclude'
          ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400'
          : 'border-border bg-background/90 text-muted-foreground hover:text-foreground'}"
        title={brushMode === 'exclude'
          ? 'Excluding: drag to exclude an x span, click a point to exclude it'
          : 'Exclude mode: remove outlier spans/points (y re-adapts)'}
        aria-pressed={brushMode === 'exclude'}
        onclick={toggleExcludeMode}
      >
        Exclude
      </button>
    </div>
  </div>
</div>
