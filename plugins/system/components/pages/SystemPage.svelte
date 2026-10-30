<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import Tabs, { type TabItem } from '../../../shared/tabs/Tabs.svelte';
  import { worstSeverity } from '../../health-utils';
  import { SYSTEM_TABS, systemUiState, type SystemTab } from '../../system-ui-state.svelte.ts';
  import { useHealth } from '../../use-health.svelte.ts';
  import { useSystem } from '../../use-system.svelte.ts';
  import HealthStrip from './health/HealthStrip.svelte';
  import MaintenanceTab from './MaintenanceTab.svelte';
  import MonitoringTab from './MonitoringTab.svelte';
  import OverviewTab from './OverviewTab.svelte';

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

  let tabs = $derived<TabItem[]>(
    SYSTEM_TABS.map((id) => ({
      id,
      label: i18n.t(`system.tabs.${id}`),
      badge: id === 'monitoring' && (worst === 'warn' || worst === 'crit') ? worst : null,
      badgeLabel: id === 'monitoring' ? i18n.t('system.health.attention') : undefined,
    })),
  );

  function select(id: string): void {
    if ((SYSTEM_TABS as readonly string[]).includes(id)) systemUiState.activeTab = id as SystemTab;
  }
</script>

<!-- та же компоновка, что у страницы Calibrations: карточка → ряд вкладок → тело с панелями -->
<div class="card">
  <Tabs {tabs} active={systemUiState.activeTab} onSelect={select} label={i18n.t('system.tabs.label')}>
    {#snippet trailing()}
      <HealthStrip summary={health.summary} onOpen={() => (systemUiState.activeTab = 'monitoring')} />
    {/snippet}

    <div class="body">
      {#if systemUiState.activeTab === 'monitoring'}
        <MonitoringTab />
      {:else if systemUiState.activeTab === 'maintenance'}
        <MaintenanceTab />
      {:else}
        <OverviewTab />
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
