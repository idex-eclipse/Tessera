<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../shared/icons/Icon.svelte';
  import { useNotifications, type NotificationItem } from '../../use-notifications.svelte.ts';
  import { systemUiState } from '../../system-ui-state.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useNotifications(api);

  let stackEl = $state<HTMLDivElement | null>(null);
  let rightOffset = $state(8);

  $effect(() => {
    const panel = stackEl?.closest('mpu-system-right-panel') as HTMLElement | null;
    if (!panel) return;
    const update = () => {
      rightOffset = Math.round(panel.getBoundingClientRect().width) + 8;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(panel);
    return () => ro.disconnect();
  });

  function severityLabel(s: NotificationItem['severity']): string {
    return i18n.t(`system.notifications.sev.${s}`);
  }

  function sourceLabel(s: NotificationItem['source']): string {
    return i18n.t(`system.notifications.src.${s}`);
  }

  function fmtTime(t: number): string {
    return new Date(t).toLocaleTimeString();
  }

  function onToastClick(n: NotificationItem): void {
    store.markSeen(n.id);
    systemUiState.notificationsOpen = true;
  }
</script>

<div
  class="toast-stack"
  bind:this={stackEl}
  style:right="{rightOffset}px"
  aria-live="polite"
  aria-relevant="additions"
>
  {#each store.activeToasts as n (n.id)}
    <div class="toast" class:critical={n.severity === 'critical'} class:error={n.severity === 'error'} class:info={n.severity === 'info'} role="status">
      <div class="toast-head">
        <span class="sev">{severityLabel(n.severity)}</span>
        <span class="src">{sourceLabel(n.source)}</span>
        <span class="time">{fmtTime(n.time)}</span>
        <button
          class="toast-close"
          title={i18n.t('system.notifications.dismiss')}
          onclick={(e) => {
            e.stopPropagation();
            store.dismiss(n.id);
          }}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      <button class="toast-body" onclick={() => onToastClick(n)}>
        {n.text}
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-stack {
    position: fixed;
    z-index: 550;
    bottom: 8px;               /* снова внизу: сдвигаемся вбок, а не вверх */
    /* right задаётся inline из ширины правой панели */
    width: - min(360px, calc(100vw - 16px));
    display: flex;
    flex-direction: column-reverse;
    gap: var(--space-xs);
    pointer-events: none;
  }

  .toast {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-sm) var(--space-md);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    pointer-events: auto;
    animation: toast-in 150ms ease-out;
  }

  .toast.critical {
    border-color: var(--danger);
  }

  .toast.error {
    border-color: var(--warning);
  }

  .toast.info {
    border-color: var(--accent);
  }

  .toast-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    font-size: 11px;
    color: var(--text-muted);
  }

  .sev {
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .toast.critical .sev { color: var(--danger); }
  .toast.error .sev { color: var(--warning); }
  .toast.info .sev { color: var(--accent); }

  .src {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .time {
    font-family: monospace;
    flex-shrink: 0;
  }

  .toast-close {
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-xs, 3px);
  }

  .toast-close:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .toast-body {
    display: block;
    width: 100%;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    text-align: start;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    padding: 0;
    cursor: pointer;
  }

  .toast-body:hover {
    color: var(--accent);
  }

  @keyframes toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>