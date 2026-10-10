<script lang="ts">
  import type { PluginApi } from '../../../../plugin-sdk/src/types';

  import { getAppContext } from '../../app-context';
  import { createPluginApi } from '../../core/plugin-api-factory';
  import PluginElementHost from '../plugin-element-host.svelte';

  let {
    mode = 'expanded',
    routeKind = 'dashboard',
  }: {
    mode?: 'expanded' | 'collapsed';
    routeKind?: string;
  } = $props();

  const ctx = getAppContext();

  let banners = $derived(ctx.registry.getBanners());

  const apiCache = new Map<string, PluginApi>();

  function apiFor(pluginId: string): PluginApi | null {
    const cached = apiCache.get(pluginId);
    if (cached) return cached;

    const loaded = ctx.loader.getLoadedPlugin(pluginId);
    if (!loaded) return null;

    const api = createPluginApi(ctx, pluginId, loaded.manifest);
    apiCache.set(pluginId, api);
    return api;
  }
</script>

{#if banners.length > 0}
  <div class="plugin-banners">
    {#each banners as banner (`${banner.pluginId}:${banner.contribution.id}`)}
      {@const api = apiFor(banner.pluginId)}

      {#if api}
        <div class="plugin-banner-item">
          <PluginElementHost
            tag={banner.contribution.element}
            {api}
            params={{ mode, route: routeKind }}
          />
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .plugin-banners {
    display: grid;
    gap: var(--space-sm);
    min-width: 0;
    flex-shrink: 0;
  }

  .plugin-banner-item {
    min-width: 0;
  }
</style>