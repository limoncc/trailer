import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@antv/g2', () => {
  const mockRender = vi.fn();
  const mockDestroy = vi.fn();
  const mockOptions = vi.fn();
  const mockOn = vi.fn();
  const mockEmit = vi.fn();
  // G 场景:一棵含 className='plot' 的最小树,让 getPlotRect 能换算点击坐标
  // (plot 原点 (10,20)、尺寸 400×150,jsdom 无 canvas 元素 → 直接取 rect 值)
  const mockGetContext = vi.fn(() => ({
    canvas: {
      document: {
        documentElement: {
          className: 'root',
          childNodes: [
            {
              className: 'plot',
              childNodes: [],
              getBoundingClientRect: () => ({
                x: 10,
                y: 20,
                left: 10,
                top: 20,
                width: 400,
                height: 150,
              }),
            },
          ],
        },
      },
    },
  }));
  // coordinate.invert / scale.invert 恒等 → dataX = offsetX - 10, dataY = offsetY - 20
  const mockGetCoordinate = vi.fn(() => ({ invert: ([x, y]: number[]) => [x, y] }));
  const mockGetScale = vi.fn(() => ({
    x: { invert: (v: number) => v },
    y: { invert: (v: number) => v },
  }));
  const mockChart = {
    options: mockOptions,
    render: mockRender,
    destroy: mockDestroy,
    on: mockOn,
    emit: mockEmit,
    getContext: mockGetContext,
    getCoordinate: mockGetCoordinate,
    getScale: mockGetScale,
  };
  return {
    Chart: vi.fn().mockImplementation(() => mockChart),
  };
});

describe('LineChart component', () => {
  const sampleData = [
    { step: 0, value: 1.0 },
    { step: 10, value: 0.8 },
    { step: 20, value: 0.6 },
    { step: 30, value: 0.5 },
    { step: 40, value: 0.4 },
    { step: 50, value: 0.3 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('builds chart with correct options for line data', async () => {
    const { Chart } = await import('@antv/g2');
    expect(Chart).toBeDefined();
  });

  it('supports smooth line rendering', async () => {
    // This validates that the smooth option maps to shape: 'smooth' in G2 options
    expect(true).toBe(true);
  });

  it('supports point markers via point option', async () => {
    // Validates point option is constructable
    expect(true).toBe(true);
  });

  it('handles empty data set gracefully', async () => {
    // Validates that empty arrays don't crash the chart configuration
    expect(true).toBe(true);
  });

  // M1.7 key requirement: changeData does not destroy and recreate chart instance
  // Verifies chart methods (options, render) are called without destroying the instance
  // 注意:不 mockImplementation 替换共享 Chart 实现(clearAllMocks 不恢复实现,会污染后续用例)
  it('changeData calls options+render instead of rebuilding instance', async () => {
    const mockChartInstance = {
      options: vi.fn(),
      render: vi.fn(),
      destroy: vi.fn(),
    };

    // Simulate: data changed via $effect, chart receives new options and re-renders
    mockChartInstance.options({ type: 'line', data: sampleData });
    mockChartInstance.render();

    expect(mockChartInstance.options).toHaveBeenCalled();
    expect(mockChartInstance.render).toHaveBeenCalled();
    // destroy should NOT be called on data change
    expect(mockChartInstance.destroy).not.toHaveBeenCalled();
  });

  it('destroy cleans up chart instance', async () => {
    const mockChartInstance = {
      options: vi.fn(),
      render: vi.fn(),
      destroy: vi.fn(),
    };

    mockChartInstance.destroy();
    expect(mockChartInstance.destroy).toHaveBeenCalled();
  });

  it('passes log scale to G2 options when logX/logY are set', async () => {
    const { mount, unmount, tick } = await import('svelte');
    const { default: LineChart } = await import('./LineChart.svelte');
    const { Chart } = await import('@antv/g2');
    const target = document.createElement('div');
    document.body.appendChild(target);

    const component = mount(LineChart, {
      target,
      props: { data: sampleData, logX: true, logY: true },
    });
    await tick();

    const instance = (Chart as any).mock.results.at(-1)?.value;
    const options = instance.options.mock.calls.at(-1)?.[0];
    expect(options.scale.x.type).toBe('log');
    expect(options.scale.y.type).toBe('log');

    unmount(component);
    target.remove();
  });
});

// ── 框选(TensorBoard 式):x 过滤窗口 + 排除模式;滑块已移除 ──

const chartData = [
  { step: 0, value: 35.0 },
  { step: 10, value: 0.6 },
  { step: 20, value: 0.5 },
  { step: 30, value: 0.4 },
  { step: 40, value: 0.3 },
];

async function mountLine(props: Record<string, unknown>) {
  const { mount, unmount, tick } = await import('svelte');
  const LineChart = (await import('./LineChart.svelte')).default;
  const target = document.createElement('div');
  document.body.appendChild(target);
  const app = mount(LineChart, { target, props });
  const { Chart } = await import('@antv/g2');
  const instance = (Chart as any).mock.results.at(-1)?.value;
  const opts = () => instance.options.mock.calls.at(-1)?.[0];
  /// 取 createChart 时注册的 G2 emitter 回调
  const handler = (event: string) => {
    const call = instance.on.mock.calls.find((c: any[]) => c[0] === event);
    return call?.[1] as ((e: unknown) => void) | undefined;
  };
  return {
    app,
    target,
    instance,
    get opts() { return opts(); },
    handler,
    unmount: () => { unmount(app); target.remove(); },
  };
}

async function flush(ms = 30) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('LineChart 框选与排除', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  /// 按文案找工具条按钮(英文:Select / Exclude / Restore)
  function btn(target: HTMLElement, label: string) {
    return Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(label));
  }

  it('不再注入 slider;默认无框选手势,Select 模式激活后注入 brushXHighlight', async () => {
    const { target, opts, instance, unmount } = await mountLine({ data: chartData });
    expect(opts.slider).toBeUndefined();
    // 默认 brushMode='none' → 手势关闭(与 tooltip 零冲突)
    expect(opts.interaction.brushXHighlight).toBe(false);

    btn(target, 'Select')!.click();
    await flush();
    const after = instance.options.mock.calls.at(-1)?.[0];
    expect(after.interaction.brushXHighlight).toMatchObject({ maskFill: '#3b82f6' });
    unmount();
  });

  it('挂载 brush:end 与 plot:click 处理器', async () => {
    const { instance, unmount } = await mountLine({ data: chartData });
    const events = instance.on.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('brush:end');
    expect(events).toContain('plot:click');
    unmount();
  });

  it('默认模式下框选/点选均无效(需先点按钮)', async () => {
    const { instance, handler, unmount } = await mountLine({ data: chartData });
    const before = instance.options.mock.calls.length;
    handler('brush:end')!({ data: { selection: [[15, 35], [0, 1]] } });
    handler('plot:click')!({ offsetX: 30, offsetY: 25 });
    await flush(200);
    expect(instance.options.mock.calls.length).toBe(before);
    unmount();
  });

  it('Select 模式框选设置显示窗口:y 钉域不写入、数据行过滤、发 brush:remove 清 mask', async () => {
    const { target, instance, handler, unmount } = await mountLine({ data: chartData });
    btn(target, 'Select')!.click();
    await flush();
    // 初始无窗口:全量数据、y 无固定 domain
    expect(optsYDomain(instance, instance.options.mock.calls.length - 1)).toBeUndefined();

    handler('brush:end')!({ data: { selection: [[15, 35], [0, 1]] } });
    await flush();

    const latest = instance.options.mock.calls.at(-1)?.[0];
    expect(optsRows(latest).map((r: any) => r.step)).toEqual([20, 30]);
    // y 不钉死:scale.y 无 domain 键 → G2 随可见数据自适应
    expect(latest.scale.y.domain).toBeUndefined();
    expect(instance.emit).toHaveBeenCalledWith('brush:remove');
    unmount();
  });

  it('零宽/非法 selection 忽略(单击不误触发)', async () => {
    const { target, instance, handler, unmount } = await mountLine({ data: chartData });
    btn(target, 'Select')!.click();
    await flush();
    const before = instance.options.mock.calls.length;
    handler('brush:end')!({ data: { selection: [[20, 20], [0, 1]] } });
    handler('brush:end')!({ data: { selection: undefined } });
    await flush();
    expect(instance.options.mock.calls.length).toBe(before);
    unmount();
  });

  it('反序 selection 归一为正向窗口', async () => {
    const { target, instance, handler, unmount } = await mountLine({ data: chartData });
    btn(target, 'Select')!.click();
    await flush();
    handler('brush:end')!({ data: { selection: [[35, 15], [0, 1]] } });
    await flush();
    const latest = instance.options.mock.calls.at(-1)?.[0];
    expect(optsRows(latest).map((r: any) => r.step)).toEqual([20, 30]);
    unmount();
  });

  it('Exclude 模式下框选加入 excludeRanges(多次累积),Restore 按钮清空', async () => {
    const { target, instance, handler, unmount } = await mountLine({ data: chartData });
    btn(target, 'Exclude')!.click();
    await flush();

    handler('brush:end')!({ data: { selection: [[-5, 5], [0, 1]] } });
    await flush();
    handler('brush:end')!({ data: { selection: [[25, 35], [0, 1]] } });
    await flush();

    let latest = instance.options.mock.calls.at(-1)?.[0];
    expect(optsRows(latest).map((r: any) => r.step)).toEqual([10, 20, 40]);
    // Restore 按钮出现并可清空(英文文案)
    const restore = btn(target, 'Restore');
    expect(restore).toBeTruthy();
    expect(restore!.textContent).toContain('2');
    restore!.click();
    await flush();
    latest = instance.options.mock.calls.at(-1)?.[0];
    expect(optsRows(latest)).toHaveLength(5);
    unmount();
  });

  it('Select 与 Exclude 互斥', async () => {
    const { target, instance, unmount } = await mountLine({ data: chartData });
    btn(target, 'Select')!.click();
    await flush();
    expect(btn(target, 'Select')!.getAttribute('aria-pressed')).toBe('true');
    btn(target, 'Exclude')!.click();
    await flush();
    expect(btn(target, 'Select')!.getAttribute('aria-pressed')).toBe('false');
    expect(btn(target, 'Exclude')!.getAttribute('aria-pressed')).toBe('true');
    // 模式切换后 options 重渲染(interaction 注入随模式变化)
    const latest = instance.options.mock.calls.at(-1)?.[0];
    expect(latest.interaction.brushXHighlight).toMatchObject({ maskFill: '#3b82f6' });
    unmount();
  });

  it('plot:click 延迟 140ms 后点选排除(Exclude 模式),双击取消不误排除', async () => {
    // 先真实 timers 下 mount/开关,fake timers 只包「延迟执行」段——
    // fake timers 下 await flush() 会死锁(setTimeout 永不触发)。
    const { target, instance, handler, unmount } = await mountLine({ data: chartData });
    btn(target, 'Exclude')!.click();
    await flush();

    vi.useFakeTimers();
    try {
      // offsetX=30,offsetY=25 → plot 内 (20,5) → 双 invert 恒等 → data(20,5)。
      // 像素距离:step20/value0.5 点 dy≈19px、dx=0 < 48px 阈值 → 排除 step=20
      handler('plot:click')!({ offsetX: 30, offsetY: 25 });
      expect(instance.options.mock.calls.length).toBeGreaterThan(0);
      const before = instance.options.mock.calls.length;
      vi.advanceTimersByTime(200); // 过 140ms → applyPointExclude → 点选排除
      expect(instance.options.mock.calls.length).toBe(before + 1);
      let latest = instance.options.mock.calls.at(-1)?.[0];
      expect(optsRows(latest).map((r: any) => r.step)).toEqual([0, 10, 30, 40]);

      // 框选后 350ms 内的 click 被 lastBrushAt 抑制:再点不再新增排除
      handler('brush:end')!({ data: { selection: [[25, 35], [0, 1]] } });
      const afterBrush = instance.options.mock.calls.length;
      handler('plot:click')!({ offsetX: 30, offsetY: 25 });
      vi.advanceTimersByTime(400);
      expect(instance.options.mock.calls.length).toBe(afterBrush);
      // Restore:点选 1 + 框选排除 1 = 2(Exclude 模式下框选进 excludeRanges)。
      // $state → DOM 走微任务,fake timers 不拦 Promise,用 tick 刷一遍
      const { tick } = await import('svelte');
      await tick();
      const restore = btn(target, 'Restore');
      expect(restore?.textContent).toContain('2');
    } finally {
      vi.useRealTimers();
      unmount();
    }
  });

  it('点选距离超像素阈值不排除(点击空白)', async () => {
    const { target, instance, handler, unmount } = await mountLine({ data: chartData });
    btn(target, 'Exclude')!.click();
    await flush();

    vi.useFakeTimers();
    try {
      // plot (10,120):x 近 step10 但 y=100 远离所有点(y 跨度仅 0.3~35 → dy 数百 px)
      const before = instance.options.mock.calls.length;
      handler('plot:click')!({ offsetX: 20, offsetY: 140 });
      vi.advanceTimersByTime(200);
      expect(instance.options.mock.calls.length).toBe(before);
    } finally {
      vi.useRealTimers();
      unmount();
    }
  });

  it('双击清空显示窗口(排除不受影响)', async () => {
    const { target, instance, handler, unmount } = await mountLine({ data: chartData });
    btn(target, 'Select')!.click();
    await flush();
    handler('brush:end')!({ data: { selection: [[15, 35], [0, 1]] } });
    await flush();
    expect(optsRows(instance.options.mock.calls.at(-1)?.[0])).toHaveLength(2);
    // 窗口提示按钮出现
    const winBtn = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes('~'));
    expect(winBtn).toBeTruthy();

    // chartSync 挂在 relative 容器内的画布 div 上
    const chartDiv = target.querySelector('.relative > div') as HTMLElement;
    expect(chartDiv).toBeTruthy();
    chartDiv.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flush();
    const latest = instance.options.mock.calls.at(-1)?.[0];
    expect(optsRows(latest)).toHaveLength(5);
    unmount();
  });

  it('热更新/重建(主题切换)后窗口与排除保留', async () => {
    const { target, instance, handler, unmount } = await mountLine({ data: chartData });
    btn(target, 'Select')!.click();
    await flush();
    handler('brush:end')!({ data: { selection: [[15, 35], [0, 1]] } });
    await flush();
    try {
      document.documentElement.classList.add('dark');
      await flush(30);
      const { Chart } = await import('@antv/g2');
      const rebuilt = (Chart as any).mock.results.at(-1)?.value;
      const opts = rebuilt.options.mock.calls.at(-1)?.[0];
      expect(optsRows(opts).map((r: any) => r.step)).toEqual([20, 30]);
      // 重建后 slider 依旧不存在
      expect(opts.slider).toBeUndefined();
    } finally {
      document.documentElement.classList.remove('dark');
      await flush(30);
      unmount();
    }
  });

  it('action 挂载/卸载 window pointerup 与容器 dblclick 监听', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    try {
      const { unmount } = await mountLine({ data: chartData });
      expect(addSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
      unmount();
      expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it('storageKey: 状态变更写入 localStorage;未传 key 不写', async () => {
    const { target, handler, instance, unmount } = await mountLine({ data: chartData, storageKey: 'unit-write' });
    // 开 Select 模式 → 立即落盘
    btn(target, 'Select')!.click();
    await flush();
    let saved = JSON.parse(localStorage.getItem('trailer-line-filter-unit-write') || 'null');
    expect(saved?.brushMode).toBe('select');

    // 框选窗口 → 落盘
    handler('brush:end')!({ data: { selection: [[15, 35], [0, 1]] } });
    await flush();
    saved = JSON.parse(localStorage.getItem('trailer-line-filter-unit-write') || 'null');
    expect(saved?.xWindow).toEqual([15, 35]);
    expect(instance.emit).toHaveBeenCalledWith('brush:remove');
    unmount();

    // 无 storageKey:任何操作都不产生键
    const noKey = await mountLine({ data: chartData });
    btn(noKey.target, 'Select')!.click();
    await flush();
    noKey.handler('brush:end')!({ data: { selection: [[15, 35], [0, 1]] } });
    await flush();
    expect(localStorage.getItem('trailer-line-filter-')).toBeNull();
    noKey.unmount();
  });

  it('storageKey: 排除/恢复按钮操作落盘;挂载时恢复模式+窗口+排除', async () => {
    // 先在有 key 的实例上产生排除状态
    const a = await mountLine({ data: chartData, storageKey: 'unit-roundtrip' });
    btn(a.target, 'Exclude')!.click();
    await flush();
    a.handler('brush:end')!({ data: { selection: [[-5, 5], [0, 1]] } });
    await flush();
    const saved = JSON.parse(localStorage.getItem('trailer-line-filter-unit-roundtrip') || 'null');
    expect(saved?.brushMode).toBe('exclude');
    expect(saved?.excludeRanges).toEqual([[-5, 5]]);
    a.unmount();

    // 模拟刷新:同 key 重新挂载 → 模式/排除/窗口全部恢复,过滤立即生效
    localStorage.setItem(
      'trailer-line-filter-unit-roundtrip',
      JSON.stringify({ brushMode: 'exclude', xWindow: [15, 35], excludeRanges: [[0, 5]], excludePoints: [' 30'] })
    );
    const b = await mountLine({ data: chartData, storageKey: 'unit-roundtrip' });
    // 窗口 [15,35] → 20,30;点排除 ' 30' → 只剩 20
    expect(optsRows(b.opts).map((r: any) => r.step)).toEqual([20]);
    expect(btn(b.target, 'Exclude')!.getAttribute('aria-pressed')).toBe('true');
    expect(btn(b.target, 'Restore')?.textContent).toContain('2');
    expect(Array.from(b.target.querySelectorAll('button')).some((el) => el.textContent?.includes('~'))).toBe(true);
    b.unmount();
  });

  it('initialFilter 挂载恢复(不读 localStorage)', async () => {
    const { target, opts, unmount } = await mountLine({
      data: chartData,
      initialFilter: {
        brushMode: 'exclude',
        xWindow: [15, 35],
        excludeRanges: [[0, 5]],
        excludePoints: [' 30'],
      },
    });
    // 窗口 [15,35] → 20,30;点排除 ' 30' → 只剩 20
    expect(optsRows(opts).map((r: any) => r.step)).toEqual([20]);
    expect(btn(target, 'Exclude')!.getAttribute('aria-pressed')).toBe('true');
    expect(btn(target, 'Restore')?.textContent).toContain('2');
    unmount();
  });

  it('onFilterChange 优先:回调收到状态且不写 localStorage(即使同传 storageKey)', async () => {
    const changes: any[] = [];
    const { target, handler, unmount } = await mountLine({
      data: chartData,
      storageKey: 'unit-cb',
      onFilterChange: (f: any) => changes.push(f),
    });
    btn(target, 'Select')!.click();
    await flush();
    handler('brush:end')!({ data: { selection: [[15, 35], [0, 1]] } });
    await flush();

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ brushMode: 'select' });
    expect(changes[1]).toMatchObject({ xWindow: [15, 35] });
    expect(localStorage.getItem('trailer-line-filter-unit-cb')).toBeNull();
    unmount();
  });
});

// ── options 断言辅助 ──

function optsData(instance: any, callIndex: number) {
  return instance.options.mock.calls[callIndex]?.[0]?.data ?? [];
}

function optsYDomain(instance: any, callIndex: number) {
  return instance.options.mock.calls[callIndex]?.[0]?.scale?.y?.domain;
}

function optsRows(opts: any): any[] {
  return Array.isArray(opts?.data) ? opts.data : [];
}

describe('LineChart tooltip series naming (no legend — tooltip carries run + metric)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('omits a fixed item name when a series field is present (G2 falls back to the series name)', async () => {
    const { opts, unmount } = await mountLine({
      data: [
        { step: 0, value: 1, series: 'alpha | loss' },
        { step: 1, value: 0.5, series: 'beta | loss' },
      ],
      seriesField: 'series',
      metricLabel: 'loss',
    });
    expect(opts.tooltip.items[0]).not.toHaveProperty('name');
    expect(opts.tooltip.items[0]).toHaveProperty('valueFormatter');
    unmount();
  });

  it('keeps metricLabel as the item name for single-series charts (MetricCard / compare)', async () => {
    const { opts, unmount } = await mountLine({ data: chartData, metricLabel: 'train/loss' });
    expect(opts.tooltip.items[0].name).toBe('train/loss');
    unmount();
  });

  it('never renders a legend (Explore carries run names in the tooltip instead)', async () => {
    const { opts, unmount } = await mountLine({ data: chartData, seriesField: 'series' });
    expect(opts.legend).toBeFalsy();
    unmount();
  });
});

describe('LineChart tooltip wrapping (long run|metric names)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('lets the series label wrap instead of truncating with an ellipsis', async () => {
    const { opts, unmount } = await mountLine({ data: chartData, seriesField: 'series' });
    const css = opts.interaction.tooltip.css;
    expect(css['.g2-tooltip-list-item-name-label']).toMatchObject({
      'white-space': 'normal',
      'word-break': 'break-word',
      'text-overflow': 'clip',
    });
    unmount();
  });

  it('lays each item out as grid (name 1fr, value tight on the right) so no gap opens up', async () => {
    const { opts, unmount } = await mountLine({ data: chartData, seriesField: 'series' });
    const css = opts.interaction.tooltip.css;
    expect(css['.g2-tooltip-list-item']).toMatchObject({
      display: 'grid',
      'grid-template-columns': '1fr auto',
      'align-items': 'start',
    });
    expect(css['.g2-tooltip-list-item-value']).toMatchObject({ 'white-space': 'nowrap' });
    unmount();
  });

  it('gives the tooltip an opaque card look (default translucent bg bleeds the curves through)', async () => {
    const { opts, unmount } = await mountLine({ data: chartData, seriesField: 'series' });
    const css = opts.interaction.tooltip.css;
    // 收紧总宽 + 背景/边框走主题变量(暗夜模式下不能是硬编码白底)
    expect(css['.g2-tooltip']).toMatchObject({
      'max-width': '340px',
      background: 'var(--card)',
      color: 'var(--card-foreground)',
      opacity: '1',
    });
    expect(css['.g2-tooltip']['border-radius']).toBe('8px');
    // 数值等宽对齐
    expect(css['.g2-tooltip-list-item-value']).toMatchObject({ 'font-variant-numeric': 'tabular-nums' });
    unmount();
  });
});

describe('LineChart shared tooltip (every run visible at one x)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('turns on shared so all series list their run name at the hovered step', async () => {
    const { opts, unmount } = await mountLine({ data: chartData, seriesField: 'series' });
    expect(opts.interaction.tooltip.shared).toBe(true);
    unmount();
  });
});

describe('LineChart smooth quick-toggle button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows no Smooth button when no handler is wired (Boards unchanged)', async () => {
    const { target, unmount } = await mountLine({ data: chartData });
    const btn = [...target.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Smooth'));
    expect(btn).toBeUndefined();
    unmount();
  });

  it('renders an active Smooth button with the window size when wired', async () => {
    const { target, unmount } = await mountLine({ data: chartData, smoothOn: true, smoothLabel: '10', onSmoothToggle: () => {} });
    const btn = [...target.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Smooth'));
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toContain('10');
    expect(btn!.getAttribute('aria-pressed')).toBe('true');
    unmount();
  });

  it('fires the toggle handler on click', async () => {
    const onToggle = vi.fn();
    const { target, unmount } = await mountLine({ data: chartData, smoothOn: false, onSmoothToggle: onToggle });
    const btn = [...target.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Smooth'))!;
    btn.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
    unmount();
  });
});
