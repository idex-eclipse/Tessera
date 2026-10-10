<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { createPluginApi } from '../../core/plugin-api-factory';
  import PluginElementHost from '../plugin-element-host.svelte';

  const ctx = getAppContext();

  let overlays = $derived(ctx.registry.getOverlays());
</script>

{#if overlays.length > 0}
  <div class="plugin-overlays-layer">
    {#each overlays as overlay (`${overlay.pluginId}:${overlay.contribution.id}`)}
      {@const loaded = ctx.loader.getLoadedPlugin(overlay.pluginId)}
      {@const api = loaded
        ? createPluginApi(ctx, overlay.pluginId, loaded.manifest)
        : null}

      {#if api}
        <div class="plugin-overlay-item">
          <PluginElementHost
            tag={overlay.contribution.element}
            {api}
            params={{}}
            fill={false}
          />
        </div>
      {/if}
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