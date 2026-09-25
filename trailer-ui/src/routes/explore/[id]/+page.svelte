<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import ExploreWorkspace from '$lib/components/ExploreWorkspace.svelte';
import { api } from '$lib/utils/api';
import type { DashWidget } from '$lib/utils/dashboard';
import { parseLayout } from '$lib/utils/dashboard';

  const id = page.params.id;
  const shareToken = page.url.searchParams.get('token') ?? '';
  const readOnly = !!shareToken;

  let initialRunIds: string[] = $state([]);
  let initialWidgets: DashWidget[] = $state([]);
  let initialTitle = $state('');
  let loading = $state(true);

  onMount(async () => {
    try {
      const resp = await api(`/api/v1/explores/${id}${shareToken ? '?token=' + shareToken : ''}`);
      if (resp.ok) {
        const e = await resp.json();
        try {
          initialRunIds = JSON.parse(e.run_ids || '[]');
        } catch {
          initialRunIds = [];
        }
        // 看板布局存 config.layout;旧分析(只有 chart_defs)打开为空看板,不做迁移
        initialWidgets = parseLayout(layoutOf(e.config)).widgets;
        initialTitle = e.title;
      }
    } catch (e) {
      console.error('Failed to load explore:', e);
    } finally {
      loading = false;
    }
  });

  /** config 是 schemaless JSON:取其中的 layout 串(非法/缺失 → null → 空看板) */
  function layoutOf(config: unknown): string | null {
    try {
      const c = JSON.parse((config as string) || '{}') as { layout?: unknown };
      return typeof c.layout === 'string' ? c.layout : null;
    } catch {
      return null;
    }
  }

  let shareModal = $state(false);
  let shareUrl = $state('');
  let shareExpiry = $state('7');
  let copyBtnText = $state('Copy');

  async function createShare() {
    const days = shareExpiry === '0' ? null : parseInt(shareExpiry);
    const resp = await api('/api/v1/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource_type: 'explore', resource_id: String(id), expires_in_days: days }),
    });
    if (resp.ok) {
      const data = await resp.json();
      shareUrl = `${location.origin}/explore/${id}?token=${data.token}`;
      shareModal = true;
    }
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      copyBtnText = 'Copied';
      setTimeout(() => (copyBtnText = 'Copy'), 1500);
    } catch {}
  }
</script>

{#if loading}
  <p class="text-center p-8 text-sm text-muted-foreground">Loading...</p>
{:else}
  <div class="h-full">
    <ExploreWorkspace
      {initialRunIds}
      {initialWidgets}
      {initialTitle}
      savedId={id}
      {readOnly}
      onShare={readOnly ? undefined : createShare}
    />
  </div>
{/if}

{#if shareModal}
  <div class="fixed inset-0 bg-black/30 z-40" role="presentation" onclick={() => shareModal = false} onkeydown={(e) => { if (e.key === 'Escape') shareModal = false; }}></div>
  <div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-xl shadow-xl p-6 w-96">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold">Share Analysis</h3>
      <button onclick={() => shareModal = false} class="text-muted-foreground hover:text-foreground text-sm leading-none">✕</button>
    </div>
    <p class="text-xs text-muted-foreground mb-3">Anyone with this link can view this analysis:</p>
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
