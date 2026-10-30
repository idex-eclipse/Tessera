<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import { useSystem } from '../../use-system.svelte.ts';
  import KvTable from './KvTable.svelte';
  import Panel from './Panel.svelte';
  import ProcCharts from './ProcCharts.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useSystem(api);

  function fmtMemGb(kb: number | null): string {
    if (kb == null) return '—';
    return `${(kb / 1024 / 1024).toFixed(1)} GiB`;
  }

  let infoRows = $derived([
    { k: i18n.t('system.info.hostname'), v: store.systemInfo.hostname || '—' },
    { k: i18n.t('system.info.os'), v: store.systemInfo.osName || '—' },
    { k: i18n.t('system.info.kernel'), v: store.systemInfo.kernel || '—' },
    {
      k: i18n.t('system.info.cpu'),
      v:
        store.systemInfo.cpuCount > 0
          ? `${store.systemInfo.cpuCount}× ${store.systemInfo.cpuDesc}`
          : '—',
    },
    { k: i18n.t('system.info.memory'), v: fmtMemGb(store.systemInfo.totalMemoryKb) },
    { k: i18n.t('system.info.python'), v: store.systemInfo.python || '—' },
    { k: i18n.t('system.info.moonrakerVersion'), v: store.systemInfo.moonrakerVersion || '—' },
    { k: i18n.t('system.info.klipperVersion'), v: store.klipper.softwareVersion || '—' },
  ]);

  let sdRows = $derived(
    Object.entries(store.systemInfo.sdInfo ?? {}).map(([k, v]) => ({
      k,
      v: typeof v === 'object' ? JSON.stringify(v) : String(v),
    })),
  );
</script>

<div class="page">
  <div class="col">
    <Panel title={i18n.t('system.info.title')}>
      <KvTable rows={infoRows} />

      {#if store.systemInfo.network.length > 0}
        <div class="sub-title">{i18n.t('system.info.network')}</div>
        <div class="net-list">
          {#each store.systemInfo.network as n (n.iface)}
            <span class="net-chip" title={n.iface} dir="ltr">
              <span class="net-iface">{n.iface}</span>
              <span class="net-ip">{n.ip}</span>
            </span>
          {/each}
        </div>
      {/if}
    </Panel>

    {#if sdRows.length > 0}
      <Panel title={i18n.t('system.info.sdTitle')}>
        <KvTable rows={sdRows} />
      </Panel>
    {/if}
  </div>

  <div class="col">
    <Panel title={i18n.t('system.charts.title')}>
      <ProcCharts />
    </Panel>
  </div>
</div>

<style>
  .page {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: var(--space-md);
    align-items: start;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    min-width: 0;
  }

  .sub-title {
    margin-top: var(--space-xs);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .net-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }

  .net-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding: 2px var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    font-size: 11px;
    font-family: monospace;
  }

  .net-iface {
    color: var(--text-secondary);
  }

  .net-ip {
    color: var(--text-primary);
  }
</style>
