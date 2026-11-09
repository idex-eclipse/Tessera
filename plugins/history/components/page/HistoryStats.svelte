<script lang="ts">
  import { onDestroy } from 'svelte';

  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import ConfirmDialog from '../../../shared/confirm-dialog.svelte';
  import { useHistoryFiles } from '../../../shared/file-table/use-history-files.svelte.ts';

  import { formatDuration, formatFilament } from '../../lib/format';
  import { analyzeHistory } from '../../lib/history-analysis';
  import { historyUi } from '../../state/page-ui-state.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const history = useHistoryFiles(api);

  interface Totals {
    totalJobs: number;
    totalTime: number;
    totalPrintTime: number;
    totalFilament: number;
    longestPrint: number;
  }

  let totals = $state<Totals | null>(null);
  let loading = $state(false);
  let resetOpen = $state(false);
  let actionError = $state('');

  // Units come from plugin localization instead of being fixed to Latin abbreviations.
  const durUnits = $derived({
    h: i18n.t('history.unit.h'),
    m: i18n.t('history.unit.m'),
    s: i18n.t('history.unit.s'),
  });
  const filUnits = $derived({ m: i18n.t('history.unit.meter'), km: i18n.t('history.unit.km') });

  // A stale request from a previous printer or notification must not replace newer totals.
  let loadSeq = 0;

  const unsubs: Array<() => void> = [];

  function n(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    loading = true;
    try {
      const res = await api
        .moonraker()
        .request<{ job_totals?: Record<string, unknown> }>('server.history.totals');
      if (seq !== loadSeq) return;
      const t = res?.job_totals ?? {};
      totals = {
        totalJobs: n(t.total_jobs),
        totalTime: n(t.total_time),
        totalPrintTime: n(t.total_print_time),
        totalFilament: n(t.total_filament_used),
        longestPrint: n(t.longest_print),
      };
    } catch {
      if (seq !== loadSeq) return;
      totals = null;
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function init(): void {
    for (const u of unsubs.splice(0)) u();
    // Clear the previous printer's totals while the new printer loads.
    loadSeq++;
    totals = null;
    actionError = '';
    let h;
    try {
      h = api.moonraker();
    } catch {
      return;
    }
    unsubs.push(h.onNotify('notify_history_changed', () => void load()));
    unsubs.push(h.onConnectionStatusChange((s) => { if (s === 'open') void load(); }));
    if (h.readyState === 'open') void load();
  }

  init();
  const offPrinter = api.onPrinterChange(init);
  onDestroy(() => {
    for (const u of unsubs) u();
    offPrinter();
  });

  const avgTime = $derived(totals && totals.totalJobs ? totals.totalTime / totals.totalJobs : 0);
  const avgPrint = $derived(totals && totals.totalJobs ? totals.totalPrintTime / totals.totalJobs : 0);
  const avgFilament = $derived(totals && totals.totalJobs ? totals.totalFilament / totals.totalJobs : 0);
  // The retained full history supplies outcome and material rows without another request.
  const analysis = $derived(analyzeHistory(history.files));

  // Rates use a fixed precision so totals and per-material rows remain visually comparable.
  function percentage(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  async function doReset(): Promise<void> {
    actionError = '';
    try {
      await api.moonraker().request('server.history.reset_totals');
      await load();
    } catch (e) {
      // Guard rejections expose a translated reason; other errors use the generic message.
      const reasonKey = (e as { rejection?: { reasonKey?: string } } | null)?.rejection?.reasonKey;
      actionError = reasonKey ? i18n.t(reasonKey) : i18n.t('stats.resetFailed');
    } finally {
      resetOpen = false;
    }
  }

  // Alt+R refreshes totals together with the retained history list.
  let lastRefreshSeq = historyUi.refreshSeq;
  $effect(() => {
    const seq = historyUi.refreshSeq;
    if (seq === lastRefreshSeq) return;
    lastRefreshSeq = seq;
    void load();
  });

  // The page-level tab row owns the reset button while this component owns its confirmation flow.
  let lastResetRequestSeq = historyUi.resetRequestSeq;
  $effect(() => {
    const seq = historyUi.resetRequestSeq;
    if (seq === lastResetRequestSeq) return;
    lastResetRequestSeq = seq;
    resetOpen = true;
  });

  // Page hotkeys stay inactive behind the reset confirmation dialog.
  $effect(() => {
    historyUi.resetDialogOpen = resetOpen;
    return () => {
      historyUi.resetDialogOpen = false;
    };
  });
</script>

<!-- The combined statistics tab splits its available height between two independently scrollable panes. -->
<div class="stats-combined">
  <section class="stats-pane printer-pane" aria-label={i18n.t('stats.title')}>
    <h2 class="pane-title">{i18n.t('stats.title')}</h2>
    <div class="printer-scroll">
      {#if actionError}
        <p class="stats-error" role="alert">{actionError}</p>
      {/if}

      {#if loading && !totals}
        <div class="stats-grid">
          {#each Array(5) as _, i (i)}
            <div class="stat-card"><div class="skeleton"></div></div>
          {/each}
        </div>
      {:else if !totals}
        <p class="stats-empty">{i18n.t('stats.statsError')}</p>
      {:else}
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat">
              <span class="stat-label">{i18n.t('stats.totalJobs')}</span>
              <span class="stat-value">{totals.totalJobs}</span>
            </div>
            <div class="stat">
              <span class="stat-label">{i18n.t('stats.longestPrint')}</span>
              <span class="stat-value">{formatDuration(totals.longestPrint, durUnits)}</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat">
              <span class="stat-label">{i18n.t('stats.totalTime')}</span>
              <span class="stat-value">{formatDuration(totals.totalTime, durUnits)}</span>
            </div>
            <div class="stat">
              <span class="stat-label">{i18n.t('stats.avgTime')}</span>
              <span class="stat-value">{formatDuration(avgTime, durUnits)}</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat">
              <span class="stat-label">{i18n.t('stats.totalPrintTime')}</span>
              <span class="stat-value">{formatDuration(totals.totalPrintTime, durUnits)}</span>
            </div>
            <div class="stat">
              <span class="stat-label">{i18n.t('stats.avgPrintTime')}</span>
              <span class="stat-value">{formatDuration(avgPrint, durUnits)}</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat">
              <span class="stat-label">{i18n.t('stats.totalFilament')}</span>
              <span class="stat-value">{formatFilament(totals.totalFilament, filUnits)}</span>
            </div>
            <div class="stat">
              <span class="stat-label">{i18n.t('stats.avgFilament')}</span>
              <span class="stat-value">{formatFilament(avgFilament, filUnits)}</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat">
              <span class="stat-label">{i18n.t('stats.failedJobs')}</span>
              <span class="stat-value">{analysis.failedJobs} / {analysis.terminalJobs}</span>
            </div>
            <div class="stat">
              <span class="stat-label">{i18n.t('stats.failureRate')}</span>
              <span class="stat-value">{analysis.terminalJobs ? percentage(analysis.failureRate) : '—'}</span>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </section>

  <section class="stats-pane materials" aria-label={i18n.t('stats.materialsTitle')}>
    <h2 class="pane-title">{i18n.t('stats.materialsTitle')}</h2>
    {#if history.loading && history.files.length === 0}
      <div class="materials-loading"><div class="skeleton"></div></div>
    {:else if analysis.materials.length === 0}
      <p class="stats-empty">{i18n.t('stats.noMaterialData')}</p>
    {:else}
      <div class="materials-scroll">
        <div class="material-grid material-header" aria-hidden="true">
          <span>{i18n.t('stats.material')}</span>
          <span>{i18n.t('stats.materialJobs')}</span>
          <span>{i18n.t('stats.materialUsed')}</span>
          <span>{i18n.t('stats.failureRate')}</span>
        </div>
        {#each analysis.materials as material (material.type ?? '__unknown__')}
          <div class="material-grid">
            <strong>{material.type ?? i18n.t('stats.unknownMaterial')}</strong>
            <span class="material-metric"><span class="mobile-label">{i18n.t('stats.materialJobs')}</span>{material.jobs}</span>
            <span class="material-metric" title={material.partialFilament ? i18n.t('stats.partialMaterialHint') : undefined}>
              <span class="mobile-label">{i18n.t('stats.materialUsed')}</span>
              {material.partialFilament && material.filamentUsed > 0 ? '≥ ' : ''}{formatFilament(material.filamentUsed, filUnits)}
              {#if material.partialFilament}<span class="partial" aria-label={i18n.t('stats.partialMaterialHint')}>*</span>{/if}
            </span>
            <span class="material-metric"><span class="mobile-label">{i18n.t('stats.failureRate')}</span>{percentage(material.failed / material.jobs)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<ConfirmDialog
  open={resetOpen}
  title={i18n.t('stats.confirmReset')}
  message={i18n.t('stats.resetConfirmBody')}
  confirmLabel={i18n.t('stats.confirm')}
  danger
  onConfirm={doReset}
  onClose={() => (resetOpen = false)}
/>

<style>
  .stats-combined {
    height: 100%;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stats-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .printer-pane {
    border-inline-end: 1px solid var(--border-color);
  }

  .pane-title {
    flex: none;
    margin: 0;
    padding: var(--space-sm) var(--space-md);
    border-block-end: 1px solid var(--border-color);
    font-size: var(--font-size-md);
  }

  .printer-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .stats-grid {
    padding: var(--space-md);
    display: grid;
    gap: var(--space-md);
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .materials {
    overflow: hidden;
  }
  .materials-loading { min-height: 84px; padding: var(--space-md); }
  .materials-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .material-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) repeat(3, minmax(0, 1fr));
    gap: var(--space-sm);
    align-items: center;
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
  }
  .material-grid:last-child { border-bottom: 0; }
  .material-grid > * { min-width: 0; overflow-wrap: anywhere; unicode-bidi: isolate; }
  .material-header {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg-surface);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }
  .partial { color: var(--text-muted); margin-inline-start: 2px; }
  .mobile-label { display: none; }
  .stat { display: grid; gap: var(--space-xs); }
  .stat-label { font-size: var(--font-size-sm); color: var(--text-muted); }
  /* Keep a value and its unit isolated so RTL does not reverse their order. */
  .stat-value { font-size: var(--font-size-lg); font-weight: 600; unicode-bidi: isolate; text-align: start; }

  .skeleton {
    height: 84px; border-radius: var(--radius-sm);
    background: linear-gradient(90deg, var(--bg-surface-hover) 25%, var(--bg-surface) 50%, var(--bg-surface-hover) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }

  @keyframes shimmer { to { background-position: -200% 0; } }
  :global([dir='rtl']) .skeleton { animation-direction: reverse; }
  .stats-empty { margin: 0; padding: var(--space-md); color: var(--text-muted); font-size: var(--font-size-sm); }
  .stats-error { margin: 0; padding: var(--space-sm) var(--space-md); color: var(--danger); font-size: var(--font-size-sm); }

  @media (max-width: 768px) {
    /* Each half keeps its own scroll area so the stacked mobile layout cannot overflow the page. */
    .stats-combined {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: repeat(2, minmax(0, 1fr));
    }
    .printer-pane {
      border-inline-end: 0;
      border-block-end: 1px solid var(--border-color);
    }
    .stats-grid { grid-template-columns: minmax(0, 1fr); }
    .material-header { display: none; }
    .material-grid { grid-template-columns: 1fr; gap: 2px; }
    .material-metric { display: flex; justify-content: space-between; gap: var(--space-md); }
    .mobile-label { display: inline; color: var(--text-muted); font-size: var(--font-size-sm); }
  }
</style>
