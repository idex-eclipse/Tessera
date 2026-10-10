<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PluginRegistry } from '../../core/plugin-registry.svelte.ts';

  let {
    registry,
    printerId,
    widgetType,
    i18n,
  }: {
    registry: PluginRegistry;
    printerId: string;
    widgetType: string;
    i18n: HostI18n;
  } = $props();

  let providers = $derived(registry.getProvidersForType(widgetType));
  let hasMultiple = $derived(providers.length > 1);
  let selected = $derived(registry.getSelectedProvider(printerId, widgetType));

  function handleSelect(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    registry.setSelectedProvider(printerId, widgetType, value);
  }
</script>

{#if hasMultiple}
  <label class="provider-picker">
    <span class="provider-label">{i18n.t('dashboard.provider')}</span>
    <select class="provider-select" value={selected ?? providers[0]?.contribution.provider} onchange={handleSelect}>
      {#each providers as provider (provider.contribution.provider)}
        <option value={provider.contribution.provider}>
          {i18n.t(provider.contribution.titleKey)}
        </option>
      {/each}
    </select>
  </label>
{/if}

<style>
  .provider-picker {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--font-size-sm);
  }

  .provider-label {
    color: var(--text-muted);
    white-space: nowrap;
  }

  .provider-select {
    padding: 2px var(--space-xs);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
</style>