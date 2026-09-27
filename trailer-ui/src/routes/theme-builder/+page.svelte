<script lang="ts">
  import { onMount } from 'svelte';
  import Picker from '$lib/theme-builder/Picker.svelte';
  import {
    BASE_COLORS,
    RADII,
    THEME_VARS,
    CHART_COLORS,
    CHART_PALETTES,
    CHART_THEME_STYLES,
    FONTS,
    MENU_STYLES,
    MENU_ACCENTS,
    DEFAULT_THEME_STATE,
    readCurrentVars,
    cssColorToHex,
    generateCss,
    saveCustomTheme,
    resolveOverrides,
    applyThemeState,
    clearThemeInlineOverrides,
    themeStateToJson,
    saveThemeState,
    loadThemeState,
    type ThemeState,
  } from '$lib/theme-builder/color';
  import { api } from '$lib/utils/api';
  import { Chart } from '@antv/g2';
  import { themeOpts, onChartThemeChange, chartPalette } from '$lib/charts/chartTheme.svelte';

  const PRESETS = ['light', 'dark', 'cyber', 'nature', 'editorial', 'midnight'];
  /** preview-02 风格主色主题(只在 app.css 覆盖主色,底色继承灰阶);对齐 shadcn 完整色板 */
  const COLOR_THEMES = [
    'red', 'rose', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
    'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink',
  ];
  const PRESET_DARK = ['dark', 'cyber', 'midnight'];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  let state: ThemeState = $state({ ...DEFAULT_THEME_STATE });
  let saved = $state(false);

  /** 当前完整生效的变量(精细 vars + chart/sidebar 增量覆盖) */
  let mergedVars = $derived({ ...state.vars, ...resolveOverrides(state) });

  const baseItems = Object.keys(BASE_COLORS).map((id) => ({
    id,
    label: cap(id),
    swatch: BASE_COLORS[id].light.primary,
  }));
  /** Chart Color 选项:default(未激活,图表走本地缺省) + 6 预设 + custom */
  const chartItems = [
    {
      id: 'default',
      label: 'Default',
      swatches: Object.values(CHART_COLORS.default.light),
    },
    ...Object.entries(CHART_PALETTES).map(([id, p]) => ({
      id,
      label: cap(id),
      swatches: p.light.slice(0, 5),
    })),
    { id: 'custom', label: 'Custom', swatches: (state.chartPalette?.light ?? CHART_PALETTES.antv.light).slice(0, 5) },
  ];
  const chartStyleItems = CHART_THEME_STYLES.map((id) => ({ id, label: cap(id) }));
  /** custom 色板编辑的亮/暗 tab */
  let paletteTab = $state<'light' | 'dark'>('light');
  /** 预览色块:custom 用编辑中的组,预设用其亮/暗组;未激活(空)不显示色块 */
  const previewSwatches = $derived.by(() => {
    if (state.chartColor === 'custom') {
      return state.isDark ? (state.chartPalette?.dark ?? []) : (state.chartPalette?.light ?? []);
    }
    const p = CHART_PALETTES[state.chartColor];
    return state.isDark ? (p?.dark ?? []) : (p?.light ?? []);
  });
  /** Custom 编辑器当前 tab 的 10 色数组(非 custom 态为空) */
  const editingPalette = $derived.by(() => {
    if (state.chartColor !== 'custom' || !state.chartPalette) return [] as string[];
    return paletteTab === 'dark' ? state.chartPalette.dark : state.chartPalette.light;
  });
  const fontItems = FONTS.map((f) => ({ id: f.id, label: f.label, family: f.family }));
  const radiusItems = RADII.map((r) => ({ id: r.label, label: r.label, value: r.value }));
  const presetItems = [...PRESETS, ...COLOR_THEMES].map((p) => ({ id: p, label: cap(p) }));
  const styleItems = [{ id: 'default', label: 'Default' }];
  const iconItems = [{ id: 'lucide', label: 'Lucide' }];
  const menuItems = MENU_STYLES.map((m) => ({ id: m, label: cap(m) }));
  const menuAccentItems = MENU_ACCENTS.map((m) => ({ id: m, label: cap(m) }));

  const radiusLabel = $derived(
    radiusItems.find((r) => Math.abs(r.value - parseFloat(state.vars.radius || '0.625')) < 0.001)?.label ?? 'Custom'
  );

  function apply() {
    applyThemeState(state);
  }

  // ─── Live Preview:真实 mini 多系列折线(与全局图表同一条 themeOpts/通知链,
  //     预览即验证色板注入与重建);未激活时展示 AntV 参考色 ───
  let previewEl = $state<HTMLDivElement | null>(null);
  let previewChart: Chart | null = null;

  function renderPreview() {
    if (!previewEl) return;
    previewChart?.destroy();
    previewChart = null;
    previewChart = new Chart({ container: previewEl, height: 150, autoFit: true });
    const data: Array<{ step: number; value: number; series: string }> = [];
    for (let s = 0; s < 6; s++) {
      for (let i = 0; i <= 20; i++) {
        data.push({
          step: i,
          value: Math.round((100 * Math.exp(-i / (6 + s * 2.5)) + 8 * Math.sin(i / 3 + s)) * 100) / 100,
          series: `Series ${s + 1}`,
        });
      }
    }
    previewChart.options({
      ...themeOpts(),
      type: 'line',
      data,
      encode: { x: 'step', y: 'value', color: 'series' },
      scale: { color: { range: chartPalette() ?? CHART_PALETTES.antv.light } },
      style: { lineWidth: 2 },
      axis: { x: { title: false }, y: { title: false } },
      legend: false,
    });
    previewChart.render();
  }

  function init() {
    const stored = loadThemeState();
    if (stored) {
      state = stored;
      if (!state.vars || Object.keys(state.vars).length === 0) state.vars = readCurrentVars();
    } else {
      state.vars = readCurrentVars();
      state.isDark = document.documentElement.classList.contains('dark');
    }
    apply();
    renderPreview();
  }
  onMount(() => {
    init();
    // 主题/色板变化 → 全局图表重建通知 → 预览同步重建(所见即所得)
    const off = onChartThemeChange(renderPreview);
    return () => {
      off();
      previewChart?.destroy();
      previewChart = null;
    };
  });

  function selectPreset(name: string) {
    state.theme = name;
    // 主色主题不改变明暗(由 Dark mode 开关决定);预设主题按自身明暗
    if (!COLOR_THEMES.includes(name)) state.isDark = PRESET_DARK.includes(name);
    const el = document.documentElement;
    el.setAttribute('data-theme', name);
    el.classList.toggle('dark', state.isDark);
    clearThemeInlineOverrides();
    state.vars = readCurrentVars();
    apply();
  }

  function selectBaseColor(id: string) {
    state.baseColor = id;
    const base = BASE_COLORS[id];
    if (base) {
      const s = state.isDark ? base.dark : base.light;
      state.vars = { ...state.vars, ...s };
    }
    apply();
  }

  function selectChart(id: string) {
    state.chartColor = id;
    // 首次进 Custom:从 AntV 预设拷贝两组作起点(亮/暗独立编辑,互不影响)
    if (id === 'custom' && !state.chartPalette) {
      state.chartPalette = { light: [...CHART_PALETTES.antv.light], dark: [...CHART_PALETTES.antv.dark] };
    }
    apply();
  }

  function selectChartStyle(id: string) {
    state.chartThemeStyle = id;
    apply();
  }

  /** Custom 色板单色编辑(即时预览) */
  function setChartPaletteColor(mode: 'light' | 'dark', i: number, hex: string) {
    if (!state.chartPalette) return;
    const arr = [...state.chartPalette[mode]];
    arr[i] = hex;
    state.chartPalette = { ...state.chartPalette, [mode]: arr };
    apply();
  }

  /** Custom 色板重置回 AntV 预设 */
  function resetChartPalette() {
    state.chartPalette = { light: [...CHART_PALETTES.antv.light], dark: [...CHART_PALETTES.antv.dark] };
    apply();
  }

  function selectFont(id: string) {
    state.font = id;
    apply();
  }
  function selectHeadingFont(id: string) {
    state.headingFont = id;
    apply();
  }

  function selectRadius(label: string) {
    const r = RADII.find((x) => x.label === label);
    if (r) {
      state.vars = { ...state.vars, radius: `${r.value}rem` };
      apply();
    }
  }

  function selectMenu(id: string) {
    state.menu = id as ThemeState['menu'];
    apply();
  }
  function selectMenuAccent(id: string) {
    state.menuAccent = id as ThemeState['menuAccent'];
    apply();
  }

  function toggleDark() {
    state.isDark = !state.isDark;
    const base = BASE_COLORS[state.baseColor];
    if (base) {
      const s = state.isDark ? base.dark : base.light;
      state.vars = { ...state.vars, ...s };
    }
    apply();
  }

  function setColor(k: string, hex: string) {
    state.vars = { ...state.vars, [k]: hex };
    apply();
  }

  async function save() {
    const full = { ...state, vars: mergedVars };
    saveThemeState(state);
    localStorage.setItem('trailer_theme', 'custom');
    saveCustomTheme({ vars: full.vars, isDark: state.isDark });
    apply();
    try {
      await api('/api/v1/users/me/theme', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme: themeStateToJson(full) }),
      });
      saved = true;
      setTimeout(() => (saved = false), 2500);
    } catch { /* ignore */ }
  }

  function reset() {
    const stored = localStorage.getItem('trailer_theme');
    state = { ...DEFAULT_THEME_STATE };
    selectPreset(stored && stored !== 'custom' ? stored : 'light');
  }

  function exportCss() {
    const css = generateCss({ vars: mergedVars, isDark: state.isDark });
    navigator.clipboard?.writeText(css);
    alert('CSS copied to clipboard');
  }
</script>

<div class="p-4 max-w-6xl mx-auto">
  <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
    <h1 class="text-lg font-bold">Theme Builder</h1>
    <div class="flex items-center gap-1">
      <button
        type="button"
        onclick={reset}
        class="px-2 py-1 text-[11px] border border-border rounded-md hover:bg-accent/50"
      >Reset</button>
      <button
        type="button"
        onclick={exportCss}
        class="px-2 py-1 text-[11px] border border-border rounded-md hover:bg-accent/50"
      >Export CSS</button>
      <button
        type="button"
        onclick={save}
        class="px-3 py-1 text-[11px] bg-primary text-primary-foreground rounded-md hover:opacity-90"
      >Save</button>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Left: controls -->
    <div class="border border-border rounded-lg p-4 space-y-3 bg-card">
      <div>
        <div class="text-xs font-semibold text-muted-foreground uppercase mb-2">Appearance</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Picker label="Style" value="Default" selected="default" items={styleItems} onSelect={() => {}} />
          <Picker
            label="Base Color"
            value={cap(state.baseColor)}
            selected={state.baseColor}
            items={baseItems}
            onSelect={selectBaseColor}
            accent="color"
          />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2.5">
          <Picker label="Theme" value={cap(state.theme)} selected={state.theme} items={presetItems} onSelect={selectPreset} />
          <Picker
            label="Chart Color"
            value={cap(state.chartColor)}
            selected={state.chartColor}
            items={chartItems}
            onSelect={selectChart}
            accent="chart"
          />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2.5">
          <Picker
            label="Chart Style"
            value={cap(state.chartThemeStyle)}
            selected={state.chartThemeStyle}
            items={chartStyleItems}
            onSelect={selectChartStyle}
          />
          <div class="text-[11px] text-muted-foreground self-end pb-2 leading-snug">
            Chart Style applies once a Chart Color is selected; Academy falls back to classicDark in dark mode.
          </div>
        </div>
        {#if state.chartColor === 'custom' && state.chartPalette}
          <div class="border border-border rounded-md p-2.5 mt-2 space-y-2">
            <div class="flex items-center justify-between">
              <div class="flex gap-1">
                {#each ['light', 'dark'] as mode}
                  <button
                    type="button"
                    class="px-2 py-0.5 text-[11px] rounded-md {paletteTab === mode ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
                    onclick={() => (paletteTab = mode as 'light' | 'dark')}
                  >{mode === 'light' ? 'Light' : 'Dark'}</button>
                {/each}
              </div>
              <button
                type="button"
                onclick={resetChartPalette}
                class="px-2 py-0.5 text-[11px] border border-border rounded-md hover:bg-accent/50"
              >Reset</button>
            </div>
            <div class="grid grid-cols-10 gap-1">
              {#each editingPalette as c, i}
                <input
                  type="color"
                  value={cssColorToHex(c)}
                  onchange={(e) => setChartPaletteColor(paletteTab, i, (e.currentTarget as HTMLInputElement).value)}
                  class="h-7 w-full rounded border border-border bg-background cursor-pointer"
                  title={`chart-${i + 1}`}
                />
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="border-t border-border pt-3">
        <div class="text-xs font-semibold text-muted-foreground uppercase mb-2">Typography</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Picker
            label="Heading"
            value={cap(state.headingFont)}
            selected={state.headingFont}
            items={fontItems}
            onSelect={selectHeadingFont}
            accent="font"
          />
          <Picker
            label="Font"
            value={cap(state.font)}
            selected={state.font}
            items={fontItems}
            onSelect={selectFont}
            accent="font"
          />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2.5">
          <Picker label="Icon Library" value="Lucide" selected="lucide" items={iconItems} onSelect={() => {}} />
          <Picker
            label="Radius"
            value={radiusLabel}
            selected={radiusLabel}
            items={radiusItems}
            onSelect={selectRadius}
            accent="radius"
          />
        </div>
      </div>

      <div class="border-t border-border pt-3">
        <div class="text-xs font-semibold text-muted-foreground uppercase mb-2">Navigation</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Picker label="Menu" value={cap(state.menu)} selected={state.menu} items={menuItems} onSelect={selectMenu} />
          <Picker
            label="Menu Accent"
            value={cap(state.menuAccent)}
            selected={state.menuAccent}
            items={menuAccentItems}
            onSelect={selectMenuAccent}
          />
        </div>
      </div>

      <div class="border-t border-border pt-3 space-y-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={state.isDark} onchange={toggleDark} class="accent-primary" />
          Dark mode
        </label>
        {#if saved}
          <p class="text-xs text-green-600">Saved to your account</p>
        {/if}
      </div>

      <div class="border-t border-border pt-3">
        <div class="text-xs font-semibold text-muted-foreground uppercase mb-2">Advanced Colors</div>
        <div class="grid grid-cols-1 gap-1.5 max-h-64 overflow-y-auto pr-1">
          {#each THEME_VARS as k}
            <label class="flex items-center justify-between text-sm gap-2">
              <span class="font-mono text-xs text-muted-foreground truncate">{k}</span>
              <input
                type="color"
                value={cssColorToHex(mergedVars[k] || '')}
                onchange={(e) => setColor(k, (e.currentTarget as HTMLInputElement).value)}
                class="h-7 w-14 rounded border border-border bg-background cursor-pointer"
              />
            </label>
          {/each}
        </div>
      </div>
    </div>

    <!-- Right: live preview -->
    <div class="border border-border rounded-lg p-4 bg-card text-card-foreground space-y-3">
      <h3 class="text-xs font-semibold text-muted-foreground mb-1">Live Preview</h3>
      <div class="border border-border rounded-lg p-4 bg-background text-foreground space-y-4">
        <div>
          <h3 class="font-semibold text-lg">Heading — {cap(state.headingFont)}</h3>
          <p class="text-sm text-muted-foreground">Body text — {cap(state.font)}. The quick brown fox jumps over the lazy dog.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md">Primary</button>
          <button class="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded-md">Secondary</button>
          <button class="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground rounded-md">Destructive</button>
          <button class="px-3 py-1.5 text-xs border border-border rounded-md">Outline</button>
        </div>
        <input class="w-full px-2 py-1 border border-input rounded-md bg-background" placeholder="Input..." />
        <div class="flex flex-wrap gap-1">
          <span class="px-2 py-0.5 text-[10px] bg-muted text-muted-foreground rounded-full">muted</span>
          <span class="px-2 py-0.5 text-[10px] bg-accent text-accent-foreground rounded-full">accent</span>
          <span class="px-2 py-0.5 text-[10px] bg-primary text-primary-foreground rounded-full">primary</span>
        </div>
        <div>
          <div class="text-xs text-muted-foreground mb-1">Chart palette</div>
          <div class="flex gap-1.5 mb-2">
            {#each previewSwatches as c (c)}
              <div class="flex-1 h-8 rounded-md" style={`background: ${c}`}></div>
            {/each}
          </div>
          <div class="border border-border rounded-md overflow-hidden" bind:this={previewEl}></div>
        </div>
        <div>
          <div class="text-xs text-muted-foreground mb-1">Sidebar (Menu / Menu Accent)</div>
          <div class="flex items-center gap-2 rounded-lg border border-border p-2 text-xs" style={`background: ${mergedVars.sidebar || 'var(--sidebar)'}`}>
            <div class="h-6 w-1.5 rounded" style={`background: ${mergedVars['sidebar-accent'] || 'var(--sidebar-accent)'}`}></div>
            <div class="flex-1 text-muted-foreground">Sidebar item</div>
            <div
              class="rounded px-2 py-0.5"
              style={`background: ${mergedVars['sidebar-accent'] || 'var(--sidebar-accent)'}; color: ${mergedVars['sidebar-accent-foreground'] || 'var(--sidebar-accent-foreground)'}`}
            >Accent</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
