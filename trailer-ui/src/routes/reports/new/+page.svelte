<script lang="ts">
  import { goto } from '$app/navigation';
  let title = $state('');
  let body = $state('');
  let project = $state('demo');
  let saving = $state(false);

  async function create() {
    if (!title.trim()) return;
    saving = true;
    try {
      const resp = await fetch('/api/v1/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project, title, body }),
      });
      if (resp.ok) {
        const data = await resp.json();
        goto(`/reports/${data.id}`);
      }
    } catch {}
    saving = false;
  }
</script>

<svelte:head><title>New Report — Trailer</title></svelte:head>

<div class="p-6">
  <a href="/reports" class="text-sm text-muted-foreground hover:text-foreground mb-2 inline-block">← Reports</a>
  <h1 class="text-xl font-bold mb-4">New Report</h1>

  <div class="flex gap-4 mb-4 max-w-md">
    <input bind:value={project} placeholder="Project" class="flex-1 px-3 py-1.5 text-xs border border-border rounded-md bg-background" />
  </div>
  <input bind:value={title} placeholder="Report title" class="w-full max-w-md px-3 py-2 text-lg font-bold border border-border rounded-md bg-background mb-4" />

  <textarea bind:value={body} placeholder="Write in Markdown..." class="w-full h-[50vh] p-4 border border-border rounded-md bg-background font-mono text-sm resize-y"></textarea>

  <div class="flex gap-2 mt-4">
    <button onclick={create} disabled={saving || !title.trim()} class="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50">
      {saving ? 'Saving...' : 'Create Report'}
    </button>
    <a href="/reports" class="px-4 py-2 border border-border rounded-md text-sm">Cancel</a>
  </div>
</div>
