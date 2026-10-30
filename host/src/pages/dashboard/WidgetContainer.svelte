<script lang="ts">
  import type { DashboardWidgetLayoutItem } from '../../core/settings-store.svelte.ts';
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PluginRegistry } from '../../core/plugin-registry.svelte.ts';
  import type { PrinterManager } from '../../core/printer-manager.svelte.ts';

  import ProviderPicker from '../../components/provider-picker/ProviderPicker.svelte';
  import PluginWidgetRenderer from './PluginWidgetRenderer.svelte';

  import { getAppContext } from '../../app-context';
  import { getPluginApi } from '../../core/plugin-api-cache';
  import PluginElementHost from '../../components/plugin-element-host.svelte';

  let {
    item,
    printerId,
    registry,
    printerManager,
    i18n,
    params = {},
    narrow = false,
  }: {
    item: DashboardWidgetLayoutItem;
    printerId: string;
    registry: PluginRegistry;
    printerManager: PrinterManager;
    i18n: HostI18n;
    params?: Record<string, string>;
    /** Dashboard уже брейкпоинта (считает Dashboard). */
    narrow?: boolean;
  } = $props();

  let widget = $derived(
    registry
      .getProvidersForType(item.type)
      .find((w) => w.contribution.provider === item.provider),
  );

  let hasMultipleProviders = $derived(registry.hasMultipleProviders(item.type));
  const ctx = getAppContext();
  let gridStyle = $derived(
    `grid-column: ${item.x + 1} / span ${item.w}; grid-row: ${item.y + 1} / span ${item.h}; --h: ${item.h};`,
  );

  const pluginApi = $derived(
    widget ? getPluginApi(ctx, widget.pluginId, { allowUnloaded: true }) : null,
  );

  let headerTag = $derived(widget?.contribution.headerElement ?? '');

</script>

<div class="widget-container" style={gridStyle}>
  <div class="widget-header">
    {#if widget && pluginApi}
      <span class="widget-title">{i18n.t(widget.contribution.titleKey)}</span>

      {#if headerTag}
        <div class="widget-header-actions">
          <PluginElementHost tag={headerTag} api={pluginApi} params={{}} fill={false} />
        </div>
      {/if}

      <div class="widget-actions">
        {#if hasMultipleProviders}
          <ProviderPicker {registry} {printerId} widgetType={item.type} {i18n} />
        {/if}
      </div>
    {:else}
      <span class="widget-title widget-title-missing">{item.type}</span>
    {/if}
  </div>

  <div class="widget-content">
    {#if widget && pluginApi}
      <PluginWidgetRenderer {widget} {printerId} {params} {narrow} api={pluginApi} />
    {:else}
      <div class="widget-placeholder widget-placeholder-error">
        Widget not found: {item.type} / {item.provider}
      </div>
    {/if}
  </div>
</div>

<style>
  .widget-container {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }

  .widget-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .widget-title {
    order: 0;
    flex: 1;
    min-width: 0;
    text-align: start;      /* убираем центрирование */
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .widget-title-missing {
    color: var(--text-muted);
    font-style: italic;
  }

  .widget-actions {
    order: 1;
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin-inline-start: auto;     /* действия всегда справа */
    flex-shrink: 0;
  }

  .widget-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: var(--space-md);
  }

  .widget-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    height: 100%;
    min-height: 60px;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }

  .widget-placeholder-error {
    color: var(--danger);
  }

</style>