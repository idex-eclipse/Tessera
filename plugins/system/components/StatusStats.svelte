<script lang="ts">
  import { useI18n } from '../../../plugin-sdk/src/svelte/index';

  import {
    computeRemaining,
    computeEta,
    computeFlow,
    fmtDuration,
    fmtClock,
    FIELD_GROUPS,
    type PrintStatusModel,
    type ProgressMode,
    type StatusFieldId,
  } from '../use-print-status.svelte.ts';

  let { m, mode, fields }: {
    m: PrintStatusModel;
    mode: ProgressMode;
    fields: StatusFieldId[];
  } = $props();

  const i18n = useI18n();

  let remaining = $derived(computeRemaining(m, mode));
  let eta = $derived(computeEta(m, mode));
  let flow = $derived(computeFlow(m));

  const KEY: Record<StatusFieldId, string> = {
    speed: 'system.status.speed',
    flow: 'system.status.flow',
    filament: 'system.status.filament',
    slicer: 'system.status.slicer',
    elapsed: 'system.status.elapsed',
    total: 'system.status.total',
    layer: 'system.status.layer',
    remaining: 'system.status.remaining',
    eta: 'system.status.eta',
  };

  function valueOf(id: StatusFieldId): string {
    switch (id) {
      case 'speed': return m.liveVelocity != null ? `${m.liveVelocity.toFixed(1)} mm/s` : '—';
      case 'flow': return flow != null ? `${flow.toFixed(1)} mm³/s` : '—';
      case 'filament': return m.filamentUsed != null ? `${(m.filamentUsed / 1000).toFixed(1)} m` : '—';
      case 'slicer': return fmtDuration(m.estimatedTime);
      case 'elapsed': return fmtDuration(m.printDuration);
      case 'total': return fmtDuration(m.totalDuration);
      case 'layer':
        return m.currentLayer != null && m.totalLayer != null
          ? `${m.currentLayer} / ${m.totalLayer}` : '—';
      case 'remaining': return fmtDuration(remaining);
      case 'eta': return fmtClock(eta);
    }
  }
</script>

<div class="stats">
  {#each FIELD_GROUPS as g (g.id)}
    {@const visible = g.fields.filter((f) => fields.includes(f))}
    {#if visible.length > 0}
      <div class="stat-col">
        <div class="grp-title">{i18n.t(g.titleKey)}</div>
        {#each visible as f (f)}
          <span class="k">{i18n.t(KEY[f])}</span>
          <span class="v">{valueOf(f)}</span>
        {/each}
      </div>
    {/if}
  {/each}
</div>

<style>
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--space-sm) var(--space-md);
    align-items: start;
  }

  .stat-col {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-xs) var(--space-sm);
    align-items: baseline;
    min-width: 0;
  }

  .grp-title {
    grid-column: 1 / -1;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .k {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .v {
    font-size: var(--font-size-sm);
    font-family: monospace;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>