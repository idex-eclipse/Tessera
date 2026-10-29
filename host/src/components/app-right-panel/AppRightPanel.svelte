<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { getPluginApi } from '../../core/plugin-api-cache';
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

  // Узкий экран: панель — оверлей на всю ширину, сохранённое «свёрнуто» и ширина игнорируются.
  let narrow = $derived(ctx.ui.isNarrow);
  let open = $derived(ctx.ui.mobilePanel === 'right');
  let isCollapsed = $derived(collapsed && !narrow);

  let closeBtn = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    if (narrow && open) closeBtn?.focus();
  });

  $effect(() => {
    if (!dragging) {
      localWidth = storedWidth;
    }
  });

  let api = $derived(panel ? getPluginApi(ctx, panel.pluginId) : null);

  // Хоткей `R` может «открыть» панель, которой нет (нет принтера / плагина): не оставляем
  // main заблокированным (inert) без видимого оверлея.
  $effect(() => {
    if (open && !(panel && api && hasPrinter)) ctx.ui.closeMobilePanel();
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

{#if panel && api && hasPrinter && (!narrow || open)}
  <aside
    class="right-panel"
    class:collapsed={isCollapsed}
    class:drawer={narrow}
    style={narrow ? undefined : `--right-panel-width: ${localWidth}px`}
    aria-label={ctx.i18n.t('common.rightPanel.title')}
  >
    {#if !isCollapsed}
      <header class="right-panel-header">
        <span class="right-panel-title">
          {ctx.i18n.t('common.rightPanel.title')}
        </span>
        {#if narrow}
          <button
            class="drawer-close"
            bind:this={closeBtn}
            onclick={() => ctx.ui.closeMobilePanel()}
            aria-label={ctx.i18n.t('common.close')}
          >
            <Icon name="x" />
          </button>
        {/if}
      </header>
    {/if}

    <div class="right-panel-content">
      <PluginElementHost
        tag={panel.contribution.element}
        {api}
        params={{
          collapsed: isCollapsed ? 'true' : 'false',
          narrow: narrow ? 'true' : 'false',
        }}
      />
    </div>

    <!-- кнопка сворачивания — ВСЕГДА внизу, в обоих состояниях (кроме узкого экрана) -->
    {#if !narrow}
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
          <Icon name={collapsed ? 'chevron-left' : 'chevron-right'} flip />
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
    {/if}
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

  /* Узкий экран: оверлей на всю ширину под шапкой */
  .right-panel.drawer {
    position: fixed;
    inset-block: var(--header-height) 0;
    inset-inline: 0;
    width: auto;
    border-inline-start: none;
    z-index: var(--z-drawer);
    transition: none;
    animation: drawer-in-end 200ms ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .right-panel.drawer {
      animation: none;
    }
  }

  .drawer-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-target);
    height: var(--touch-target);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .drawer-close:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
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
    text-align: start;
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
    padding-inline: 0;
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