<script lang="ts">
  import { onMount } from 'svelte';
  import PaginationBar from '$lib/components/PaginationBar.svelte';

  interface ShareInfo {
    token: string;
    resource_type: string;
    resource_id: string;
    created_at: number;
    expires_at: number | null;
  }

  let shares = $state<ShareInfo[]>([]);
  let loading = $state(true);
  let error = $state('');
  let editToken = $state<string | null>(null);
  let editDays = $state('7');
  let page = $state(1);
  let perPage = $state(20);
  let total = $state(0);
  let inited = false;

  function token() { return localStorage.getItem('trailer_token') || ''; }
  function hdrs() { return { 'content-type': 'application/json', authorization: `Bearer ${token()}` }; }

  async function load() {
    loading = true;
    error = '';
    try {
      const r = await fetch(`/api/v1/shares?limit=${perPage}&offset=${(page - 1) * perPage}`, { headers: hdrs() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      total = Number(r.headers.get('x-total-count') || 0);
      shares = await r.json();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  // 翻页/每页条数变化 → 重新加载(首次由 onMount 处理)
  $effect(() => {
    page;
    perPage;
    if (!inited) { inited = true; return; }
    load();
  });

  async function updateExpiry(t: string) {
    const days = parseInt(editDays);
    if (isNaN(days) || days < 0) return;
    await fetch(`/api/v1/shares/${encodeURIComponent(t)}`, {
      method: 'PUT', headers: hdrs(), body: JSON.stringify({ expires_in_days: days }),
    });
    editToken = null;
    await load();
  }

  async function revoke(t: string) {
    if (!confirm('Revoke this share link?')) return;
    await fetch(`/api/v1/shares/${encodeURIComponent(t)}`, { method: 'DELETE', headers: hdrs() });
    await load();
  }

  function status(s: ShareInfo): { label: string; cls: string } {
    if (s.expires_at == null) return { label: 'Permanent', cls: 'bg-muted text-muted-foreground' };
    if (s.expires_at < Date.now() / 1000) return { label: 'Expired', cls: 'bg-destructive/10 text-destructive' };
    return { label: 'Active', cls: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-400' };
  }

  function fmt(ts: number | null): string {
    if (ts == null) return '—';
    return new Date(ts * 1000).toLocaleString();
  }

  function typeLabel(t: string): string {
    if (t === 'run') return 'Run';
    if (t === 'explore') return 'Explore';
    if (t === 'report') return 'Report';
    return t;
  }
  function typeCls(t: string): string {
    if (t === 'explore') return 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300';
    if (t === 'report') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300';
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300';
  }
  /** 按资源类型复制对应分享链接 */
  function copyUrl(s: ShareInfo) {
    const base = location.origin;
    const path = s.resource_type === 'run' ? `/run/${s.resource_id}`
      : s.resource_type === 'explore' ? `/explore/${s.resource_id}`
      : `/reports/${s.resource_id}`;
    navigator.clipboard.writeText(`${base}${path}?token=${s.token}`);
  }

  onMount(() => {
    inited = true;
    load();
  });
</script>

<svelte:head><title>Shares — Trailer</title></svelte:head>

<div class="p-6 max-w-4xl">
  <a href="/" class="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block">← Back</a>
  <h1 class="text-xl font-bold mb-4">Shared Links</h1>

  {#if loading}
    <p class="text-sm text-muted-foreground py-8 text-center">Loading...</p>
  {:else if error}
    <div class="text-center py-8">
      <p class="text-sm text-destructive">{error}</p>
      <button onclick={load} class="mt-2 px-3 py-1 text-xs border border-border rounded-md hover:bg-accent">Retry</button>
    </div>
  {:else if shares.length === 0}
    <p class="text-sm text-muted-foreground py-8 text-center">No shared links yet. Open a run, explore, or report page and click Share.</p>
  {:else}
    <div class="border border-border rounded-md overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-muted/30 border-b border-border">
          <tr>
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Resource</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Type</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Token</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Created</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Expires</th>
            <th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
            <th class="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {#each shares as s (s.token)}
            <tr class="hover:bg-muted/20">
              <td class="px-3 py-2 font-mono text-xs">{s.resource_id}</td>
              <td class="px-3 py-2">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-medium {typeCls(s.resource_type)}">{typeLabel(s.resource_type)}</span>
              </td>
              <td class="px-3 py-2">
                <div class="flex items-center gap-2">
                  <code class="text-[10px] font-mono text-muted-foreground truncate max-w-[160px]">{s.token}</code>
                  <button onclick={() => copyUrl(s)} class="text-[10px] underline text-muted-foreground hover:text-foreground shrink-0" title="Copy link">Copy URL</button>
                </div>
              </td>
              <td class="px-3 py-2 text-xs text-muted-foreground">{fmt(s.created_at)}</td>
              <td class="px-3 py-2 text-xs text-muted-foreground">{fmt(s.expires_at)}</td>
              <td class="px-3 py-2">
                <span class="px-1.5 py-0.5 rounded text-[10px] font-medium {status(s).cls}">{status(s).label}</span>
              </td>
              <td class="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                <button onclick={() => { editToken = s.token; editDays = '7'; }} class="text-[10px] underline text-muted-foreground hover:text-foreground">Set expiry</button>
                <button onclick={() => revoke(s.token)} class="text-[10px] underline text-destructive">Revoke</button>
              </td>
            </tr>
            {#if editToken === s.token}
              <tr>
                <td colspan="7" class="px-3 py-2 bg-muted/30">
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-muted-foreground">Expiry (days):</span>
                    <input bind:value={editDays} type="number" min="0" class="w-20 px-2 py-1 text-xs border border-border rounded-md bg-background" />
                    <span class="text-[10px] text-muted-foreground">0 = immediate, empty = permanent</span>
                    <button onclick={() => updateExpiry(s.token)} class="px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md">Save</button>
                    <button onclick={() => editToken = null} class="px-2 py-1 text-xs border border-border rounded-md">Cancel</button>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
    <PaginationBar bind:page bind:perPage {total} />
  {/if}
</div>
