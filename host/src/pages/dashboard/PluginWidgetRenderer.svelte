<script lang="ts">
  import PluginElementHost from '../../components/plugin-element-host.svelte';
  import { getAppContext } from '../../app-context.ts';

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

  const ctx = getAppContext();

  let bodyTag = $derived(widget.contribution.element ?? '');
  let elementParams = $derived({ ...params, narrow: ctx.ui.isNarrow ? 'true' : 'false' });
</script>

{#if bodyTag}
  <PluginElementHost tag={bodyTag} {api} params={elementParams} />
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