<script lang="ts">
  import { useWidget } from '../../../../../plugin-sdk/src/svelte/index';
  import type { PluginApi } from '../../../../../plugin-sdk/src/types';

  import ConfirmDialog from '../../../../shared/confirm-dialog.svelte';
  import Icon from '../../../../shared/icons/Icon.svelte';
  import { useKlippyState } from '../../../../shared/klippy-state/use-klippy-state.svelte.ts';
  import { useJobQueue } from '../../data/use-job-queue.svelte.ts';

  /** Omit printerId in dashboard widgets; fleet dialogs pin all requests to their card. */
  let { printerId, api: providedApi }: { printerId?: string; api?: PluginApi } = $props();

  const api = providedApi ?? useWidget();
  const i18n = api.i18n;
  const store = useJobQueue(api, printerId);
  const klippy = useKlippyState(api, printerId);
  let confirmClear = $state(false);

  function formatInQueue(seconds: number): string {
    if (!Number.isFinite(seconds)) return '—';
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);
    const minuteUnit = i18n.t('widgets.jobQueue.unit.m');
    const secondUnit = i18n.t('widgets.jobQueue.unit.s');
    return minutes ? `${minutes}${minuteUnit} ${remainder}${secondUnit}` : `${remainder}${secondUnit}`;
  }

  const KNOWN_STATES = ['ready', 'loading', 'starting', 'paused', 'unknown'];

  function stateLabel(state: string): string {
    return i18n.t(`widgets.jobQueue.state.${KNOWN_STATES.includes(state) ? state : 'unknown'}`);
  }

  function stateClass(state: string): string {
    if (state === 'loading' || state === 'starting') return 'busy';
    if (state === 'paused') return 'paused';
    if (state === 'ready') return 'ready';
    return 'off';
  }
</script>

{#if !store.available}
  <p class="empty">{i18n.t('widgets.jobQueue.unavailable')}</p>
{:else if store.jobs.length === 0}
  <p class="empty">
    {i18n.t('widgets.jobQueue.empty')}
    <span class="st {stateClass(store.state)}">{stateLabel(store.state)}</span>
  </p>
{:else}
  <div class="jq">
    <div class="jq-head">
      <span class="st {stateClass(store.state)}">{stateLabel(store.state)}</span>
      <div class="jq-actions">
        {#if store.state === 'paused'}
          <button
            class="jq-btn"
            disabled={!klippy.ready}
            title={!klippy.ready ? i18n.t('common.klipperNotReady') : undefined}
            onclick={() => store.start()}
          >
            <Icon name="play" size={13} /> {i18n.t('widgets.jobQueue.start')}
          </button>
        {:else}
          <button class="jq-btn" onclick={() => store.pause()}>
            <Icon name="pause" size={13} /> {i18n.t('widgets.jobQueue.pause')}
          </button>
        {/if}
        <button class="jq-btn" onclick={() => (confirmClear = true)}>
          <Icon name="trash" size={13} /> {i18n.t('widgets.jobQueue.clear')}
        </button>
      </div>
    </div>

    <ol class="jq-list">
      {#each store.jobs as job, index (job.job_id)}
        <li class="jq-row">
          <span class="jq-idx">{index + 1}</span>
          <bdi class="jq-name" title={job.filename}>{job.filename.split('/').pop() ?? job.filename}</bdi>
          <span class="jq-time" dir="ltr" title={i18n.t('widgets.jobQueue.inQueue')}>
            {formatInQueue(job.time_in_queue)}
          </span>
          <button
            class="jq-ico"
            title={i18n.t('widgets.jobQueue.jump')}
            aria-label={i18n.t('widgets.jobQueue.jump')}
            disabled={index === 0}
            onclick={() => store.jump(job.job_id)}
          >
            <Icon name="skip-next" size={13} />
          </button>
          <button
            class="jq-ico danger"
            title={i18n.t('widgets.jobQueue.remove')}
            aria-label={i18n.t('widgets.jobQueue.remove')}
            onclick={() => store.remove([job.job_id])}
          >
            <Icon name="trash" size={13} />
          </button>
        </li>
      {/each}
    </ol>
  </div>
{/if}

<ConfirmDialog
  open={confirmClear}
  title={i18n.t('widgets.jobQueue.clear')}
  message={i18n.t('widgets.jobQueue.clearConfirm')}
  confirmLabel={i18n.t('widgets.jobQueue.clear')}
  danger={true}
  onConfirm={() => store.clearAll()}
  onClose={() => (confirmClear = false)}
/>

<style>
  .jq {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-xs);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-md);
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
  }
  .jq-head,
  .jq-actions,
  .jq-row,
  .jq-btn {
    display: flex;
    align-items: center;
  }
  .jq-head { justify-content: space-between; gap: var(--space-sm); }
  .jq-actions { gap: var(--space-xs); }
  .jq-btn {
    gap: 4px;
    padding: 2px var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  .jq-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .jq-btn:hover:not(:disabled) { background: var(--bg-surface-hover); color: var(--text-primary); }
  .jq-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .jq-row {
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
  }
  .jq-idx {
    width: 20px;
    flex-shrink: 0;
    color: var(--text-muted);
    font-family: monospace;
    font-size: var(--font-size-xs);
    text-align: center;
  }
  .jq-name {
    display: block;
    direction: ltr;
    unicode-bidi: isolate;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-family: monospace;
    font-size: var(--font-size-sm);
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .jq-time {
    flex-shrink: 0;
    color: var(--text-muted);
    font-family: monospace;
    font-size: var(--font-size-xs);
  }
  .jq-ico {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .jq-ico:hover:not(:disabled) { background: var(--bg-surface); color: var(--text-primary); }
  .jq-ico.danger:hover:not(:disabled) { color: var(--danger); }
  .jq-ico:disabled { opacity: 0.35; cursor: not-allowed; }
  .st {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: var(--font-size-sm);
    font-weight: 600;
  }
  .st.ready { background: color-mix(in srgb, var(--success) 12%, transparent); color: var(--success); }
  .st.busy { background: color-mix(in srgb, var(--warning) 15%, transparent); color: var(--warning); }
  .st.paused { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
  .st.off { background: var(--bg-surface-hover); color: var(--text-muted); }

  /* Mobile controls remain comfortably tappable while the desktop widget stays compact. */
  @media (max-width: 768px) {
    .jq-btn,
    .jq-ico { min-width: 44px; min-height: 44px; }
    .jq-head { align-items: flex-start; flex-direction: column; }
    .jq-actions { width: 100%; flex-wrap: wrap; }
  }
</style>
