<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { createPluginApi } from '../../core/plugin-api-factory';

  import PluginElementHost from '../plugin-element-host.svelte';

  let { pageId, params = {} }: { pageId: string; params?: Record<string, string> } = $props();

  const ctx = getAppContext();

  const page = ctx.registry.getPages().find((p) => p.contribution.id === pageId);

  let api = $derived.by(() => {
    if (!page) return null;
    const loaded = ctx.loader.getLoadedPlugin(page.pluginId);
    const manifest =
      loaded?.manifest ??
      ({ id: page.pluginId, name: page.pluginId, version: '0.0.0', entry: '' } as any);
    return createPluginApi(ctx, page.pluginId, manifest);
  });

  let tag = $derived(page?.contribution.element ?? '');
</script>

{#if api && tag}
  <PluginElementHost {tag} {api} {params} />
{:else}
  <p class="slot-error">
    Page element not found: {pageId}
  </p>
{/if}

<style>
  .slot-error {
    color: var(--danger);
    font-size: var(--font-size-sm);
  }
</style>