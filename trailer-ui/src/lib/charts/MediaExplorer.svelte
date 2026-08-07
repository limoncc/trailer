<script lang="ts">
  interface MediaRow {
    id: number;
    run_id: string;
    step: number;
    name: string;
    kind: 'image' | 'video' | 'audio';
    ext: string;
    size: number;
  }

  interface Props {
    runId: string;
  }

  let { runId }: Props = $props();

  let items = $state<MediaRow[]>([]);
  let loading = $state(true);
  let error = $state('');
  let filterKind = $state('');
  let brightness = $state(100);
  let contrast = $state(100);

  async function loadMedia() {
    loading = true;
    error = '';
    try {
      if (!runId) return;
      const params = filterKind ? `?kind=${encodeURIComponent(filterKind)}` : '';
      const resp = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/media${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      items = await resp.json();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load media';
    } finally {
      loading = false;
    }
  }

  function fileUrl(id: number): string {
    return `/api/v1/runs/${encodeURIComponent(runId)}/media/${id}/file`;
  }

  // 媒体文件流需要鉴权;<img>/<video> 原生请求无法带 Authorization header,
  // 故先 fetch(自动带 token)再转为 object URL。
  let blobUrls = $state<Map<number, string>>(new Map());

  async function blobUrl(id: number): Promise<string> {
    const hit = blobUrls.get(id);
    if (hit) return hit;
    const resp = await fetch(fileUrl(id));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const url = URL.createObjectURL(await resp.blob());
    blobUrls = new Map(blobUrls).set(id, url);
    return url;
  }

  function resetImageControls() {
    brightness = 100;
    contrast = 100;
  }

  $effect(() => {
    if (runId) loadMedia();
  });
</script>

<div class="media-explorer">
  <div class="flex items-center gap-3 mb-3 flex-wrap">
    <div class="flex gap-1 text-xs border border-border rounded-md overflow-hidden">
      <button
        class="px-2.5 py-1 {!filterKind ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
        onclick={() => { filterKind = ''; loadMedia(); }}
      >All</button>
      <button
        class="px-2.5 py-1 {filterKind === 'image' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
        onclick={() => { filterKind = 'image'; loadMedia(); resetImageControls(); }}
      >Images</button>
      <button
        class="px-2.5 py-1 {filterKind === 'video' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
        onclick={() => { filterKind = 'video'; loadMedia(); }}
      >Videos</button>
      <button
        class="px-2.5 py-1 {filterKind === 'audio' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
        onclick={() => { filterKind = 'audio'; loadMedia(); }}
      >Audio</button>
    </div>
  </div>

  {#if loading}
    <p class="text-center text-muted-foreground py-8 text-sm">Loading media...</p>
  {:else if error}
    <div class="text-center py-8">
      <p class="text-sm text-destructive">{error}</p>
      <button
        onclick={loadMedia}
        class="mt-2 px-3 py-1 text-xs border border-border rounded-md hover:bg-accent"
      >Retry</button>
    </div>
  {:else if items.length === 0}
    <p class="text-center text-muted-foreground py-8 text-sm">
      {filterKind ? `No ${filterKind} files` : 'No media files recorded'}
    </p>
  {:else}
    <div class="space-y-4">
      {#each items as item (item.id)}
        <div class="border border-border rounded-md overflow-hidden">
          <div class="flex items-center gap-2 px-3 py-1.5 bg-muted/30 text-xs text-muted-foreground border-b border-border">
            <span class="font-mono font-medium">{item.name}</span>
            <span class="px-1.5 py-0.5 rounded bg-muted text-xs uppercase">{item.kind}</span>
            <span class="ml-auto font-mono">Step {item.step}</span>
            <span class="text-xs">({(item.size / 1024).toFixed(1)} KB)</span>
          </div>

          <div class="p-3">
            {#if item.kind === 'image'}
              <div class="space-y-2">
                <div class="flex items-center gap-4 text-xs text-muted-foreground">
                  <label class="flex items-center gap-1">
                    Brightness
                    <input type="range" min="0" max="200" bind:value={brightness} class="w-20" />
                    <span class="w-8 text-right">{brightness}%</span>
                  </label>
                  <label class="flex items-center gap-1">
                    Contrast
                    <input type="range" min="0" max="200" bind:value={contrast} class="w-20" />
                    <span class="w-8 text-right">{contrast}%</span>
                  </label>
                  <button onclick={resetImageControls} class="underline hover:text-foreground">Reset</button>
                </div>
                {#await blobUrl(item.id)}
                  <p class="text-xs text-muted-foreground py-4 text-center">Loading media...</p>
                {:then url}
                  <img
                    src={url}
                    alt={item.name}
                    class="max-w-full h-auto rounded border border-border"
                    style="filter: brightness({brightness}%) contrast({contrast}%)"
                    loading="lazy"
                  />
                {:catch}
                  <p class="text-xs text-destructive py-4 text-center">Failed to load</p>
                {/await}
              </div>
            {:else if item.kind === 'video'}
              <video controls class="max-w-full rounded" preload="metadata">
                {#await blobUrl(item.id)}
                  <p class="text-xs text-muted-foreground py-4 text-center">Loading media...</p>
                {:then url}
                  <source src={url} />
                {:catch}
                  <p class="text-xs text-destructive py-4 text-center">Failed to load</p>
                {/await}
              </video>
            {:else if item.kind === 'audio'}
              <audio controls class="w-full" preload="metadata">
                {#await blobUrl(item.id)}
                  <p class="text-xs text-muted-foreground py-4 text-center">Loading media...</p>
                {:then url}
                  <source src={url} />
                {:catch}
                  <p class="text-xs text-destructive py-4 text-center">Failed to load</p>
                {/await}
              </audio>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <p class="text-xs text-muted-foreground mt-2">{items.length} file(s)</p>
  {/if}
</div>
