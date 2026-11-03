<script lang="ts">
  import { getAppContext } from '../../app-context';
  import Icon from '../icons/Icon.svelte';
  import type { NotificationItem } from '../../core/notification-center.svelte.ts';
  import { fmtTime, printerName, sourceLabel } from './notification-labels';

  const ctx = getAppContext();
  const center = ctx.notifications;

  /** Отступ от правого края: ширина колонки правой панели (в drawer и без панели — 8px). */
  let rightOffset = $state(8);

  $effect(() => {
    // колонка пересоздаётся (панель сворачивается, смена принтера) — следим за родителем
    void ctx.ui.isNarrow; // смена режима: drawer получает класс без мутации childList
    const update = () => {
      const col = document.querySelector<HTMLElement>('aside.right-panel:not(.drawer)');
      rightOffset = col ? Math.round(col.getBoundingClientRect().width) + 8 : 8;
    };
    update();
    const ro = new ResizeObserver(update);
    const col = document.querySelector<HTMLElement>('aside.right-panel:not(.drawer)');
    if (col) ro.observe(col);
    const mo = new MutationObserver(() => {
      update();
      ro.disconnect();
      const next = document.querySelector<HTMLElement>('aside.right-panel:not(.drawer)');
      if (next) ro.observe(next);
    });
    const body = document.querySelector('.app-body');
    if (body) mo.observe(body, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  });

  function isPrinterActive(id: string): boolean {
    return id === ctx.printerManager.activePrinterId;
  }

  function onToastClick(n: NotificationItem): void {
    center.markSeen(n.id);
    center.setOpen(true);
  }
</script>

<div
  class="toast-stack"
  style:inset-inline-end="{rightOffset}px"
  aria-live="polite"
  aria-relevant="additions"
>
  {#each center.activeToasts as n (n.id)}
    <div
      class="toast"
      class:critical={n.severity === 'critical'}
      class:error={n.severity === 'error'}
      class:info={n.severity === 'info'}
      role="status"
    >
      <div class="toast-head">
        <span class="sev">{ctx.i18n.t(`notifications.sev.${n.severity}`)}</span>
        <span class="src">{sourceLabel(ctx, n)}</span>
        {#if n.printerId}
          <span
            class="printer"
            class:inactive={!isPrinterActive(n.printerId)}
            title={printerName(ctx, n.printerId)}
          >
            {printerName(ctx, n.printerId)}
          </span>
        {/if}
        <span class="time">{fmtTime(ctx, n.time)}</span>
        <button
          class="toast-close"
          title={ctx.i18n.t('notifications.dismiss')}
          aria-label={ctx.i18n.t('notifications.dismiss')}
          onclick={(e) => {
            e.stopPropagation();
            center.dismiss(n.id);
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
    bottom: 8px;
    width: min(360px, calc(100vw - 16px));
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

  .toast.critical { border-color: var(--danger); }
  .toast.error { border-color: var(--warning); }
  .toast.info { border-color: var(--accent); }

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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Бейдж принтера: компактный чип с именем. inactive = muted. */
  .printer {
    padding: 0 6px;
    border-radius: 3px;
    background: var(--bg-surface-active);
    color: var(--accent);
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100px;
    flex-shrink: 0;
  }

  .printer.inactive {
    background: var(--bg-surface-hover);
    color: var(--text-muted);
  }

  .time {
    font-family: monospace;
    flex-shrink: 0;
    margin-inline-start: auto;
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
    flex-shrink: 0;
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
