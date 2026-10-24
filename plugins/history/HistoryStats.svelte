<script lang="ts">
  import { onDestroy } from 'svelte';

  import { usePluginApi } from '../../plugin-sdk/src/svelte/index';

  import ConfirmDialog from '../shared/confirm-dialog.svelte';
  import Icon from '../shared/icons/Icon.svelte';

  import { formatDuration, formatFilament } from './format';
  import { historyUi } from './page-ui-state.svelte.ts';

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
  let actionError = $state('');

  // Единицы измерения — из i18n плагина (раньше были зашиты латиницей: «1h 2m 3s»)
  const durUnits = $derived({
    h: i18n.t('history.unit.h'),
    m: i18n.t('history.unit.m'),
    s: i18n.t('history.unit.s'),
  });
  const filUnits = $derived({ m: i18n.t('history.unit.meter'), km: i18n.t('history.unit.km') });

  // Ответ устаревшего запроса (другой принтер, быстрые notify) не должен перезаписать свежий
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
    // смена принтера: не показываем чужие итоги, пока грузятся свои
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

  async function doReset(): Promise<void> {
    actionError = '';
    try {
      await api.moonraker().request('server.history.reset_totals');
      await load();
    } catch (e) {
      // отказ гарда → переведённая причина, иначе общее сообщение
      const reasonKey = (e as { rejection?: { reasonKey?: string } } | null)?.rejection?.reasonKey;
      actionError = reasonKey ? i18n.t(reasonKey) : i18n.t('stats.resetFailed');
    } finally {
      resetOpen = false;
    }
  }

  // Alt+R (hotkey) просит обновить статистику вместе с таблицей
  let lastRefreshSeq = historyUi.refreshSeq;
  $effect(() => {
    const seq = historyUi.refreshSeq;
    if (seq === lastRefreshSeq) return;
    lastRefreshSeq = seq;
    void load();
  });

  // Пока открыт диалог сброса, hotkeys страницы молчат
  $effect(() => {
    historyUi.dialogOpen = resetOpen;
    return () => {
      historyUi.dialogOpen = false;
    };
  });
</script>

<section class="stats-card">
  <div class="page-header">
    <span class="page-title">{i18n.t('stats.title')}</span>
    <div class="actions">
      <button
        class="btn btn--sm"
        class:active={resetOpen}
        title={i18n.t('stats.reset')}
        aria-label={i18n.t('stats.reset')}
        onclick={() => (resetOpen = true)}
      >
        <Icon name="delete" />
      </button>
    </div>
  </div>

  {#if actionError}
    <p class="stats-error" role="alert">{actionError}</p>
  {/if}

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

  .stats-card .page-header { margin-bottom: 0; }

  .stats-grid {
    padding: var(--space-md);
    display: grid;
    gap: var(--space-md);
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  }
  .stat { display: grid; gap: var(--space-xs); }
  .stat-label { font-size: var(--font-size-sm); color: var(--text-muted); }
  /* число + единицы — единый фрагмент: в RTL не должны переставляться местами */
  .stat-value { font-size: var(--font-size-lg); font-weight: 600; unicode-bidi: isolate; text-align: start; }

  .skeleton {
    height: 84px; border-radius: var(--radius-sm);
    background: linear-gradient(90deg, var(--bg-surface-hover) 25%, var(--bg-surface) 50%, var(--bg-surface-hover) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }

  @keyframes shimmer { to { background-position: -200% 0; } }
  :global([dir='rtl']) .skeleton { animation-direction: reverse; }
  .stats-empty { color: var(--text-muted); font-size: var(--font-size-sm); }
  .stats-error { margin: 0; padding: var(--space-sm) var(--space-md); color: var(--danger); font-size: var(--font-size-sm); }

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .btn.active {
    background: var(--bg-surface-active);
    color: var(--accent);
  }
</style>