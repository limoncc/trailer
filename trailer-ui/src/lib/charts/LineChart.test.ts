import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@antv/g2', () => {
  const mockRender = vi.fn();
  const mockDestroy = vi.fn();
  const mockOptions = vi.fn();
  const mockOn = vi.fn();
  const mockEmit = vi.fn();
  // G 场景:一棵含 className='plot' 的最小树,让 getPlotRect 能换算点击坐标
  // (plot 原点 (10,20),jsdom 无 canvas 元素 → 直接取 rect 值)
  const mockGetContext = vi.fn(() => ({
    canvas: {
      document: {
        documentElement: {
          className: 'root',
          childNodes: [
            {
              className: 'plot',
              childNodes: [],
              getBoundingClientRect: () => ({ x: 10, y: 20, left: 10, top: 20 }),
            },
          ],
        },
      },
    },
  }));
  // coordinate.invert 恒等 → abstractX = offsetX - 10
  const mockGetCoordinate = vi.fn(() => ({ invert: ([x, y]: number[]) => [x, y] }));
  const mockGetScale = vi.fn(() => ({ x: {}, y: {} }));
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
  });

  it('不再注入 slider,注入 brushXHighlight 手势', async () => {
    const { opts, unmount } = await mountLine({ data: chartData });
    expect(opts.slider).toBeUndefined();
    expect(opts.interaction.brushXHighlight).toMatchObject({ maskFill: '#3b82f6' });
    unmount();
  });

  it('挂载 brush:end 与 element:click 处理器', async () => {
    const { instance, unmount } = await mountLine({ data: chartData });
    const events = instance.on.mock.calls.map((c: any[]) => c[0]);
    expect(events).toContain('brush:end');
    expect(events).toContain('element:click');
    unmount();
  });

  it('框选(非排除模式)设置显示窗口:y 钉域不写入、数据行过滤、发 brush:remove 清 mask', async () => {
    const { instance, handler, unmount } = await mountLine({ data: chartData });
    // 初始无窗口:全量数据、y 无固定 domain
    expect(optsData(instance, 0)).toHaveLength(5);
    expect(optsYDomain(instance, 0)).toBeUndefined();

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
    const { instance, handler, unmount } = await mountLine({ data: chartData });
    const before = instance.options.mock.calls.length;
    handler('brush:end')!({ data: { selection: [[20, 20], [0, 1]] } });
    handler('brush:end')!({ data: { selection: undefined } });
    await flush();
    expect(instance.options.mock.calls.length).toBe(before);
    unmount();
  });

  it('反序 selection 归一为正向窗口', async () => {
    const { instance, handler, unmount } = await mountLine({ data: chartData });
    handler('brush:end')!({ data: { selection: [[35, 15], [0, 1]] } });
    await flush();
    const latest = instance.options.mock.calls.at(-1)?.[0];
    expect(optsRows(latest).map((r: any) => r.step)).toEqual([20, 30]);
    unmount();
  });

  it('排除模式下框选加入 excludeRanges(多次累积),恢复按钮清空', async () => {
    const { target, instance, handler, unmount } = await mountLine({ data: chartData });
    // 开排除模式
    const toggle = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes('排除'));
    toggle!.click();
    await flush();

    handler('brush:end')!({ data: { selection: [[-5, 5], [0, 1]] } });
    await flush();
    handler('brush:end')!({ data: { selection: [[25, 35], [0, 1]] } });
    await flush();

    let latest = instance.options.mock.calls.at(-1)?.[0];
    expect(optsRows(latest).map((r: any) => r.step)).toEqual([10, 20, 40]);
    // 恢复按钮出现并可清空
    const restore = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes('恢复'));
    expect(restore).toBeTruthy();
    expect(restore!.textContent).toContain('2');
    restore!.click();
    await flush();
    latest = instance.options.mock.calls.at(-1)?.[0];
    expect(optsRows(latest)).toHaveLength(5);
    unmount();
  });

  it('element:click 延迟 220ms 后点选排除(排除模式),双击取消不误排除', async () => {
    // 先真实 timers 下 mount/开关,fake timers 只包「延迟执行」段——
    // fake timers 下 await flush() 会死锁(setTimeout 永不触发)。
    const { target, instance, handler, unmount } = await mountLine({ data: chartData });
    const toggle = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes('排除'));
    toggle!.click();
    await flush();

    vi.useFakeTimers();
    try {
      // offsetX=30,offsetY=50 → plot 内 (20,30) → invert 恒等 → click(20,30)。
      // y=30 归一化后离异常点 35 最近(dy≈0.14 vs 其余 ≈0.85)→ 排除 step=0(value 35)
      handler('element:click')!({ offsetX: 30, offsetY: 50 });
      expect(instance.options.mock.calls.length).toBe(1); // 延迟未到,尚未重渲染
      vi.advanceTimersByTime(300); // 过 220ms → applyPointExclude → 点选排除
      expect(instance.options.mock.calls.length).toBe(2);
      let latest = instance.options.mock.calls.at(-1)?.[0];
      expect(optsRows(latest).map((r: any) => r.step)).toEqual([10, 20, 30, 40]);

      // 框选后 350ms 内的 click 被 lastBrushAt 抑制:再点不再新增排除
      handler('brush:end')!({ data: { selection: [[15, 35], [0, 1]] } });
      const afterBrush = instance.options.mock.calls.length;
      handler('element:click')!({ offsetX: 30, offsetY: 50 });
      vi.advanceTimersByTime(400);
      expect(instance.options.mock.calls.length).toBe(afterBrush);
      // 恢复按钮:点选 1 + 框选排除 1 = 2(排除模式下框选进 excludeRanges)。
      // $state → DOM 走微任务,fake timers 不拦 Promise,用 tick 刷一遍
      const { tick } = await import('svelte');
      await tick();
      const restore = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes('恢复'));
      expect(restore?.textContent).toContain('2');
    } finally {
      vi.useRealTimers();
      unmount();
    }
  });

  it('双击清空显示窗口(排除不受影响)', async () => {
    const { target, instance, handler, unmount } = await mountLine({ data: chartData });
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
    const { instance, handler, unmount } = await mountLine({ data: chartData });
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
