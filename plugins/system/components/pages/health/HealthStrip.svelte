<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';

  import type { HealthSummary, Severity } from '../../../health-utils';
  import StatusChip from './StatusChip.svelte';

  let { summary, onOpen }: { summary: HealthSummary; onOpen: () => void } = $props();

  const i18n = usePluginApi().i18n;

  const stateLabel = (s: Severity) => i18n.t(`system.health.state.${s}`);

  function labelFor(severity: Severity, count: number, idle = false): string {
    if (idle) return i18n.t('system.health.idle');
    return count > 1 ? `${stateLabel(severity)} · ${count}` : stateLabel(severity);
  }

  let items = $derived([
    { id: 'host', name: i18n.t('system.health.host'), severity: summary.host, label: labelFor(summary.host, 0) },
    {
      id: 'mcu',
      name: i18n.t('system.health.mcu'),
      severity: summary.mcu,
      label: labelFor(summary.mcu, summary.mcuIssues),
    },
    {
      id: 'drivers',
      name: i18n.t('system.health.drivers'),
      severity: summary.drivers,
      label: labelFor(summary.drivers, summary.driverIssues, summary.driversIdle),
    },
  ]);
</script>

<div class="strip" role="group" aria-label={i18n.t('system.health.title')}>
  {#each items as it (it.id)}
    <button type="button" class="item" onclick={onOpen} title={i18n.t('system.health.open')}>
      <span class="name">{it.name}</span>
      <StatusChip severity={it.severity} label={it.label} />
    </button>
  {/each}
</div>

<style>
  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
    padding-bottom: var(--space-xs);
  }

  .item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding: 2px var(--space-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .item:hover {
    background: var(--bg-surface-hover);
  }

  .item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .name {
    color: var(--text-secondary);
  }
</style>
