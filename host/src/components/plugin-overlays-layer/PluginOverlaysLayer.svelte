<script lang="ts">
  import { getAppContext } from '../../app-context';
  import PluginSurface from '../PluginSurface.svelte';

  const ctx = getAppContext();

  let overlays = $derived(ctx.registry.getOverlays());
</script>

{#if overlays.length > 0}
  <div class="plugin-overlays-layer">
    {#each overlays as overlay (`${overlay.pluginId}:${overlay.contribution.id}`)}
      <div class="plugin-overlay-item">
        <PluginSurface
          pluginId={overlay.pluginId}
          tag={overlay.contribution.element}
          fill={false}
        />
      </div>
    {/each}
  </div>
{/if}

<style>
  .plugin-overlays-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: var(--z-plugin-overlays, 60);
  }

  .plugin-overlay-item {
    pointer-events: none;
  }

  .plugin-overlay-item :global(*) {
    pointer-events: auto;
  }
</style>