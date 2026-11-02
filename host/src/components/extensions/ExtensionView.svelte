<script lang="ts">
  import type { ExtensionContribution, MpuParams, PluginApi } from '../../../../plugin-sdk/src/types';

  import PluginElementHost from '../plugin-element-host.svelte';

  /**
   * Вклад дополнения в точке владельца, с api ДОПОЛНЕНИЯ.
   * panel — оболочка панели хоста («язык панелей»): шапка с titleKey, справа
   * headerElement, тело — element. tab/element — CE как есть.
   */
  let {
    contribution,
    api,
    params = {},
    title,
  }: {
    contribution: ExtensionContribution | null;
    api: PluginApi | null;
    params?: MpuParams;
    title: string;
  } = $props();
</script>

{#if !contribution || !api || !contribution.element}
  <div class="ext-error">Extension not loaded: {title}</div>
{:else if contribution.kind === 'panel'}
  <section class="ext-panel">
    <header class="ext-panel-header">
      <span class="ext-panel-title">{title}</span>
      {#if contribution.headerElement}
        <div class="ext-panel-actions">
          <PluginElementHost tag={contribution.headerElement} {api} {params} fill={false} />
        </div>
      {/if}
    </header>
    <div class="ext-panel-body">
      <PluginElementHost tag={contribution.element} {api} {params} fill={false} />
    </div>
  </section>
{:else}
  <PluginElementHost tag={contribution.element} {api} {params} fill={contribution.kind === 'tab'} />
{/if}

<style>
  .ext-error {
    padding: var(--space-md);
    color: var(--danger);
    font-size: var(--font-size-sm);
  }

  .ext-panel {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    min-width: 0;
  }

  .ext-panel-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
  }

  .ext-panel-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ext-panel-actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .ext-panel-body {
    padding: var(--space-md);
  }
</style>
