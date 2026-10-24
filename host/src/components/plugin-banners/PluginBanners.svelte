<script lang="ts">
  import { getAppContext } from '../../app-context';
  import PluginSurface from '../PluginSurface.svelte';

  let {
    mode = 'expanded',
    routeKind = 'dashboard',
  }: {
    mode?: 'expanded' | 'collapsed';
    routeKind?: string;
  } = $props();

  const ctx = getAppContext();

  let banners = $derived(ctx.registry.getBanners());

</script>

{#if banners.length > 0}
  <div class="plugin-banners">
    {#each banners as banner (`${banner.pluginId}:${banner.contribution.id}`)}
      <div class="plugin-banner-item">
        <PluginSurface
          pluginId={banner.pluginId}
          tag={banner.contribution.element}
          params={{ mode, route: routeKind }}
        />
      </div>
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