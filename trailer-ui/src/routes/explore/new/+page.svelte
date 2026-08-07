<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ExploreWorkspace from '$lib/components/ExploreWorkspace.svelte';
  import { deserializeDefs } from '$lib/utils/explore';
  import type { ChartDef } from '$lib/utils/explore';

  // 可选从 URL 初始化(兼容 ?run_ids&defs 快速分享)
  const runIds = page.url.searchParams.get('run_ids')?.split(',').filter(Boolean) ?? [];
  const defsParam = page.url.searchParams.get('defs');
  let initialDefs: ChartDef[] = [];
  if (defsParam) {
    const d = deserializeDefs(defsParam);
    if (d) initialDefs = d;
  }

  function onSaved(id: string) {
    goto(`/explore/${id}`);
  }
</script>

<div class="h-full">
  <ExploreWorkspace initialRunIds={runIds} {initialDefs} {onSaved} />
</div>
