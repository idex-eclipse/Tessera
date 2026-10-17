<script lang="ts">
  import type { PluginApi } from '../../../../../plugin-sdk/src/types';

  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';

  import {
    usePrintStatus,
    computeProgress,
    computeRemaining,
    computeEta,
    fmtDuration,
    fmtClock,
  } from '../../use-print-status.svelte.ts';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';

  let {
    mpuApi,
    mpuParams,
    params,
  }: {
    mpuApi?: PluginApi;
    mpuParams?: Record<string, string>;
    params?: Record<string, string>;
  } = $props();

  const ctxApi = useWidget();
  const api = mpuApi ?? ctxApi;
  const i18n = useI18n();

  const injected = mpuParams ?? params;
  const printerId = injected?.printerId ?? api.printer.id;

  const klippy = useKlippyState(api, printerId);

  let klippyLabel = $derived.by<string | null>(() => {
    switch (klippy.state) {
      case 'ready': return null;
      case 'startup': return i18n.t('fleet.status.klippyStartup');
      case 'shutdown': return i18n.t('fleet.status.klippyShutdown');
      case 'error': return i18n.t('fleet.status.klippyError');
      case 'disconnected': return i18n.t('fleet.status.klippyDisconnected');
      default: return i18n.t('fleet.status.klippyUnknown');
    }
  });

  let klippyTone = $derived(
    klippy.state === 'error' || klippy.state === 'shutdown'
      ? 'danger'
      : klippy.state === 'startup' || klippy.state === 'disconnected'
        ? 'warning'
        : 'muted',
  );

  if (!injected?.printerId) {
    console.warn(
      '[fleet-status] printerId NOT injected — fallback to active printer.',
    );
  }

  const store = usePrintStatus(api, printerId);

  const mode = 'file' as const;

  let m = $derived(store.model);
  let printing = $derived(m.state === 'printing' || m.state === 'paused');
  let progress = $derived(computeProgress(m, mode));
  let remaining = $derived(computeRemaining(m, mode));
  let eta = $derived(computeEta(m, mode));

  let stateClass = $derived(
    m.state === 'printing' ? 'printing' :
    m.state === 'paused' ? 'paused' :
    m.state === 'error' ? 'error' :
    'idle',
  );
</script>

<div class="fleet-status">
    {#if klippyLabel}
        <div class="fs-klippy" class:danger={klippyTone === 'danger'} class:warning={klippyTone === 'warning'}>
        {klippyLabel}
        </div>
    {:else}
        <div class="fs-head">
            <span class="fs-state" class:printing={stateClass === 'printing'} class:paused={stateClass === 'paused'} class:error={stateClass === 'error'}>
            {m.state}
            </span>
            <span class="fs-fname" title={m.filename}>
            {m.filename || i18n.t('fleet.status.idle')}
            </span>
        </div>

        {#if printing}
            <div class="fs-bar">
            <div class="fs-fill" style="width: {progress != null ? progress * 100 : 0}%"></div>
            </div>

            <div class="fs-metrics">
            <div class="fs-metric">
                <span class="fs-label">{i18n.t('fleet.status.progress')}</span>
                <span class="fs-value">
                {progress != null ? `${Math.round(progress * 100)}%` : '—'}
                </span>
            </div>
            <div class="fs-metric">
                <span class="fs-label">{i18n.t('fleet.status.remaining')}</span>
                <span class="fs-value mono">{fmtDuration(remaining)}</span>
            </div>
            <div class="fs-metric">
                <span class="fs-label">{i18n.t('fleet.status.eta')}</span>
                <span class="fs-value mono">{fmtClock(eta)}</span>
            </div>
            </div>
        {:else if m.state === 'complete'}
            <div class="fs-complete">
            <span class="fs-label">{i18n.t('fleet.status.completed')}</span>
            {#if m.filename}
                <span class="fs-fname-secondary">{m.filename}</span>
            {/if}
            </div>
        {/if}
    {/if}
</div>

<style>
  .fleet-status {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-sm);
    font-size: var(--font-size-sm);
  }

  .fs-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-width: 0;
  }

  .fs-state {
    padding: 2px 10px;
    border-radius: 999px;
    font-size: var(--font-size-xs);
    font-weight: 700;
    background: var(--bg-surface-hover);
    color: var(--text-secondary);
    flex-shrink: 0;
    text-transform: capitalize;
  }

  .fs-state.printing {
    background: color-mix(in srgb, var(--success) 18%, transparent);
    color: var(--success);
  }

  .fs-state.paused {
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
  }

  .fs-state.error {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
  }

  .fs-fname {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fs-fname-secondary {
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    max-width: 100%;
  }

  .fs-bar {
    height: 6px;
    border-radius: 3px;
    background: var(--bg-surface-hover);
    overflow: hidden;
  }

  .fs-fill {
    height: 100%;
    background: var(--accent);
    transition: width var(--transition-normal);
  }

  .fs-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-xs);
  }

  .fs-metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .fs-label {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .fs-value {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fs-value.mono {
    font-family: var(--font-mono, monospace);
    font-variant-numeric: tabular-nums;
  }

  .fs-complete {
    padding: var(--space-sm) 0;
    color: var(--text-muted);
    text-align: center;
    font-size: var(--font-size-sm);
  }

  .fs-klippy {
    padding: var(--space-sm);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-align: center;
  }

  .fs-klippy.danger {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
  }

  .fs-klippy.warning {
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
  }
</style>