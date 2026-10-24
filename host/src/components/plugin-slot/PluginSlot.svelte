<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { getPluginApi } from '../../core/plugin-api-cache';

  import PluginElementHost from '../plugin-element-host.svelte';

  let { pageId, params = {} }: { pageId: string; params?: Record<string, string> } = $props();

  const ctx = getAppContext();

  const page = ctx.registry.getPages().find((p) => p.contribution.id === pageId);

  let api = $derived(page ? getPluginApi(ctx, page.pluginId, { allowUnloaded: true }) : null);

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