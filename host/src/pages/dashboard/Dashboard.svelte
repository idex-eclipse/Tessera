<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PluginRegistry } from '../../core/plugin-registry.svelte.ts';
  import type { PrinterManager } from '../../core/printer-manager.svelte.ts';
  import type { DashboardWidgetLayoutItem } from '../../core/settings-store.svelte.ts';
  import type { WidgetContribution } from '../../../../plugin-sdk/src/types';

  import { confirm } from '../../components/confirm/confirm-dialog.svelte.ts';
  import { getAppContext } from '../../app-context.ts';

  import WidgetContainer from './WidgetContainer.svelte';
  import AddWidgetDialog from './AddWidgetDialog.svelte';

  import { findFreeSpot, overlaps } from '../../core/layout-utils.ts';

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

  let editMode = $state(params.edit === '1');
  let dialogOpen = $state(false);
  let activeId = $state<string | null>(null);
  let gridEl = $state<HTMLElement | null>(null);

  const MAX_H = 16;

  // ------------------------------------------------------------------
  // Mobile detection
  // ------------------------------------------------------------------

  // Единый источник брейкпоинта — ui-store (NARROW_BREAKPOINT).
  const appCtx = getAppContext();
  let isMobile = $derived(appCtx.ui.isNarrow);

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

  function settle(
    items: DashboardWidgetLayoutItem[],
    activeInstanceId: string,
  ): DashboardWidgetLayoutItem[] {
    const result = items.map((i) => ({ ...i }));
    const active = result.find((i) => i.instanceId === activeInstanceId);
    if (!active) return result;

    const queue: DashboardWidgetLayoutItem[] = [active];
    const inQueue = new Set<string>([active.instanceId]);
    let guard = 0;

    while (queue.length > 0 && guard++ < 500) {
      const cur = queue.shift()!;
      for (const other of result) {
        if (other.instanceId === cur.instanceId) continue;
        if (overlaps(cur, other)) {
          other.y = cur.y + cur.h;
          if (!inQueue.has(other.instanceId)) {
            inQueue.add(other.instanceId);
            queue.push(other);
          }
        }
      }
    }

    return result;
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
  }

  function handleRemove(instanceId: string): void {
    if (!activePrinterId) return;
    const current = registry.getDashboardLayout(activePrinterId);
    registry.setDashboardLayout(
      activePrinterId,
      current.filter((i) => i.instanceId !== instanceId),
    );
  }

  async function handleReset(): Promise<void> {
    if (!activePrinterId) return;
    const ok = await confirm({
      title: i18n.t('dashboard.resetLayout'),
      message: i18n.t('dashboard.resetLayoutConfirm'),
      danger: true,
    });
    if (!ok) return;
    registry.resetDashboardLayout(activePrinterId);
  }

  function toggleEdit(): void {
    editMode = !editMode;
    if (!editMode) {
      activeId = null;
      dialogOpen = false;
      if (params.edit && window.location.hash.includes('edit=1')) {
        window.location.replace(window.location.hash.split('?')[0] || '#/');
      }
    }
  }

  // ------------------------------------------------------------------
  // move drag (free placement)
  // ------------------------------------------------------------------

  function onMoveStart(item: DashboardWidgetLayoutItem, e: PointerEvent): void {
    if (!editMode || !activePrinterId || !gridEl) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, .resize-handle')) return;

    e.preventDefault();
    const { colStep, rowStep } = gridMetrics();

    const px = e.clientX;
    const py = e.clientY;
    const gx = item.x;
    const gy = item.y;

    activeId = item.instanceId;

    const move = (ev: PointerEvent): void => {
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
    };

    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      activeId = null;
      if (activePrinterId) {
        registry.setDashboardLayout(
          activePrinterId,
          settle(registry.getDashboardLayout(activePrinterId), item.instanceId),
        );
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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

    const move = (ev: PointerEvent): void => {
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
    };

    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      activeId = null;
      if (activePrinterId) {
        registry.setDashboardLayout(
          activePrinterId,
          settle(registry.getDashboardLayout(activePrinterId), item.instanceId),
        );
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
</script>

{#if activePrinter}
  {#if editMode}
    <div class="edit-toolbar">
      <span class="edit-hint">{i18n.t('dashboard.editHint')}</span>
      <button class="btn btn-secondary" onclick={() => (dialogOpen = true)}>
        + {i18n.t('dashboard.addWidget')}
      </button>
      {#if layout.length > 0}
        <button class="btn btn-danger" onclick={handleReset}>
          {i18n.t('dashboard.resetLayout')}
        </button>
      {/if}
      <button class="btn btn-primary" onclick={toggleEdit}>
        {i18n.t('common.save')}
      </button>
    </div>
  {/if}

  {#if layout.length === 0 && !editMode}
    <div class="empty-state">
      <p>{i18n.t('dashboard.noWidgets')}</p>
      <p class="empty-hint">{i18n.t('dashboard.editToStart')}</p>
    </div>
  {:else}
    <div class="dashboard-grid" class:edit-mode={editMode} class:mobile={isMobile} bind:this={gridEl}>
      {#each displayLayout as item (item.instanceId)}
        {#if editMode}
          <div
            class="layout-card"
            class:dragging={activeId === item.instanceId}
            style={isMobile 
              ? "" 
              : `grid-column: ${item.x + 1} / span ${item.w}; grid-row: ${item.y + 1} / span ${item.h};`}
            onpointerdown={(e) => onMoveStart(item, e)}
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
      open={dialogOpen}
      onClose={() => (dialogOpen = false)}
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
  .edit-toolbar,
  .view-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-md);
  }

  .edit-hint {
    flex: 1;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }

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
    touch-action: none;
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
    font-size: var(--font-size-xl, 1.25rem);
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

  @media (max-width: 768px) {
    .dashboard-grid {
      grid-template-columns: 1fr;
      grid-auto-rows: auto;
      gap: var(--space-sm);
    }

    .dashboard-grid > :global(*) {
      grid-column: 1 / -1 !important;
      grid-row: auto !important;
      min-height: 240px;
      height: auto !important;
    }

    .dashboard-grid.edit-mode .layout-card {
      cursor: default;
      min-height: 160px;
    }

    .dashboard-grid.edit-mode .resize-handle {
      display: none;
    }

    .edit-toolbar {
      flex-wrap: wrap;
      gap: var(--space-xs);
    }

    .edit-toolbar .btn {
      flex: 1;
      min-width: 120px;
    }
  }
</style>