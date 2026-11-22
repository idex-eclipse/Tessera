<script lang="ts">
  import type { Snippet } from 'svelte';

  // Test stand-in for the SDK ExtensionPoint: no host context exists in unit mounts,
  // so the point always renders its original snippet with no contributions.
  let { original }: { point?: string; params?: Record<string, string>; original?: Snippet } = $props();
</script>

{#if original}{@render original()}{/if}
