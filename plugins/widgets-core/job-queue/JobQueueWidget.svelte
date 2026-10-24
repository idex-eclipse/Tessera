<script lang="ts">
  import { useWidget, useI18n } from '../../../plugin-sdk/src/svelte/index';
  import Icon from '../../shared/icons/Icon.svelte';
  import ConfirmDialog from '../../shared/confirm-dialog.svelte';
  import { useKlippyState } from '../../shared/klippy-state/use-klippy-state.svelte.ts';

  import { useJobQueue } from './use-job-queue.svelte.ts';

  const api = useWidget();
  const i18n = useI18n();
  const store = useJobQueue(api);
  const klippy = useKlippyState(api);

  let confirmClear = $state(false);

  function formatInQueue(sec: number): string {
    if (!Number.isFinite(sec)) return '—';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const um = i18n.t('widgets.jobQueue.unit.m');
    const us = i18n.t('widgets.jobQueue.unit.s');
    return m ? `${m}${um} ${s}${us}` : `${s}${us}`;
  }

  const KNOWN_STATES = ['ready', 'loading', 'starting', 'paused', 'unknown'];

  // t() возвращает ключ для неизвестного состояния — показываем «Unknown», а не ключ
  function stateLabel(s: string): string {
    return i18n.t(`widgets.jobQueue.state.${KNOWN_STATES.includes(s) ? s : 'unknown'}`);
  }

  function stateClass(s: string): string {
    if (s === 'loading' || s === 'starting') return 'busy';
    if (s === 'paused') return 'paused';
    if (s === 'ready') return 'ready';
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
      {#each store.jobs as j, i (j.job_id)}
        <li class="jq-row">
          <span class="jq-idx">{i + 1}</span>
          <bdi class="jq-name" title={j.filename}>
            {j.filename.split('/').pop() ?? j.filename}
          </bdi>
          <span class="jq-time" dir="ltr" title={i18n.t('widgets.jobQueue.inQueue')}>
            {formatInQueue(j.time_in_queue)}
          </span>
          <button
            class="jq-ico"
            title={i18n.t('widgets.jobQueue.jump')}
            aria-label={i18n.t('widgets.jobQueue.jump')}
            disabled={i === 0}
            onclick={() => store.jump(j.job_id)}
          >
            <Icon name="skip-next" size={13} />
          </button>
          <button
            class="jq-ico danger"
            title={i18n.t('widgets.jobQueue.remove')}
            aria-label={i18n.t('widgets.jobQueue.remove')}
            onclick={() => store.remove([j.job_id])}
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
  :global(mpu-widgets-job-queue) {
    display: block;
    height: 100%;
  }

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
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-xs);
  }

  .jq-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
  }

  .jq-actions {
    display: flex;
    gap: var(--space-xs);
  }

  .jq-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .jq-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .jq-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .jq-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .jq-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
  }

  .jq-idx {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-muted);
    width: 20px;
    text-align: center;
    flex-shrink: 0;
  }

  .jq-name {
    display: block;
    direction: ltr; /* имя файла — как есть, слева направо */
    unicode-bidi: isolate;
    text-align: start;
    flex: 1;
    min-width: 0;
    font-family: monospace;
    font-size: var(--font-size-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .jq-time {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .jq-ico {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }

  .jq-ico:hover:not(:disabled) {
    background: var(--bg-surface);
    color: var(--text-primary);
  }

  .jq-ico.danger:hover:not(:disabled) {
    color: var(--danger);
  }

  .jq-ico:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .st {
    font-size: var(--font-size-sm);
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    flex-shrink: 0;
  }

  .st.ready {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 12%, transparent);
  }

  .st.busy {
    color: var(--warning);
    background: color-mix(in srgb, var(--warning) 15%, transparent);
  }

  .st.paused {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .st.off {
    color: var(--text-muted);
    background: var(--bg-surface-hover);
  }
</style>