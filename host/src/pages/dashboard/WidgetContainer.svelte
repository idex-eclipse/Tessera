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
  import { headerNeedsStacking } from './widget-header-fit';

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

  // ---------- Шапка: не помещается в строку — заголовок и действия на двух строках ----------
  let titleText = $derived(widget ? i18n.t(widget.contribution.titleKey) : '');

  let headerEl = $state<HTMLDivElement | null>(null);
  let titleEl = $state<HTMLSpanElement | null>(null);
  let headerActionsEl = $state<HTMLDivElement | null>(null);
  let widgetActionsEl = $state<HTMLDivElement | null>(null);
  let stacked = $state(false);

  function measureHeader(): void {
    if (!headerEl || !titleEl) return;
    const style = getComputedStyle(headerEl);
    const available =
      headerEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);

    // Ширины не зависят от раскладки шапки, поэтому режимы не переключаются по кругу.
    // У блоков действий — размер рамки: открытый поповер плагина не должен влиять на шапку.
    stacked = headerNeedsStacking(
      available,
      [
        titleEl.scrollWidth,
        headerActionsEl?.offsetWidth ?? 0,
        widgetActionsEl?.offsetWidth ?? 0,
      ],
      parseFloat(style.columnGap) || 0,
    );
  }

  $effect(() => {
    void titleText;
    measureHeader();

    if (!headerEl || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureHeader);
    ro.observe(headerEl);
    if (headerActionsEl) ro.observe(headerActionsEl);
    if (widgetActionsEl) ro.observe(widgetActionsEl);
    return () => ro.disconnect();
  });
</script>

<div class="widget-container" style={gridStyle}>
  <div class="widget-header" class:stacked bind:this={headerEl}>
    {#if widget && pluginApi}
      <span class="widget-title">
        <span class="widget-title-text" title={titleText} bind:this={titleEl}>{titleText}</span>
      </span>

      {#if headerTag}
        <div class="widget-header-actions" bind:this={headerActionsEl}>
          <PluginElementHost tag={headerTag} api={pluginApi} params={{}} fill={false} />
        </div>
      {/if}

      <!-- Без {#if} пустой блок добавил бы зазор и сместил вторую строку от центра -->
      {#if hasMultipleProviders}
        <div class="widget-actions" bind:this={widgetActionsEl}>
          <ProviderPicker {registry} {printerId} widgetType={item.type} {i18n} />
        </div>
      {/if}
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

  /* nowrap: по scrollWidth узнаём полную ширину текста, даже когда он обрезан */
  .widget-title-text {
    display: inline-block;
    max-width: 100%;
    vertical-align: bottom;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .widget-title-missing {
    color: var(--text-muted);
    font-style: italic;
  }

  .widget-header-actions {
    flex: 0 0 auto;
    max-width: 100%;
  }

  .widget-actions {
    order: 1;
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin-inline-start: auto;     /* действия всегда справа */
    flex: 0 0 auto;
    max-width: 100%;
  }

  /* Две строки: заголовок, под ним действия; обе по центру */
  .widget-header.stacked {
    flex-wrap: wrap;
    justify-content: center;
  }

  .widget-header.stacked .widget-title {
    flex: 0 0 100%;
    text-align: center;
  }

  .widget-header.stacked .widget-actions {
    margin-inline-start: 0;
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