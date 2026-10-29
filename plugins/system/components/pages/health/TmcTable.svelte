<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';

  import { TMC_CRITICAL_FLAGS } from '../../../health-utils';
  import type { TmcDriver } from '../../../use-health.svelte.ts';
  import StatusChip from './StatusChip.svelte';

  let { drivers, klippyReady }: { drivers: TmcDriver[]; klippyReady: boolean } = $props();

  const i18n = usePluginApi().i18n;

  const flagLabel = (f: string) => {
    const key = `system.tmc.flag.${f}`;
    const t = i18n.t(key);
    return t === key ? f : t;
  };

  /** Флаги, которые были, но сейчас сняты. */
  function pastFlags(d: TmcDriver): string[] {
    const active = new Set([...d.decoded.errors, ...d.decoded.temp]);
    return Object.keys(d.seen).filter((f) => !active.has(f));
  }

  const fmtTime = (ms: number | undefined) =>
    ms === undefined ? '' : new Date(ms).toLocaleTimeString();

  const fmtCurrent = (d: TmcDriver): string => {
    if (d.runCurrent == null && d.holdCurrent == null) return '—';
    const f = (v: number | null) => (v == null ? '—' : v.toFixed(2));
    return `${f(d.runCurrent)} / ${f(d.holdCurrent)} A`;
  };

  function chipLabel(d: TmcDriver): string {
    if (!klippyReady) return i18n.t('system.health.state.unknown');
    if (d.idle) return i18n.t('system.tmc.idle');
    if (d.noResponse) return i18n.t('system.tmc.noResponse');
    return i18n.t(`system.health.state.${d.severity}`);
  }
</script>

<div class="wrap">
  <table class="tmc">
    <thead>
      <tr>
        <th>{i18n.t('system.tmc.driver')}</th>
        <th>{i18n.t('system.tmc.status')}</th>
        <th>{i18n.t('system.tmc.flags')}</th>
        <th class="num">{i18n.t('system.tmc.temperature')}</th>
        <th class="num">{i18n.t('system.tmc.current')}</th>
      </tr>
    </thead>
    <tbody>
      {#each drivers as d (d.name)}
        {@const past = pastFlags(d)}
        <tr>
          <td>
            <bdi class="stepper">{d.stepper || d.name}</bdi>
            <bdi class="type" dir="ltr">{d.type}</bdi>
          </td>
          <td>
            <StatusChip
              severity={klippyReady ? d.severity : 'unknown'}
              label={chipLabel(d)}
              title={klippyReady && d.idle ? i18n.t('system.tmc.idleHint') : undefined}
            />
          </td>
          <td>
            <!-- flex на самой <td> ломает табличную раскладку: строки «съезжают» -->
            <div class="flags">
              {#each d.decoded.errors as f (f)}
                <span class="flag" class:crit={TMC_CRITICAL_FLAGS.has(f)} title={f}>{flagLabel(f)}</span>
              {/each}
              {#each d.decoded.temp as f (f)}
                <span class="flag" title={f}>{flagLabel(f)}</span>
              {/each}
              {#each past as f (f)}
                <span class="flag past" title={`${f} · ${i18n.t('system.tmc.seen', { time: fmtTime(d.seen[f]) })}`}>
                  {flagLabel(f)} · <bdi dir="ltr">{fmtTime(d.seen[f])}</bdi>
                </span>
              {/each}
              {#if d.decoded.errors.length === 0 && d.decoded.temp.length === 0 && past.length === 0}
                <span class="none">—</span>
              {/if}
            </div>
          </td>
          <td class="num"><bdi dir="ltr">{d.temperature == null ? '—' : `${d.temperature.toFixed(1)}°C`}</bdi></td>
          <td class="num"><bdi dir="ltr">{fmtCurrent(d)}</bdi></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap {
    overflow-x: auto;
  }

  .tmc {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }

  th {
    text-align: start;
    padding: var(--space-xs) var(--space-sm);
    color: var(--text-muted);
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border-bottom: 1px solid var(--border-color);
    white-space: nowrap;
  }

  td {
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    vertical-align: middle;
  }

  tr:last-child td {
    border-bottom: none;
  }

  th.num,
  td.num {
    text-align: end;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .stepper {
    font-family: monospace;
    font-weight: 600;
    color: var(--text-primary);
    margin-inline-end: var(--space-xs);
  }

  .type {
    color: var(--text-muted);
    font-size: 11px;
    font-family: monospace;
  }

  .flags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    min-width: 160px;
  }

  .flag {
    padding: 1px var(--space-sm);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
    font-size: 11px;
    font-weight: 600;
  }

  .flag.crit {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
  }

  .flag.past {
    background: transparent;
    border: 1px dashed var(--border-color);
    color: var(--text-secondary);
    font-weight: 400;
  }

  .none {
    color: var(--text-muted);
  }
</style>
