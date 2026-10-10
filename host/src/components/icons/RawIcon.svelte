<script lang="ts">
  let { raw, size = 20 }: { raw: string; size?: number } = $props();
</script>

<span class="raw-icon" style="width: {size}px; height: {size}px">
  {@html raw}
</span>

<style>
  .raw-icon {
    display: inline-flex;
    flex-shrink: 0;
    color: inherit; /* svg внутри рисует currentColor */
  }

  .raw-icon :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>