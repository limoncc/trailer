<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { Maximize2, ChevronsDownUp, ChevronsUpDown, ChevronDown, Network, Search } from 'lucide-svelte';
  import { layoutGraph, displayName, subLabel, ioLabel, type LayoutResult } from './model/layout';
  import { canvasMeasure as tw } from './model/measure';
  import { ancestorsOf, enforceBudget, computeFrame, easeOutCubic } from './model/interactions';
  import ModelNodeFinder from './ModelNodeFinder.svelte';
  import Inspector from './Inspector.svelte';

  interface Props {
    spec: { meta?: any; tree?: any; edges?: any[] };
  }
  let { spec }: Props = $props();

  // --- Global state ---
  let container: HTMLDivElement;
  let leafer: any = null, contentGroup: any = null;
  let graphReady = $state(false);
  let initErr = $state('');
  let sidebarWidth = $state(380);
  let darkMode = $state(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));

  // Watch dark mode — redraw the graph with the new palette when it changes
  $effect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark === darkMode) return;
    darkMode = isDark;
    if (leafer && graphReady) {
      const canvas = container?.querySelector('canvas');
      if (canvas) canvas.style.background = isDark ? '#1a1a2e' : '#fafafa';
      renderGraph(); // re-render all Leafer elements with new colors
      if (selectedId) highlight(selectedId);
      setTimeout(fitView, 30);
    }
  });
  // Track class changes on <html>
  $effect(() => {
    const observer = new MutationObserver(() => {
      const d = document.documentElement.classList.contains('dark');
      if (d !== darkMode) {
        darkMode = d;
        if (leafer && graphReady) {
          const canvas = container?.querySelector('canvas');
          if (canvas) canvas.style.background = d ? '#1a1a2e' : '#fafafa';
          renderGraph();
          if (selectedId) highlight(selectedId);
          setTimeout(fitView, 30);
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  });

  let graphData: any = null;
  let nodeById: Record<string, any> = {};
  let parentOf: Record<string, string> = {};
  let collapsedSet = new Set<string>();
  let layout: LayoutResult | null = null;
  let layoutGen = 0;
  let openOrder: string[] = [];
  let animRaf = 0;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let toastMsg = $state('');
  let finderOpen = $state(false);
  let selectedId: string | null = $state(null);
  let selectedInfo: any = $state(null);

  // Breadcrumb trail of the selection (root → … → selected)
  const breadcrumb = $derived.by(() => {
    if (!selectedId || !graphData) return [];
    const ids = [...ancestorsOf(selectedId), selectedId];
    return ids.filter((id) => nodeById[id]).map((id) => ({ id, name: nodeById[id].name || id }));
  });

  // --- Data loading ---
  function indexTree(n: any, parent: any) {
    nodeById[n.id] = n; if (parent) parentOf[n.id] = parent.id;
    (n.children || []).forEach((c: any) => indexTree(c, n));
  }

  function isContainer(n: any) { return n.children && n.children.length > 0; }

  function defaultCollapse() {
    collapsedSet.clear();
    for (const id of Object.keys(nodeById)) {
      const n = nodeById[id];
      if (!isContainer(n)) continue;
      const depth = id.split('.').length - 1;
      if (depth >= 2) collapsedSet.add(id);
    }
  }

  /** async layout (ELK runs in a worker) + draw; the generation counter makes
   *  rapid collapse/expand toggles race-safe */
  async function relayout(): Promise<void> {
    if (!graphData) return;
    const gen = ++layoutGen;
    try {
      const r = await layoutGraph(graphData, collapsedSet);
      if (gen !== layoutGen) return;
      layout = r;
      if (leafer && contentGroup) renderGraph();
    } catch (err: any) {
      console.error('[model-graph] layout failed', err);
    }
  }

  function loadGraph(g: any) {
    graphData = g; nodeById = {}; parentOf = {}; selectedId = null;
    indexTree(g.tree, null);
    defaultCollapse();
    if (leafer && contentGroup) {
      relayout().then(() => { setTimeout(fitView, 60); showDetail(g.tree.id); });
    }
  }

  // --- Container open/close with render budget (modelmap §10 semantics) ---
  function showToast(msg: string) {
    toastMsg = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastMsg = ''), 3200);
  }

  function applyBudget(opened: string | null) {
    if (!graphData) return;
    const res = enforceBudget(graphData.tree, collapsedSet, openOrder, opened);
    collapsedSet = res.collapsed;
    openOrder = res.order;
    if (res.evicted)
      showToast(`Collapsed ${res.evicted} container${res.evicted > 1 ? 's' : ''} to keep the graph fast`);
  }

  function openContainer(id: string) {
    if (!isContainer(nodeById[id])) return;
    collapsedSet.delete(id);
    applyBudget(id);
    relayout().then(() => frame(id));
  }

  function closeContainer(id: string) {
    if (!isContainer(nodeById[id]) || collapsedSet.has(id)) return;
    collapsedSet.add(id);
    openOrder = openOrder.filter((x) => x !== id);
    relayout();
  }

  /** collapse the container itself, or (for a leaf / already-collapsed node)
   *  its nearest expanded ancestor */
  function collapseNearest(id: string) {
    if (isContainer(nodeById[id]) && !collapsedSet.has(id)) { closeContainer(id); return; }
    let cur: string | null = parentOf[id];
    while (cur && !isContainer(nodeById[cur])) cur = parentOf[cur];
    if (cur) closeContainer(cur);
  }

  /** open every ancestor of id, select it and frame it (search, deep links) */
  function reveal(id: string) {
    if (!nodeById[id]) return;
    for (const a of ancestorsOf(id)) if (isContainer(nodeById[a])) collapsedSet.delete(a);
    applyBudget(id);
    relayout().then(() => { showDetail(id); highlight(id); frame(id); });
  }

  function pickNode(id: string) {
    finderOpen = false;
    reveal(id);
  }

  // --- Camera framing ---
  function animateGroup(target: { scale: number; x: number; y: number }, dur: number) {
    if (!contentGroup) return;
    cancelAnimationFrame(animRaf);
    const from = { scale: contentGroup.scaleX || 1, x: contentGroup.x || 0, y: contentGroup.y || 0 };
    const apply = (s: number, x: number, y: number) => {
      contentGroup.scaleX = s; contentGroup.scaleY = s; contentGroup.x = x; contentGroup.y = y;
    };
    if (dur <= 0) { apply(target.scale, target.x, target.y); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = easeOutCubic(p);
      apply(
        from.scale + (target.scale - from.scale) * e,
        from.x + (target.x - from.x) * e,
        from.y + (target.y - from.y) * e,
      );
      if (p < 1) animRaf = requestAnimationFrame(step);
    };
    animRaf = requestAnimationFrame(step);
  }

  /** frame one container (after opening / picking) */
  function frame(id: string) {
    if (!layout || !container) return;
    const b = layout.boxes[id];
    if (!b) { fitView(); return; }
    const vw = container.clientWidth || 800, vh = container.clientHeight || 500;
    animateGroup(computeFrame(b, vw, vh), 350);
  }

  // --- Keyboard: E expand · C collapse · 0 fit · / search · Esc deselect ---
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (finderOpen) finderOpen = false;
      else { selectedId = null; selectedInfo = null; }
    } else if (e.key === '0') fitView();
    else if (e.key === '/') { e.preventDefault(); finderOpen = true; }
    else if (e.key === 'e' || e.key === 'E') { if (selectedId) openContainer(selectedId); }
    else if (e.key === 'c' || e.key === 'C') { if (selectedId) collapseNearest(selectedId); }
  }
  $effect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // --- Colors (light/dark aware) ---
  function colorsFor(n: any, depth: number) {
    const isDark = darkMode;
    const c = (n.class || '').toLowerCase(), name = (n.name || '').toLowerCase();
    function pick(lFill: string, lStroke: string, lLabel: string, dFill: string, dStroke: string, dLabel: string) {
      return isDark ? { fill: dFill, stroke: dStroke, label: dLabel } : { fill: lFill, stroke: lStroke, label: lLabel };
    }
    if (c.indexOf('embed') >= 0) return pick('#dbeafe', '#3b82f6', '#1e40af', '#1e3a5f', '#60a5fa', '#93c5fd');
    if (c.indexOf('attention') >= 0 || c.indexOf('attn') >= 0 || name.indexOf('attn') >= 0) return pick('#f3e8ff', '#8b5cf6', '#5b21b6', '#3b1f6e', '#a78bfa', '#c4b5fd');
    if (c.indexOf('norm') >= 0) return pick('#ccfbf1', '#14b8a6', '#0f766e', '#134e4a', '#2dd4bf', '#5eead4');
    if (c.indexOf('conv') >= 0) return pick('#dcfce7', '#22c55e', '#166534', '#14532d', '#4ade80', '#86efac');
    if (name.indexOf('head') >= 0 || name === 'classifier' || name === 'fc') return pick('#fef3c7', '#f59e0b', '#92400e', '#78350f', '#fbbf24', '#fcd34d');
    if (c.indexOf('mlp') >= 0 || c.indexOf('feedforward') >= 0 || c === 'linear' || name.indexOf('mlp') >= 0) return pick('#fce7f3', '#ec4899', '#9d174d', '#831843', '#f472b6', '#f9a8d4');
    if (c.indexOf('gelu') >= 0 || c.indexOf('relu') >= 0 || c.indexOf('silu') >= 0 || c.indexOf('swiglu') >= 0 || c.indexOf('act') >= 0 ||
        c.indexOf('dropout') >= 0 || c.indexOf('pool') >= 0 || c.indexOf('identity') >= 0 || c.indexOf('flatten') >= 0)
      return pick('#f1f5f9', '#94a3b8', '#64748b', '#1e293b', '#64748b', '#94a3b8');
    if (isContainer(n)) {
      if (depth === 0) return pick('#ffffff', '#cbd5e1', '#475569', '#0f172a', '#334155', '#94a3b8');
      return pick(depth % 2 === 1 ? '#f8fafc' : '#ffffff', '#94a3b8', '#475569',
                  depth % 2 === 1 ? '#1e293b' : '#0f172a', '#475569', '#94a3b8');
    }
    return pick('#ffffff', '#cbd5e1', '#64748b', '#0f172a', '#334155', '#94a3b8');
  }

  // --- Theme palette ---
  const PAL = () => ({
    subText: darkMode ? '#64748b' : '#94a3b8',
    ioText: darkMode ? '#475569' : '#b0b7c3',
    badgeBg: darkMode ? '#3b1f6e' : '#fdf2f8',
    badgeText: darkMode ? '#f9a8d4' : '#be185d',
    badgeStroke: darkMode ? '#a78bfa' : '#d946ef',
    opBg: darkMode ? '#2e1065' : '#ede9fe',
    opStroke: darkMode ? '#a78bfa' : '#8b5cf6',
    opText: darkMode ? '#c4b5fd' : '#5b21b6',
    edgeLabelBg: darkMode ? '#3b1f6e' : '#fdf2f8',
    edgeLabelText: darkMode ? '#f9a8d4' : '#be185d',
    edgeLabelStroke: darkMode ? '#a78bfa' : '#d946ef',
    ioPillInBg: darkMode ? '#1e3a5f' : '#dbeafe',
    ioPillInStroke: darkMode ? '#60a5fa' : '#3b82f6',
    ioPillOutBg: darkMode ? '#78350f' : '#fef3c7',
    ioPillOutStroke: darkMode ? '#fbbf24' : '#f59e0b',
    canvasBg: darkMode ? '#0f172a' : '#fafafa',
  });

  function edgeStyle(kind: string) {
    if (kind === 'routing') return { color: '#d946ef', width: 1.9, dash: [6, 4] as number[] | null, side: 'right' as const };
    if (kind === 'residual') return { color: '#f59e0b', width: 1.6, dash: null, side: 'right' as const };
    if (kind === 'loop') return { color: '#8b5cf6', width: 1.4, dash: [5, 4] as number[], side: 'left' as const };
    if (kind === 'seq' || kind === 'order') return { color: '#cbd5e1', width: 1.2, dash: [3, 3] as number[], side: 'center' as const };
    return { color: '#64748b', width: 1.7, dash: null, side: 'center' as const };
  }

  // --- Rendering (consumes layout geometry; leafer only draws) ---
  function drawArrow(x: number, y: number, color: string, dir: string) {
    if (!contentGroup || !leafer) return;
    const R = getLeaferUI();
    let pts: Array<{ x: number; y: number }>;
    if (dir === 'down') pts = [{ x, y }, { x: x - 4.5, y: y - 9 }, { x: x + 4.5, y: y - 9 }];
    else if (dir === 'up') pts = [{ x, y }, { x: x - 4.5, y: y + 9 }, { x: x + 4.5, y: y + 9 }];
    else if (dir === 'left') pts = [{ x, y }, { x: x + 9, y: y - 4.5 }, { x: x + 9, y: y + 4.5 }];
    else pts = [{ x, y }, { x: x - 9, y: y - 4.5 }, { x: x - 9, y: y + 4.5 }];
    contentGroup.add(new R.Polygon({ points: pts, fill: color }));
  }

  function getLeaferUI() {
    return (window as any).__leaferR;
  }

  function renderGraph() {
    if (!layout || !graphData || !contentGroup) return;
    const R = getLeaferUI();
    if (!R) return;

    const P = PAL();
    const boxes = layout.boxes;
    while (contentGroup.children?.length > 0) contentGroup.children[0].remove();

    let elements: any[] = [];
    let ordered = Object.keys(boxes).sort((a, b) => boxes[a].depth - boxes[b].depth);

    // Draw boxes
    for (const id of ordered) {
      let b = boxes[id], n = b.node;
      let col = colorsFor(n, b.depth);
      let expanded = isContainer(n) && !collapsedSet.has(id);

      let rect = new R.Rect({
        x: b.x, y: b.y, width: b.w, height: b.h,
        fill: col.fill, stroke: col.stroke,
        strokeWidth: b.depth === 0 ? 2 : 1.2,
        cornerRadius: expanded ? 8 : 5,
      });
      contentGroup.add(rect);
      rect.__id = id; elements.push(rect);

      let name = displayName(n);
      if (expanded) {
        contentGroup.add(new R.Text({ x: b.x + 12, y: b.y + 7, text: name, fill: col.label, fontSize: 13, fontWeight: 600 }));
        contentGroup.add(new R.Text({ x: b.x + 12 + tw(name, 13, 600) + 10, y: b.y + 9, text: subLabel(n), fill: P.subText, fontSize: 10.5 }));
        contentGroup.add(new R.Text({ x: b.x + b.w - 22, y: b.y + 7, text: '−', fill: col.stroke, fontSize: 14, fontWeight: 600 }));
      } else if (isContainer(n)) {
        contentGroup.add(new R.Text({ x: b.x + 12, y: b.y + 7, text: name, fill: col.label, fontSize: 12.5, fontWeight: 600 }));
        contentGroup.add(new R.Text({ x: b.x + 12, y: b.y + 26, text: subLabel(n), fill: P.subText, fontSize: 10 }));
        contentGroup.add(new R.Text({ x: b.x + b.w - 22, y: b.y + 7, text: '+', fill: col.stroke, fontSize: 14, fontWeight: 600 }));
      } else {
        let io = ioLabel(n);
        if (n.op) {
          let cr = 13, ccx = b.x + b.w / 2, ccy = b.y + b.h / 2 + 2;
          contentGroup.add(new R.Rect({ x: ccx - cr, y: ccy - cr, width: cr * 2, height: cr * 2, cornerRadius: cr, fill: P.opBg, stroke: P.opStroke, strokeWidth: 1.4 }));
          contentGroup.add(new R.Text({ x: ccx, y: ccy - 9, text: n.op, fill: P.opText, fontSize: 17, fontWeight: 700, textAlign: 'center' }));
          contentGroup.add(new R.Text({ x: b.x + b.w / 2, y: b.y + b.h - 6, text: name, fill: col.label, fontSize: 11.5, fontWeight: 600, textAlign: 'center' }));
        } else {
          contentGroup.add(new R.Text({ x: b.x + b.w / 2, y: b.y + 8, text: name, fill: col.label, fontSize: 12, fontWeight: 600, textAlign: 'center' }));
          contentGroup.add(new R.Text({ x: b.x + b.w / 2, y: b.y + 25, text: subLabel(n), fill: P.subText, fontSize: 10, textAlign: 'center' }));
          if (io) contentGroup.add(new R.Text({ x: b.x + b.w / 2, y: b.y + 40, text: io, fill: P.ioText, fontSize: 9.5, textAlign: 'center' }));
        }
        if (n.badge) {
          let bw = tw(n.badge, 9) + 12, bh = 14;
          let bx = b.x + b.w / 2 - bw / 2, by = b.y + b.h - (n.op ? 6 : 15);
          if (n.op) by = b.y + 3;
          contentGroup.add(new R.Rect({ x: bx, y: by, width: bw, height: bh, fill: P.badgeBg, stroke: P.badgeStroke, strokeWidth: 1, cornerRadius: 7 }));
          contentGroup.add(new R.Text({ x: bx + bw / 2, y: by + 3, text: n.badge, fill: P.badgeText, fontSize: 9, textAlign: 'center' }));
        }
      }
    }

    // Edges — geometry comes straight from the ELK layout
    for (const route of layout.routes) {
      let st = edgeStyle(route.kind);
      let path = new R.Path({ path: route.path, stroke: st.color, strokeWidth: st.width, fill: null });
      if (st.dash) path.dashPattern = st.dash;
      contentGroup.add(path);
      drawArrow(route.ex, route.ey, st.color, route.arrowDir);

      if (route.kind === 'routing' && route.shape) {
        let lw = tw(route.shape, 8.5) + 10, lh = 14;
        contentGroup.add(new R.Rect({ x: route.mx - lw / 2, y: route.my - lh / 2, width: lw, height: lh, fill: P.badgeBg, stroke: st.color, strokeWidth: 0.8, cornerRadius: 7 }));
        contentGroup.add(new R.Text({ x: route.mx, y: route.my - 4.5, text: route.shape, fill: P.badgeText, fontSize: 8.5, textAlign: 'center' }));
      }
    }

    // IO pills
    if (graphData.meta) {
      let rb = boxes[graphData.tree.id];
      if (rb) {
        let inText = graphData.meta.input_spec || (graphData.tree.io ? graphData.tree.io.in.join('  ') : null);
        let outText = graphData.meta.output_spec || (graphData.tree.io ? graphData.tree.io.out.join('  ') : null);
        if (inText) drawIoPill('INPUT  ' + inText, rb.x + rb.w / 2, rb.y - 64, P.ioPillInStroke, P.ioPillInBg);
        if (outText) drawIoPill('OUTPUT  ' + outText, rb.x + rb.w / 2, rb.y + rb.h + 30, '#f59e0b', '#fef3c7');
        if (inText) {
          contentGroup.add(new R.Path({ path: 'M ' + (rb.x + rb.w / 2) + ' ' + (rb.y - 34) + ' L ' + (rb.x + rb.w / 2) + ' ' + (rb.y - 3), stroke: P.ioPillInStroke, strokeWidth: 1.7, fill: null }));
          drawArrow(rb.x + rb.w / 2, rb.y - 2, P.ioPillInStroke, 'down');
        }
        if (outText) {
          contentGroup.add(new R.Path({ path: 'M ' + (rb.x + rb.w / 2) + ' ' + (rb.y + rb.h) + ' L ' + (rb.x + rb.w / 2) + ' ' + (rb.y + rb.h + 27), stroke: '#f59e0b', strokeWidth: 1.7, fill: null }));
          drawArrow(rb.x + rb.w / 2, rb.y + rb.h + 28, '#f59e0b', 'down');
        }
      }
    }

    function drawIoPill(text: string, cx: number, top: number, stroke: string, fill: string) {
      const ioH = 30;
      let w = tw(text, 11, 600) + 34;
      contentGroup.add(new R.Rect({ x: cx - w / 2, y: top, width: w, height: ioH, fill, stroke, strokeWidth: 1.4, cornerRadius: ioH / 2 }));
      contentGroup.add(new R.Text({ x: cx, y: top + 8, text, fill: stroke, fontSize: 11, fontWeight: 600, textAlign: 'center' }));
    }

    // Interactions
    for (const el of elements) {
      el.on(R.PointerEvent.TAP, () => { showDetail(el.__id); highlight(el.__id); });
      el.on(R.PointerEvent.DOUBLE_TAP, () => {
        let n = nodeById[el.__id];
        if (!isContainer(n)) return;
        if (collapsedSet.has(el.__id)) openContainer(el.__id);
        else closeContainer(el.__id);
      });
    }
    if (selectedId) highlight(selectedId);
  }

  function highlight(id: string) {
    selectedId = id;
    if (!contentGroup || !layout) return;
    const ancSet = new Set(id ? ancestorsOf(id) : []);
    for (const ch of contentGroup.children) {
      if (!ch.__id) continue;
      let b = layout.boxes[ch.__id];
      if (!b) continue;
      let col = colorsFor(b.node, b.depth);
      if (ch.__id === id) { ch.stroke = '#c2622d'; ch.strokeWidth = 2.5; }
      else if (ancSet.has(ch.__id)) { ch.stroke = '#c2622d'; ch.strokeWidth = 1.8; }
      else { ch.stroke = col.stroke; ch.strokeWidth = b.depth === 0 ? 2 : 1.2; }
    }
  }

  // --- Detail panel ---
  function showDetail(id: string) {
    let n = nodeById[id];
    if (!n) return;
    selectedId = id;

    let info: any = { name: n.name, id: n.id, class: n.class, kind: n.kind, dtype: n.dtype, params: n.params, repeat: n.repeat, io: n.io, io_hint: n.io_hint, attrs: n.attrs, children: n.children, param_breakdown: n.param_breakdown, moe_routing: n.moe_routing };
    selectedInfo = info;
  }

  // --- Toolbar ---
  function expandAll() {
    collapsedSet.clear();
    applyBudget(null);
    relayout().then(() => setTimeout(fitView, 30));
  }
  function collapseAll() {
    for (const id of Object.keys(nodeById)) {
      if (isContainer(nodeById[id]) && id !== (graphData?.tree?.id)) collapsedSet.add(id);
    }
    relayout().then(() => setTimeout(fitView, 30));
  }
  function expandOneLevel() {
    let toOpen: string[] = [];
    collapsedSet.forEach((id) => {
      let p = parentOf[id];
      let visible = true, cur = p;
      while (cur) { if (collapsedSet.has(cur)) { visible = false; break; } cur = parentOf[cur]; }
      if (visible) toOpen.push(id);
    });
    toOpen.forEach((id) => collapsedSet.delete(id));
    relayout().then(() => setTimeout(fitView, 30));
  }

  function fitView() {
    if (!layout || !contentGroup || !leafer) return;
    const b = layout.bounds;
    let minX = b.minX - 70, minY = b.minY - 70, maxX = b.maxX + 70, maxY = b.maxY + 66;
    let vw = container?.clientWidth || 800, vh = container?.clientHeight || 500;
    let cw = maxX - minX, ch = maxY - minY;
    if (cw <= 0 || ch <= 0) return;
    let scale = Math.min((vw - 40) / cw, (vh - 40) / ch, 1.4);
    scale = Math.max(scale, 0.02);
    contentGroup.scaleX = scale; contentGroup.scaleY = scale;
    contentGroup.x = (vw - cw * scale) / 2 - minX * scale;
    contentGroup.y = (vh - ch * scale) / 2 - minY * scale;
  }

  // --- Init ---
  onMount(() => {
    if (!container || !spec?.tree) return;
    (async () => {
      try {
        const R = await import('leafer-ui');
        (window as any).__leaferR = R;
        leafer = new R.Leafer({ view: container });
        // Set canvas bg via CSS for easy dark mode switching
        const cv = container.querySelector('canvas');
        if (cv) cv.style.background = darkMode ? '#1a1a2e' : '#fafafa';
        contentGroup = new R.Group();
        leafer.add(contentGroup);
        loadGraph(spec);
        graphReady = true;

        // Zoom
        container.addEventListener('wheel', (e: WheelEvent) => {
          e.preventDefault();
          cancelAnimationFrame(animRaf);
          let os = contentGroup.scaleX || 1;
          let f = e.deltaY < 0 ? 1.08 : 0.92;
          let ns = Math.max(0.02, Math.min(4, os * f));
          if (ns === os) return;
          let rect = container.getBoundingClientRect();
          let lx = e.clientX - rect.left, ly = e.clientY - rect.top;
          let ratio = ns / os;
          contentGroup.x = lx - (lx - (contentGroup.x || 0)) * ratio;
          contentGroup.y = ly - (ly - (contentGroup.y || 0)) * ratio;
          contentGroup.scaleX = ns; contentGroup.scaleY = ns;
        }, { passive: false });

        // Pan
        let dragging = false, sx = 0, sy = 0, gx = 0, gy = 0;
        leafer.on(R.PointerEvent.DOWN, (e: any) => {
          cancelAnimationFrame(animRaf);
          if (e.target === leafer || e.target === contentGroup) {
            dragging = true; sx = e.x; sy = e.y; gx = contentGroup.x || 0; gy = contentGroup.y || 0;
          }
        });
        leafer.on(R.PointerEvent.MOVE, (e: any) => {
          if (dragging) { contentGroup.x = gx + e.x - sx; contentGroup.y = gy + e.y - sy; }
        });
        leafer.on(R.PointerEvent.UP, () => { dragging = false; });
      } catch (err: any) {
        initErr = `Init failed: ${err?.message || err}`;
        console.error(err);
      }
    })();
  });
</script>

<div class="border border-border rounded-xl overflow-hidden bg-background h-full flex flex-col">
  <!-- Toolbar -->
  <div class="flex items-center gap-1.5 px-4 py-2 bg-muted/30 border-b border-border flex-wrap shrink-0">
    <div class="flex items-center gap-2 shrink-0">
      <Network class="w-4 h-4 text-muted-foreground" />
      <span class="text-sm font-semibold text-foreground/80">{spec?.meta?.name || 'Model'}</span>
      {#if spec?.meta?.total_params_fmt}
        <span class="text-[11px] font-mono text-muted-foreground/60 font-medium">{spec.meta.total_params_fmt}</span>
      {/if}
    </div>
    <div class="flex-1"></div>
    <Button variant="outline" size="sm" onclick={() => (finderOpen = true)}><Search class="w-3.5 h-3.5" />Search</Button>
    <Button variant="outline" size="sm" onclick={expandAll}><ChevronsDownUp class="w-3.5 h-3.5" />Expand</Button>
    <Button variant="outline" size="sm" onclick={collapseAll}><ChevronsUpDown class="w-3.5 h-3.5" />Collapse</Button>
    <Button variant="outline" size="sm" onclick={expandOneLevel}><ChevronDown class="w-3.5 h-3.5" />Expand 1 level</Button>
    <Button variant="outline" size="sm" onclick={fitView}><Maximize2 class="w-3.5 h-3.5" />Fit</Button>
  </div>

  <!-- Legend -->
  {#if graphReady}
  <div class="flex items-center justify-between px-4 py-1.5 text-[11px] text-muted-foreground bg-muted/10 border-b border-border">
    <div class="flex items-center gap-3 flex-wrap">
      {#each [['#dbeafe','#3b82f6','Embed'],['#f3e8ff','#8b5cf6','Attn'],['#fce7f3','#ec4899','MLP'],['#ccfbf1','#14b8a6','Norm'],['#dcfce7','#22c55e','Conv'],['#fef3c7','#f59e0b','Head']] as [f,s,l]}
        <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm" style="background:{f};border:1px solid {s}"></span>{l}</span>
      {/each}
      <span class="flex items-center gap-1"><span style="color:#f59e0b;">╮</span>Residual</span>
      <span class="flex items-center gap-1"><span style="color:#d946ec;">╌╌</span>Routing</span>
    </div>
    <div class="flex items-center gap-3 font-mono text-[10px]"><span>Click → Select</span><span>·</span><span>Dbl-click → Collapse</span><span>·</span><span>E/C · 0 fit · / search</span></div>
  </div>
  {/if}

  <!-- Breadcrumb -->
  {#if selectedId && breadcrumb.length > 1}
  <div class="flex items-center gap-1 px-4 py-1 text-[11px] font-mono bg-muted/10 border-b border-border overflow-x-auto shrink-0">
    {#each breadcrumb as seg, i}
      {#if i > 0}<span class="text-muted-foreground/40 shrink-0">/</span>{/if}
      <button
        class="truncate hover:text-violet-500 transition-colors {i === breadcrumb.length - 1 ? 'text-foreground font-semibold' : 'text-muted-foreground'}"
        onclick={() => { showDetail(seg.id); highlight(seg.id); frame(seg.id); }}
      >{seg.name}</button>
    {/each}
  </div>
  {/if}

  <!-- Main area -->
  <div class="flex flex-1 min-h-0">
    <div class="relative flex-1 min-w-0" class:bg-[#fafafa]={!darkMode} class:bg-[#1a1a2e]={darkMode}>
      <div bind:this={container} class="absolute inset-0"></div>
      {#if finderOpen}
        <ModelNodeFinder {nodeById} onpick={pickNode} onclose={() => (finderOpen = false)} />
      {/if}
      {#if toastMsg}
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-md bg-foreground/90 text-background text-xs shadow-lg pointer-events-none">{toastMsg}</div>
      {/if}
      {#if !graphReady}
      <div class="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground bg-background flex-col">
        {#if initErr}<p class="text-destructive">{initErr}</p>{:else}<div class="w-2 h-2 rounded-full bg-primary/40 animate-pulse"></div><p>Loading model graph...</p>{/if}
      </div>
      {/if}
    </div>

    <!-- Resize handle -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      role="separator"
      aria-label="Resize detail panel"
      class="w-1 shrink-0 cursor-col-resize bg-border/30 hover:bg-violet-400 transition-colors active:bg-violet-500 relative"
      onmousedown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = sidebarWidth;
        const handler = (ev: MouseEvent) => {
          const newW = Math.max(260, Math.min(700, startW + (startX - ev.clientX)));
          sidebarWidth = newW;
        };
        const cleanup = () => { window.removeEventListener('mousemove', handler); window.removeEventListener('mouseup', cleanup); };
        window.addEventListener('mousemove', handler);
        window.addEventListener('mouseup', cleanup);
      }}
    ></div>

    <!-- Detail panel -->
    <div class="shrink-0 border-l border-border overflow-y-auto bg-background" style="width:{sidebarWidth}px">
      <Inspector spec={spec} selected={selectedInfo} onjump={reveal} />
    </div>
  </div>
</div>

<style>
  :global(canvas) { display: block; width: 100% !important; }
</style>
