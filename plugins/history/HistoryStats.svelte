<script lang="ts">
  import { onDestroy } from 'svelte';

  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';

  import ConfirmDialog from '../shared/confirm-dialog.svelte';
  import Icon from '../shared/icons/Icon.svelte';

  import { formatDuration, formatFilament } from './format';

  const api = usePluginApi();
  const i18n = api.i18n;

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

  const unsubs: Array<() => void> = [];

  function n(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }

  async function load(): Promise<void> {
    loading = true;
    try {
      const res = await api
        .moonraker()
        .request<{ job_totals?: Record<string, unknown> }>('server.history.totals');
      const t = res?.job_totals ?? {};
      totals = {
        totalJobs: n(t.total_jobs),
        totalTime: n(t.total_time),
        totalPrintTime: n(t.total_print_time),
        totalFilament: n(t.total_filament_used),
        longestPrint: n(t.longest_print),
      };
    } catch {
      totals = null;
    } finally {
      loading = false;
    }
  }

  function init(): void {
    for (const u of unsubs.splice(0)) u();
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

  async function doReset(): Promise<void> {
    try {
      await api.moonraker().request('server.history.reset_totals');
      await load();
    } finally {
      resetOpen = false;
    }
  }
</script>

<section class="stats-card">
  <div class="page-header">
    <span class="page-title">{i18n.t('stats.title')}</span>
    <div class="actions">
      <button class="btn btn--sm" onclick={() => (resetOpen = true)}>
        <Icon name="delete" />
        <span>{i18n.t('stats.reset')}</span>
      </button>
    </div>
  </div>

  {#if loading && !totals}
    <div class="stats-grid">
      {#each Array(4) as _, i (i)}
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
          <span class="stat-value">{formatDuration(totals.longestPrint)}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat">
          <span class="stat-label">{i18n.t('stats.totalTime')}</span>
          <span class="stat-value">{formatDuration(totals.totalTime)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{i18n.t('stats.avgTime')}</span>
          <span class="stat-value">{formatDuration(avgTime)}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat">
          <span class="stat-label">{i18n.t('stats.totalPrintTime')}</span>
          <span class="stat-value">{formatDuration(totals.totalPrintTime)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{i18n.t('stats.avgPrintTime')}</span>
          <span class="stat-value">{formatDuration(avgPrint)}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat">
          <span class="stat-label">{i18n.t('stats.totalFilament')}</span>
          <span class="stat-value">{formatFilament(totals.totalFilament)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{i18n.t('stats.avgFilament')}</span>
          <span class="stat-value">{formatFilament(avgFilament)}</span>
        </div>
      </div>
    </div>
  {/if}
</section>

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

.stats-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  flex-shrink: 0;
}
/* тот же оверрайд, что в FileTable и GCodePreview: шапка внутри карточки */
.stats-card .page-header { margin-bottom: 0; }

.stats-grid {
  padding: var(--space-md);
  display: grid;
  gap: var(--space-md);
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
}
  .stat { display: grid; gap: var(--space-xs); }
  .stat-label { font-size: var(--font-size-sm); color: var(--text-muted); }
  .stat-value { font-size: var(--font-size-lg); font-weight: 600; }
  .skeleton {
    height: 84px; border-radius: var(--radius-sm);
    background: linear-gradient(90deg, var(--bg-surface-hover) 25%, var(--bg-surface) 50%, var(--bg-surface-hover) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }
  @keyframes shimmer { to { background-position: -200% 0; } }
  .stats-empty { color: var(--text-muted); font-size: var(--font-size-sm); }
</style>