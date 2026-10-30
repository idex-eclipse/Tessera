<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import { useHealth, type McuHealth } from '../../use-health.svelte.ts';
  import HostCard from './health/HostCard.svelte';
  import McuCard from './health/McuCard.svelte';
  import McuDetailsDialog from './health/McuDetailsDialog.svelte';
  import TmcTable from './health/TmcTable.svelte';
  import Panel from './Panel.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const health = useHealth(api);

  let details = $state<McuHealth | null>(null);

  // диалог показывает свежие данные, а не снимок на момент открытия
  let detailsLive = $derived(details ? (health.mcus.find((m) => m.name === details!.name) ?? details) : null);
</script>

<div class="mon">
  {#if !health.klippyReady}
    <p class="waiting">{i18n.t('system.health.waitingKlipper')}</p>
  {/if}

  <Panel title={i18n.t('system.health.host')}>
    <HostCard {health} />
  </Panel>

  {#if health.mcus.length > 0}
    <Panel title={i18n.t('system.mcu.title')}>
      <div class="mcu-grid">
        {#each health.mcus as mcu (mcu.name)}
          <McuCard {mcu} onDetails={(m) => (details = m)} />
        {/each}
      </div>
    </Panel>
  {/if}

  {#if health.tmc.length > 0}
    <Panel title={i18n.t('system.tmc.title')}>
      <TmcTable drivers={health.tmc} klippyReady={health.klippyReady} />
    </Panel>
  {:else if health.klippyReady}
    <Panel title={i18n.t('system.tmc.title')}>
      <p class="empty">{i18n.t('system.tmc.empty')}</p>
    </Panel>
  {/if}
</div>

{#if detailsLive}
  <McuDetailsDialog mcu={detailsLive} onClose={() => (details = null)} />
{/if}

<style>
  .mon {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    min-width: 0;
  }

  .mcu-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: var(--space-md);
  }

  .waiting,
  .empty {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }

  .waiting {
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
    font-weight: 600;
  }
</style>
