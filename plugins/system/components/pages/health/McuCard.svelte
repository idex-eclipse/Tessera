<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';

  import Icon from '../../../../shared/icons/Icon.svelte';
  import { busStateSeverity } from '../../../health-utils';
  import type { McuHealth, McuPoint } from '../../../use-health.svelte.ts';
  import ChartGrid from '../ChartGrid.svelte';
  import type { ChartDef } from '../chart-types';
  import KvTable from '../KvTable.svelte';
  import StatusChip from './StatusChip.svelte';

  let {
    mcu,
    onDetails,
  }: {
    mcu: McuHealth;
    onDetails: (mcu: McuHealth) => void;
  } = $props();

  const i18n = usePluginApi().i18n;

  const C = { awake: '#c678dd', retrans: '#ff6d00', rtt: '#61afef' };

  let charts = $derived<ChartDef<McuPoint>[]>([
    {
      id: 'awake',
      title: i18n.t('system.charts.mcuLoad'),
      fixed: false,
      axisDecimals: 1,
      series: [{ label: 'awake', color: C.awake, unit: '%', get: (p) => p.awake }],
    },
    {
      id: 'retrans',
      title: i18n.t('system.charts.mcuRetrans'),
      fixed: false,
      series: [{ label: 'retransmit', color: C.retrans, unit: ' B/s', get: (p) => p.retransBps }],
    },
    {
      id: 'rtt',
      title: i18n.t('system.charts.mcuRtt'),
      fixed: false,
      axisDecimals: 1,
      series: [{ label: 'srtt', color: C.rtt, unit: ' ms', get: (p) => p.srttMs }],
    },
  ]);

  const fmtMHz = (hz: number | null) => (hz == null ? '—' : `${Math.round(hz / 1e6)} MHz`);

  let rows = $derived.by(() => {
    const out: Array<{ k: string; v: string }> = [
      { k: i18n.t('system.mcu.version'), v: mcu.version || '—' },
    ];
    if (mcu.build) out.push({ k: i18n.t('system.mcu.build'), v: mcu.build });
    out.push({ k: i18n.t('system.mcu.freq'), v: fmtMHz(mcu.freq) });

    const s = mcu.stats;
    if (s.awake !== undefined) out.push({ k: i18n.t('system.link.awake'), v: `${(s.awake * 100).toFixed(1)}%` });
    if (s.taskAvg !== undefined)
      out.push({ k: i18n.t('system.link.taskAvg'), v: `${(s.taskAvg * 1e6).toFixed(1)} µs` });
    if (s.srtt !== undefined) out.push({ k: i18n.t('system.link.srtt'), v: `${(s.srtt * 1000).toFixed(1)} ms` });
    out.push({
      k: i18n.t('system.link.retransmit'),
      v: `${(mcu.link.retransmitRatio * 100).toFixed(2)}%`,
    });
    if (s.bytesInvalid !== undefined) out.push({ k: i18n.t('system.link.invalid'), v: String(s.bytesInvalid) });

    if (mcu.bus) {
      if (mcu.bus.rxError !== undefined) out.push({ k: i18n.t('system.link.rxError'), v: String(mcu.bus.rxError) });
      if (mcu.bus.txError !== undefined) out.push({ k: i18n.t('system.link.txError'), v: String(mcu.bus.txError) });
      if (mcu.bus.txRetries !== undefined)
        out.push({ k: i18n.t('system.link.txRetries'), v: String(mcu.bus.txRetries) });
    }
    return out;
  });

  const busLabel = (state: string) => {
    const key = `system.link.bus.${state}`;
    const t = i18n.t(key);
    return t === key ? state : t;
  };
</script>

<div class="mcu-card">
  <div class="mcu-head">
    <bdi class="mcu-name">{mcu.short}</bdi>
    <StatusChip severity={mcu.link.severity} label={i18n.t(`system.health.state.${mcu.link.severity}`)} />
    {#if mcu.bus}
      <StatusChip
        severity={busStateSeverity(mcu.bus.state)}
        label={`${i18n.t('system.link.busLabel')}: ${busLabel(mcu.bus.state)}`}
      />
    {/if}
    <button
      type="button"
      class="icon-btn"
      title={i18n.t('system.mcu.details')}
      aria-label={i18n.t('system.mcu.details')}
      onclick={() => onDetails(mcu)}
    >
      <Icon name="columns" size={14} />
    </button>
  </div>

  {#if mcu.link.reasons.length > 0}
    <ul class="reasons">
      {#each mcu.link.reasons as r (r)}
        <li>{i18n.t(`system.link.reason.${r}`)}</li>
      {/each}
    </ul>
  {/if}

  <KvTable {rows} />

  <ChartGrid {charts} points={mcu.history} height={100} />
</div>

<style>
  .mcu-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-sm);
    min-width: 0;
  }

  .mcu-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-sm);
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

  .reasons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .reasons li {
    padding: 1px var(--space-sm);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
    font-size: 11px;
    font-weight: 600;
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
</style>
