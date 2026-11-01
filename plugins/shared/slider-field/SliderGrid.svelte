<script lang="ts">
  import type { Snippet } from 'svelte';

  let { columns, children }: { columns: 1 | 2; children: Snippet } = $props();
</script>

<div class="sf-grid" style:--sf-columns={columns}>
  {@render children()}
</div>

<style>
  .sf-grid {
    display: grid;
    grid-template-columns: repeat(var(--sf-columns), minmax(0, 1fr));
    gap: var(--space-sm) var(--space-md);
  }
</style>
