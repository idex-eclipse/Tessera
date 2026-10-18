<script lang="ts">
  import { useWidget, useI18n } from '../../../../plugin-sdk/src/svelte/index';

  import KlipperNotReady from '../../../shared/klippy-state/KlippyNotReady.svelte';
  import StatusStats from '../StatusStats.svelte';
  import {
    usePrintStatus,
    computeProgress,
    type ProgressMode,
  } from '../../../system/use-print-status.svelte.ts';

  import { readEnabledFields, type StatusFieldId } from '../../../system/use-print-status.svelte.ts';

  const api = useWidget();
  const i18n = useI18n();
  const store = usePrintStatus(api);
  
  let fields = $state<StatusFieldId[]>(readEnabledFields(api));

  let mode = $state(api.settings.get<ProgressMode>('status.progressMode') ?? 'file');

  let m = $derived(store.model);
  let printing = $derived(m.state === 'printing' || m.state === 'paused');
  let progress = $derived(computeProgress(m, mode));

  let stateKey = $derived(
    m.state === 'printing' ? 'system.status.printing'
    : m.state === 'paused' ? 'system.status.paused'
    : m.state === 'complete' ? 'system.status.complete'
    : m.state === 'cancelled' ? 'system.status.cancelled'
    : m.state === 'error' ? 'system.status.error'
    : 'system.status.standby',
  );
</script>

{#if !m.klippyReady}
  <KlipperNotReady />
{:else}
  <div class="status-widget">
    <div class="line1">
      <span class="state" class:printing class:paused={m.state === 'paused'}>
        {i18n.t(stateKey)}
      </span>
      <span class="fname" title={m.filename}>{m.filename || '—'}</span>
    </div>

    {#if printing}
      <div class="progress-line">
        <span class="pct">
          {progress != null ? `${Math.round(progress * 100)}%` : '—'}
        </span>
        <div class="bar">
          <div class="fill" style="width: {progress != null ? progress * 100 : 0}%"></div>
        </div>
      </div>

      <StatusStats {m} {mode} {fields} />
    {:else}
      <p class="idle">{i18n.t('system.status.ready')}</p>
    {/if}
  </div>
{/if}

<!-- headerActions рендерятся отдельным элементом (StatusHeader.svelte) -->

<style>
  .hint {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
    padding: var(--space-md);
  }

  .status-widget {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .line1 {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-width: 0;
  }

  .state {
    padding: 1px 8px;
    border-radius: 999px;
    font-size: var(--font-size-sm);
    font-weight: 700;
    background: var(--bg-surface-hover-no-override);
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .state.printing {
    background: color-mix(in srgb, var(--success) 18%, transparent);
    color: var(--success);
  }

  .state.paused {
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
  }

  .fname {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress-line {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .pct {
    font-size: var(--font-size-lg);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    min-width: 52px;
  }

  .bar {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: var(--bg-surface-hover);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    transition: width var(--transition-normal);
  }

  .idle {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    margin: 0;
  }
</style>