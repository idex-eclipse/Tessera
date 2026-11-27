<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PluginApi } from '../../../../plugin-sdk/src/types.ts';
  import type { PluginRegistry } from '../../core/plugin-registry.svelte.ts';
  import type { PrinterManager, PrinterConnectionState } from '../../core/printer-manager.svelte.ts';
  import type { UiStore } from '../../core/ui-store.svelte.ts';
  import type { FleetPanelLayoutItem } from '../../core/settings-store.svelte.ts';
  import {
    FLEET_GRID_COLUMNS, FLEET_MAX_HEIGHT, FLEET_MIN_HEIGHT, FLEET_MIN_WIDTH,
    FLEET_ROW_GAP, FLEET_ROW_HEIGHT, fleetPanelKey, mergeFleetGridLayout,
    projectFleetGridLayout, resizeFleetPanel, settleFleetGridLayout,
    type FleetPanelDisplayItem, type FleetResizeDir,
  } from '../../core/fleet-grid-layout.ts';

  import { getAppContext } from '../../app-context.ts';
  import { getPluginApi } from '../../core/plugin-api-cache.ts';
  import { collectTags, matchPrinter } from '../../core/fleet-filter.ts';
  import type { FleetFilterMode } from '../../core/fleet-filter.ts';
  import type { FleetTag } from '../../../../plugin-sdk/src/types.ts';

  import Icon from '../../../../plugins/shared/icons/Icon.svelte';
  import ConnectionStatus from '../connection-status/ConnectionStatus.svelte';
  import FleetFiltersPopover from './FleetFiltersPopover.svelte';
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
  let filterMode = $state<FleetFilterMode>('or');
  let searchEl = $state<HTMLInputElement | null>(null);

  let entries = $derived(printers.map((p) => ctx.fleetIndex.forPrinter(p.id)));
  let tagCounts = $derived(collectTags(entries));

  // An active tag stays selectable with a zero count after its last matching printer disappears.
  let seenTags = $state<Record<string, FleetTag>>({});
  $effect(() => {
    const fresh = tagCounts.filter(({ tag }) => seenTags[tag.id]?.labelKey !== tag.labelKey);
    if (fresh.length === 0) return;
    const next = { ...seenTags };
    for (const { tag } of fresh) next[tag.id] = tag;
    seenTags = next;
  });

  let filterOptions = $derived.by(() => {
    const live = new Set(tagCounts.map(({ tag }) => tag.id));
    const kept = [...activeTags]
      .filter((id) => !live.has(id) && seenTags[id])
      .map((id) => ({ tag: seenTags[id]!, count: 0 }));
    return [...tagCounts, ...kept];
  });

  let visibleIds = $derived(
    new Set(
      printers
        .filter((p, i) => matchPrinter(p, entries[i] ?? null, query, activeTags, filterMode))
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

  /** The registry wrapper and the saved layout use the same stable identity. */
  function keyOf(panel: { pluginId: string; contribution: { id: string } }): string {
    return fleetPanelKey({ pluginId: panel.pluginId, contributionId: panel.contribution.id });
  }

  // ---------- Shared and printer-specific Fleet grid layouts ----------

  function panelIds() {
    return registryPanels.map((panel) => ({
      pluginId: panel.pluginId,
      contributionId: panel.contribution.id,
      defaultSize: panel.contribution.defaultSize,
    }));
  }

  function mergeLayout(): FleetPanelLayoutItem[] {
    return mergeFleetGridLayout(
      panelIds(),
      ctx.settings.getFleetPanels(),
      ctx.settings.ui.fleetPanelsCustomized,
    );
  }

  let layout = $state<FleetPanelLayoutItem[]>(mergeLayout());
  let printerLayouts = $state<Record<string, FleetPanelLayoutItem[]>>({});
  let measuredHeights = $state<Record<string, Record<string, number>>>({});

  function layoutFor(printerId: string): FleetPanelLayoutItem[] {
    return ctx.settings.isFleetPanelLayoutSynced(printerId)
      ? layout
      : (printerLayouts[printerId] ?? mergeFleetGridLayout(panelIds(), ctx.settings.getFleetPanelsFor(printerId), true));
  }

  $effect(() => {
    void registryPanels;
    void ctx.settings.ui.fleetPanels;
    void ctx.settings.ui.fleetPanelsCustomized;
    layout = mergeLayout();
    const next: Record<string, FleetPanelLayoutItem[]> = {};
    for (const printer of printers) {
      if (!ctx.settings.isFleetPanelLayoutSynced(printer.id)) {
        next[printer.id] = mergeFleetGridLayout(panelIds(), ctx.settings.getFleetPanelsFor(printer.id), true);
      }
    }
    printerLayouts = next;
  });

  function persistLayout(printerId: string): void {
    if (ctx.settings.isFleetPanelLayoutSynced(printerId)) ctx.settings.setFleetPanels(layout);
    else ctx.settings.setFleetPanelsFor(printerId, printerLayouts[printerId] ?? []);
  }

  function editLayout(printerId: string, change: (items: FleetPanelLayoutItem[]) => FleetPanelLayoutItem[]): void {
    if (ctx.settings.isFleetPanelLayoutSynced(printerId)) layout = change(layout);
    else printerLayouts = { ...printerLayouts, [printerId]: change(layoutFor(printerId)) };
  }

  function setLayoutSync(printerId: string, synced: boolean): void {
    ctx.settings.setFleetPanelLayoutSynced(printerId, synced, layoutFor(printerId));
  }

  /**
   * Registry order stays fixed in the DOM while CSS grid coordinates move panels.
   * This avoids disconnecting the plugin custom elements during edits.
   */
  function layoutMapFor(printerId: string): Map<string, FleetPanelDisplayItem> {
    return new Map(projectFleetGridLayout(layoutFor(printerId), measuredHeights[printerId] ?? {})
      .map((item) => [fleetPanelKey(item), item]));
  }

  /** Observe intrinsic panel height so a full-width panel can grow without changing its saved grid size. */
  function measureContent(node: HTMLElement, options: { printerId: string; key: string; enabled: boolean }) {
    let current = options;
    let frame = 0;
    const measure = (): void => {
      if (!current.enabled) return;
      const height = Math.ceil(node.getBoundingClientRect().height);
      if (measuredHeights[current.printerId]?.[current.key] === height) return;
      measuredHeights = {
        ...measuredHeights,
        [current.printerId]: { ...measuredHeights[current.printerId], [current.key]: height },
      };
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return {
      update(next: typeof options) {
        current = next;
        // A mode switch changes the wrapper from fixed to intrinsic height after Svelte updates the DOM.
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(measure);
      },
      destroy() {
        cancelAnimationFrame(frame);
        observer.disconnect();
      },
    };
  }

  // ---------- Editor ----------

  let editorTarget = $state<string | null>(null);
  let editorItems = $derived(
    (editorTarget ? layoutFor(editorTarget) : []).map((item, index) => {
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
    editMode = false;
    ui.setFleet(false);
  }

  function handleActivate(printerId: string) {
    router.navigateToPrinter(printerId);
    ui.setFleet(false);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (editorOpen) editorOpen = false;
      else if (editMode) editMode = false;
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

  // ---------- Shared in-card grid editor ----------

  let editorOpen = $state(false);
  let editMode = $state(false);
  let activeKey = $state<string | null>(null);

  function openEditor(printerId: string): void {
    layout = mergeLayout();
    editorTarget = printerId;
    editorOpen = true;
  }

  function closeEditor(): void {
    editorOpen = false;
  }

  function toggleVisible(printerId: string, index: number): void {
    editLayout(printerId, (items) => items.map((item, i) =>
      i === index ? { ...item, visible: !item.visible } : item,
    ));
    persistLayout(printerId);
  }

  /** Keep the fixed row count as a fallback when content fitting is switched off. */
  function setAutoHeight(printerId: string, key: string, enabled: boolean): void {
    editLayout(printerId, (items) => items.map((item) =>
      fleetPanelKey(item) === key && item.w === FLEET_GRID_COLUMNS
        ? { ...item, autoHeight: enabled }
        : item,
    ));
    persistLayout(printerId);
  }

  /** Measure the card's own tracks, since card widths change with the fleet viewport. */
  function gridStep(tile: HTMLElement): { col: number; row: number } | null {
    const grid = tile.closest('.fleet-card-body') as HTMLElement | null;
    if (!grid) return null;
    const css = getComputedStyle(grid);
    const gap = parseFloat(css.columnGap) || 0;
    const innerWidth = grid.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0);
    return {
      col: (innerWidth - gap * (FLEET_GRID_COLUMNS - 1)) / FLEET_GRID_COLUMNS + gap,
      row: FLEET_ROW_HEIGHT + (parseFloat(css.columnGap) || FLEET_ROW_GAP),
    };
  }

  const RESIZE_DIRS: FleetResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  /** A gesture updates the shared template or just this printer's private one. */
  function startGridGesture(printerId: string, key: string, e: PointerEvent, resize: FleetResizeDir | null): void {
    if (!editMode || e.button !== 0) return;
    const tile = (e.currentTarget as HTMLElement).closest('.fleet-panel-slot') as HTMLElement | null;
    if (!tile) return;
    const step = gridStep(tile);
    const initial = layoutFor(printerId).find((item) => fleetPanelKey(item) === key);
    if (!step || !initial || step.col <= 0 || step.row <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const px = e.clientX;
    const py = e.clientY;
    const rtl = document.documentElement.dir === 'rtl';
    activeKey = `${printerId}:${key}`;

    const move = (event: PointerEvent): void => {
      const dx = Math.round(((event.clientX - px) * (rtl ? -1 : 1)) / step.col);
      const dy = Math.round((event.clientY - py) / step.row);
      editLayout(printerId, (items) => items.map((item) => {
        if (fleetPanelKey(item) !== key) return item;
        if (resize) return resizeFleetPanel(initial, resize, dx, dy);
        return {
          ...item,
          x: Math.min(FLEET_GRID_COLUMNS - item.w, Math.max(0, initial.x + dx)),
          y: Math.max(0, initial.y + dy),
        };
      }));
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      editLayout(printerId, (items) => settleFleetGridLayout(items, key));
      activeKey = null;
      persistLayout(printerId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  /** Arrow keys move a panel; Shift+arrows resize it without requiring a pointer. */
  function onTileKeydown(printerId: string, key: string, event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const rtl = document.documentElement.dir === 'rtl';
    const dx = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    const dy = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    editLayout(printerId, (items) => settleFleetGridLayout(items.map((item) => {
      if (fleetPanelKey(item) !== key) return item;
      if (!event.shiftKey) return { ...item, x: Math.min(FLEET_GRID_COLUMNS - item.w, Math.max(0, item.x + dx)), y: Math.max(0, item.y + dy) };
      const w = Math.min(FLEET_GRID_COLUMNS - item.x, Math.max(FLEET_MIN_WIDTH, item.w + dx));
      return { ...item, w, h: Math.min(FLEET_MAX_HEIGHT, Math.max(FLEET_MIN_HEIGHT, item.h + dy)),
        autoHeight: w === FLEET_GRID_COLUMNS && item.autoHeight === true };
    }), key));
    persistLayout(printerId);
  }

  function resetLayout(): void {
    if (!editorTarget) return;
    if (ctx.settings.isFleetPanelLayoutSynced(editorTarget)) {
      ctx.settings.resetFleetPanels();
      layout = mergeLayout();
    } else {
      ctx.settings.setFleetPanelsFor(editorTarget, mergeFleetGridLayout(panelIds(), [], false));
    }
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
      {#if filterOptions.length > 0}
        <FleetFiltersPopover
          {i18n}
          tags={filterOptions}
          activeTagIds={activeTags}
          mode={filterMode}
          onToggleTag={toggleTag}
          onModeChange={(next) => (filterMode = next)}
        />
      {/if}
      {#if registryPanels.length > 0}
        <button
          class="fleet-edit-btn"
          class:on={editMode}
          onclick={() => (editMode = !editMode)}
          title={i18n.t(editMode ? 'fleet.doneEditing' : 'fleet.editPanels')}
          aria-label={i18n.t(editMode ? 'fleet.doneEditing' : 'fleet.editPanels')}
        >
          <Icon name={editMode ? 'grid' : 'settings'} size={16} />
          <span class="btn-label">{i18n.t(editMode ? 'fleet.doneEditing' : 'fleet.editPanels')}</span>
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
        {@const cardLayout = layoutFor(printer.id)}
        {@const cardMap = layoutMapFor(printer.id)}

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
          <div class="fleet-card-header">
            <button type="button" class="fleet-card-activate" disabled={editMode} onclick={() => handleActivate(printer.id)}>
              <span class="fleet-card-info">
                <span class="fleet-card-name">{printer.name}</span>
                {#if connection}<ConnectionStatus status={connection.status} />{/if}
              </span>
            </button>
            {#if editMode}
              <div class="fleet-card-editor-actions">
                <label class="fleet-sync" title={i18n.t('fleet.syncLayout')}>
                  <input
                    type="checkbox"
                    checked={ctx.settings.isFleetPanelLayoutSynced(printer.id)}
                    onchange={(event) => setLayoutSync(printer.id, event.currentTarget.checked)}
                  />
                  <span>{i18n.t('fleet.syncLayout')}</span>
                </label>
                <button type="button" class="fleet-card-choose" onclick={() => openEditor(printer.id)} aria-label={i18n.t('fleet.choosePanels')} title={i18n.t('fleet.choosePanels')}>
                  <Icon name="preview" size={16} />
                  <span>{i18n.t('fleet.panels')}</span>
                </button>
              </div>
            {/if}
          </div>

          <div class="fleet-card-body" class:editing={editMode}>
            {#if !cardLayout.some((item) => item.visible)}
              <p class="fleet-card-empty">{i18n.t('fleet.noPanels')}</p>
            {:else}
              <!--
                Stable registry iteration keeps custom elements connected while
                their CSS grid coordinates change on every card.
              -->
              {#each registryPanels as panel (keyOf(panel))}
                {@const baseInfo = cardLayout.find((item) => fleetPanelKey(item) === keyOf(panel))}
                {@const info = cardMap.get(keyOf(panel))}
                {@const hidden = info ? !info.visible : false}
                {@const autoHeight = baseInfo?.w === FLEET_GRID_COLUMNS && baseInfo.autoHeight === true}
                {@const api = apiFor(panel.pluginId)}
                <div
                  class="fleet-panel-slot"
                  class:panel-hidden={hidden}
                  class:dragging={activeKey === `${printer.id}:${keyOf(panel)}`}
                  class:single-row={(info?.heightPx ?? 0) < 80}
                  style={info ? `grid-column: ${info.x + 1} / span ${info.w}; grid-row: ${info.topPx + 1} / span ${info.heightPx};` : undefined}
                >
                  <div class="fleet-panel-content" class:edit-concealed={editMode} class:auto-height={autoHeight}
                    use:measureContent={{ printerId: printer.id, key: keyOf(panel), enabled: autoHeight }}>
                    {#if api}
                      <PluginElementHost
                        tag={panel.contribution.element}
                        {api}
                        params={paramsFor(printer.id)}
                        fill={!autoHeight}
                      />
                    {:else}
                      <div class="fleet-card-missing">
                        {i18n.t('fleet.pluginMissing')} · {panel.pluginId}
                      </div>
                    {/if}
                  </div>
                  {#if editMode}
                    <div class="fleet-edit-tile">
                      <button
                        type="button"
                        class="fleet-move-target"
                        aria-label={i18n.t('fleet.movePanel', { name: i18n.t(panel.contribution.titleKey ?? panel.contribution.id) })}
                        onpointerdown={(event) => startGridGesture(printer.id, keyOf(panel), event, null)}
                        onkeydown={(event) => onTileKeydown(printer.id, keyOf(panel), event)}
                      >
                        <span class="fleet-provider" dir="ltr">{panel.pluginId}</span>
                        <span class="fleet-edit-name">{i18n.t(panel.contribution.titleKey ?? panel.contribution.id)}</span>
                        <span class="fleet-edit-size" dir="ltr">{baseInfo?.w ?? 12}×{baseInfo?.h ?? 4}</span>
                      </button>
                      {#if baseInfo?.w === FLEET_GRID_COLUMNS}
                        <label class="fleet-auto-height">
                          <input type="checkbox" checked={autoHeight}
                            onchange={(event) => setAutoHeight(printer.id, keyOf(panel), event.currentTarget.checked)} />
                          <span>{i18n.t('fleet.autoHeight')}</span>
                        </label>
                      {/if}
                      {#each RESIZE_DIRS as dir (dir)}
                        <button
                          type="button"
                          class="fleet-resize-handle resize-{dir}"
                          tabindex={dir === 'se' ? 0 : -1}
                          title={i18n.t('fleet.resizePanel')}
                          aria-label={i18n.t('fleet.resizePanel')}
                          onpointerdown={(event) => startGridGesture(printer.id, keyOf(panel), event, dir)}
                        ></button>
                      {/each}
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
      <h3 class="editor-title">{i18n.t('fleet.editPanelsTitle')} · {printers.find((printer) => printer.id === editorTarget)?.name ?? ''}</h3>
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
              class:hidden-item={!item.visible}
              class:unloaded={!item.loaded}
            >
              <label class="editor-check">
                <input
                  type="checkbox"
                  checked={item.visible}
                  onchange={() => { if (editorTarget) toggleVisible(editorTarget, i); }}
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
      {#if editorTarget && (ctx.settings.ui.fleetPanelsCustomized || !ctx.settings.isFleetPanelLayoutSynced(editorTarget))}
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
    min-height: 36px;
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
  .fleet-edit-btn.on {
    background: var(--accent-subtle-strong);
    border-color: var(--accent);
    color: var(--text-primary);
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
    .fleet-grid > .fleet-card { grid-column: 1 / -1; }
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
    width: 100%;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 0;
    background: var(--bg-surface-hover);
    border-bottom: 1px solid var(--border-color);
    color: var(--text-primary);
    font: inherit;
    text-align: start;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .fleet-card-activate {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    padding: var(--space-xs) 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .fleet-card-activate:disabled { cursor: default; }
  .fleet-card-editor-actions { display: flex; align-items: center; gap: var(--space-xs); min-width: 0; }
  /* Checkbox text wraps in narrow or translated card headers without covering the printer name. */
  .fleet-sync { display: flex; align-items: center; gap: var(--space-xs); min-width: 0; font-size: var(--font-size-xs); cursor: pointer; }
  .fleet-sync input { width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--accent); }
  .fleet-sync span { overflow-wrap: anywhere; }
  /* The short label keeps the visibility action discoverable without crowding narrow card headers. */
  .fleet-card-choose { min-height: var(--touch-target); padding-inline: var(--space-sm); display: flex; align-items: center; justify-content: center; gap: var(--space-xs); flex-shrink: 0; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text-secondary); font: inherit; font-size: var(--font-size-xs); white-space: nowrap; cursor: pointer; }
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
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    /* One-pixel tracks preserve exact content height; saved edits still snap to 44px cells. */
    grid-auto-rows: 1px;
    column-gap: var(--space-xs);
    row-gap: 0;
    align-content: start;
    min-height: 0;
    overflow-y: auto;
  }
  /* Card tracks stay logical in RTL; one shared template fits both wide and narrow fleet. */
  .fleet-card-body.editing {
    background: var(--bg-surface-hover);
  }
  .fleet-card-empty {
    grid-column: 1 / -1;
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

  .fleet-panel-slot {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    transition: opacity var(--transition-fast);
  }
  .fleet-card-body.editing .fleet-panel-slot {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
  }
  .fleet-panel-slot.dragging { z-index: 2; border-color: var(--accent); }
  .fleet-panel-slot.panel-hidden {
    display: none;
  }
  .fleet-panel-content {
    height: 100%;
    min-height: 0;
    overflow: auto;
  }
  /* Intrinsic height is measured before grid tracks are expanded for this printer. */
  .fleet-panel-content.auto-height {
    height: auto;
    overflow: visible;
    --fleet-panel-content-height: auto;
    --fleet-panel-stream-flex: 0 0 auto;
  }
  .fleet-panel-content.edit-concealed { visibility: hidden; }
  .fleet-edit-tile {
    position: absolute;
    inset: 0;
    background: var(--bg-surface);
    color: var(--text-primary);
  }
  .fleet-move-target {
    display: block;
    width: 100%;
    height: 100%;
    padding: var(--space-sm);
    border: 0;
    background: transparent;
    color: inherit;
    text-align: start;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .fleet-move-target:active { cursor: grabbing; }
  .fleet-move-target:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .fleet-edit-name {
    position: absolute;
    inset-inline-start: var(--space-sm);
    inset-block-end: var(--space-xs);
    max-inline-size: 45%;
    font-size: var(--font-size-sm);
    font-weight: 600;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .fleet-panel-slot.single-row .fleet-edit-name { display: none; }
  /* The provider follows the leading corner while its technical ID remains LTR. */
  .fleet-provider {
    position: absolute;
    inset-inline-start: var(--space-sm);
    inset-block-start: var(--space-xs);
    max-inline-size: calc(100% - var(--touch-target) - var(--space-md));
    font-family: monospace;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    unicode-bidi: isolate;
  }
  /* dir=ltr isolates the ID, so the RTL corner needs an explicit override. */
  :global([dir='rtl']) .fleet-provider { inset-inline-start: auto; inset-inline-end: var(--space-sm); }
  .fleet-edit-size {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-muted);
  }
  /* The control stays in a bottom corner so narrow cards keep their central size readable. */
  .fleet-auto-height {
    position: absolute;
    inset-inline-end: var(--space-sm);
    inset-block-end: var(--space-xs);
    z-index: 3;
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    min-height: 28px;
    max-inline-size: 48%;
    font-size: var(--font-size-xs);
    line-height: 1.2;
    cursor: pointer;
  }
  .fleet-auto-height input { width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--accent); }
  .fleet-auto-height span { overflow-wrap: anywhere; }
  /* One-row cards use opposite corners for provider and checkbox, keeping both controls reachable. */
  .fleet-panel-slot.single-row .fleet-auto-height {
    inset-inline-start: var(--space-sm);
    inset-inline-end: auto;
    inset-block-end: 2px;
    min-height: 18px;
  }
  .fleet-resize-handle {
    position: absolute;
    z-index: 2;
    padding: 0;
    border: 0;
    background: transparent;
    touch-action: none;
  }
  .fleet-resize-handle:hover, .fleet-resize-handle:focus-visible {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .fleet-resize-handle:focus-visible { outline: 2px solid var(--accent); }
  /* Full-side handles mirror dashboard; corners take precedence at intersections. */
  .resize-n { inset-block-start: 0; inset-inline: 0; block-size: 7px; cursor: ns-resize; }
  .resize-s { inset-block-end: 0; inset-inline: 0; block-size: 7px; cursor: ns-resize; }
  .resize-e { inset-inline-end: 0; inset-block: 0; inline-size: 7px; cursor: ew-resize; }
  .resize-w { inset-inline-start: 0; inset-block: 0; inline-size: 7px; cursor: ew-resize; }
  .resize-ne { inset-block-start: 0; inset-inline-end: 0; inline-size: 12px; block-size: 12px; cursor: nesw-resize; }
  .resize-nw { inset-block-start: 0; inset-inline-start: 0; inline-size: 12px; block-size: 12px; cursor: nwse-resize; }
  .resize-se { inset-block-end: 0; inset-inline-end: 0; inline-size: 12px; block-size: 12px; cursor: nwse-resize; }
  .resize-sw { inset-block-end: 0; inset-inline-start: 0; inline-size: 12px; block-size: 12px; cursor: nesw-resize; }
  :global([dir='rtl']) .resize-ne, :global([dir='rtl']) .resize-sw { cursor: nwse-resize; }
  :global([dir='rtl']) .resize-nw, :global([dir='rtl']) .resize-se { cursor: nesw-resize; }

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
    transition: opacity var(--transition-fast), transform var(--transition-fast);
  }
  .editor-item.hidden-item {
    opacity: 0.55;
    background: transparent;
    border-style: dashed;
  }
  .editor-item.unloaded { opacity: 0.7; }
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
    font-size: var(--font-size-2xs);
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
