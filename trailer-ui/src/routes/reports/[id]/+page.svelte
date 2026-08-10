<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ClipboardCopy } from 'lucide-svelte';
  import { authReady } from '$lib/utils/auth';
  import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';

  let report = $state<any>(null);
  let loading = $state(true);
  let editing = $state(false);
  let editTitle = $state('');
  let editBody = $state('');
  let deleting = $state(false);
  let confirmTitle = $state('');

  let readOnly = $state(false);
  let headings = $state<{ id: string; text: string; depth: number }[]>([]);

  onMount(async () => {
    await authReady();
    readOnly = !!page.url.searchParams.get('token');
    const id = page.params.id;
    if (!id) { loading = false; return; }
    await loadReport(id);
    loading = false;
  });

  async function loadReport(id: string) {
    try {
      const resp = await fetch(`/api/v1/reports/${id}`);
      if (resp.ok) {
        report = await resp.json();
        editTitle = report.title;
        editBody = report.body;
      }
    } catch {}
  }

  function startEdit() {
    editTitle = report.title;
    editBody = report.body;
    editing = true;
  }

  async function saveEdit() {
    try {
      const resp = await fetch(`/api/v1/reports/${report.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: report.project, title: editTitle, body: editBody }),
      });
      if (resp.ok) {
        report.title = editTitle;
        report.body = editBody;
        editing = false;
      }
    } catch {}
  }

  function cancelEdit() {
    editing = false;
  }

  async function deleteReport() {
    if (confirmTitle !== report.title) return;
    try {
      await fetch(`/api/v1/reports/${report.id}`, { method: 'DELETE' });
      goto('/reports');
    } catch {}
  }

  let shareModal = $state(false);
  let shareUrl = $state('');
  let shareExpiry = $state('7');
  let copyBtnText = $state('Copy');

  async function createShare() {
    const days = shareExpiry === '0' ? null : parseInt(shareExpiry);
    const resp = await fetch('/api/v1/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource_type: 'report', resource_id: String(page.params.id), expires_in_days: days }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    shareUrl = `${location.origin}/reports/${page.params.id}?token=${data.token}`;
    shareModal = true;
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      copyBtnText = 'Copied';
      setTimeout(() => (copyBtnText = 'Copy'), 1500);
    } catch {}
  }

</script>

<svelte:head><title>{report?.title || 'Report'} — Trailer</title></svelte:head>

<div class="p-6 {editing ? '' : 'max-w-4xl'}">
  <a href="/reports" class="text-sm text-muted-foreground hover:text-foreground mb-2 inline-block">← Reports</a>

  {#if loading}
    <p class="text-sm text-muted-foreground">Loading...</p>
  {:else if !report}
    <p class="text-sm text-muted-foreground">Report not found</p>
  {:else if editing}
    <div class="flex gap-2 mb-4">
      <input bind:value={editTitle} class="flex-1 px-3 py-2 text-lg font-bold border border-border rounded-md bg-background" />
      <button onclick={saveEdit} class="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">Save</button>
      <button onclick={cancelEdit} class="px-4 py-2 border border-border rounded-md text-sm">Cancel</button>
    </div>
    <textarea bind:value={editBody} class="w-[calc(100vw-4rem)] h-[60vh] p-4 border border-border rounded-md bg-background font-mono text-sm resize-y"></textarea>
  {:else}
    <div class="mb-6">
      <h1 class="text-2xl font-bold">{report.title}</h1>
      <div class="text-xs text-muted-foreground mt-1 flex items-center gap-2">
        <span>{report.project} · {new Date(report.created_at * 1000).toLocaleString()}</span>
        {#if !readOnly}
          <button onclick={startEdit} class="px-2 py-0.5 text-[10px] border border-border rounded hover:bg-accent transition-colors">Edit</button>
          <button onclick={() => deleting = true} class="px-2 py-0.5 text-[10px] border border-destructive/50 text-destructive rounded hover:bg-destructive/10 transition-colors">Delete</button>
          <button onclick={createShare} class="px-2 py-0.5 text-[10px] border border-border rounded hover:bg-accent transition-colors">Share</button>
        {/if}
        {#if deleting}
          <!-- Overlay -->
          <div class="fixed inset-0 bg-black/30 z-40" role="presentation" onclick={() => { deleting = false; confirmTitle = ''; }} onkeydown={(e) => { if (e.key === 'Escape') { deleting = false; confirmTitle = ''; } }}></div>
          <!-- Modal -->
          <div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-destructive/30 rounded-xl shadow-xl p-6 w-80">
            <h3 class="text-sm font-semibold mb-2 text-destructive">Delete Report</h3>
            <p class="text-xs text-foreground mb-3">Type the report title to confirm:</p>
            <div class="flex items-center gap-1 mb-3">
              <code class="text-xs flex-1 font-mono bg-muted px-2 py-1 rounded truncate">{report.title}</code>
              <button onclick={() => { navigator.clipboard.writeText(report.title); }} class="px-2 py-1 border border-border rounded hover:bg-accent shrink-0" title="Copy title"><ClipboardCopy class="size-3.5" /></button>
            </div>
            <input bind:value={confirmTitle} placeholder="Paste or type title above" class="w-full px-2 py-1.5 text-xs border border-border rounded-md bg-background mb-4" />
            <div class="flex gap-2 justify-end">
              <button onclick={() => { deleting = false; confirmTitle = ''; }} class="px-3 py-1 text-xs border border-border rounded-md">Cancel</button>
              <button onclick={deleteReport} disabled={confirmTitle !== report.title} class="px-3 py-1 text-xs bg-destructive text-destructive-foreground rounded-md disabled:opacity-30">Delete</button>
            </div>
          </div>
        {/if}

        {#if shareModal}
          <div class="fixed inset-0 bg-black/30 z-40" role="presentation" onclick={() => shareModal = false} onkeydown={(e) => { if (e.key === 'Escape') shareModal = false; }}></div>
          <div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-xl shadow-xl p-6 w-96">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-semibold">Share Report</h3>
              <button onclick={() => shareModal = false} class="text-muted-foreground hover:text-foreground text-sm leading-none">✕</button>
            </div>
            <p class="text-xs text-muted-foreground mb-3">Anyone with this link can view this report:</p>
            <div class="flex items-center gap-2 mb-3 text-xs">
              <span class="text-muted-foreground shrink-0">Expires in:</span>
              <select bind:value={shareExpiry} class="px-2 py-1 border border-border rounded-md bg-background">
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="0">Never</option>
              </select>
            </div>
            <div class="flex items-center gap-2 mb-4">
              <input readonly value={shareUrl} class="flex-1 px-2 py-1.5 text-xs font-mono bg-muted border border-border rounded-md" />
              <button onclick={copyShare} class="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md shrink-0">{copyBtnText}</button>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <div class="flex gap-6 items-start">
      <div class="flex-1 min-w-0 prose prose-sm max-w-none">
        <MarkdownRenderer content={report.body} onHeadings={(h) => headings = h} />
      </div>
      {#if headings.length > 1}
        <nav class="hidden lg:block w-52 shrink-0 border-l border-border pl-4 self-start sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto text-sm">
          <div class="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Contents</div>
          <ul class="space-y-1">
            {#each headings as h (h.id)}
              <li style="padding-left:{(h.depth - 1) * 0.75}rem">
                <a
                  href="#{h.id}"
                  onclick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  class="block py-0.5 text-muted-foreground hover:text-foreground truncate"
                >{h.text}</a>
              </li>
            {/each}
          </ul>
        </nav>
      {/if}
    </div>
  {/if}
</div>
