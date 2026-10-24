<script lang="ts">
  import type { PluginApi } from '../../../../plugin-sdk/src/types.ts';
  import type { QuickChipLayoutItem } from '../../../../plugin-sdk/src/types.ts';
  import type { Route } from '../../core/router.svelte.ts';

  import { getAppContext } from '../../app-context.ts';
  import { getPluginApi } from '../../core/plugin-api-cache.ts';
  import PluginElementHost from '../plugin-element-host.svelte';
  import { confirm } from '../confirm/confirm-dialog.svelte.ts';
  import AddChipDialog from './AddChipDialog.svelte';

  let { route }: { route: Route } = $props();

  const ctx = getAppContext();

  const QUICK_CHIPS_MAX = 16;

  let editMode = $derived(route.kind === 'dashboard' && route.query.edit === '1');
  let printerId = $derived(ctx.printerManager.activePrinterId);

  let chips = $derived<QuickChipLayoutItem[]>(
    printerId ? ctx.registry.getQuickChips(printerId) : [],
  );
  let contributions = $derived(ctx.registry.getChips());

  let dialogOpen = $state(false);

  // ---------- DnD state (HTML5, по образцу MacroWidget) ----------
  let dragSourceIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);
  let dragOverSide = $state<'before' | 'after' | null>(null);

  const apiFor = (pluginId: string) => getPluginApi(ctx, pluginId);

  interface ResolvedChip {
    index: number;
    item: QuickChipLayoutItem;
    element: string | null;
    pluginId: string | null;
  }

  let resolved = $derived.by<ResolvedChip[]>(() => {
    const out: ResolvedChip[] = [];
    chips.forEach((item, index) => {
      const reg = contributions.find(
        (c) =>
          c.contribution.type === item.type &&
          c.contribution.provider === item.provider,
      );
      const applicable =
        reg && printerId
          ? ctx.loader.pluginAppliesToPrinter(reg.pluginId, printerId)
          : false;
      out.push({
        index,
        item,
        element: applicable ? (reg?.contribution.element ?? null) : null,
        pluginId: applicable ? (reg?.pluginId ?? null) : null,
      });
    });
    return out;
  });

  let visible = $derived(editMode || resolved.some((r) => r.element !== null));

  function paramsFor(item: QuickChipLayoutItem): Record<string, string> {
    const p: Record<string, string> = {
      chipId: item.id,
      edit: editMode ? '1' : '0',
    };
    if (item.label) p.chipLabel = item.label;
    return p;
  }

  function generateInstanceId(): string {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function removeChip(instanceId: string): void {
    if (!printerId) return;
    ctx.settings.setQuickChips(
      printerId,
      chips.filter((c) => c.instanceId !== instanceId),
    );
  }

  async function resetChips(): Promise<void> {
    if (!printerId) return;
    const ok = await confirm({
      title: ctx.i18n.t('quickAccess.resetLayout'),
      message: ctx.i18n.t('quickAccess.resetLayoutConfirm'),
      danger: true,
    });
    if (!ok) return;
    ctx.settings.resetQuickChips(printerId);
  }

  function handlePick(type: string, provider: string, id: string, label?: string): void {
    if (!printerId) return;
    if (chips.length >= QUICK_CHIPS_MAX) return;
    if (chips.some((c) => c.type === type && c.provider === provider && c.id === id)) return;
    ctx.settings.setQuickChips(printerId, [
      ...chips,
      { instanceId: generateInstanceId(), type, provider, id, label },
    ]);
  }

  // ---------- HTML5 DnD handlers ----------

  function onDragStart(e: DragEvent, index: number): void {
    dragSourceIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  }

  /**
   * Половина ширины = вставка до/после (как в MacroWidget macroDragOver).
   * preventDefault() ОБЯЗАТЕЛЕН — без него drop не срабатывает.
   */
  function onDragOver(e: DragEvent, index: number): void {
    if (dragSourceIndex === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dragSourceIndex === index) return;

    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side: 'before' | 'after' = e.clientX < r.left + r.width / 2 ? 'before' : 'after';

    dragOverIndex = index;
    dragOverSide = side;
  }

  function onDrop(e: DragEvent, index: number): void {
    e.preventDefault();
    e.stopPropagation();
    if (!printerId || dragSourceIndex === null || dragSourceIndex === index) {
      endDrag();
      return;
    }

    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientX >= r.left + r.width / 2;

    const next = [...chips];
    const [moved] = next.splice(dragSourceIndex, 1);

    // Вычисляем целевую позицию: если dragSourceIndex < index, после splice индекс сдвинулся
    let target = index;
    if (dragSourceIndex < index) target -= 1;
    if (after) target += 1;

    if (moved) next.splice(target, 0, moved);
    ctx.settings.setQuickChips(printerId, next);
    endDrag();
  }

  function onDragEnd(): void {
    endDrag();
  }

  function onDragLeave(): void {
    // Если курсор ушёл с wrap — сбрасываем подсветку цели.
    // dragover соседа перебивает это через onDragOver, поэтому мерцания нет.
    dragOverIndex = null;
    dragOverSide = null;
  }

  function endDrag(): void {
    dragSourceIndex = null;
    dragOverIndex = null;
    dragOverSide = null;
  }

  /** Кнопка-крестик не должна инициировать drag родителя. */
  function blockDrag(e: DragEvent): void {
    e.stopPropagation();
    e.preventDefault();
  }
</script>

{#if visible && printerId}
  <div class="quick-access" class:edit={editMode}>
    {#if editMode}
      <div class="qa-toolbar">
        <span class="qa-hint">{ctx.i18n.t('quickAccess.editHint')}</span>
        <button
          class="qa-btn"
          disabled={chips.length >= QUICK_CHIPS_MAX}
          onclick={() => (dialogOpen = true)}
        >
          + {ctx.i18n.t('quickAccess.addChip')}
        </button>
        {#if chips.length > 0}
          <button class="qa-btn danger" onclick={resetChips}>
            {ctx.i18n.t('quickAccess.resetLayout')}
          </button>
        {/if}
      </div>
      {#if chips.length >= QUICK_CHIPS_MAX}
        <span class="qa-cap">
          {ctx.i18n.t('quickAccess.capReached', { max: String(QUICK_CHIPS_MAX) })}
        </span>
      {/if}
    {/if}

    <div class="qa-chips">
      {#each resolved as r (r.item.instanceId)}
        {#if r.element && r.pluginId}
          {@const api = apiFor(r.pluginId)}
          {#if api}
            <div
              class="qa-chip-wrap"
              class:dragging={dragSourceIndex === r.index}
              class:drag-over-before={dragOverIndex === r.index && dragOverSide === 'before'}
              class:drag-over-after={dragOverIndex === r.index && dragOverSide === 'after'}
              draggable={editMode ? 'true' : 'false'}
              ondragstart={(e) => onDragStart(e, r.index)}
              ondragover={(e) => onDragOver(e, r.index)}
              ondragleave={onDragLeave}
              ondrop={(e) => onDrop(e, r.index)}
              ondragend={onDragEnd}
            >
              <PluginElementHost tag={r.element} {api} params={paramsFor(r.item)} fill={false} />
              {#if editMode}
                <button
                  class="qa-x"
                  onclick={() => removeChip(r.item.instanceId)}
                  ondragstart={blockDrag}
                  ondragover={blockDrag}
                  ondrop={blockDrag}
                  aria-label={ctx.i18n.t('common.remove')}
                >✕</button>
              {/if}
            </div>
          {/if}
        {:else}
          <div
            class="qa-chip-wrap ghost"
            class:dragging={dragSourceIndex === r.index}
            class:drag-over-before={dragOverIndex === r.index && dragOverSide === 'before'}
            class:drag-over-after={dragOverIndex === r.index && dragOverSide === 'after'}
            draggable={editMode ? 'true' : 'false'}
            ondragstart={(e) => onDragStart(e, r.index)}
            ondragover={(e) => onDragOver(e, r.index)}
            ondragleave={onDragLeave}
            ondrop={(e) => onDrop(e, r.index)}
            ondragend={onDragEnd}
          >
            <span class="qa-ghost-text">
              {ctx.i18n.t('quickAccess.providerMissing')} · {r.item.type} · {r.item.provider}
            </span>
            {#if editMode}
              <button
                class="qa-x"
                onclick={() => removeChip(r.item.instanceId)}
                ondragstart={blockDrag}
                ondragover={blockDrag}
                ondrop={blockDrag}
                aria-label={ctx.i18n.t('common.remove')}
              >✕</button>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  </div>

  {#if editMode}
    <AddChipDialog
      open={dialogOpen}
      placed={chips}
      onClose={() => (dialogOpen = false)}
      onPick={handlePick}
    />
  {/if}
{/if}

<style>
  .quick-access {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    flex-shrink: 0;
    margin-bottom: var(--space-sm);
  }
  .quick-access.edit {
    outline: 1px dashed var(--border-color);
    outline-offset: 4px;
    border-radius: var(--radius-md);
    padding: var(--space-xs);
  }
  .qa-toolbar { display: flex; align-items: center; gap: var(--space-sm); }
  .qa-hint { flex: 1; color: var(--text-muted); font-size: var(--font-size-sm); }
  .qa-btn {
    padding: 2px var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  .qa-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .qa-btn.danger { background: var(--danger); border-color: var(--danger); color: var(--accent-text); }
  .qa-cap { color: var(--warning); font-size: var(--font-size-sm); }

  .qa-chips { display: flex; flex-wrap: wrap; gap: var(--space-xs); }
  .qa-chip-wrap {
    position: relative;
    height: 80px;
    display: flex;
    align-items: center;
    transition: transform var(--transition-fast), opacity var(--transition-fast);
  }
  .qa-chip-wrap :global(.host) { height: 80px; }

  /* Edit-mode: аффордансы DnD (HTML5) */
  .quick-access.edit .qa-chip-wrap { cursor: grab; }
  .quick-access.edit .qa-chip-wrap.dragging {
    cursor: grabbing;
    opacity: 0.35;
    transform: scale(0.97);
  }
  /* Drop-индикатор: рамка на цели + акцентная полоса с нужной стороны */
  .quick-access.edit .qa-chip-wrap.drag-over-before,
  .quick-access.edit .qa-chip-wrap.drag-over-after {
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
  .quick-access.edit .qa-chip-wrap.drag-over-before::before,
  .quick-access.edit .qa-chip-wrap.drag-over-after::after {
    content: '';
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 3px;
    background: var(--accent);
    border-radius: 2px;
    pointer-events: none;
  }
  .quick-access.edit .qa-chip-wrap.drag-over-before::before { left: -6px; }
  .quick-access.edit .qa-chip-wrap.drag-over-after::after  { right: -6px; }

  .qa-x {
    position: absolute; top: -6px; right: -6px; z-index: 5;
    width: 16px; height: 16px; border-radius: 50%; border: none;
    background: var(--danger); color: var(--accent-text); font-size: 10px; line-height: 1;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
  }
  .qa-chip-wrap.ghost {
    padding: 0 var(--space-sm);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }
  .qa-ghost-text { font-family: monospace; font-size: 11px; }
</style>