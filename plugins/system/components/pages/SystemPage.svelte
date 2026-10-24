<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import Icon from '../../../shared/icons/Icon.svelte';
  import ProcCharts from './ProcCharts.svelte';
  import StoragePanel from './StoragePanel.svelte';
  import UpdatesPanel from './UpdatesPanel.svelte';
  import { useSystem } from '../../use-system.svelte.ts';
  import { systemUiState } from '../../system-ui-state.svelte.ts';
  
  import type { McuModel } from '../../use-system.svelte.ts';

  let mcuDetails = $state<McuModel | null>(null);

  function fmtVal(v: unknown): string {
    if (v == null) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useSystem(api);

  // hotkey Alt+R: обновить данные страницы
  let lastRefreshSeq = systemUiState.refreshSeq;
  $effect(() => {
    const seq = systemUiState.refreshSeq;
    if (seq === lastRefreshSeq) return;
    lastRefreshSeq = seq;
    void store.refresh();
  });

  function fmtMemGb(kb: number | null): string {
    if (kb == null) return '—';
    return `${(kb / 1024 / 1024).toFixed(1)} GiB`;
  }

  function fmtMHz(hz: number | null): string {
    if (hz == null) return '—';
    return `${Math.round(hz / 1e6)} MHz`;
  }

  // ---------------- database ----------------

  let dbBusy = $state('');
  let dbNotice = $state<{ kind: 'ok' | 'fail'; text: string } | null>(null);

  async function dbAction(action: 'compact' | 'backup'): Promise<void> {
    if (dbBusy) return;
    dbBusy = action;
    dbNotice = null;
    try {
      await api.moonraker().request(`server.database.${action}`);
      dbNotice = { kind: 'ok', text: i18n.t('system.database.ok') };
    } catch (e) {
      console.error('[system] database action failed:', action, e);
      dbNotice = { kind: 'fail', text: i18n.t('system.database.fail') };
    } finally {
      dbBusy = '';
    }
  }

  let sdEntries = $derived(Object.entries(store.systemInfo.sdInfo ?? {}));
</script>

<div class="page">
  <div class="col">
    <!-- ================= System information ================= -->
    <section class="panel">
      <header class="panel-header">
        <span class="panel-title">{i18n.t('system.info.title')}</span>
      </header>

      <div class="panel-body">
        <table class="kv">
          <tbody>
            <tr>
              <td class="k">{i18n.t('system.info.hostname')}</td>
              <td class="v">{store.systemInfo.hostname || '—'}</td>
            </tr>
            <tr>
              <td class="k">{i18n.t('system.info.os')}</td>
              <td class="v">{store.systemInfo.osName || '—'}</td>
            </tr>
            <tr>
              <td class="k">{i18n.t('system.info.kernel')}</td>
              <td class="v">{store.systemInfo.kernel || '—'}</td>
            </tr>
            <tr>
              <td class="k">{i18n.t('system.info.cpu')}</td>
              <td class="v">
                {store.systemInfo.cpuCount > 0
                  ? `${store.systemInfo.cpuCount}× ${store.systemInfo.cpuDesc}`
                  : '—'}
              </td>
            </tr>
            <tr>
              <td class="k">{i18n.t('system.info.memory')}</td>
              <td class="v">{fmtMemGb(store.systemInfo.totalMemoryKb)}</td>
            </tr>
            <tr>
              <td class="k">{i18n.t('system.info.python')}</td>
              <td class="v">{store.systemInfo.python || '—'}</td>
            </tr>
            <tr>
              <td class="k">{i18n.t('system.info.moonrakerVersion')}</td>
              <td class="v">{store.systemInfo.moonrakerVersion || '—'}</td>
            </tr>
            <tr>
              <td class="k">{i18n.t('system.info.klipperVersion')}</td>
              <td class="v">{store.klipper.softwareVersion || '—'}</td>
            </tr>
          </tbody>
        </table>

        {#if store.systemInfo.network.length > 0}
          <div class="sub-title">{i18n.t('system.info.network')}</div>
          <div class="net-list">
            {#each store.systemInfo.network as n (n.iface)}
              <span class="net-chip" title={n.iface}>
                <span class="net-iface">{n.iface}</span>
                <span class="net-ip">{n.ip}</span>
              </span>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <!-- ================= SD card (если есть) ================= -->
    {#if sdEntries.length > 0}
      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">{i18n.t('system.info.sdTitle')}</span>
        </header>
        <div class="panel-body">
          <table class="kv">
            <tbody>
              {#each sdEntries as [k, v] (k)}
                <tr>
                  <td class="k">{k}</td>
                  <td class="v">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    <!-- ================= Storage ================= -->
    <section class="panel">
      <header class="panel-header">
        <span class="panel-title">{i18n.t('system.storage.title')}</span>
      </header>
      <div class="panel-body">
        <StoragePanel />
      </div>
    </section>

    <!-- ================= Database ================= -->
    <section class="panel">
      <header class="panel-header">
        <span class="panel-title">{i18n.t('system.database.title')}</span>
      </header>
      <div class="panel-body db-body">
        <button
          class="btn"
          disabled={dbBusy !== ''}
          onclick={() => dbAction('compact')}
        >
          <Icon name="refresh" size={14} />
          {i18n.t('system.database.compact')}
        </button>
        <button
          class="btn"
          disabled={dbBusy !== ''}
          onclick={() => dbAction('backup')}
        >
          <Icon name="download" size={14} />
          {i18n.t('system.database.backup')}
        </button>

        {#if dbNotice}
          <span class="db-notice" class:fail={dbNotice.kind === 'fail'}>
            {dbNotice.text}
          </span>
        {/if}
      </div>
    </section>
    <UpdatesPanel />
  </div>
  

  <div class="col">
    <!-- ================= Load charts ================= -->
    <section class="panel">
      <header class="panel-header">
        <span class="panel-title">{i18n.t('system.charts.title')}</span>
      </header>
      <div class="panel-body">
        <ProcCharts />
      </div>
    </section>

    <!-- ================= MCU (только при connected) ================= -->
    {#if store.klipper.state === 'ready' && store.mcus.length > 0}
      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">{i18n.t('system.mcu.title')}</span>
        </header>
        <div class="panel-body">
          <div class="mcu-grid">
            {#each store.mcus as mcu (mcu.name)}
              <div class="mcu-card">
                <div class="mcu-head">
                  <span class="mcu-name">{mcu.name}</span>
                  <button
                    class="icon-btn"
                    title={i18n.t('system.mcu.details')}
                    onclick={() => (mcuDetails = mcu)}
                  >
                    <Icon name="columns" size={14} />
                  </button>
                </div>
                <table class="kv">
                  <tbody>
                    <tr>
                      <td class="k">{i18n.t('system.mcu.version')}</td>
                      <td class="v">{mcu.version || '—'}</td>
                    </tr>
                    {#if mcu.build}
                      <tr>
                        <td class="k">{i18n.t('system.mcu.build')}</td>
                        <td class="v">{mcu.build}</td>
                      </tr>
                    {/if}
                    <tr>
                      <td class="k">{i18n.t('system.mcu.freq')}</td>
                      <td class="v">{fmtMHz(mcu.freq)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            {/each}
          </div>
        </div>
      </section>
    {/if}
  </div>
</div>

{#if mcuDetails}
  <div class="dlg-backdrop" onclick={() => (mcuDetails = null)} role="presentation"></div>

  <div class="dlg" role="dialog" aria-modal="true" aria-label={mcuDetails.name}>
    <header class="dlg-header">
      <span class="dlg-title">{mcuDetails.name}</span>
      <button class="icon-btn" onclick={() => (mcuDetails = null)}>
        <Icon name="x" size={14} />
      </button>
    </header>

    <div class="dlg-body">
      <h4 class="dlg-section">{i18n.t('system.mcu.constants')}</h4>
      <table class="kv">
        <tbody>
          {#each Object.entries(mcuDetails.constants ?? {}) as [k, v] (k)}
            <tr>
              <td class="k">{k}</td>
              <td class="v">{fmtVal(v)}</td>
            </tr>
          {/each}
        </tbody>
      </table>

      <h4 class="dlg-section">{i18n.t('system.mcu.lastStats')}</h4>
      <table class="kv">
        <tbody>
          {#each Object.entries(mcuDetails.stats ?? {}) as [k, v] (k)}
            <tr>
              <td class="k">{k}</td>
              <td class="v">{fmtVal(v)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}

<style>
  :global(mpu-system-page) {
    display: block;
    min-height: 100%;
  }

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

  .panel {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
  }

  .panel-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .panel-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
  }

  /* key-value таблица */
  .kv {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }

  .kv td {
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    vertical-align: top;
  }

  .kv tr:last-child td {
    border-bottom: none;
  }

  .kv .k {
    color: var(--text-muted);
    white-space: nowrap;
    width: 1%;
  }

  .kv .v {
    color: var(--text-primary);
    font-family: monospace;
    word-break: break-word;
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

  .db-body {
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .btn:hover:not(:disabled) {
    background: var(--bg-surface-active);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .db-notice {
    font-size: var(--font-size-sm);
    color: var(--success);
  }

  .db-notice.fail {
    color: var(--danger);
  }

  .mcu-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-md);
  }

  .mcu-card {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-sm);
    background: var(--bg-surface-hover-no-override);
  }

  .mcu-name {
    font-family: monospace;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: var(--space-xs);
  }

    .mcu-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-xs);
  }

  .mcu-name {
    flex: 1;
    min-width: 0;
    font-family: monospace;
    font-weight: 600;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }

  .icon-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .dlg-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 450;
  }

  .dlg {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 560px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 451;
  }

  .dlg-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .dlg-title {
    flex: 1;
    min-width: 0;
    font-family: monospace;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dlg-body {
    padding: var(--space-md);
    overflow-y: auto;
    min-height: 0;
  }

  .dlg-section {
    margin: 0 0 var(--space-xs);
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .dlg-section:not(:first-child) {
    margin-top: var(--space-md);
  }
</style>