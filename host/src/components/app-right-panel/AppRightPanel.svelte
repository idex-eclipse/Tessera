<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { createPluginApi } from '../../core/plugin-api-factory';
  import PluginElementHost from '../plugin-element-host.svelte';
  import Icon from '../icons/Icon.svelte';

  const ctx = getAppContext();

  const MIN_WIDTH = 240;
  const MAX_WIDTH = 560;

  let panel = $derived(ctx.registry.getRightPanel());
  let collapsed = $derived(ctx.ui.rightPanelCollapsed);
  let storedWidth = $derived(ctx.ui.rightPanelWidth);

  let localWidth = $state(storedWidth);
  let dragging = $state(false);
  let dragStartX = 0;
  let dragStartWidth = 0;
  let hasPrinter = $derived((ctx.settings?.printers?.length ?? 0) > 0);

  $effect(() => {
    if (!dragging) {
      localWidth = storedWidth;
    }
  });

  let loaded = $derived(panel ? ctx.loader.getLoadedPlugin(panel.pluginId) : null);

  let api = $derived.by(() => {
    if (!panel || !loaded) return null;
    return createPluginApi(ctx, panel.pluginId, loaded.manifest);
  });

  function toggle() {
    ctx.ui.toggleRightPanel();
  }

  function onPointerDown(event: PointerEvent) {
    if (collapsed) return;
    dragging = true;
    dragStartX = event.clientX;
    dragStartWidth = localWidth;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    const delta = event.clientX - dragStartX;
    const isRtl = ctx.ui.dir === 'rtl';
    const nextWidth = isRtl ? dragStartWidth + delta : dragStartWidth - delta;
    localWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, nextWidth));
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    ctx.ui.setRightPanelWidth(localWidth);
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }
</script>

{#if panel && api && hasPrinter}
  <aside
    class="right-panel"
    class:collapsed
    style={`--right-panel-width: ${localWidth}px`}
    aria-label={ctx.i18n.t('common.rightPanel.title')}
  >
    {#if !collapsed}
      <header class="right-panel-header">
        <span class="right-panel-title">
          {ctx.i18n.t('common.rightPanel.title')}
        </span>
      </header>
    {/if}

    <div class="right-panel-content">
      <PluginElementHost
        tag={panel.contribution.element}
        {api}
        params={{ collapsed: collapsed ? 'true' : 'false' }}
      />
    </div>

    <!-- кнопка сворачивания — ВСЕГДА внизу, в обоих состояниях -->
    <footer class="right-panel-footer">
      <button
        class="nav-item"
        class:collapsed
        onclick={toggle}
        aria-expanded={!collapsed}
        title={collapsed
          ? ctx.i18n.t('common.rightPanel.expandMenu')
          : ctx.i18n.t('common.rightPanel.collapseMenu')}
      >
        <span class="nav-icon">
          <Icon name={collapsed ? 'chevron-left' : 'chevron-right'} />
        </span>
        {#if !collapsed}
          <span class="nav-label">
            {ctx.i18n.t('common.rightPanel.collapseMenu')}
          </span>
        {/if}
      </button>
    </footer>

    <div
      class="resize-handle"
      role="separator"
      aria-orientation="vertical"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
    ></div>
  </aside>
{/if}

<style>
  .right-panel {
    position: relative;
    flex-shrink: 0;
    width: var(--right-panel-width);
    background: var(--bg-surface);
    border-inline-start: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    min-width: 0;
    z-index: var(--z-right-panel, 30);
    transition: width var(--transition-normal);   /* анимация сворачивания */
    padding: var(--space-xs);
  }

  .right-panel.collapsed {
    width: var(--right-panel-collapsed-width, 56px);
  }

  .right-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .right-panel-title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .right-panel-footer {
    flex-shrink: 0;
    padding: 0 var(--space-sm) var(--space-xs);
  }

  /* скроллит сам плагин; хост только держит колонку */
  .right-panel-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .resize-handle {
    position: absolute;
    inset-block: 0;
    inset-inline-start: -3px;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
    z-index: 1;
  }

  .resize-handle::after {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: 2px;
    width: 2px;
    background: transparent;
    transition: background var(--transition-fast);
  }

  .resize-handle:hover::after {
    background: var(--accent);
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background var(--transition-fast), color var(--transition-fast);
    white-space: nowrap;
  }

  .nav-item:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .nav-item.collapsed {
    justify-content: center;
    padding-left: 0;
    padding-right: 0;
    gap: 0;
  }

  .nav-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 30px;
    height: 30px;
  }

  .nav-icon :global(svg) {
    display: block;
  }

  .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>