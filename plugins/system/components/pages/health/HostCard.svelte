<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';

  import { cpuTempSeverity, formatUptime, type ThrottleFlag } from '../../../health-utils';
  import type { HealthStore } from '../../../use-health.svelte.ts';
  import { useSystem } from '../../../use-system.svelte.ts';
  import StatusChip from './StatusChip.svelte';

  let { health }: { health: HealthStore } = $props();

  const api = usePluginApi();
  const i18n = api.i18n;
  const system = useSystem(api);

  let last = $derived(system.proc.at(-1) ?? null);

  const flagName = (f: ThrottleFlag) => i18n.t(`system.throttle.${f}`);

  let ramPct = $derived(
    last && last.memUsed != null && last.memTotal ? (last.memUsed / last.memTotal) * 100 : null,
  );

  let tempSeverity = $derived(cpuTempSeverity(health.cpuTemp));
  let uptimeText = $derived(
    health.uptime == null
      ? null
      : formatUptime(health.uptime, {
          d: i18n.t('system.units.d'),
          h: i18n.t('system.units.h'),
          m: i18n.t('system.units.m'),
        }),
  );
</script>

<div class="host">
  <div class="row">
    <span class="k">{i18n.t('system.health.throttle')}</span>
    <span class="v wrap">
      {#if !health.throttle.supported}
        <span class="muted">{i18n.t('system.health.throttleUnsupported')}</span>
      {:else if health.throttle.now.length === 0}
        <StatusChip severity="ok" label={i18n.t('system.health.throttleNone')} />
      {:else}
        {#each health.throttle.now as f (f)}
          <StatusChip
            severity={f === 'undervoltage' || f === 'throttled' ? 'crit' : 'warn'}
            label={flagName(f)}
          />
        {/each}
      {/if}
    </span>
  </div>

  {#if health.throttle.supported && health.throttle.past.length > 0}
    <div class="row">
      <span class="k">{i18n.t('system.health.throttlePast')}</span>
      <span class="v wrap">
        {#each health.throttle.past as f (f)}
          <span class="past">{flagName(f)}</span>
        {/each}
      </span>
    </div>
  {/if}

  {#if health.cpuTemp != null}
    <div class="row">
      <span class="k">{i18n.t('system.health.cpuTemp')}</span>
      <span class="v">
        <bdi dir="ltr">{health.cpuTemp.toFixed(1)}°C</bdi>
        {#if tempSeverity === 'warn' || tempSeverity === 'crit'}
          <StatusChip severity={tempSeverity} label={i18n.t(`system.health.state.${tempSeverity}`)} />
        {/if}
      </span>
    </div>
  {/if}

  {#if last?.sysCpu != null}
    <div class="row">
      <span class="k">{i18n.t('system.health.cpu')}</span>
      <span class="v"><bdi dir="ltr">{last.sysCpu.toFixed(0)}%</bdi></span>
    </div>
  {/if}

  {#if ramPct != null}
    <div class="row">
      <span class="k">{i18n.t('system.health.ram')}</span>
      <span class="v"><bdi dir="ltr">{ramPct.toFixed(0)}%</bdi></span>
    </div>
  {/if}

  {#if uptimeText}
    <div class="row">
      <span class="k">{i18n.t('system.health.uptime')}</span>
      <span class="v"><bdi dir="ltr">{uptimeText}</bdi></span>
    </div>
  {/if}

  {#if health.netIssues != null}
    <div class="row">
      <span class="k">{i18n.t('system.health.netIssues')}</span>
      <span class="v"><bdi dir="ltr">{health.netIssues}</bdi></span>
    </div>
  {/if}

  {#if health.stalls != null}
    <div class="row">
      <span class="k" title={i18n.t('system.health.stallsHint')}>{i18n.t('system.health.stalls')}</span>
      <span class="v"><bdi dir="ltr">{health.stalls}</bdi></span>
    </div>
  {/if}

  {#if health.failedComponents.length > 0}
    <div class="row">
      <span class="k">{i18n.t('system.health.failedComponents')}</span>
      <span class="v wrap">
        {#each health.failedComponents as c (c)}
          <StatusChip severity="crit" label={c} />
        {/each}
      </span>
    </div>
  {/if}

  {#if health.warnings.length > 0}
    <div class="row">
      <span class="k">{i18n.t('system.health.warnings')}</span>
      <ul class="v warn-list">
        {#each health.warnings as w (w)}
          <li dir="auto">{w}</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .host {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    align-items: baseline;
    gap: var(--space-md);
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-color);
    font-size: var(--font-size-sm);
  }

  .row:last-child {
    border-bottom: none;
  }

  .k {
    flex: 0 0 38%;
    min-width: 0;
    color: var(--text-muted);
  }

  .v {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .v.wrap {
    flex-wrap: wrap;
  }

  .muted {
    color: var(--text-muted);
  }

  .past {
    padding: 0 var(--space-sm);
    border: 1px dashed var(--border-color);
    border-radius: 999px;
    color: var(--text-secondary);
    font-size: 11px;
  }

  .warn-list {
    flex-direction: column;
    align-items: flex-start;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--warning);
  }
</style>
