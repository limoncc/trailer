<script lang="ts">
  import { cn } from "$lib/utils";
  import { type Snippet } from "svelte";

  interface Props {
    children: Snippet;
    class?: string;
    variant?: "default" | "outline" | "ghost" | "destructive";
    size?: "default" | "sm" | "lg" | "icon";
    onclick?: () => void;
    disabled?: boolean;
  }

  let { children, class: className = "", variant = "default", size = "default", onclick, disabled = false }: Props = $props();
</script>

<button
  {onclick}
  {disabled}
  class={cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size'])]:size-4",
    variant === "default" && "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
    variant === "outline" && "border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
    variant === "ghost" && "hover:bg-accent hover:text-accent-foreground",
    variant === "destructive" && "bg-destructive text-white shadow-xs hover:bg-destructive/90",
    size === "default" && "h-9 px-4 py-2",
    size === "sm" && "h-8 rounded-md gap-1.5 px-3 text-xs",
    size === "lg" && "h-10 rounded-md px-6",
    size === "icon" && "size-9",
    className
  )}
>
  {@render children()}
</button>
