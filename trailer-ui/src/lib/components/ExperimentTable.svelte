<script lang="ts">
  import { goto } from '$app/navigation';
  import Card from './ui/Card.svelte';
  import { loadColumnConfig, saveColumnConfig } from '$lib/utils/columnConfig';
  import { EllipsisVertical, ClipboardCopy, Play, Archive, Trash2 } from 'lucide-svelte';
  import { refreshInterval } from '$lib/refresh.svelte';
  import { getUser, getOwners } from '$lib/projectsStore.svelte';
  import PaginationBar from './PaginationBar.svelte';

  interface RunItem {
    run_id: string;
    name: string | null;
    state: string;
    project: string;
    created_at: number;
    summary: Record<string, { last: number | null; best: number | null }>;
    owner_id?: number | null;
  }

  type ColumnKey = 'name' | 'state' | 'created_at';

  const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'state', label: 'State' },
    { key: 'created_at', label: 'Created' },
  ];

  let { project } = $props();

  let user = $derived(getUser());
  let owners = $derived(getOwners());
  let canWrite = $derived(user?.role === 'admin' || owners.get(project) === user?.id);

  let runs = $state<RunItem[]>([]);
  let page = $state(1);
  let perPage = $state(20);
  let total = $state(0);
  let sortField = $state('created_at');
  let sortDir = $state('desc');
  let loading = $state(false);
  let columnMenuOpen = $state(false);
  let searchQuery = $state('');
  let stateFilter = $state<string | null>(null);
  let selected = $state<Set<string>>(new Set());
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let menuOpen = $state<string | null>(null);
  let expandedSummaries = $state<Set<string>>(new Set());
  let menuStyle = $state('');
  let deleteTarget = $state<string | null>(null);
  let deleteConfirm = $state('');
  let batchDeleteTarget = $state<Set<string> | null>(null);

  function token() { return localStorage.getItem('trailer_token') || ''; }
  function hdrs() { return { 'content-type': 'application/json', authorization: `Bearer ${token()}` }; }

  async function deleteRun(id: string) {
    if (deleteConfirm !== id) return;
    await fetch(`/api/v1/runs/${id}/delete`, { method: 'POST', headers: hdrs() });
    runs = runs.filter(r => r.run_id !== id);
    menuOpen = null;
    deleteTarget = null;
    deleteConfirm = '';
  }

  function openDelete(id: string) {
    deleteTarget = id;
    deleteConfirm = '';
    menuOpen = null;
  }

  async function resumeRun(id: string) {
    await fetch(`/api/v1/runs/${id}/resume`, { method: 'POST', headers: hdrs() });
    runs = runs.map(r => r.run_id === id ? { ...r, state: 'running' } : r);
    menuOpen = null;
  }

  async function archiveRun(id: string) {
    await fetch(`/api/v1/runs/${id}/archive`, { method: 'POST', headers: hdrs() });
    runs = runs.map(r => r.run_id === id ? { ...r, state: 'archived' } : r);
    menuOpen = null;
  }

  async function copyRun(id: string, name: string) {
    const resp = await fetch(`/api/v1/runs/${id}/copy`, {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ name: name + ' (copy)' }),
    });
    if (resp.ok) {
      const data = await resp.json();
      runs = [{ run_id: data.run_id, name: name + ' (copy)', state: 'finished',
               project, created_at: Date.now() / 1000, summary: {}, owner_id: user?.id ?? null } as RunItem, ...runs];
    }
    menuOpen = null;
  }

  let colConfig = $derived(loadColumnConfig(project));

  function toggleColumn(key: ColumnKey) {
    const idx = colConfig.visible.indexOf(key);
    if (idx >= 0) colConfig.visible.splice(idx, 1);
    else colConfig.visible.push(key);
    saveColumnConfig(project, colConfig);
  }

  function isColumnVisible(key: ColumnKey): boolean {
    return colConfig.visible.includes(key);
  }

  async function loadRuns(initial = false) {
    if (!project) return;
    if (initial) loading = true;
    try {
      let url = `/api/v1/runs?project=${encodeURIComponent(project)}&limit=${perPage}&offset=${(page - 1) * perPage}`;
      if (stateFilter) { url += `&state=${encodeURIComponent(stateFilter)}`; }
      if (searchQuery.trim()) {
        // If query looks like expr (contains operators), send as expr; otherwise name search
        const q = searchQuery.trim();
        const exprLike = /[=<>!|&()]| in | like |not /i.test(q);
        if (exprLike) { url += `&expr=${encodeURIComponent(q)}`; }
        else { url += `&name=${encodeURIComponent(q)}`; }
      }
      const resp = await fetch(url, { headers: hdrs() });
      if (resp.ok) {
        total = Number(resp.headers.get('x-total-count') || 0);
        const data = await resp.json();
        if (initial || searchQuery.trim()) {
          runs = data;
        } else {
          // Refresh: merge new data into existing — update matching runs, append new
          const oldMap = new Map(runs.map(r => [r.run_id, r]));
          const merged: RunItem[] = [];
          const seen = new Set<string>();
          for (const run of runs) {
            if (data.find((d: RunItem) => d.run_id === run.run_id)) {
              merged.push(data.find((d: RunItem) => d.run_id === run.run_id)!);
              seen.add(run.run_id);
            } else {
              merged.push(run);
            }
          }
          for (const d of data) {
            if (!seen.has(d.run_id)) merged.push(d);
          }
          runs = merged;
        }
      }
    } catch (_) {}
    if (initial) loading = false;
  }

  function onSearchInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadRuns, 300);
  }

  function setStateFilter(s: string | null) {
    stateFilter = s;
    loadRuns(true);
  }

  $effect(() => { loadRuns(true); });


  $effect(() => {
    if (!project || $refreshInterval <= 0) return;
    const id = setInterval(() => loadRuns(false), $refreshInterval * 1000);
    return () => clearInterval(id);
  });

  function toggleSort(field: string) {
    if (sortField === field) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
    else { sortField = field; sortDir = 'desc'; }
  }

  let sorted = $derived([...runs].sort((a, b) => {
    let va: any, vb: any;
    if (sortField === 'created_at') { va = a.created_at; vb = b.created_at; }
    else if (sortField === 'state') { va = a.state; vb = b.state; }
    else { va = a.name || a.run_id; vb = b.name || b.run_id; }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  }));

  let allSelected = $derived(sorted.length > 0 && sorted.every(r => selected.has(r.run_id)));

  function toggleAll() {
    if (allSelected) selected = new Set();
    else selected = new Set(sorted.map(r => r.run_id));
  }

  function toggleRun(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    selected = next;
  }

  function compareSelected() {
    if (selected.size < 2) return;
    const ids = [...selected].join(',');
    goto(`/compare?run_ids=${ids}`);
  }

  async function batchArchive() {
    const ids = [...selected];
    await Promise.all(ids.map(id =>
      fetch(`/api/v1/runs/${id}/archive`, { method: 'POST', headers: hdrs() })
    ));
    runs = runs.map(r => selected.has(r.run_id) ? { ...r, state: 'archived' } : r);
    selected = new Set();
  }

  function openBatchDelete() {
    batchDeleteTarget = new Set(selected);
  }

  async function confirmBatchDelete() {
    const ids = [...batchDeleteTarget!];
    await Promise.all(ids.map(id =>
      fetch(`/api/v1/runs/${id}/delete`, { method: 'POST', headers: hdrs() })
    ));
    runs = runs.filter(r => !batchDeleteTarget!.has(r.run_id));
    selected = new Set();
    batchDeleteTarget = null;
  }

  function stateColor(state: string): string {
    switch (state) {
      case 'running': return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-400';
      case 'finished': return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
      case 'crashed': return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-400';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  function displayKey(k: string): string {
    if (k.endsWith('/')) return k.slice(0, -1);
    if (k.includes('/')) {
      const parts = k.split('/');
      return parts[parts.length - 1] ? `${parts.slice(0, -1).join('/')} [${parts[parts.length - 1]}]` : parts.join('/');
    }
    return k;
  }

  const SUMMARY_LIMIT = 2;
  function toggleSummary(runId: string) {
    const next = new Set(expandedSummaries);
    if (next.has(runId)) next.delete(runId);
    else next.add(runId);
    expandedSummaries = next;
  }
  function formatVal(v: number): string {
    return Math.abs(v) > 1 ? v.toFixed(4) : v.toExponential(4);
  }

  function openRun(runId: string) {
    goto(`/run/${runId}`);
  }
</script>

<div class="p-6">
  <h2 class="text-xl font-semibold mb-4">{project}</h2>

  <Card>
    {#if loading}
      <div class="p-8 text-center text-muted-foreground text-sm">Loading...</div>
    {:else if runs.length === 0}
      {#if stateFilter || searchQuery.trim()}
        <div class="p-8 text-center text-muted-foreground text-sm">
          <p>No runs matching your filter</p>
          <button class="mt-2 text-xs underline hover:text-foreground" onclick={() => { stateFilter = null; searchQuery = ''; loadRuns(true); }}>Clear filters</button>
        </div>
      {:else}
        <div class="p-8 text-center text-muted-foreground">
          <p>No runs in this project yet</p>
          <pre class="mt-3 text-xs bg-muted p-3 rounded-lg inline-block text-left"><code
            >from trailer import Tracker
tracker = Tracker(project="&#123;project}")
tracker.log(&#123;"train/loss": 0.5})
tracker.finish()</code></pre>
        </div>
      {/if}
    {:else}
      <div class="flex items-center gap-2 mb-2 flex-wrap px-4 pt-4">
        <!-- State filter dropdown -->
        <select
          value={stateFilter || ''}
          onchange={(e) => setStateFilter((e.target as HTMLSelectElement).value || null)}
          class="px-2.5 py-1 text-xs border border-border rounded-md bg-background shrink-0"
        >
          <option value="">All states</option>
          <option value="running">Running</option>
          <option value="finished">Finished</option>
          <option value="crashed">Crashed</option>
          <option value="archived">Archived</option>
        </select>

        <!-- Columns -->
        <div class="relative">
          <button
            class="px-3 py-1 text-xs border border-border rounded-md hover:bg-accent transition-colors shrink-0"
            onclick={() => columnMenuOpen = !columnMenuOpen}
            onblur={() => setTimeout(() => columnMenuOpen = false, 200)}
          >
            Columns ▾
          </button>
          {#if columnMenuOpen}
            <div class="absolute top-full left-0 mt-1 w-40 bg-card border border-border rounded-md shadow-lg z-10 py-1">
              {#each ALL_COLUMNS as col}
                <label class="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent cursor-pointer">
                  <input type="checkbox" checked={isColumnVisible(col.key)} onchange={() => toggleColumn(col.key)} />
                  {col.label}
                </label>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Batch actions -->
        {#if selected.size > 0}
          <span class="text-xs text-muted-foreground shrink-0">{selected.size} selected</span>
          {#if selected.size >= 2}
            <button
              class="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md shrink-0"
              onclick={compareSelected}
            >
              Compare ({selected.size})
            </button>
          {/if}
          {#if canWrite}
            <button
              class="px-3 py-1 text-xs border border-border rounded-md hover:bg-accent transition-colors shrink-0"
              onclick={batchArchive}
            >
              Archive ({selected.size})
            </button>
            <button
              class="px-3 py-1 text-xs border border-destructive/50 text-destructive hover:bg-destructive/10 rounded-md shrink-0"
              onclick={openBatchDelete}
            >
              Delete ({selected.size})
            </button>
          {/if}
        {/if}

        <!-- Search -->
        <input
          type="text"
          placeholder='Search runs... name, expr, or config.key == value'
          class="flex-1 min-w-50 px-3 py-1.5 text-xs border border-border rounded-md bg-background"
          bind:value={searchQuery}
          oninput={onSearchInput}
        />
    </div>

      <div class="overflow-x-auto px-4 pb-4">
        <table class="w-full text-sm">
          <thead class="border-b border-border text-muted-foreground">
            <tr>
              <th class="px-2 py-3 w-8">
                <input type="checkbox" checked={allSelected} onchange={toggleAll} class="cursor-pointer" />
              </th>
              {#if isColumnVisible('name')}
                <th class="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground" onclick={() => toggleSort('name')}>Name {sortField === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
              {/if}
              {#if isColumnVisible('state')}
                <th class="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground" onclick={() => toggleSort('state')}>State {sortField === 'state' ? '↑' : '↓'}</th>
              {/if}
              <th class="px-4 py-3 text-right font-medium">Summary</th>
              {#if isColumnVisible('created_at')}
                <th class="px-4 py-3 text-left font-medium cursor-pointer hover:text-foreground" onclick={() => toggleSort('created_at')}>Created {sortField === 'created_at' ? '↑' : '↓'}</th>
              {/if}
              <th class="px-2 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {#each sorted as run (run.run_id)}
              <tr class="hover:bg-muted/50 transition-colors">
                <td class="px-2 py-3">
                  <input type="checkbox" checked={selected.has(run.run_id)} onchange={() => toggleRun(run.run_id)} class="cursor-pointer" />
                </td>
                {#if isColumnVisible('name')}
                  <td class="px-4 py-3 font-mono text-xs">
                    <button class="text-left hover:text-ring cursor-pointer" onclick={() => openRun(run.run_id)}>
                      <div class="font-medium">{run.name || run.run_id.slice(0, 12)}</div>
                      <div class="text-muted-foreground text-[10px]">{run.run_id}</div>
                    </button>
                  </td>
                {/if}
                {#if isColumnVisible('state')}
                  <td class="px-4 py-3"><span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {stateColor(run.state)}">{run.state}</span></td>
                {/if}
                <td class="px-4 py-3">
                  {#if Object.keys(run.summary || {}).length > 0}
                    {@const entries = Object.entries(run.summary || {}).filter(([, v]) => v.last != null)}
                    {@const expanded = expandedSummaries.has(run.run_id)}
                    <div class="flex flex-wrap gap-1 max-w-72">
                      {#each (expanded ? entries : entries.slice(0, SUMMARY_LIMIT)) as [key, val] (key)}
                        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-muted/40 rounded text-[10px] font-mono whitespace-nowrap">
                          <span class="text-muted-foreground">{displayKey(key)}</span>
                          <span class="font-semibold">{formatVal(val.last as number)}</span>
                        </span>
                      {/each}
                    </div>
                    {#if entries.length > SUMMARY_LIMIT}
                      <button
                        type="button"
                        onclick={() => toggleSummary(run.run_id)}
                        class="text-[10px] text-muted-foreground hover:text-foreground mt-1"
                      >
                        {expanded ? 'Show less' : `+${entries.length - SUMMARY_LIMIT} more`}
                      </button>
                    {/if}
                  {/if}
                </td>
                {#if isColumnVisible('created_at')}
                  <td class="px-4 py-3 text-xs text-muted-foreground">{new Date(run.created_at * 1000).toLocaleString()}</td>
                {/if}
                <td class="px-2 py-3 text-right">
                  <button type="button" onclick={(e) => {
                    menuOpen = menuOpen === run.run_id ? null : run.run_id;
                    if (menuOpen) {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      menuStyle = `position:fixed; top:${rect.bottom + 4}px; right:${document.body.clientWidth - rect.right}px;`;
                    }
                  }} class="px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"><EllipsisVertical class="size-4" /></button>
                  {#if menuOpen === run.run_id}
                    <div style={menuStyle} class="w-36 bg-card border border-border rounded-lg shadow-xl z-50 py-1 text-xs">
                      {#if canWrite}
                        <button type="button" onclick={() => copyRun(run.run_id, run.name || run.run_id)} class="w-full text-left px-3 py-1.5 hover:bg-accent"><ClipboardCopy class="size-3.5 inline-block mr-1.5" /> Copy</button>
                        {#if run.state !== 'running'}
                          <button type="button" onclick={() => resumeRun(run.run_id)} class="w-full text-left px-3 py-1.5 hover:bg-accent"><Play class="size-3.5 inline-block mr-1.5" /> Resume</button>
                        {:else}
                          <button type="button" onclick={() => archiveRun(run.run_id)} class="w-full text-left px-3 py-1.5 hover:bg-accent"><Archive class="size-3.5 inline-block mr-1.5" /> Archive</button>
                        {/if}
                        <button type="button" onclick={() => openDelete(run.run_id)} class="w-full text-left px-3 py-1.5 hover:bg-accent text-destructive"><Trash2 class="size-3.5 inline-block mr-1.5" /> Delete</button>
                      {:else}
                        <p class="px-3 py-1.5 text-muted-foreground">View only</p>
                      {/if}
                    </div>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <PaginationBar bind:page bind:perPage {total} />
    {/if}
  </Card>

  <div class="mt-3 text-xs text-muted-foreground">{runs.length} runs</div>
</div>

{#if deleteTarget}
  <div class="fixed inset-0 bg-black/30 z-40" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) { deleteTarget = null; deleteConfirm = ''; } }} onkeydown={(e) => { if (e.key === 'Escape') { deleteTarget = null; deleteConfirm = ''; } }}></div>
  <div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-destructive/30 rounded-xl shadow-xl p-6 w-80">
    <h3 class="text-sm font-semibold mb-2 text-destructive">Delete Run</h3>
    <p class="text-xs text-foreground mb-3">Type the run ID to confirm:</p>
    <div class="flex items-center gap-1 mb-3">
      <code class="text-xs flex-1 font-mono bg-muted px-2 py-1 rounded truncate">{deleteTarget}</code>
      <button type="button" onclick={() => navigator.clipboard.writeText(deleteTarget || '')} class="px-2 py-1 border border-border rounded hover:bg-accent shrink-0" title="Copy ID">
        <ClipboardCopy class="size-3.5" />
      </button>
    </div>
    <input bind:value={deleteConfirm} placeholder="Paste run ID above" class="w-full px-2 py-1.5 text-xs border border-border rounded-md bg-background mb-4" />
    <div class="flex gap-2 justify-end">
      <button type="button" onclick={() => { deleteTarget = null; deleteConfirm = ''; }} class="px-3 py-1 text-xs border border-border rounded-md">Cancel</button>
      <button type="button" onclick={() => deleteTarget && deleteRun(deleteTarget)} disabled={deleteConfirm !== deleteTarget} class="px-3 py-1 text-xs bg-destructive text-destructive-foreground rounded-md disabled:opacity-30">Delete</button>
    </div>
  </div>
{/if}

{#if batchDeleteTarget}
  <div class="fixed inset-0 bg-black/30 z-40" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) batchDeleteTarget = null; }} onkeydown={(e) => { if (e.key === 'Escape') batchDeleteTarget = null; }}></div>
  <div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-destructive/30 rounded-xl shadow-xl p-6 w-80">
    <h3 class="text-sm font-semibold mb-2 text-destructive">Delete Runs</h3>
    <p class="text-xs text-foreground mb-4">Are you sure you want to delete <strong>{batchDeleteTarget.size}</strong> runs? This action cannot be undone.</p>
    <div class="flex gap-2 justify-end">
      <button type="button" onclick={() => batchDeleteTarget = null} class="px-3 py-1 text-xs border border-border rounded-md">Cancel</button>
      <button type="button" onclick={confirmBatchDelete} class="px-3 py-1 text-xs bg-destructive text-destructive-foreground rounded-md">Delete</button>
    </div>
  </div>
{/if}
