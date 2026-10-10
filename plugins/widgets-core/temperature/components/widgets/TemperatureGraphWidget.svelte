<script lang="ts">
  import { useI18n, useWidget } from '../../../../../plugin-sdk/src/svelte/index';

  import KlipperNotReady from '../../../../shared/klippy-state/KlippyNotReady.svelte';
  import TargetInput from '../TargetInput.svelte';
  import TempKindIcon from '../TempKindIcon.svelte';
  import { useTemperatureData, useTemperaturePrefs } from '../../use-temperature.svelte';
  import TemperatureChart from '../TemperatureChart.svelte';

  const api = useWidget();
  const i18n = useI18n();

  const temp = useTemperatureData(api);
  const prefs = useTemperaturePrefs(api);

  const { toggleChart, togglePower, setTarget } = temp;

  let hasPrinter = $derived(api.printer.url !== '');
  let ready = $derived(temp.klippyState === 'ready');

  function fmtTemp(t: number | null): string {
    return t == null ? '—' : `${t.toFixed(1)}°C`;
  }

  function fmtPower(p: number | null): string {
    if (p == null) return '';
    if (p <= 0) return 'off';
    return `${Math.round(p * 100)}%`;
  }

  function fmtRate(r: number | null): string {
    if (r == null || !Number.isFinite(r)) return '+0.0°C/s';
    const sign = r >= 0 ? '+' : '';
    return `${sign}${r.toFixed(1)}°C/s`;
  }
</script>

<div class="temp-widget">
  {#if !hasPrinter}
    <p class="notice">{i18n.t('widgets.temperature.noPrinter')}</p>
  {:else if !ready}
    <KlipperNotReady />
  {:else}
    <table class="temp-table">
      <colgroup>
        <col />
        {#if prefs.columns.power}<col class="w-power" />{/if}
        {#if prefs.columns.rate}<col class="w-rate" />{/if}
        {#if prefs.columns.current}<col class="w-current" />{/if}
        {#if prefs.columns.target}<col class="w-target" />{/if}
      </colgroup>

      <thead>
        <tr>
          <th>{i18n.t('widgets.temperature.sensor')}</th>
          {#if prefs.columns.power}<th class="col-power">{i18n.t('widgets.temperature.power')}</th>{/if}
          {#if prefs.columns.rate}<th class="col-rate">{i18n.t('widgets.temperature.rate')}</th>{/if}
          {#if prefs.columns.current}<th class="col-current">{i18n.t('widgets.temperature.current')}</th>{/if}
          {#if prefs.columns.target}<th class="col-target">{i18n.t('widgets.temperature.target')}</th>{/if}
        </tr>
      </thead>

      <tbody>
        {#each temp.sensors as s (s.name)}
          <tr>
            <td>
              <button
                class="sensor-name"
                class:dim={!s.chartVisible}
                onclick={() => toggleChart(s.name)}
                title={i18n.t('widgets.temperature.toggleSeries')}
              >
                <span class="icon-wrap" style="color: {s.color}">
                  <TempKindIcon
                    kind={s.kind}
                    speed={s.kind === 'fan' ? s.power : null}
                    size={20}
                  />
                </span>
                <span class="label">{s.displayName}</span>
              </button>
            </td>

            {#if prefs.columns.power}
              <td class="col-power">
                {#if s.kind !== 'sensor'}
                  <button
                    class="power-btn"
                    class:active={s.powerVisible}
                    onclick={() => togglePower(s.name)}
                    title={i18n.t('widgets.temperature.togglePower')}
                  >
                    {fmtPower(s.power)}
                  </button>
                {/if}
              </td>
            {/if}

            {#if prefs.columns.rate}<td class="col-rate">{fmtRate(s.rate)}</td>{/if}
            {#if prefs.columns.current}<td class="col-current">{fmtTemp(s.temperature)}</td>{/if}

            {#if prefs.columns.target}
              <td class="col-target">
                {#if s.kind !== 'sensor'}
                  <TargetInput value={s.target} onCommit={(v) => setTarget(s.name, v)} />
                {/if}
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <div class="chart-slot">
    <TemperatureChart
      sensors={temp.sensors}
      buffers={temp.buffers}
      tick={temp.tick}
    />
  </div>
</div>

<style>
  .temp-widget {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    height: 100%;
  }

  .notice {
    color: var(--text-muted);
    font-style: italic;
    padding: var(--space-md);
    text-align: center;
  }

  .temp-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: var(--font-size-md);
  }

  .w-power { width: 120px; }
  .w-rate { width: 120px; }
  .w-current { width: 120px; }
  .w-target { width: 120px; }

  .temp-table th {
    text-align: center;
    color: var(--text-muted);
    font-weight: 600;
    font-size: var(--font-size-sm);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .temp-table td {
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    vertical-align: middle;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .temp-table th:first-child,
  .temp-table td:first-child {
    text-align: left;
  }

  .col-power,
  .col-rate,
  .col-current,
  .col-target {
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  td.col-current {
    font-size: var(--font-size-lg);
    font-weight: 600;
  }

  td.col-rate {
    color: var(--text-secondary);
  }

  .sensor-name {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-md);
    font-weight: 500;
    cursor: pointer;
    padding: 2px 0;
    max-width: 100%;
    overflow: hidden;
  }

  .sensor-name.dim {
    opacity: 0.45;
    text-decoration: line-through;
  }

  .sensor-name .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .power-btn {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    padding: 2px var(--space-xs);
    border-radius: var(--radius-sm);
  }

  .power-btn:hover {
    background: var(--bg-surface-hover);
  }

  .power-btn.active {
    color: var(--accent);
    background: var(--bg-surface-active);
  }

  .chart-slot {
    flex: 1;
    min-height: 120px;
  }
</style>