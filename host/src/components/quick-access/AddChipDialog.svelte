<script lang="ts">
  import type { PluginApi } from '../../../../plugin-sdk/src/types';
  import type { QuickChipLayoutItem } from '../../../../plugin-sdk/src/types';

  import { getAppContext } from '../../app-context';
  import { createPluginApi } from '../../core/plugin-api-factory';
  import PluginElementHost from '../plugin-element-host.svelte';

  let {
    open,
    placed,
    onClose,
    onPick,
  }: {
    open: boolean;
    placed: QuickChipLayoutItem[];
    onClose: () => void;
    onPick: (type: string, provider: string, id: string, label?: string) => void;
  } = $props();

  const ctx = getAppContext();

  let printerId = $derived(ctx.printerManager.activePrinterId);
  let contributions = $derived(
    ctx.registry
      .getChips()
      .filter((c) => ctx.loader.pluginAppliesToPrinter(c.pluginId, printerId ?? '')),
  );

  let bodyEl = $state<HTMLDivElement | null>(null);

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

  /** Уже размещённые id предмета — подсказка picker'у (может скрыть занятые). */
  function placedIdsFor(type: string, provider: string): string {
    return JSON.stringify(
      placed.filter((p) => p.type === type && p.provider === provider).map((p) => p.id),
    );
  }

  // Единственный слушатель выбора: picker-элементы плагинов диспатчат
  // баблящий CustomEvent 'mpu:chip-pick' (преседент mpu:banner-expand в AppMain).
  // type/provider берём НЕ из события, а из dataset-обёртки секции.
  $effect(() => {
    const el = bodyEl;
    if (!el || !open) return;

    function onPickEvent(e: Event): void {
      const ce = e as CustomEvent<{ id?: unknown; label?: unknown }>;
      const wrap = (e.target as HTMLElement).closest('[data-chip-type]') as HTMLElement | null;
      if (!wrap) return;
      const type = wrap.dataset.chipType;
      const provider = wrap.dataset.chipProvider;
      const id = ce.detail?.id;
      if (!type || !provider || typeof id !== 'string' || id.length === 0) return;
      const label =
        typeof ce.detail?.label === 'string' && ce.detail.label.length > 0
          ? ce.detail.label
          : undefined;
      onPick(type, provider, id, label);
    }

    el.addEventListener('mpu:chip-pick', onPickEvent);
    return () => el.removeEventListener('mpu:chip-pick', onPickEvent);
  });
</script>

{#if open}
  <div class="dialog-backdrop" onclick={onClose} role="presentation"></div>

  <div class="dialog" role="dialog" aria-label={ctx.i18n.t('quickAccess.addChip')}>
    <div class="dialog-header">
      <h3>{ctx.i18n.t('quickAccess.addChip')}</h3>
      <button class="dialog-close" onclick={onClose}>✕</button>
    </div>

    <div class="dialog-body" bind:this={bodyEl}>
      {#if contributions.length === 0}
        <p class="dialog-empty">{ctx.i18n.t('quickAccess.empty')}</p>
      {:else}
        {#each contributions as c (`${c.pluginId}:${c.contribution.type}`)}
          {@const api = apiFor(c.pluginId)}
          {#if api}
            <section
              class="picker-section"
              data-chip-type={c.contribution.type}
              data-chip-provider={c.contribution.provider}
            >
              <div class="picker-head">
                <h4>{ctx.i18n.t(c.contribution.titleKey)}</h4>
                <span class="picker-meta">{c.contribution.provider}</span>
              </div>
              <PluginElementHost
                tag={c.contribution.pickerElement}
                {api}
                params={{ edit: '1', placed: placedIdsFor(c.contribution.type, c.contribution.provider) }}
                fill={false}
              />
            </section>
          {/if}
        {/each}
      {/if}
    </div>

    <div class="dialog-footer">
      <button class="btn btn-primary" onclick={onClose}>
        {ctx.i18n.t('dashboard.done')}
      </button>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop { position: fixed; inset: 0; background: var(--bg-overlay); z-index: 200; }
  .dialog {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 90%; max-width: 520px; max-height: 80vh;
    display: flex; flex-direction: column;
    background: var(--bg-surface); border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg); z-index: 201; overflow: hidden;
  }
  .dialog-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-md) var(--space-lg);
    border-bottom: 1px solid var(--border-color);
  }
  .dialog-header h3 { font-size: var(--font-size-lg); font-weight: 600; }
  .dialog-close { border: none; background: transparent; color: var(--text-muted); cursor: pointer; font-size: var(--font-size-lg); padding: var(--space-xs); }
  .dialog-body { flex: 1; overflow-y: auto; padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-lg); }
  .dialog-empty { color: var(--text-muted); text-align: center; padding: var(--space-xl); }
  .picker-section { display: flex; flex-direction: column; gap: var(--space-sm); }
  .picker-head { display: flex; align-items: baseline; gap: var(--space-sm); }
  .picker-head h4 { font-size: var(--font-size-md); font-weight: 600; }
  .picker-meta { font-family: monospace; font-size: var(--font-size-sm); color: var(--text-muted); margin-inline-start: auto; }
  .dialog-footer {
    display: flex; justify-content: flex-end; gap: var(--space-sm);
    padding: var(--space-md) var(--space-lg);
    border-top: 1px solid var(--border-color);
  }
  .btn { padding: var(--space-sm) var(--space-lg); border: none; border-radius: var(--radius-md); font-size: var(--font-size-md); cursor: pointer; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-hover); }
</style>