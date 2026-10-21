<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PluginApi } from '../../../../plugin-sdk/src/types.ts';
  import type { PluginRegistry } from '../../core/plugin-registry.svelte.ts';
  import type { PrinterManager, PrinterConnectionState } from '../../core/printer-manager.svelte.ts';
  import type { UiStore } from '../../core/ui-store.svelte.ts';
  import type { FleetPanelLayoutItem } from '../../core/settings-store.svelte.ts';

  import { getAppContext } from '../../app-context.ts';
  import { createPluginApi } from '../../core/plugin-api-factory.ts';

  import Icon from '../../../../plugins/shared/icons/Icon.svelte';
  import ConnectionStatus from '../connection-status/ConnectionStatus.svelte';
  import PluginElementHost from '../plugin-element-host.svelte';

  import type { Router } from '../../core/router.svelte.ts';

  let {
    printerManager,
    registry,
    ui,
    i18n,
    router,
  }: {
    printerManager: PrinterManager;
    registry: PluginRegistry;
    ui: UiStore;
    i18n: HostI18n;
    router: Router;
  } = $props();

  const paramsCache = new Map<string, Record<string, string>>();
  const ctx = getAppContext();

  let printers = $derived(printerManager.printers);
  let activePrinterId = $derived(printerManager.activePrinterId);
  let registryPanels = $derived(registry.getPrinterPanels());

  let connections = $state<Record<string, PrinterConnectionState>>(
    printerManager.connections,
  );

  $effect(() => {
    return printerManager.onConnectionStateChange((states) => {
      connections = states;
    });
  });

  // ---------- Fleet panel layout (device-global, in UiState) ----------

  /** Стабильный ключ панели = pluginId:contributionId */
  function keyOf(panel: { pluginId: string; contribution: { id: string } }): string {
    return `${panel.pluginId}:${panel.contribution.id}`;
  }

  /**
   * Merge persisted layout ↔ актуальный registry.
   * - Сохраняет пользовательский порядок для известных ключей.
   * - Новые панели (плагин только что загрузился) добавляет в конец видимыми.
   * - Удаляет из layout ключи, которых больше нет в registry.
   */
  function mergeLayout(): FleetPanelLayoutItem[] {
    const stored = ctx.settings.getFleetPanels();
    const customized = ctx.settings.ui.fleetPanelsCustomized;

    // Без кастомизации — registry порядок, все видимы
    if (!customized || stored.length === 0) {
      return registryPanels.map((p) => ({
        pluginId: p.pluginId,
        contributionId: p.contribution.id,
        visible: true,
      }));
    }

    const registryByKey = new Map(registryPanels.map((p) => [keyOf(p), p]));
    const storedKeys = new Set(stored.map((s) => `${s.pluginId}:${s.contributionId}`));

    // Сохранённые, которые ещё существуют в registry — в порядке layout
    const preserved: FleetPanelLayoutItem[] = [];
    for (const item of stored) {
      const k = `${item.pluginId}:${item.contributionId}`;
      if (registryByKey.has(k)) preserved.push(item);
    }

    // Новые (registry - stored) — в конец, видимы
    const added: FleetPanelLayoutItem[] = [];
    for (const p of registryPanels) {
      const k = keyOf(p);
      if (!storedKeys.has(k)) {
        added.push({ pluginId: p.pluginId, contributionId: p.contribution.id, visible: true });
      }
    }

    return [...preserved, ...added];
  }

  let layout = $state<FleetPanelLayoutItem[]>(mergeLayout());

  /** Синхронизация layout при изменении registry или ui.fleetPanels */
  $effect(() => {
    // читаем оба источника — эффект перезапускается при их изменении
    void registryPanels;
    void ctx.settings.ui.fleetPanels;
    void ctx.settings.ui.fleetPanelsCustomized;
    layout = mergeLayout();
  });

  function persistLayout(): void {
    ctx.settings.setFleetPanels(layout);
  }

  /** Панели для рендера карточек: в порядке layout, только visible. */
  let visiblePanels = $derived(
    layout
      .filter((item) => item.visible)
      .map((item) =>
        registryPanels.find(
          (p) => p.pluginId === item.pluginId && p.contribution.id === item.contributionId,
        ),
      )
      .filter((p): p is NonNullable<typeof p> => p != null),
  );

  /** Панели для редактора — все, в порядке layout, с пометкой hidden. */
  let editorItems = $derived(
    layout.map((item) => {
      const p = registryPanels.find(
        (r) => r.pluginId === item.pluginId && r.contribution.id === item.contributionId,
      );
      const loaded = p ? !!ctx.loader.getLoadedPlugin(p.pluginId) : false;
      const titleKey = p?.contribution.titleKey;
      const title = titleKey ? i18n.t(titleKey) : (p?.contribution.id ?? '');
      return {
        pluginId: item.pluginId,
        contributionId: item.contributionId,
        title,
        visible: item.visible,
        loaded,
      };
    }),
  );

  const apiCache = new Map<string, PluginApi>();
  function apiFor(pluginId: string): PluginApi | null {
    const cached = apiCache.get(pluginId);
    if (cached) return cached;
    const loaded = ctx.loader.getLoadedPlugin(pluginId);
    if (!loaded) return null;
    const api = createPluginApi(ctx, pluginId, loaded.manifest);
    apiCache.set(pluginId, api);
    return api;
  }

  function handleClose() {
    ui.setFleet(false);
  }

  function handleActivate(printerId: string) {
    router.navigateToPrinter(printerId);
    ui.setFleet(false);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (editorOpen) {
        editorOpen = false;
      } else {
        handleClose();
      }
    }
  }

  function paramsFor(printerId: string): Record<string, string> {
    let p = paramsCache.get(printerId);
    if (!p) {
      p = { printerId };
      paramsCache.set(printerId, p);
    }
    return p;
  }

  // ---------- Editor (overlay + HTML5 DnD, работает с drag-drop-touch) ----------

  let editorOpen = $state(false);
  let dragIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);
  let dragOverSide = $state<'before' | 'after' | null>(null);

  function openEditor(): void {
    layout = mergeLayout();
    editorOpen = true;
  }

  function closeEditor(): void {
    editorOpen = false;
  }

  function toggleVisible(index: number): void {
    const next = layout.map((item, i) =>
      i === index ? { ...item, visible: !item.visible } : item,
    );
    layout = next;
    persistLayout();
  }

  function onDragStart(e: DragEvent, index: number): void {
    dragIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  }

  function onDragOver(e: DragEvent, index: number): void {
    if (dragIndex === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dragIndex === index) return;

    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side: 'before' | 'after' = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    dragOverIndex = index;
    dragOverSide = side;
  }

  function onDragLeave(): void {
    dragOverIndex = null;
    dragOverSide = null;
  }

  function onDrop(e: DragEvent, index: number): void {
    e.preventDefault();
    e.stopPropagation();
    if (dragIndex === null || dragIndex === index) {
      endDrag();
      return;
    }

    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY >= r.top + r.height / 2;

    const next = [...layout];
    const [moved] = next.splice(dragIndex, 1);

    let target = index;
    if (dragIndex < index) target -= 1;
    if (after) target += 1;

    next.splice(target, 0, moved);
    layout = next;
    persistLayout();
    endDrag();
  }

  function onDragEnd(): void {
    endDrag();
  }

  function endDrag(): void {
    dragIndex = null;
    dragOverIndex = null;
    dragOverSide = null;
  }

  function resetLayout(): void {
    ctx.settings.resetFleetPanels();
    layout = mergeLayout();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fleet-drawer">
  <div class="fleet-header">
    <h2 class="fleet-title">{i18n.t('fleet.title')}</h2>
    <div class="fleet-header-actions">
      {#if registryPanels.length > 0}
        <button
          class="fleet-edit-btn"
          onclick={openEditor}
          title={i18n.t('fleet.editPanels')}
          aria-label={i18n.t('fleet.editPanels')}
        >
          <Icon name="settings" size={16} />
          <span>{i18n.t('fleet.editPanels')}</span>
        </button>
      {/if}
      <button class="fleet-close" onclick={handleClose} aria-label={i18n.t('fleet.close')}>
        <Icon name="x" />
      </button>
    </div>
  </div>

  {#if printers.length === 0}
    <div class="fleet-empty">
      <p>{i18n.t('fleet.empty')}</p>
    </div>
  {:else}
    <div class="fleet-grid">
      {#each printers as printer (printer.id)}
        {@const connection = connections[printer.id] ?? null}
        {@const isActive = printer.id === activePrinterId}

        <div class="fleet-card" class:active={isActive}>
          <div
            class="fleet-card-header"
            onclick={() => handleActivate(printer.id)}
          >
            <div class="fleet-card-info">
              <span class="fleet-card-name">{printer.name}</span>
              {#if connection}
                <ConnectionStatus status={connection.status} />
              {/if}
            </div>
          </div>

          <div class="fleet-card-body">
            {#if visiblePanels.length === 0}
              <p class="fleet-card-empty">{i18n.t('fleet.noPanels')}</p>
            {:else}
              {#each visiblePanels as panel (keyOf(panel))}
                {@const api = apiFor(panel.pluginId)}
                {#if api}
                  <PluginElementHost
                    tag={panel.contribution.element}
                    {api}
                    params={paramsFor(printer.id)}
                    fill={false}
                  />
                {:else}
                  <div class="fleet-card-missing">
                    {i18n.t('fleet.pluginMissing')} · {panel.pluginId}
                  </div>
                {/if}
              {/each}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if editorOpen}
  <div class="editor-backdrop" onclick={closeEditor} role="presentation"></div>
  <div
    class="editor-panel"
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t('fleet.editPanelsTitle')}
  >
    <header class="editor-header">
      <h3 class="editor-title">{i18n.t('fleet.editPanelsTitle')}</h3>
      <button class="editor-close" onclick={closeEditor} aria-label={i18n.t('fleet.close')}>
        <Icon name="x" size={14} />
      </button>
    </header>

    <div class="editor-body">
      {#if editorItems.length === 0}
        <p class="editor-empty">{i18n.t('fleet.editPanelsEmpty')}</p>
      {:else}
        <p class="editor-hint">{i18n.t('fleet.editPanelsHint')}</p>
        <ul class="editor-list">
          {#each editorItems as item, i (`${item.pluginId}:${item.contributionId}`)}
            <li
              class="editor-item"
              class:dragging={dragIndex === i}
              class:drag-over-before={dragOverIndex === i && dragOverSide === 'before'}
              class:drag-over-after={dragOverIndex === i && dragOverSide === 'after'}
              class:hidden-item={!item.visible}
              class:unloaded={!item.loaded}
              draggable="true"
              ondragstart={(e) => onDragStart(e, i)}
              ondragover={(e) => onDragOver(e, i)}
              ondragleave={onDragLeave}
              ondrop={(e) => onDrop(e, i)}
              ondragend={onDragEnd}
            >
              <span class="editor-grip" aria-hidden="true">
                <Icon name="grip" size={14} />
              </span>

              <label class="editor-check" onclick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={item.visible}
                  onchange={() => toggleVisible(i)}
                />
              </label>

              <div class="editor-label">
                <span class="editor-name">{item.title}</span>
                <div class="editor-meta">
                  {#if !item.loaded}
                    <span class="editor-badge unloaded">
                      {i18n.t('fleet.panelPluginUnloaded')}
                    </span>
                  {/if}
                  {#if !item.visible}
                    <span class="editor-badge hidden">
                      {i18n.t('fleet.panelHidden')}
                    </span>
                  {/if}
                  <span class="editor-plugin">{item.pluginId}</span>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <footer class="editor-footer">
      {#if ctx.settings.ui.fleetPanelsCustomized}
        <button class="editor-reset" onclick={resetLayout}>
          {i18n.t('common.reset')}
        </button>
      {/if}
      <button class="editor-done" onclick={closeEditor}>
        {i18n.t('common.save')}
      </button>
    </footer>
  </div>
{/if}

<style>
  .fleet-drawer {
    position: fixed;
    top: var(--header-height);
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 200;
    background: var(--bg-surface);
    border-top: 2px solid var(--border-color);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    animation: slideDown 0.25s ease-out;
  }
  @keyframes slideDown {
    from { transform: translateY(-100%); }
    to   { transform: translateY(0); }
  }

  .fleet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    gap: var(--space-sm);
  }
  .fleet-title {
    font-size: var(--font-size-xl);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fleet-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex-shrink: 0;
  }
  .fleet-edit-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }
  .fleet-edit-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    border-color: var(--accent);
  }
  .fleet-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    cursor: pointer;
    transition: background var(--transition-fast);
  }
  .fleet-close:hover { background: var(--bg-surface-hover); }

  .fleet-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-secondary);
    font-size: var(--font-size-lg);
  }
  .fleet-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    grid-auto-rows: var(--grid-row-height, 80px);
    gap: var(--space-md);
    padding: var(--space-lg);
    overflow-y: auto;
    flex: 1;
  }
  @media (max-width: 768px) {
    .fleet-grid { grid-template-columns: 1fr; }
  }
  .fleet-card {
    grid-column: span 4;
    grid-row: span 5;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 2px solid var(--border-color);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: border-color var(--transition-fast);
  }
  .fleet-card.active { border-color: var(--accent); }
  .fleet-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-sm) var(--space-md);
    background: var(--bg-surface-hover);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    cursor: pointer;
  }
  .fleet-card-info {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-width: 0;
    flex: 1;
  }
  .fleet-card-name {
    font-weight: 600;
    font-size: var(--font-size-md);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fleet-card-body {
    flex: 1;
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-height: 0;
    overflow-y: auto;
  }
  .fleet-card-empty {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
    padding: var(--space-md);
  }
  .fleet-card-missing {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    font-family: monospace;
    padding: var(--space-sm);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
  }

  /* ---------- Editor overlay ---------- */
  .editor-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 300;
    animation: fadeIn 0.15s ease-out;
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .editor-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(480px, calc(100vw - 32px));
    max-height: calc(100vh - 80px);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 301;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: popIn 0.15s ease-out;
  }
  @keyframes popIn {
    from { opacity: 0; transform: translate(-50%, -48%); }
    to   { opacity: 1; transform: translate(-50%, -50%); }
  }
  .editor-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .editor-title {
    flex: 1;
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .editor-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .editor-close:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .editor-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .editor-empty {
    color: var(--text-muted);
    text-align: center;
    padding: var(--space-lg);
    margin: 0;
    font-size: var(--font-size-sm);
  }
  .editor-hint {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    margin: 0;
  }
  .editor-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .editor-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover-no-override);
    cursor: grab;
    transition: opacity var(--transition-fast), transform var(--transition-fast);
  }
  .editor-item:active { cursor: grabbing; }
  .editor-item.hidden-item {
    opacity: 0.55;
    background: transparent;
    border-style: dashed;
  }
  .editor-item.unloaded { opacity: 0.7; }
  .editor-item.dragging {
    opacity: 0.35;
    transform: scale(0.98);
  }
  .editor-item.drag-over-before,
  .editor-item.drag-over-after {
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
    position: relative;
  }
  .editor-item.drag-over-before::before,
  .editor-item.drag-over-after::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    height: 3px;
    background: var(--accent);
    border-radius: 2px;
    pointer-events: none;
  }
  .editor-item.drag-over-before::before { top: -5px; }
  .editor-item.drag-over-after::after  { bottom: -5px; }

  .editor-grip {
    display: flex;
    align-items: center;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .editor-check {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    cursor: pointer;
  }
  .editor-check input {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: var(--accent);
  }
  .editor-label {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .editor-name {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .editor-meta {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex-wrap: wrap;
  }
  .editor-plugin {
    font-family: monospace;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .editor-badge {
    display: inline-flex;
    align-items: center;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .editor-badge.unloaded {
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
  }
  .editor-badge.hidden {
    background: color-mix(in srgb, var(--text-muted) 18%, transparent);
    color: var(--text-muted);
  }

  .editor-footer {
    display: flex;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .editor-reset {
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }
  .editor-reset:hover {
    background: var(--bg-surface-hover);
    color: var(--danger);
    border-color: var(--danger);
  }
  .editor-done {
    margin-left: auto;
    padding: var(--space-xs) var(--space-md);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-text);
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast);
  }
  .editor-done:hover { background: var(--accent-hover); }
</style>