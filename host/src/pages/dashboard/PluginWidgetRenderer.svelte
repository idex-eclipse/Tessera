<script lang="ts">
  import PluginElementHost from '../../components/plugin-element-host.svelte';

  import type { PluginApi, WidgetContribution } from '../../../../plugin-sdk/src/types';

  let {
    widget,
    printerId,
    params = {},
    api,
  }: {
    widget: { pluginId: string; contribution: WidgetContribution };
    printerId: string;
    params: Record<string, string>;
    api: PluginApi;
  } = $props();

  let bodyTag = $derived(widget.contribution.element ?? '');
</script>

{#if bodyTag}
  <PluginElementHost tag={bodyTag} {api} {params} />
{:else}
  <div class="widget-load-error">
    Element not found: {widget.contribution.element || widget.contribution.component}
  </div>
{/if}

<style>
  .widget-load-error {
    color: var(--danger);
    font-size: var(--font-size-sm);
    padding: var(--space-md);
  }
</style>