<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PluginApi } from '../../../../plugin-sdk/src/types.ts';
  import type { PluginRegistry } from '../../core/plugin-registry.svelte.ts';
  import type { PrinterManager, PrinterConnectionState } from '../../core/printer-manager.svelte.ts';
  import type { UiStore } from '../../core/ui-store.svelte.ts';
  import type { FleetPanelLayoutItem } from '../../core/settings-store.svelte.ts';

  import { getAppContext } from '../../app-context.ts';
  import { getPluginApi } from '../../core/plugin-api-cache.ts';
  import { collectTags, matchPrinter } from '../../core/fleet-filter.ts';
  import type { FleetTag } from '../../../../plugin-sdk/src/types.ts';

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

  // Стабильный список панелей в порядке регистрации (НИКОГДА не меняет порядок)
  let registryPanels = $derived(registry.getPrinterPanels());

  let connections = $state<Record<string, PrinterConnectionState>>(
    printerManager.connections,
  );

  $effect(() => {
    return printerManager.onConnectionStateChange((states) => {
      connections = states;
    });
  });

  // ---------- Search & filters (in-memory, сбрасываются при закрытии drawer) ----------
  //
  // Хост не знает смысла тегов и searchText: их публикуют панели плагинов
  // (api.fleet.publish), здесь они только сопоставляются как строки.

  let query = $state('');
  let activeTags = $state<ReadonlySet<string>>(new Set());
  let searchEl = $state<HTMLInputElement | null>(null);

  let entries = $derived(printers.map((p) => ctx.fleetIndex.forPrinter(p.id)));
  let tagCounts = $derived(collectTags(entries));

  // Тег, который был виден, но у которого сейчас 0 принтеров, остаётся кнопкой
  // (пока он активен), иначе фильтр «пропал бы» вместе с последним совпадением.
  let seenTags = $state<Record<string, FleetTag>>({});
  $effect(() => {
    const fresh = tagCounts.filter(({ tag }) => seenTags[tag.id]?.labelKey !== tag.labelKey);
    if (fresh.length === 0) return;
    const next = { ...seenTags };
    for (const { tag } of fresh) next[tag.id] = tag;
    seenTags = next;
  });

  let filterButtons = $derived.by(() => {
    const live = new Set(tagCounts.map(({ tag }) => tag.id));
    const kept = [...activeTags]
      .filter((id) => !live.has(id) && seenTags[id])
      .map((id) => ({ tag: seenTags[id]!, count: 0 }));
    return [...tagCounts, ...kept];
  });

  let visibleIds = $derived(
    new Set(
      printers
        .filter((p, i) => matchPrinter(p, entries[i] ?? null, query, activeTags))
        .map((p) => p.id),
    ),
  );
  let filtering = $derived(query.trim() !== '' || activeTags.size > 0);

  function toggleTag(id: string): void {
    const next = new Set(activeTags);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    activeTags = next;
  }

  function clearQuery(): void {
    query = '';
    searchEl?.focus();
  }

  // ---------- Fleet panel layout (device-global, in UiState) ----------

  /** Стабильный ключ панели = pluginId:contributionId */
  function keyOf(panel: { pluginId: string; contribution: { id: string } }): string {
    return `${panel.pluginId}:${panel.contribution.id}`;
  }

  // ---------- Layout (device-global, mpu:v2:ui.fleetPanels) ----------

  function mergeLayout(): FleetPanelLayoutItem[] {
    const stored = ctx.settings.getFleetPanels();
    const customized = ctx.settings.ui.fleetPanelsCustomized;

    if (!customized || stored.length === 0) {
      return registryPanels.map((p) => ({
        pluginId: p.pluginId,
        contributionId: p.contribution.id,
        visible: true,
      }));
    }

    const registryByKey = new Map(registryPanels.map((p) => [keyOf(p), p]));
    const storedKeys = new Set(stored.map((s) => `${s.pluginId}:${s.contributionId}`));

    const preserved: FleetPanelLayoutItem[] = [];
    for (const item of stored) {
      const k = `${item.pluginId}:${item.contributionId}`;
      if (registryByKey.has(k)) preserved.push(item);
    }

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

  $effect(() => {
    void registryPanels;
    void ctx.settings.ui.fleetPanels;
    void ctx.settings.ui.fleetPanelsCustomized;
    layout = mergeLayout();
  });

  function persistLayout(): void {
    ctx.settings.setFleetPanels(layout);
  }

  /**
   * Map для быстрого lookup: key → { orderIndex, visible }.
   * Используется в шаблоне для CSS order + display:none.
   * DOM-порядок НЕ меняется — только CSS-свойства.
   */
  let layoutMap = $derived.by(() => {
    const map = new Map<string, { orderIndex: number; visible: boolean }>();
    layout.forEach((item, index) => {
      map.set(`${item.pluginId}:${item.contributionId}`, {
        orderIndex: index,
        visible: item.visible,
      });
    });
    return map;
  });

  /** Видимые панели (для счётчика "пусто ли в карточке") */
  let visibleCount = $derived(
    layoutMap.size > 0
      ? layout.filter((item) => item.visible).length
      : registryPanels.length,
  );

  // ---------- Editor ----------

  let editorItems = $derived(
    layout.map((item, index) => {
      const p = registryPanels.find(
        (r) => r.pluginId === item.pluginId && r.contribution.id === item.contributionId,
      );
      const loaded = p ? !!ctx.loader.getLoadedPlugin(p.pluginId) : false;
      const titleKey = p?.contribution.titleKey;
      const title = titleKey ? i18n.t(titleKey) : (p?.contribution.id ?? item.contributionId);
      return {
        index,
        pluginId: item.pluginId,
        contributionId: item.contributionId,
        title,
        visible: item.visible,
        loaded,
      };
    }),
  );

  const apiFor = (pluginId: string) => getPluginApi(ctx, pluginId);

  function handleClose() {
    ui.setFleet(false);
  }

  function handleActivate(printerId: string) {
    router.navigateToPrinter(printerId);
    ui.setFleet(false);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (editorOpen) editorOpen = false;
      else if (query && document.activeElement === searchEl) query = '';
      else handleClose();
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

  // ---------- Editor DnD ----------

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
    layout = layout.map((item, i) =>
      i === index ? { ...item, visible: !item.visible } : item,
    );
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

    if (moved) next.splice(target, 0, moved);
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
    {#if printers.length > 0}
      <div class="fleet-search">
        <span class="fleet-search-icon"><Icon name="search" size={16} /></span>
        <input
          class="fleet-search-input"
          type="text"
          dir="auto"
          enterkeyhint="search"
          autocomplete="off"
          spellcheck="false"
          placeholder={i18n.t('fleet.search.placeholder')}
          aria-label={i18n.t('fleet.search.placeholder')}
          bind:this={searchEl}
          bind:value={query}
        />
        {#if query}
          <button
            class="fleet-search-clear"
            onclick={clearQuery}
            title={i18n.t('fleet.search.clear')}
            aria-label={i18n.t('fleet.search.clear')}
          >
            <Icon name="x" size={14} />
          </button>
        {/if}
      </div>
    {/if}
    <div class="fleet-header-actions">
      {#if filterButtons.length > 0}
        <div class="fleet-filters" role="group" aria-label={i18n.t('fleet.filters')}>
          {#each filterButtons as { tag, count } (tag.id)}
            {@const label = i18n.t(tag.labelKey)}
            <button
              class="fleet-edit-btn fleet-filter-btn"
              class:on={activeTags.has(tag.id)}
              aria-pressed={activeTags.has(tag.id)}
              onclick={() => toggleTag(tag.id)}
              title={label}
              aria-label={label}
            >
              {#if tag.icon}<Icon name={tag.icon} size={16} />{/if}
              <span class="btn-label">{label}</span>
              <span class="fleet-filter-count">{count}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if registryPanels.length > 0}
        <button
          class="fleet-edit-btn"
          onclick={openEditor}
          title={i18n.t('fleet.editPanels')}
          aria-label={i18n.t('fleet.editPanels')}
        >
          <Icon name="settings" size={16} />
          <span class="btn-label">{i18n.t('fleet.editPanels')}</span>
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
    {#if filtering}
      <div class="fleet-result" role="status">
        <span>
          {visibleIds.size === 0
            ? i18n.t('fleet.noMatches')
            : i18n.t('fleet.count', { shown: visibleIds.size, total: printers.length })}
        </span>
        <button
          class="fleet-result-reset"
          onclick={() => {
            query = '';
            activeTags = new Set();
          }}
        >
          {i18n.t('fleet.resetFilters')}
        </button>
      </div>
    {/if}
    <div class="fleet-grid">
      {#each printers as printer (printer.id)}
        {@const connection = connections[printer.id] ?? null}
        {@const isActive = printer.id === activePrinterId}

        <!--
          Отфильтрованные карточки скрываются ТОЛЬКО через CSS (display:none),
          без {#if}: панели остаются смонтированными и держат подписки
          (core-keeper хранит ядра лишь для 4 принтеров).
        -->
        <div
          class="fleet-card"
          class:active={isActive}
          class:filtered-out={!visibleIds.has(printer.id)}
        >
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
            {#if visibleCount === 0}
              <p class="fleet-card-empty">{i18n.t('fleet.noPanels')}</p>
            {:else}
              <!--
                КРИТИЧНО: {#each} итерирует registryPanels в СТАБИЛЬНОМ порядке
                регистрации. Визуальный порядок задаётся через CSS order.
                DOM-узлы НИКОГДА не перемещаются/удаляются при reorder —
                Custom Elements не получают disconnectedCallback.
              -->
              {#each registryPanels as panel (keyOf(panel))}
                {@const info = layoutMap.get(keyOf(panel))}
                {@const order = info ? info.orderIndex : 999}
                {@const hidden = info ? !info.visible : false}
                {@const api = apiFor(panel.pluginId)}
                <div
                  class="fleet-panel-slot"
                  class:panel-hidden={hidden}
                  style:order={order}
                >
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
                </div>
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
                    <span class="editor-badge hidden-badge">
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

  /* Search + filters live in the header. Logical properties only: RTL mirrors for free. */
  .fleet-search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 0 1 280px;
    min-width: 140px;
  }
  .fleet-search-icon {
    position: absolute;
    inset-inline-start: var(--space-sm);
    display: flex;
    color: var(--text-muted);
    pointer-events: none;
  }
  .fleet-search-input {
    width: 100%;
    min-height: 36px;
    padding-block: var(--space-xs);
    padding-inline: calc(var(--space-sm) + 22px);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }
  .fleet-search-input:focus { outline: none; border-color: var(--border-focus); }
  .fleet-search-clear {
    position: absolute;
    inset-inline-end: 4px;
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
  .fleet-search-clear:hover { background: var(--bg-surface-hover); color: var(--text-primary); }

  .fleet-filters {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }
  .fleet-filter-btn.on {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: var(--accent);
    color: var(--text-primary);
  }
  .fleet-filter-count {
    min-width: 18px;
    padding-inline: 5px;
    border-radius: 999px;
    background: var(--bg-surface-hover);
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .fleet-result {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-lg) 0;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
  .fleet-result-reset {
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  .fleet-result-reset:hover { text-decoration: underline; }

  /* Narrow screens: header buttons collapse to icons, search takes its own row. */
  @media (max-width: 768px) {
    .fleet-header { flex-wrap: wrap; }
    .fleet-search { order: 3; flex: 1 1 100%; }
    .fleet-edit-btn {
      min-width: 36px;
      min-height: 36px;
      justify-content: center;
    }
    .fleet-edit-btn .btn-label { display: none; }
  }

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
  .fleet-card.filtered-out { display: none; }
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

  /* Панель-слот: flex-shrink 0 предотвращает сжатие;
     order управляет визуальным порядком без DOM-перемещений */
  .fleet-panel-slot {
    flex-shrink: 0;
    transition: opacity var(--transition-fast);
  }
  .fleet-panel-slot.panel-hidden {
    display: none;
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
  .editor-badge.hidden-badge {
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
    margin-inline-start: auto;
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