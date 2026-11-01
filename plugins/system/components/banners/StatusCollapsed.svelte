<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import { usePrintStatus, computeProgress } from '../../use-print-status.svelte.ts';
  import { useStatusBannerPrefs } from './status-banner-prefs.svelte.ts';

  const api = usePluginApi();
  const store = usePrintStatus(api);
  const prefs = useStatusBannerPrefs(api);

  let m = $derived(store.model);
  let printing = $derived(m.state === 'printing' || m.state === 'paused');
  let progress = $derived(computeProgress(m, prefs.mode));
</script>

{#if prefs.banner && m.klippyReady}
  <div class="status-collapsed">
    <span class="state" class:printing class:paused={m.state === 'paused'}>{m.state}</span>
    <span class="fname" title={m.filename}>{m.filename || '—'}</span>

    {#if printing}
      <div class="bar">
        <div class="fill" style="width: {progress != null ? progress * 100 : 0}%"></div>
      </div>
      <span class="pct">{progress != null ? `${Math.round(progress * 100)}%` : '—'}</span>
    {/if}
  </div>
{/if}

<style>
  .status-collapsed {
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
    text-transform: capitalize;
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

  .bar {
    flex: 1;
    min-width: 40px;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-surface-hover);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    transition: width var(--transition-normal);
  }

  .pct {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    flex-shrink: 0;
  }
</style>
