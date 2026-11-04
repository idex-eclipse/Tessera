<script lang="ts">
  import { ExtensionPoint, usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import type { ExtensionRef } from '../../../../plugin-sdk/src/types';

  import Tabs, { type TabItem } from '../../../shared/tabs/Tabs.svelte';
  import { worstSeverity } from '../../health-utils';
  import { SYSTEM_TABS, systemUiState } from '../../system-ui-state.svelte.ts';
  import { useHealth } from '../../use-health.svelte.ts';
  import { useSystem } from '../../use-system.svelte.ts';
  import HealthStrip from './health/HealthStrip.svelte';
  import MaintenanceTab from './MaintenanceTab.svelte';
  import MonitoringTab from './MonitoringTab.svelte';
  import OverviewTab from './OverviewTab.svelte';

  let { params = {} }: { params?: Record<string, string> } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useSystem(api);
  const health = useHealth(api);

  // hotkey Alt+R: обновить данные страницы
  let lastRefreshSeq = systemUiState.refreshSeq;
  $effect(() => {
    const seq = systemUiState.refreshSeq;
    if (seq === lastRefreshSeq) return;
    lastRefreshSeq = seq;
    void store.refresh();
    void health.refresh();
  });

  let worst = $derived(
    worstSeverity(health.summary.host, health.summary.mcu, health.summary.drivers),
  );

  // Extension point `tabs` (append): extra tabs contributed by other plugins. Re-read on any
  // registry change (plugin enabled/disabled, availability, conflict resolution).
  let extVersion = $state(0);
  $effect(() => api.extensions.onChange(() => extVersion++));
  let extTabs = $derived.by<ExtensionRef[]>(() => {
    void extVersion;
    return api.extensions.list('tabs');
  });

  let tabs = $derived<TabItem[]>([
    ...SYSTEM_TABS.map((id) => ({
      id,
      label: i18n.t(`system.tabs.${id}`),
      badge: id === 'monitoring' && (worst === 'warn' || worst === 'crit') ? worst : null,
      badgeLabel: id === 'monitoring' ? i18n.t('system.health.attention') : undefined,
    })),
    // the extension ref (`<plugin>/<id>`) doubles as the tab id
    ...extTabs.map((t) => ({ id: t.ref, label: t.title })),
  ]);

  // Deep link ?section=<builtin id> or ?section=<plugin>/<id>; unknown values are ignored.
  // Applied once per value: `tabs` is recomputed on every health badge change, and re-applying
  // the link then would snap the user back from the tab they picked by hand. An extension tab
  // may resolve later than the page opens, so the link stays pending until its tab exists.
  let appliedSection = '';
  $effect(() => {
    const s = params.section;
    if (!s || s === appliedSection || !tabs.some((t) => t.id === s)) return;
    appliedSection = s;
    systemUiState.activeTab = s;
  });

  // An extension tab can disappear (extension disabled, availability changed): fall back
  // to the first built-in tab instead of rendering an empty body.
  $effect(() => {
    if (!tabs.some((t) => t.id === systemUiState.activeTab)) systemUiState.activeTab = 'overview';
  });

  function select(id: string): void {
    if (tabs.some((t) => t.id === id)) systemUiState.activeTab = id;
  }
</script>

<!-- та же компоновка, что у страницы Calibrations: карточка → ряд вкладок → тело с панелями -->
<div class="card">
  <Tabs {tabs} active={systemUiState.activeTab} onSelect={select} label={i18n.t('system.tabs.label')}>
    {#snippet trailing()}
      <HealthStrip summary={health.summary} onOpen={() => (systemUiState.activeTab = 'monitoring')} />
    {/snippet}

    <div class="body">
      <!-- Each built-in tab body is replaceable as a whole (tab-* points); the tab button stays. -->
      {#if systemUiState.activeTab === 'monitoring'}
        <ExtensionPoint point="tab-monitoring">
          {#snippet original()}<MonitoringTab />{/snippet}
        </ExtensionPoint>
      {:else if systemUiState.activeTab === 'maintenance'}
        <ExtensionPoint point="tab-maintenance">
          {#snippet original()}<MaintenanceTab />{/snippet}
        </ExtensionPoint>
      {:else if systemUiState.activeTab === 'overview'}
        <ExtensionPoint point="tab-overview">
          {#snippet original()}<OverviewTab />{/snippet}
        </ExtensionPoint>
      {:else}
        <ExtensionPoint point="tabs" only={systemUiState.activeTab} />
      {/if}
    </div>
  </Tabs>
</div>

<style>
  :global(mpu-system-page) {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 100%;
  }

  .card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .body {
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    min-height: 0;
  }
</style>
