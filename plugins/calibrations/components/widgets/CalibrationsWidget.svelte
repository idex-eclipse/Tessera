<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import { useCalibrations } from '../../use-calibrations.svelte.ts';
  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte.ts';
  import KlipperNotReady from '../../../shared/klippy-state/KlippyNotReady.svelte';

  import ProbeContent from '../panels/Probe/ProbeContent.svelte';

  import LiveZContent from '../panels/LiveZ/LiveZContent.svelte';

  import PidContent from '../panels/Heaters/PidContent.svelte';

  import MeshContent from '../panels/Mesh/MeshContent.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useCalibrations(api);
  const klippy = useKlippyState(api);

  type Tab = 'probe' | 'livez' | 'pid';
  let tab = $state<Tab>('livez');

  // шейперов в виджете нет: графикам там не место
  let tabs = $derived.by(() =>
    [
      { id: 'livez' as Tab, label: i18n.t('calibrations.liveZ.tab'), show: true },
      { id: 'probe' as Tab, label: i18n.t('calibrations.section.probe'), show: true },
      { id: 'pid' as Tab, label: i18n.t('calibrations.section.pid'), show: store.state.hasPid && store.state.heaters.length > 0 },
    ].filter((t) => t.show),
  );

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
      {#if tab === 'probe'}<ProbeContent />
      {:else if tab === 'livez'}<LiveZContent />
      {:else if tab === 'pid'}<PidContent />
      {:else}<MeshContent />
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
</style>