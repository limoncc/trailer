<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ExploreWorkspace from '$lib/components/ExploreWorkspace.svelte';

  // 可选从 URL 初始化(?run_ids=a,b)
  const runIds = page.url.searchParams.get('run_ids')?.split(',').filter(Boolean) ?? [];

  function onSaved(id: string) {
    goto(`/explore/${id}`);
  }
</script>

<div class="h-full">
  <ExploreWorkspace initialRunIds={runIds} {onSaved} />
</div>
