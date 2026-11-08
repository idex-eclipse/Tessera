<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PluginRegistry } from '../../core/plugin-registry.svelte.ts';
  import type { PrinterManager } from '../../core/printer-manager.svelte.ts';
  import type { DashboardWidgetLayoutItem } from '../../core/settings-store.svelte.ts';
  import type { WidgetContribution } from '../../../../plugin-sdk/src/types';

  import { getAppContext } from '../../app-context.ts';
  import Icon from '../../components/icons/Icon.svelte';
  import { narrowWidth } from '../../core/narrow-width.ts';

  import WidgetContainer from './WidgetContainer.svelte';
  import AddWidgetDialog from './AddWidgetDialog.svelte';
  import HeightRuler from './HeightRuler.svelte';

  import { findFreeSpot, moveInStack, setHeight, settle } from '../../core/layout-utils.ts';

  let {
    printerManager,
    registry,
    i18n,
    params = {},
  }: {
    printerManager: PrinterManager;
    registry: PluginRegistry;
    i18n: HostI18n;
    params?: Record<string, string>;
  } = $props();

  let activePrinter = $derived(printerManager.activePrinter);
  let activePrinterId = $derived(printerManager.activePrinterId);
  let layout = $derived(
    activePrinterId ? registry.getDashboardLayout(activePrinterId) : [],
  );

  // ------------------------------------------------------------------
  // Edit mode
  // ------------------------------------------------------------------

  const { editor } = getAppContext();

  let editMode = $derived(editor.active);
  let activeId = $state<string | null>(null);
  let gridEl = $state<HTMLElement | null>(null);

  const MAX_H = 16;

  // ------------------------------------------------------------------
  // Mobile detection
  // ------------------------------------------------------------------

  // Узость определяется шириной самого dashboard (а не окна): сайдбар и правая панель
  // сужают область, и сетка из 12 колонок разваливается раньше, чем окно станет «мобильным».
  // Порог — единый брейкпоинт хоста (ui-store). Сетка остаётся сеткой: меняется только число
  // колонок (одна), высота карточки по-прежнему задаётся рядами `h`.
  let isMobile = $state(false);

  let mobileLayout = $derived.by(() => {
    if (!isMobile || !layout) return layout;
    // На мобильных: сортируем по y (сверху вниз), затем по x (слева направо)
    return [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  });

  let displayLayout = $derived(isMobile ? mobileLayout : layout);

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function contributionOf(item: DashboardWidgetLayoutItem): WidgetContribution | null {
    return (
      registry
        .getProvidersForType(item.type)
        .find((p) => p.contribution.provider === item.provider)?.contribution ?? null
    );
  }

  function titleOf(item: DashboardWidgetLayoutItem): string {
    const c = contributionOf(item);
    return c ? i18n.t(c.titleKey) : item.type;
  }

  function generateInstanceId(): string {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function gridMetrics(): { colStep: number; rowStep: number } {
    const cs = getComputedStyle(gridEl!);
    const colGap = parseFloat(cs.columnGap) || 0;
    const rowGap = parseFloat(cs.rowGap) || 0;
    const colW = (gridEl!.clientWidth - colGap * 11) / 12;
    const rowH = parseFloat(cs.gridAutoRows) || 80;
    return { colStep: colW + colGap, rowStep: rowH + rowGap };
  }

  // ------------------------------------------------------------------
  // mutations
  // ------------------------------------------------------------------

  function handleAdd(type: string, provider: string, w: number, h: number): void {
    if (!activePrinterId) return;
    const current = registry.getDashboardLayout(activePrinterId);
    const pos = findFreeSpot(current, w, h);
    registry.setDashboardLayout(activePrinterId, [
      ...current,
      { instanceId: generateInstanceId(), type, provider, x: pos.x, y: pos.y, w, h },
    ]);
    editor.changed();
  }

  function handleRemove(instanceId: string): void {
    if (!activePrinterId) return;
    const current = registry.getDashboardLayout(activePrinterId);
    registry.setDashboardLayout(
      activePrinterId,
      current.filter((i) => i.instanceId !== instanceId),
    );
    editor.changed();
  }

  // ------------------------------------------------------------------
  // мобильный режим: порядок кнопками, высота линейкой
  // ------------------------------------------------------------------

  function minHeightOf(item: DashboardWidgetLayoutItem): number {
    return contributionOf(item)?.minSize?.h ?? 2;
  }

  function moveItem(item: DashboardWidgetLayoutItem, delta: -1 | 1): void {
    if (!activePrinterId) return;
    registry.setDashboardLayout(
      activePrinterId,
      moveInStack(registry.getDashboardLayout(activePrinterId), item.instanceId, delta),
    );
    editor.changed();
  }

  // Шаг линейки измеряем: зазор между рядами в мобильном режиме другой.
  let rowStep = $state(0);
  $effect(() => {
    if (isMobile && gridEl) rowStep = gridMetrics().rowStep;
  });

  // Жест считается от раскладки на его начало: «вверх-вниз» возвращает всё в точности.
  let heightBase: DashboardWidgetLayoutItem[] | null = null;

  function startHeight(): void {
    if (!activePrinterId) return;
    heightBase = registry.getDashboardLayout(activePrinterId).map((i) => ({ ...i }));
  }

  function applyHeight(item: DashboardWidgetLayoutItem, h: number): void {
    if (!activePrinterId || !heightBase) return;
    registry.setDashboardLayout(
      activePrinterId,
      setHeight(heightBase, item.instanceId, h, minHeightOf(item), MAX_H),
    );
  }

  function commitHeight(): void {
    heightBase = null;
    editor.changed();
  }

  // ------------------------------------------------------------------
  // жесты: перенос и ресайз
  // ------------------------------------------------------------------

  /**
   * Ведёт жест окном: move до отпускания, затем один `onEnd`. `pointercancel` (браузер забрал
   * касание под прокрутку) завершает жест так же, как отпускание. Для касания блокируем
   * прокрутку страницы на время жеста.
   */
  function trackGesture(
    touch: boolean,
    onMove: (e: PointerEvent) => void,
    onEnd: () => void,
  ): void {
    const stopScroll = (e: TouchEvent): void => {
      if (e.cancelable) e.preventDefault();
    };

    const finish = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('touchmove', stopScroll);
      onEnd();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    if (touch) window.addEventListener('touchmove', stopScroll, { passive: false });
  }

  function endGesture(instanceId: string): void {
    activeId = null;
    if (!activePrinterId) return;
    registry.setDashboardLayout(
      activePrinterId,
      settle(registry.getDashboardLayout(activePrinterId), instanceId),
    );
    editor.changed();
  }

  // Касание: карточка прокручивается пальцем, перенос начинается после долгого нажатия.
  const LONG_PRESS_MS = 400;
  const LONG_PRESS_SLOP = 10;

  function onMoveStart(item: DashboardWidgetLayoutItem, e: PointerEvent): void {
    if (!editMode || isMobile || !activePrinterId || !gridEl) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, .resize-handle')) return;

    if (e.pointerType !== 'touch') {
      e.preventDefault();
      beginMove(item, e.clientX, e.clientY, false);
      return;
    }

    let x = e.clientX;
    let y = e.clientY;
    const sx = x;
    const sy = y;

    const stop = (): void => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    const track = (ev: PointerEvent): void => {
      x = ev.clientX;
      y = ev.clientY;
      if (Math.hypot(x - sx, y - sy) > LONG_PRESS_SLOP) stop();
    };
    const timer = setTimeout(() => {
      stop();
      navigator.vibrate?.(10);
      beginMove(item, x, y, true);
    }, LONG_PRESS_MS);

    window.addEventListener('pointermove', track);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  function beginMove(item: DashboardWidgetLayoutItem, px: number, py: number, touch: boolean): void {
    if (!activePrinterId || !gridEl) return;
    const { colStep, rowStep } = gridMetrics();
    const gx = item.x;
    const gy = item.y;

    activeId = item.instanceId;

    trackGesture(
      touch,
      (ev) => {
        if (!activePrinterId) return;
        const cur = registry.getDashboardLayout(activePrinterId);
        const it = cur.find((i) => i.instanceId === item.instanceId);
        if (!it) return;

        const dcol = Math.round((ev.clientX - px) / colStep);
        const drow = Math.round((ev.clientY - py) / rowStep);

        const x = Math.min(12 - it.w, Math.max(0, gx + dcol));
        const y = Math.max(0, gy + drow);

        if (x === it.x && y === it.y) return;

        registry.setDashboardLayout(
          activePrinterId,
          cur.map((i) => (i.instanceId === item.instanceId ? { ...i, x, y } : i)),
        );
      },
      () => endGesture(item.instanceId),
    );
  }

  // ------------------------------------------------------------------
  // edge resize (8 directions)
  // ------------------------------------------------------------------

  type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  function onResizeStart(
    item: DashboardWidgetLayoutItem,
    dir: ResizeDir,
    e: PointerEvent,
  ): void {
    if (!editMode || !activePrinterId || !gridEl) return;
    e.preventDefault();
    e.stopPropagation();

    const { colStep, rowStep } = gridMetrics();
    const c = contributionOf(item);

    const px = e.clientX;
    const py = e.clientY;
    const gx = item.x;
    const gy = item.y;
    const startW = item.w;
    const startH = item.h;
    const minW = c?.minSize?.w ?? 2;
    const minH = c?.minSize?.h ?? 2;
    const hasN = dir.includes('n');
    const hasS = dir.includes('s');
    const hasE = dir.includes('e');
    const hasW = dir.includes('w');

    activeId = item.instanceId;

    trackGesture(
      e.pointerType === 'touch',
      (ev) => {
        if (!activePrinterId) return;
        const cur = registry.getDashboardLayout(activePrinterId);
        const it = cur.find((i) => i.instanceId === item.instanceId);
        if (!it) return;

        const dcol = Math.round((ev.clientX - px) / colStep);
        const drow = Math.round((ev.clientY - py) / rowStep);

        let x = gx, y = gy, w = startW, h = startH;

        if (hasE) {
          w = Math.min(12 - gx, Math.max(minW, startW + dcol));
        } else if (hasW) {
          let d = dcol;
          d = Math.max(d, -gx);
          d = Math.min(d, startW - minW);
          x = gx + d;
          w = startW - d;
        }

        if (hasS) {
          h = Math.min(MAX_H, Math.max(minH, startH + drow));
        } else if (hasN) {
          let d = drow;
          d = Math.max(d, -gy);
          d = Math.min(d, startH - minH);
          y = gy + d;
          h = startH - d;
        }

        if (x === it.x && y === it.y && w === it.w && h === it.h) return;

        registry.setDashboardLayout(
          activePrinterId,
          cur.map((i) => (i.instanceId === item.instanceId ? { ...i, x, y, w, h } : i)),
        );
      },
      () => endGesture(item.instanceId),
    );
  }
</script>

{#if activePrinter}
  {#if layout.length === 0 && !editMode}
    <div class="empty-state">
      <p>{i18n.t('dashboard.noWidgets')}</p>
      <p class="empty-hint">{i18n.t('dashboard.editToStart')}</p>
    </div>
  {:else}
    <div class="dashboard-grid" class:edit-mode={editMode} class:mobile={isMobile} bind:this={gridEl} use:narrowWidth={(v) => (isMobile = v)}>
      {#each displayLayout as item, index (item.instanceId)}
        {#if editMode && isMobile}
          <div class="mobile-row" style={`--h: ${item.h};`}>
            <div class="layout-card">
              <div class="layout-card-head">
                <span class="layout-card-title">{titleOf(item)}</span>
                <button class="btn btn-danger" onclick={() => handleRemove(item.instanceId)}>✕</button>
              </div>

              <span class="layout-card-meta">{item.type} · {item.provider}</span>
              <span class="size-badge">{item.h}</span>
            </div>

            <HeightRuler
              h={item.h}
              min={minHeightOf(item)}
              max={MAX_H}
              {rowStep}
              label={i18n.t('dashboard.widgetHeight')}
              onStart={startHeight}
              onChange={(h) => applyHeight(item, h)}
              onCommit={commitHeight}
            />

            <div class="move-rail">
              <button
                class="ctl"
                disabled={index === 0}
                onclick={() => moveItem(item, -1)}
                aria-label={i18n.t('dashboard.moveUp')}
                title={i18n.t('dashboard.moveUp')}
              ><Icon name="chevron-up" size={20} /></button>
              <button
                class="ctl"
                disabled={index === displayLayout.length - 1}
                onclick={() => moveItem(item, 1)}
                aria-label={i18n.t('dashboard.moveDown')}
                title={i18n.t('dashboard.moveDown')}
              ><Icon name="chevron-down" size={20} /></button>
            </div>
          </div>
        {:else if editMode}
          <div
            class="layout-card"
            class:dragging={activeId === item.instanceId}
            style={`grid-column: ${item.x + 1} / span ${item.w}; grid-row: ${item.y + 1} / span ${item.h}; --h: ${item.h};`}
            onpointerdown={(e) => onMoveStart(item, e)}
            oncontextmenu={(e) => e.preventDefault()}
          >
            <div class="layout-card-head">
              <span class="layout-card-title">{titleOf(item)}</span>
              <button class="btn btn-danger" onclick={() => handleRemove(item.instanceId)}>✕</button>
            </div>

            <span class="layout-card-meta">{item.type} · {item.provider}</span>
            <span class="size-badge">{item.w}×{item.h}</span>

            {#each RESIZE_DIRS as dir (dir)}
              <span
                class="resize-handle resize-{dir}"
                onpointerdown={(e) => onResizeStart(item, dir, e)}
              ></span>
            {/each}
          </div>
        {:else}
          <WidgetContainer
            {item}
            printerId={activePrinterId!}
            {registry}
            {printerManager}
            {i18n}
            params={params}
            narrow={isMobile}
          />
        {/if}
      {/each}
    </div>
  {/if}

  {#if editMode}
    <AddWidgetDialog
      {registry}
      printerId={activePrinterId!}
      {i18n}
      open={editor.addDialogOpen}
      onClose={() => (editor.addDialogOpen = false)}
      onAdd={handleAdd}
    />
  {/if}
{:else}
  <div class="empty-state">
    <p>{i18n.t('printer.noPrinters')}</p>
    <p>{i18n.t('printer.addFirstPrinter')}</p>
  </div>
{/if}

<style>
  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    grid-auto-rows: var(--grid-row-height);
    gap: var(--space-md);
  }

  .dashboard-grid.edit-mode .layout-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    min-height: 0;
    overflow: hidden;
    padding: var(--space-sm) var(--space-md);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    cursor: grab;
    user-select: none;
    -webkit-touch-callout: none;
    /* Палец прокручивает страницу; перенос начинается долгим нажатием (см. onMoveStart) */
    touch-action: pan-y;
  }

  .dashboard-grid.edit-mode .layout-card.dragging {
    opacity: 0.75;
    border-color: var(--accent);
    cursor: grabbing;
  }

  .layout-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
  }

  .layout-card-title {
    font-weight: 600;
  }

  .layout-card-meta {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    font-family: monospace;
  }

  .size-badge {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    font-family: monospace;
    font-size: var(--font-size-xl);
    font-weight: 600;
    color: var(--text-muted);
    opacity: 0.8;
  }

  .resize-handle {
    position: absolute;
    z-index: 2;
    touch-action: none;
  }

  .resize-n { top: 0; left: 0; right: 0; height: 7px; cursor: ns-resize; }
  .resize-s { bottom: 0; left: 0; right: 0; height: 7px; cursor: ns-resize; }
  .resize-e { top: 0; right: 0; bottom: 0; width: 7px; cursor: ew-resize; }
  .resize-w { top: 0; left: 0; bottom: 0; width: 7px; cursor: ew-resize; }

  .resize-ne { top: 0; right: 0; width: 12px; height: 12px; cursor: nesw-resize; }
  .resize-nw { top: 0; left: 0; width: 12px; height: 12px; cursor: nwse-resize; }
  .resize-se { bottom: 0; right: 0; width: 12px; height: 12px; cursor: nwse-resize; }
  .resize-sw { bottom: 0; left: 0; width: 12px; height: 12px; cursor: nesw-resize; }

  .resize-handle:hover {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .layout-card-head .btn-danger {
    position: relative;
    z-index: 3;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xl);
    text-align: center;
    color: var(--text-secondary);
  }

  .empty-hint {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }

  .btn {
    padding: var(--space-xs) var(--space-md);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    color: #fff;
  }

  .btn-secondary {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .btn-danger {
    background: var(--danger);
    color: #fff;
  }

  /* Узкий dashboard (ширина самой сетки < NARROW_BREAKPOINT, класс .mobile): одна колонка,
     ряды остаются — карточка занимает `h` рядов, поэтому у виджета всегда определённая высота. */
  .dashboard-grid.mobile {
    grid-template-columns: 1fr;
    gap: var(--space-sm);
  }

  .dashboard-grid.mobile > :global(*) {
    grid-column: 1 / -1 !important;
    grid-row: span var(--h, 3) !important;
  }

  .dashboard-grid.mobile.edit-mode .layout-card {
    cursor: default;
  }

  /* Строка мобильного редактирования: карточка, линейка, кнопки порядка.
     Порядок колонок сам зеркалится в RTL. */
  .mobile-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 28px var(--touch-target);
    grid-template-rows: minmax(0, 1fr);
    gap: var(--space-xs);
    min-width: 0;
    min-height: 0;
  }

  .move-rail {
    display: flex;
    flex-direction: column;
    align-self: center;
    gap: var(--space-xs);
  }

  .ctl {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-target);
    height: var(--touch-target);
    border: none;
    border-radius: var(--radius-md);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    cursor: pointer;
  }

  .ctl:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
