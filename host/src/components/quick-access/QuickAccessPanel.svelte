<script lang="ts">
  import type { PluginApi } from '../../../../plugin-sdk/src/types.ts';
  import type { QuickChipLayoutItem } from '../../../../plugin-sdk/src/types.ts';
  import type { Route } from '../../core/router.svelte.ts';

  import { getAppContext } from '../../app-context.ts';
  import { createPluginApi } from '../../core/plugin-api-factory.ts';
  import PluginElementHost from '../plugin-element-host.svelte';
  import { confirm } from '../confirm/confirm-dialog.svelte.ts';
  import AddChipDialog from './AddChipDialog.svelte';

  let { route }: { route: Route } = $props();

  const ctx = getAppContext();

  /** Мягкий потолок: защита от «второго сайдбара»; константа для ревизий. */
  const QUICK_CHIPS_MAX = 16;

  let editMode = $derived(route.kind === 'dashboard' && route.query.edit === '1');
  let printerId = $derived(ctx.printerManager.activePrinterId);

  let chips = $derived<QuickChipLayoutItem[]>(
    printerId ? ctx.registry.getQuickChips(printerId) : [],
  );
  let contributions = $derived(ctx.registry.getChips());

  let dialogOpen = $state(false);

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

  interface ResolvedChip {
    item: QuickChipLayoutItem;
    element: string | null;   // null = ghost (провайдер исчез/выключен/не для принтера)
    pluginId: string | null;
  }

  let resolved = $derived.by<ResolvedChip[]>(() => {
    const out: ResolvedChip[] = [];
    for (const item of chips) {
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
        item,
        element: applicable ? (reg?.contribution.element ?? null) : null,
        pluginId: applicable ? (reg?.pluginId ?? null) : null,
      });
    }
    return out;
  });

  // Автоскрытие: в view-режиме пустая полоса = ноль footprint;
  // в edit-режиме видна всегда (иначе режим недостижим из нуля).
  let visible = $derived(editMode || resolved.some((r) => r.element !== null));

  /** Контракт чипа: строковый словарь в params (преседент banners). */
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
    // дубль того же предмета не добавляем
    if (chips.some((c) => c.type === type && c.provider === provider && c.id === id)) return;
    ctx.settings.setQuickChips(printerId, [
      ...chips,
      { instanceId: generateInstanceId(), type, provider, id, label },
    ]);
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
            <div class="qa-chip-wrap">
              <PluginElementHost tag={r.element} {api} params={paramsFor(r.item)} fill={false} />
              {#if editMode}
                <button
                  class="qa-x"
                  onclick={() => removeChip(r.item.instanceId)}
                  aria-label={ctx.i18n.t('common.remove')}
                >✕</button>
              {/if}
            </div>
          {/if}
        {:else}
          <div class="qa-chip-wrap ghost">
            <span class="qa-ghost-text">
              {ctx.i18n.t('quickAccess.providerMissing')} · {r.item.type} · {r.item.provider}
            </span>
            {#if editMode}
              <button
                class="qa-x"
                onclick={() => removeChip(r.item.instanceId)}
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
  .qa-btn.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
  .qa-cap { color: var(--warning); font-size: var(--font-size-sm); }

  .qa-chips { display: flex; flex-wrap: wrap; gap: var(--space-xs); }
  .qa-chip-wrap { position: relative; height: 80px; display: flex; align-items: center; }
  /* Контракт размера: хост даёт слот 80px по высоте, ширина по контенту;
     CE чипа обязан растягиваться на 100% высоты слота. */
  .qa-chip-wrap :global(.host) { height: 80px; }
  .qa-x {
    position: absolute; top: -6px; right: -6px; z-index: 5;
    width: 16px; height: 16px; border-radius: 50%; border: none;
    background: var(--danger); color: #fff; font-size: 10px; line-height: 1;
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