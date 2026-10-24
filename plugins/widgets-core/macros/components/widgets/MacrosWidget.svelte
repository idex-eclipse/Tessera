<script lang="ts">
  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../../shared/icons/Icon.svelte';
  import ConfirmDialog from '../../../../shared/confirm-dialog.svelte';
  import ColorPickerMenu from '../../../../shared/color-picker/ColorPickerMenu.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';

  import { useMacros } from '../../use-macros.svelte.ts';
  import MacroParamsMenu from '../MacroParamsMenu.svelte';
  import { buildMacroScript } from '../../../../shared/macro-params.ts';
  import { isRtl } from '../../../../shared/popover-align';

  const api = useWidget();
  const i18n = useI18n();
  const store = useMacros(api);
  const klippy = useKlippyState(api);

  // ---------------- tooltip ----------------
  let tip = $state<{ name: string; x: number; y: number } | null>(null);

  function showTip(e: MouseEvent, name: string): void {
    if (store.editMode || !store.cfg.ui.tooltips) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    tip = { name, x: r.left, y: r.bottom + 6 };
  }

  function hideTip(): void {
    tip = null;
  }

  // ---------------- confirm запуска / удаления группы ----------------
  let confirmRun = $state<string | null>(null);
  let confirmGroup = $state<{ id: string; name: string } | null>(null);

  function clickMacro(e: MouseEvent, name: string): void {
    hideTip();
    if (store.editMode) {
      openPop(e, name);
      return;
    }
    const item = store.itemOf(name);
    if (item.confirm) confirmRun = name;
    else store.run(name);
  }

  // ---------------- Live DnD ----------------
  let dragPayload = $state<string | null>(null);
  let dragOverHidden = $state(false);

  function dragStart(e: DragEvent, name: string): void {
    dragPayload = name;
    e.dataTransfer?.setData('text/plain', name);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function dragStartGroup(e: DragEvent, id: string): void {
    dragPayload = 'grp:' + id;
    e.dataTransfer?.setData('text/plain', 'grp:' + id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  /** Завершение перетаскивания: persist текущего порядка. */
  function endDrag(): void {
    if (dragPayload) store.commit();
    dragPayload = null;
    dragOverHidden = false;
  }

  function dropCommit(e: DragEvent): void {
    e.preventDefault();
    endDrag();
  }

  /** Макрос: половина кнопки = вставка перед/после. */
  function macroDragOver(e: DragEvent, name: string): void {
    if (!store.editMode || !dragPayload || dragPayload.startsWith('grp:')) return;
    e.preventDefault();
    e.stopPropagation();
    if (dragPayload === name) return;
    const pos = store.containerOf(name);
    if (pos.index < 0) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // в RTL кнопки идут справа налево: «после» — левая половина
    const mid = r.left + r.width / 2;
    const after = isRtl() ? e.clientX < mid : e.clientX > mid;
    store.placeMacroTransient(dragPayload, pos.container, pos.index + (after ? 1 : 0));
  }

  /**
   * Секция группы:
   * - группа: половина высоты = вставка перед/после;
   * - макрос: всегда в конец тела группы (для точного позиционирования наводим на конкретный макрос).
   */
  function groupDragOver(e: DragEvent, groupId: string): void {
    if (!store.editMode || !dragPayload) return;
    e.preventDefault();
    if (dragPayload.startsWith('grp:')) {
      const id = dragPayload.slice(4);
      if (id === groupId) return;
      const idx = store.cfg.groups.findIndex((g) => g.id === groupId);
      if (idx < 0) return;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      store.moveGroupTransient(id, idx + (after ? 1 : 0));
    } else {
      const len = store.cfg.groups.find((g) => g.id === groupId)?.macros.length ?? 0;
      store.placeMacroTransient(dragPayload, groupId, len);
    }
  }

  function ungroupedDragOver(e: DragEvent): void {
    if (!store.editMode || !dragPayload || dragPayload.startsWith('grp:')) return;
    e.preventDefault();
    store.placeMacroTransient(dragPayload, '', store.cfg.ungrouped.length);
  }

  function hiddenDragOver(e: DragEvent): void {
    if (!store.editMode || !dragPayload || dragPayload.startsWith('grp:')) return;
    e.preventDefault();
    dragOverHidden = true;
  }

  function hiddenDrop(e: DragEvent): void {
    e.preventDefault();
    if (dragPayload && !dragPayload.startsWith('grp:')) {
      store.setHidden(dragPayload, true);
    }
    endDrag();
  }

  // ---------------- popover с flip ----------------
  let pop = $state<{ name: string; ax: number; ar: number; aTop: number; aBottom: number } | null>(null);
  let popEl = $state<HTMLDivElement | null>(null);
  let popPos = $state({ x: -9999, y: -9999 });
  let popItem = $derived(pop ? store.itemOf(pop.name) : null);

  function openPop(e: MouseEvent, name: string): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    popPos = { x: -9999, y: -9999 };
    pop = { name, ax: r.left, ar: r.right, aTop: r.top, aBottom: r.bottom };
  }

  $effect(() => {
    if (!pop || !popEl) return;
    const w = popEl.offsetWidth;
    const h = popEl.offsetHeight;
    // выравнивание по «начальному» краю кнопки (в RTL — по правому)
    const preferred = isRtl() ? pop.ar - w : pop.ax;
    const x = Math.max(8, Math.min(preferred, window.innerWidth - w - 8));
    let y = pop.aBottom + 6;
    if (y + h > window.innerHeight - 8) {
      y = pop.aTop - h - 6;
      if (y < 8) y = 8;
    }
    popPos = { x, y };
  });

  function borderStyle(color?: string | null): string {
    return color ? `border-color: ${color}` : '';
  }

  // ---------------- меню параметров (шеврон split-кнопки) ----------------
  let paramsMenu = $state<{
    name: string;
    anchor: { left: number; right: number; top: number; bottom: number };
  } | null>(null);

  function openParams(e: MouseEvent, name: string): void {
    e.stopPropagation();
    hideTip();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    paramsMenu = { name, anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } };
  }

  function runWithParams(vals: Record<string, string>): void {
    if (!paramsMenu) return;
    const params = store.paramsByMacro[paramsMenu.name] ?? [];
    store.run(buildMacroScript(paramsMenu.name, params, vals));
    paramsMenu = null;
  }
</script>

{#snippet macroBtn(name: string, ghost: boolean)}
  {@const item = store.itemOf(name)}
  {@const mparams = store.paramsByMacro[name] ?? []}
  {@const split = mparams.length > 0 && !store.editMode}
  <span class="mb-split">
    <button
      class="macro-btn"
      class:ghost
      class:colored={!!item.color}
      class:split-main={split}
      style={borderStyle(item.color)}
      draggable={store.editMode}
      disabled={!store.editMode && !klippy.ready}
      title={!store.editMode && !klippy.ready ? i18n.t('common.klipperNotReady') : undefined}
      onclick={(e) => clickMacro(e, name)}
      ondragstart={(e) => dragStart(e, name)}
      ondragend={endDrag}
      ondragover={(e) => macroDragOver(e, name)}
      ondrop={dropCommit}
      onmouseenter={(e) => showTip(e, name)}
      onmouseleave={hideTip}
    >
      <bdi>{item.alias || name}</bdi>
    </button>
    {#if split}
      <button
        class="macro-btn-chev"
        disabled={!klippy.ready}
        title={!klippy.ready ? i18n.t('common.klipperNotReady') : i18n.t('widgets.macros.paramsOpen')}
        onclick={(e) => openParams(e, name)}
      >
        <Icon name="chevron-down" size={13} />
      </button>
    {/if}
  </span>
{/snippet}

{#if store.liveNames.length === 0}
  <p class="empty">{i18n.t('widgets.macros.empty')}</p>
{:else}
  <div class="macros">
    {#each store.viewGroups() as g (g.id)}
      <section class="grp" ondragover={(e) => groupDragOver(e, g.id)} ondrop={dropCommit}>
        {#if store.editMode}
          <header class="grp-head edit">
            <span
              class="grip"
              draggable="true"
              title={i18n.t('widgets.macros.dragGroup')}
              ondragstart={(e) => dragStartGroup(e, g.id)}
              ondragend={endDrag}
            >
              <Icon name="grip" size={14} />
            </span>
            <input
              class="grp-input"
              value={g.name}
              onchange={(e) => store.renameGroup(g.id, e.currentTarget.value)}
            />
            <button
              class="grp-del"
              title={i18n.t('widgets.macros.deleteGroup')}
              onclick={() => (confirmGroup = { id: g.id, name: g.name })}
            >
              <Icon name="x" size={14} />
            </button>
          </header>
        {:else}
          <header class="grp-head">
            <button class="grp-toggle" onclick={() => store.toggleCollapsed(g.id)}>
              <span class="chev" class:open={!g.collapsed}>
                <Icon name="chevron-down" size={14} />
              </span>
              <bdi class="grp-name">{g.name}</bdi>
              <span class="grp-count">{g.macros.length}</span>
            </button>
          </header>
        {/if}

        {#if store.editMode || !g.collapsed}
          <div class="grp-body">
            {#each g.macros as name (name)}
              {@render macroBtn(name, false)}
            {/each}
          </div>
        {/if}
      </section>
    {/each}

    {#if store.editMode}
      <button class="add-group" onclick={() => store.addGroup(i18n.t('widgets.macros.newGroup'))}>
        <Icon name="plus" size={14} />
        {i18n.t('widgets.macros.addGroup')}
      </button>
    {/if}

    <!-- Без группы -->
    <section class="grp" ondragover={ungroupedDragOver} ondrop={dropCommit}>
      <header class="grp-head">
        <button class="grp-toggle" onclick={() => store.toggleUngrouped()}>
          <span class="chev" class:open={store.editMode || !store.cfg.ui.ungroupedCollapsed}>
            <Icon name="chevron-down" size={14} />
          </span>
          <span class="grp-name">{i18n.t('widgets.macros.ungrouped')}</span>
          <span class="grp-count">{store.ungrouped().length}</span>
        </button>
      </header>

      {#if store.editMode || !store.cfg.ui.ungroupedCollapsed}
        <div class="grp-body">
          {#each store.ungrouped() as name (name)}
            {@render macroBtn(name, false)}
          {/each}
        </div>
      {/if}
    </section>

    {#if store.editMode}
      <section
        class="grp hidden-grp"
        class:drag-over={dragOverHidden}
        ondragover={hiddenDragOver}
        ondragleave={() => (dragOverHidden = false)}
        ondrop={hiddenDrop}
      >
        <header class="grp-head">
          <span class="grp-static">{i18n.t('widgets.macros.hidden')}</span>
        </header>
        <div class="grp-body">
          {#each store.hiddenList() as name (name)}
            {@render macroBtn(name, true)}
          {/each}
        </div>
      </section>
    {/if}
  </div>
{/if}

{#if tip}
  <div class="tip" style:left="{Math.max(8, Math.min(tip.x, window.innerWidth - 288))}px" style:top="{tip.y}px">
    <div class="tip-name">{store.itemOf(tip.name).alias || tip.name}</div>
    {#if store.help[tip.name]}
      <div class="tip-desc" dir="auto">{store.help[tip.name]}</div>
    {/if}
  </div>
{/if}

{#if pop && popItem}
  <div class="pop-backdrop" onclick={() => (pop = null)} role="presentation"></div>
  <div
    class="pop"
    bind:this={popEl}
    style:left="{popPos.x}px"
    style:top="{popPos.y}px"
  >
    <label class="pop-field">
      <span>{i18n.t('widgets.macros.alias')}</span>
      <input
        type="text"
        value={popItem.alias ?? ''}
        placeholder={pop.name}
        onchange={(e) => store.setAlias(pop.name, e.currentTarget.value)}
      />
    </label>

    <div class="pop-field row">
      <span>{i18n.t('widgets.macros.color')}</span>
      <ColorPickerMenu
        value={popItem.color ?? null}
        i18n={i18n}
        onPick={(hex) => store.setColor(pop.name, hex)}
      />
    </div>

    <label class="pop-check">
      <input
        type="checkbox"
        checked={store.isHidden(pop.name)}
        onchange={(e) => store.setHidden(pop.name, e.currentTarget.checked)}
      />
      {i18n.t('widgets.macros.hide')}
    </label>

    <label class="pop-check">
      <input
        type="checkbox"
        checked={popItem.confirm === true}
        onchange={(e) => store.setConfirm(pop.name, e.currentTarget.checked)}
      />
      {i18n.t('widgets.macros.confirm')}
    </label>

    <label class="pop-field">
      <span>{i18n.t('widgets.macros.group')}</span>
      <select
        value={store.groupOf(pop.name)}
        onchange={(e) => store.moveMacro(pop.name, e.currentTarget.value)}
      >
        <option value="">{i18n.t('widgets.macros.ungrouped')}</option>
        {#each store.cfg.groups as g (g.id)}
          <option value={g.id}>{g.name}</option>
        {/each}
      </select>
    </label>
  </div>
{/if}

<ConfirmDialog
  open={confirmRun !== null}
  title={i18n.t('widgets.macros.confirmTitle')}
  message={i18n.t('widgets.macros.confirmRun', { name: confirmRun ?? '' })}
  confirmLabel={i18n.t('widgets.macros.run')}
  danger={false}
  onConfirm={() => {
    if (confirmRun) store.run(confirmRun);
  }}
  onClose={() => (confirmRun = null)}
/>

<ConfirmDialog
  open={confirmGroup !== null}
  title={i18n.t('widgets.macros.deleteGroup')}
  message={i18n.t('widgets.macros.confirmDeleteGroup', { name: confirmGroup?.name ?? '' })}
  confirmLabel={i18n.t('widgets.macros.deleteGroup')}
  danger={true}
  onConfirm={() => {
    if (confirmGroup) store.deleteGroup(confirmGroup.id);
  }}
  onClose={() => (confirmGroup = null)}
/>

{#if paramsMenu}
  <MacroParamsMenu
    name={paramsMenu.name}
    params={store.paramsByMacro[paramsMenu.name] ?? []}
    anchor={paramsMenu.anchor}
    onRun={runWithParams}
    onClose={() => (paramsMenu = null)}
  />
{/if}

<style>
  .empty {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
    padding: var(--space-md);
  }

  :global(mpu-widgets-macros) {
    display: block;
    height: 100%;
  }

  .macros {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    height: 100%;
    overflow-y: auto;
    min-height: 0;
    padding: var(--space-xs);
  }

  .grp {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface-hover-no-override);
  }

  .grp-head {
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-surface);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }

  .grp-head.edit {
    padding: var(--space-xs) var(--space-sm);
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }

  .grp-head:last-child {
    border-radius: var(--radius-md);
    border-bottom: none;
  }

  .grp-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    width: 100%;
    padding: var(--space-xs) var(--space-sm);
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-weight: 600;
  }

  .grp-toggle:hover {
    background: var(--bg-surface-hover);
  }

  .grp-static {
    display: block;
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .grp-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-app);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .grip {
    display: flex;
    align-items: center;
    padding: 0 var(--space-xs);
    color: var(--text-muted);
    cursor: grab;
    flex-shrink: 0;
  }

  .grip:active {
    cursor: grabbing;
    color: var(--text-primary);
  }

  .grp-del {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }

  .grp-del:hover {
    background: color-mix(in srgb, var(--danger) 15%, transparent);
    color: var(--danger);
  }

  .chev {
    display: flex;
    color: var(--text-muted);
    transform: rotate(-90deg);
    transition: transform var(--transition-fast);
  }

  /* свёрнутая группа: шеврон смотрит в сторону чтения (в RTL — влево) */
  :global([dir='rtl']) .chev:not(.open) {
    transform: rotate(90deg);
  }

  .chev.open {
    transform: rotate(0deg);
  }

  .grp-name {
    flex: 1;
    text-align: start;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grp-count {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    font-weight: 400;
  }

  .grp-body {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    padding: var(--space-sm);
    min-height: 34px;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
  }

  .macro-btn {
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .macro-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .macro-btn:hover {
    background: var(--bg-surface-active);
  }

  .macro-btn.colored {
    border-width: 1px;
    border-style: solid;
  }

  .macro-btn.ghost {
    opacity: 0.45;
  }

  .mb-split {
    display: inline-flex;
    align-items: stretch;
    max-width: 100%;
  }

  .macro-btn.split-main {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
  }

  .macro-btn-chev {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    border: 1px solid var(--border-color);
    border-inline-start: none;
    border-start-end-radius: var(--radius-sm);
    border-end-end-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    cursor: pointer;
    flex-shrink: 0;
  }

  .macro-btn-chev:hover:not(:disabled) {
    background: var(--bg-surface-active);
    color: var(--text-primary);
  }

  .macro-btn-chev:disabled { opacity: 0.5; cursor: not-allowed; }

  .hidden-grp {
    border-style: dashed;
  }

  .hidden-grp.drag-over {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .add-group {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .add-group:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .tip {
    position: fixed;
    z-index: 470;
    max-width: 280px;
    padding: var(--space-xs) var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    pointer-events: none;
  }

  .tip-name {
    font-family: monospace;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .tip-desc {
    margin-top: 2px;
    font-size: 12px;
    color: var(--text-secondary);
    white-space: pre-wrap;
  }

  .pop-backdrop {
    position: fixed;
    inset: 0;
    z-index: 460;
    background: transparent;
  }

  .pop {
    position: fixed;
    z-index: 461;
    width: 260px;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .pop-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .pop-field.row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .pop-field input[type='text'],
  .pop-field select {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-app);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .pop-check {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

</style>