<script lang="ts">
  import { ExtensionPoint, usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import type { ExtensionRef } from '../../../../plugin-sdk/src/types';
  import { useCalibrations } from '../../use-calibrations.svelte.ts';
  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte.ts';
  import KlipperNotReady from '../../../shared/klippy-state/KlippyNotReady.svelte';

  import ProbeContent from '../panels/Probe/ProbeContent.svelte';

  import LiveZContent from '../panels/LiveZ/LiveZContent.svelte';

  import PidContent from '../panels/Heaters/PidContent.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useCalibrations(api);
  const klippy = useKlippyState(api);

  type BuiltinTab = 'probe' | 'livez' | 'pid';
  /** Встроенная вкладка или ref вкладки дополнения (точка widget-tabs). */
  type Tab = BuiltinTab | string;
  let tab = $state<Tab>('livez');

  // Точка widget-tabs (append) — вкладки дополнений.
  let extVersion = $state(0);
  $effect(() => api.extensions.onChange(() => extVersion++));
  let extTabs = $derived.by<ExtensionRef[]>(() => {
    void extVersion;
    return api.extensions.list('widget-tabs');
  });

  // шейперов в виджете нет: графикам там не место
  let tabs = $derived.by<Array<{ id: Tab; label: string }>>(() => [
    ...[
      { id: 'livez', label: i18n.t('calibrations.liveZ.tab'), show: true },
      { id: 'probe', label: i18n.t('calibrations.section.probe'), show: true },
      { id: 'pid', label: i18n.t('calibrations.section.pid'), show: store.state.hasPid && store.state.heaters.length > 0 },
    ].filter((t) => t.show),
    ...extTabs.map((t) => ({ id: t.ref, label: t.title })),
  ]);

  $effect(() => {
    if (!tabs.some((t) => t.id === tab)) tab = tabs[0]?.id ?? 'probe';
  });

  let helpTitle = $derived.by(() => {
    if (tab === 'livez') return i18n.t('calibrations.liveZ.title');
    if (tab === 'pid') return i18n.t('calibrations.section.pid');
    return i18n.t('calibrations.section.probe');
  });
</script>

<div class="widget">
  {#if !klippy.ready}
    <div class="gate"><KlipperNotReady /></div>
  {:else}
    <div class="tabrow">
      <div class="tabs" role="tablist">
        {#each tabs as t (t.id)}
          <button class="tab" class:active={tab === t.id} role="tab" aria-selected={tab === t.id} onclick={() => (tab = t.id)}>
            {t.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="body">
      {#if tab === 'probe'}
        <ExtensionPoint point="widget-probe">
          {#snippet original()}<ProbeContent />{/snippet}
        </ExtensionPoint>
      {:else if tab === 'livez'}
        <ExtensionPoint point="widget-livez">
          {#snippet original()}<LiveZContent />{/snippet}
        </ExtensionPoint>
      {:else if tab === 'pid'}
        <ExtensionPoint point="widget-pid">
          {#snippet original()}<PidContent />{/snippet}
        </ExtensionPoint>
      {:else}
        <ExtensionPoint point="widget-tabs" only={tab} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .widget {
    display: flex; flex-direction: column; height: 100%; min-height: 0;
    background: var(--bg-surface); border: 1px solid var(--border-color);
    border-radius: var(--radius-md); box-shadow: var(--shadow-sm); overflow: hidden;
  }
  .gate { flex: 1; display: flex; align-items: center; justify-content: center; padding: var(--space-md); }
  .tabrow {
    display: flex; align-items: center; gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm) 0; border-bottom: 1px solid var(--border-color); flex-shrink: 0;
  }
  .tabs { display: flex; gap: 2px; flex: 1; min-width: 0; overflow-x: auto; }
  .tab {
    padding: var(--space-xs) var(--space-sm); border: none; background: transparent;
    color: var(--text-secondary); font-size: var(--font-size-sm);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0; cursor: pointer; white-space: nowrap;
  }
  .tab:hover { background: var(--bg-surface-hover); }
  .tab.active { background: var(--bg-surface-active); color: var(--accent); font-weight: 600; }
  .body { flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-sm) var(--space-md) var(--space-md); }

  /* container: вложенные панели (Probe/LiveZ/PID) адаптируются по ширине виджета */
  :global(mpu-calibrations-widget) { display: block; height: 100%; container-type: inline-size; }

  @container (max-width: 480px) {
    .body { padding: var(--space-xs) var(--space-sm) var(--space-sm); }
    .tab { min-height: 36px; }
  }
</style>