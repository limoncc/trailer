<script lang="ts">
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { Check, ChevronDown } from 'lucide-svelte';

  interface PickerItem {
    id: string;
    label: string;
    /** accent='color' 时的单色块 */
    swatch?: string;
    /** accent='chart' 时的多色点 */
    swatches?: string[];
    /** accent='font' 时的字形预览 */
    family?: string;
    /** accent='radius' 时的圆角(rem) */
    value?: number;
  }

  let {
    label,
    value,
    selected,
    items,
    onSelect,
    accent = 'none',
  }: {
    label: string;
    value: string;
    selected: string;
    items: PickerItem[];
    onSelect: (id: string) => void;
    accent?: 'none' | 'color' | 'chart' | 'font' | 'radius';
  } = $props();

  let cur = $derived(items.find((i) => i.id === selected) ?? items[0]);

  /** 显式控制打开状态:onSelect 里同步触发大范围主题重渲染会打断 bits-ui 的自动关闭 */
  let open = $state(false);

  const triggerCls =
    'relative w-full shrink-0 touch-manipulation rounded-xl p-3 ring-1 ring-foreground/10 select-none hover:bg-muted focus-visible:ring-foreground/50 focus-visible:outline-none disabled:opacity-50 data-[state=open]:bg-muted flex items-center justify-between gap-2';
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger class={triggerCls}>
    <div class="flex min-w-0 flex-1 flex-col justify-start text-left">
      <div class="text-xs text-muted-foreground">{label}</div>
      <div class="flex items-center gap-2 text-sm font-medium text-foreground">
        {#if accent === 'color' && cur?.swatch}
          <span class="size-3.5 shrink-0 rounded-full" style={`background: ${cur.swatch}`}></span>
        {:else if accent === 'chart' && cur?.swatches}
          <span class="flex shrink-0 gap-0.5">
            {#each cur.swatches as c}<span class="size-1.5 rounded-full" style={`background: ${c}`}></span>{/each}
          </span>
        {:else if accent === 'font' && cur?.family}
          <span class="shrink-0 text-base" style={`font-family: ${cur.family}`}>Aa</span>
        {:else if accent === 'radius' && cur?.value !== undefined}
          <span class="size-3.5 shrink-0 border-t-2 border-r-2 border-current" style={`border-top-right-radius: ${cur.value}rem`}></span>
        {/if}
        <span class="truncate">{value}</span>
      </div>
    </div>
    <ChevronDown class="size-4 shrink-0 text-muted-foreground" />
  </DropdownMenu.Trigger>

  <DropdownMenu.Content align="start" class="w-52 max-h-80 overflow-y-auto">
    {#each items as it (it.id)}
      <DropdownMenu.Item
        onSelect={() => {
          open = false;
          onSelect(it.id);
        }}
        class="justify-between"
      >
        <span class="flex min-w-0 items-center gap-2">
          {#if accent === 'color' && it.swatch}
            <span class="size-3.5 shrink-0 rounded-full" style={`background: ${it.swatch}`}></span>
          {:else if accent === 'chart' && it.swatches}
            <span class="flex shrink-0 gap-0.5">
              {#each it.swatches as c}<span class="size-1.5 rounded-full" style={`background: ${c}`}></span>{/each}
            </span>
          {:else if accent === 'font' && it.family}
            <span class="shrink-0 text-sm" style={`font-family: ${it.family}`}>Aa</span>
          {:else if accent === 'radius' && it.value !== undefined}
            <span class="size-3.5 shrink-0 border-t-2 border-r-2 border-current" style={`border-top-right-radius: ${it.value}rem`}></span>
          {/if}
          <span class="truncate">{it.label}</span>
        </span>
        {#if it.id === selected}<Check class="size-4 shrink-0" />{/if}
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
