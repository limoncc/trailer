<script lang="ts">
  import { MousePointerClick } from 'lucide-svelte';
  import { displayName } from './model/layout';
  import {
    fmtInt,
    fmtPct,
    dtypeLabel,
    fmtMembers,
    parseShape,
    buildDimLabels,
    shapeParts,
  } from './model/inspector';

  interface Props {
    spec: { meta?: any; tree?: any; edges?: any[] };
    selected: any; // selectedInfo, or null → model summary
    onjump?: (id: string) => void;
  }
  let { spec, selected, onjump }: Props = $props();

  const total = $derived(spec?.meta?.total_params ?? 0);

  function attrEntries(attrs: Record<string, unknown> | undefined | null): Array<[string, number]> {
    if (!attrs) return [];
    const out: Array<[string, number]> = [];
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('_')) continue;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isNaN(n)) out.push([k, n]);
    }
    return out;
  }

  function dimsOf(n: any): number[] {
    const vals: number[] = [];
    const push = (dims: number[]) => {
      for (const d of dims) if (Number.isFinite(d) && d > 1) vals.push(d);
    };
    for (const s of [...(n.io?.in ?? []), ...(n.io?.out ?? [])]) push(parseShape(s).dims);
    for (const p of n.param_breakdown ?? []) push((p.shape ?? []).filter((x: any) => typeof x === 'number'));
    if (n.io_hint) {
      push(parseShape(n.io_hint.in).dims);
      push(parseShape(n.io_hint.out).dims);
    }
    return [...new Set(vals)];
  }

  const labels = $derived.by(() => {
    const entries = [...attrEntries(spec?.tree?.attrs), ...attrEntries(selected?.attrs)];
    return buildDimLabels(entries, selected ? dimsOf(selected) : []);
  });

  const topChildren = $derived.by(() => {
    const kids: any[] = (selected ?? spec?.tree)?.children ?? [];
    return [...kids]
      .sort((a, b) => (b.params?.total ?? 0) - (a.params?.total ?? 0))
      .slice(0, 10);
  });

  const childPct = (child: any, parentTotal: number) => {
    if (!parentTotal) return 0;
    const v = (child.repeat ? child.repeat.group_params : child.params?.total) || 0;
    return Math.round((v / parentTotal) * 1000) / 10;
  };

  function jump(id: string) {
    onjump?.(id);
  }
</script>

{#if !selected}
  <!-- Model summary (nothing selected) -->
  <div class="flex items-center justify-center gap-2 text-xs text-muted-foreground p-6 text-center">
    <div class="flex flex-col items-center gap-2">
      <div class="w-10 h-10 rounded-full bg-muted/60 flex items-center justify-center"><MousePointerClick class="w-5 h-5 text-muted-foreground/60" /></div>
      <p class="leading-relaxed">Click any module<br />to inspect it</p>
    </div>
  </div>
  {#if spec?.meta}
    <div class="px-4 pb-3">
      <h3 class="font-semibold text-sm mb-1">{spec.meta.name || 'Model'}</h3>
      <div class="flex items-center gap-1.5 flex-wrap mb-2">
        <span class="inline-flex text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">{spec.meta.class || ''}</span>
        {#if spec.meta.trace_mode}
          <span class="inline-flex text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{spec.meta.trace_mode}</span>
        {/if}
      </div>
      <div class="space-y-1.5 text-xs">
        <div class="flex justify-between"><span class="text-muted-foreground">Parameters</span><span class="font-mono font-medium" title={fmtInt(total)}>{spec.meta.total_params_fmt || '?'} · {fmtInt(total)}</span></div>
        {#if spec.meta.input_spec}<div class="flex justify-between gap-2"><span class="text-muted-foreground shrink-0">Input</span><span class="font-mono text-right text-[10px] break-all">{spec.meta.input_spec}</span></div>{/if}
        {#if spec.meta.output_spec}<div class="flex justify-between gap-2"><span class="text-muted-foreground shrink-0">Output</span><span class="font-mono text-right text-[10px] break-all">{spec.meta.output_spec}</span></div>{/if}
        {#if spec.edges}<div class="flex justify-between"><span class="text-muted-foreground">Edges</span><span class="font-mono">{spec.edges.length}</span></div>{/if}
      </div>
    </div>
    {#if (spec?.tree?.children ?? []).length}
      <hr class="border-t border-border mx-4" />
      <div class="p-4">
        <div class="text-xs font-semibold mb-2 text-foreground/80">Sub-module param share</div>
        <div class="space-y-2">
          {#each topChildren as child (child.id)}
            {@const pct = childPct(child, spec.tree.params?.total)}
            <button class="w-full text-left group" onclick={() => jump(child.id)} title="Jump to {displayName(child)}">
              <div class="flex justify-between text-[10px] font-mono">
                <span class="truncate group-hover:text-violet-500 transition-colors">{displayName(child)}</span>
                <span class="shrink-0">{pct}%</span>
              </div>
              <div class="h-1 bg-muted rounded-full overflow-hidden"><div class="h-full rounded-full bg-violet-500" style="width:{Math.min(pct, 100)}%"></div></div>
            </button>
          {/each}
        </div>
      </div>
    {/if}
    <hr class="border-t border-border mx-4" />
    <div class="p-4 text-[11px] text-muted-foreground space-y-1">
      <div><kbd class="font-mono px-1 py-0.5 rounded bg-muted">E</kbd> expand · <kbd class="font-mono px-1 py-0.5 rounded bg-muted">C</kbd> collapse · <kbd class="font-mono px-1 py-0.5 rounded bg-muted">0</kbd> fit</div>
      <div><kbd class="font-mono px-1 py-0.5 rounded bg-muted">/</kbd> search · <kbd class="font-mono px-1 py-0.5 rounded bg-muted">esc</kbd> deselect</div>
    </div>
  {:else}
    <div class="p-4 text-[11px] text-muted-foreground">
      <div><kbd class="font-mono px-1 py-0.5 rounded bg-muted">/</kbd> search · <kbd class="font-mono px-1 py-0.5 rounded bg-muted">esc</kbd> deselect</div>
    </div>
  {/if}
{:else}
  <!-- Selected node -->
  <div class="px-4 pt-4 pb-2">
    <div class="flex items-center justify-between mb-1 flex-wrap gap-1">
      <h3 class="font-semibold text-sm">{selected.name}</h3>
      <div class="flex items-center gap-1">
        {#if selected.kind && selected.kind !== 'container' && selected.kind !== 'leaf'}
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">{selected.kind}</span>
        {/if}
        {#if selected.repeat}
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" title={fmtMembers(selected.repeat.names)}>×{selected.repeat.count}</span>
        {/if}
      </div>
    </div>
    <p class="text-[10px] font-mono text-muted-foreground break-all">{selected.id}</p>
  </div>
  <hr class="border-t border-border mx-4" />
  <div class="p-4 space-y-2 text-xs">
    <div class="flex justify-between gap-2"><span class="text-muted-foreground shrink-0">Class</span><span class="font-mono text-right">{selected.class}</span></div>
    {#if selected.dtype}
      <div class="flex justify-between gap-2"><span class="text-muted-foreground shrink-0">dtype</span><span class="font-mono text-right">{dtypeLabel(selected.dtype)}</span></div>
    {/if}
    {#if selected.moe_routing}
      <div class="flex justify-between gap-2">
        <span class="text-muted-foreground shrink-0">MoE routing</span>
        <span class="font-mono text-right text-violet-600 dark:text-violet-400">{selected.moe_routing.label} · {selected.moe_routing.router}</span>
      </div>
    {/if}
    {#if selected.params}
      <div class="flex justify-between gap-2">
        <span class="text-muted-foreground shrink-0">Params</span>
        <span class="font-mono text-right" title={fmtInt(selected.params.total)}>
          {selected.repeat ? selected.repeat.group_fmt + ' (×' + selected.repeat.count + ')' : selected.params.fmt}
          {#if !selected.repeat && total}
            <span class="text-muted-foreground/70"> · {fmtPct(selected.params.total, total)} of model</span>
          {/if}
        </span>
      </div>
    {/if}
    {#if selected.params && !selected.repeat && total}
      <div class="h-1.5 bg-muted rounded-full overflow-hidden" title="share of model parameters">
        <div class="h-full rounded-full bg-violet-500" style="width:{Math.max(0.5, Math.min(100, (selected.params.total / total) * 100))}%"></div>
      </div>
    {/if}
    {#if selected.io}
      <div class="flex justify-between gap-2">
        <span class="text-muted-foreground shrink-0">Input</span>
        <span class="font-mono text-right">
          {#each selected.io.in as s, i}
            {#if i > 0}<br />{/if}
            {#each shapeParts(parseShape(s).dims, labels) as p, j}
              {#if j > 0}<span class="text-muted-foreground/50"> × </span>{/if}<span class={p.muted ? "text-muted-foreground/50" : ""}>{p.text}</span>
            {/each}
            {#if parseShape(s).dtype}<span class="text-muted-foreground/50"> · {dtypeLabel(parseShape(s).dtype)}</span>{/if}
          {/each}
        </span>
      </div>
      <div class="flex justify-between gap-2">
        <span class="text-muted-foreground shrink-0">Output</span>
        <span class="font-mono text-right">
          {#each selected.io.out as s, i}
            {#if i > 0}<br />{/if}
            {#each shapeParts(parseShape(s).dims, labels) as p, j}
              {#if j > 0}<span class="text-muted-foreground/50"> × </span>{/if}<span class={p.muted ? "text-muted-foreground/50" : ""}>{p.text}</span>
            {/each}
            {#if parseShape(s).dtype}<span class="text-muted-foreground/50"> · {dtypeLabel(parseShape(s).dtype)}</span>{/if}
          {/each}
        </span>
      </div>
    {:else if selected.io_hint}
      <div class="flex justify-between gap-2"><span class="text-muted-foreground shrink-0">Input</span><span class="font-mono text-right">{selected.io_hint.in}</span></div>
      <div class="flex justify-between gap-2"><span class="text-muted-foreground shrink-0">Output</span><span class="font-mono text-right">{selected.io_hint.out}</span></div>
    {/if}
    {#if selected.attrs && Object.keys(selected.attrs).length}
      <div class="pt-1">
        <div class="text-muted-foreground mb-1">Attrs</div>
        <div class="rounded-md border border-border/60 divide-y divide-border/40 overflow-hidden">
          {#each Object.entries(selected.attrs) as [k, v] (k)}
            {#if k === '_args'}
              <div class="flex justify-between gap-2 px-2 py-1"><span class="text-muted-foreground">args</span><span class="font-mono text-right break-all">{String(v)}</span></div>
            {:else}
              <div class="flex justify-between gap-2 px-2 py-1"><span class="text-muted-foreground">{k}</span><span class="font-mono text-right break-all">{String(v)}</span></div>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  </div>

  {#if selected.param_breakdown?.length}
    <hr class="border-t border-border mx-4" />
    <div class="p-4">
      <div class="text-xs font-semibold mb-2 text-foreground/80">Weights</div>
      <table class="w-full text-[10px] font-mono">
        <tbody>
          {#each selected.param_breakdown as p (p.label)}
            <tr class="border-b border-border/40 last:border-0">
              <td class="py-1 pr-2 align-top break-all">{p.label}</td>
              <td class="py-1 pr-2 align-top whitespace-nowrap">
                {#each shapeParts((p.shape ?? []).filter((x: any) => typeof x === 'number'), labels, 0) as part, j}
                  {#if j > 0}<span class="text-muted-foreground/50">×</span>{/if}
                  {part.text}
                {/each}
                {#if p.dtype}<span class="text-muted-foreground/50">· {dtypeLabel(p.dtype)}</span>{/if}
              </td>
              <td class="py-1 align-top text-right whitespace-nowrap">{p.fmt}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if (selected.children ?? []).length}
    <hr class="border-t border-border mx-4" />
    <div class="p-4">
      <div class="text-xs font-semibold mb-2 text-foreground/80">Sub-module param share</div>
      <div class="space-y-2">
        {#each topChildren as child (child.id)}
          {@const pct = childPct(child, selected.params?.total)}
          <button class="w-full text-left group" onclick={() => jump(child.id)} title="Jump to {displayName(child)}">
            <div class="flex justify-between text-[10px] font-mono">
              <span class="truncate group-hover:text-violet-500 transition-colors">{displayName(child)}</span>
              <span class="shrink-0">{pct}%</span>
            </div>
            <div class="h-1 bg-muted rounded-full overflow-hidden"><div class="h-full rounded-full bg-violet-500" style="width:{Math.min(pct, 100)}%"></div></div>
          </button>
        {/each}
      </div>
    </div>
  {/if}
{/if}
