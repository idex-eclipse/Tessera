<script lang="ts">
  import { getAppContext } from '../../app-context';
  import Icon from '../icons/Icon.svelte';
  import type { NotificationSeverity } from '../../../../plugin-sdk/src/types';
  import { fmtTime, printerName, sourceLabel } from './notification-labels';
  import NotificationActions from './NotificationActions.svelte';

  const ctx = getAppContext();
  const center = ctx.notifications;

  let narrow = $derived(ctx.ui.isNarrow);
  let open = $derived(center.open);

  /** Колонка правой панели; null — панели нет (нет принтера или плагина), панель прижимается к краю окна. */
  let panelBox = $state<{ right: number; top: number; height: number } | null>(null);
  let vw = $state(typeof window !== 'undefined' ? window.innerWidth : 1200);
  let panelWidth = $derived(Math.max(200, Math.min(400, vw - (panelBox?.right ?? 0) - 16)));

  function measureColumn(): void {
    const col = document.querySelector<HTMLElement>('aside.right-panel');
    vw = window.innerWidth;
    if (!col) {
      panelBox = null;
      return;
    }
    const r = col.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) {
      panelBox = null;
      return;
    }
    panelBox = {
      right: Math.round(r.width),
      top: Math.round(r.top),
      height: Math.round(r.height),
    };
  }

  function close(): void {
    center.setOpen(false);
  }

  let filter = $state<NotificationSeverity | 'all'>('all');
  let settingsOpen = $state(false);

  $effect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (settingsOpen) settingsOpen = false;
      else close();
    }
    window.addEventListener('keydown', onKey);

    // Узкий экран: лист на всю ширину под шапкой, колонка правой панели не нужна
    if (narrow) return () => window.removeEventListener('keydown', onKey);

    measureColumn();

    const col = document.querySelector<HTMLElement>('aside.right-panel');
    const ro = new ResizeObserver(() => measureColumn());
    if (col) ro.observe(col);

    let mo: MutationObserver | null = null;
    if (col?.parentElement) {
      mo = new MutationObserver(() => measureColumn());
      mo.observe(col.parentElement, { childList: true });
    }

    window.addEventListener('resize', measureColumn);

    return () => {
      ro.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', measureColumn);
      window.removeEventListener('keydown', onKey);
    };
  });

  let filtered = $derived.by(() => {
    const list = center.items;
    if (filter === 'all') return list;
    return list.filter((n) => n.severity === filter);
  });

  function isPrinterActive(id: string): boolean {
    return id === ctx.printerManager.activePrinterId;
  }

  // ---------------- настройки ----------------
  let newPattern = $state('');

  function addPattern(): void {
    const p = newPattern.trim();
    if (!p) return;
    try {
      new RegExp(p);
    } catch {
      return;
    }
    center.setIgnoredPatterns([...center.ignoredPatterns, p]);
    newPattern = '';
  }

  function removePattern(i: number): void {
    center.setIgnoredPatterns(center.ignoredPatterns.filter((_, idx) => idx !== i));
  }
</script>

{#if open}
  <div
    class="notifications-panel"
    class:sheet={narrow}
    class:detached={!narrow && !panelBox}
    style:inset-inline-end={narrow || !panelBox ? undefined : `${panelBox.right}px`}
    style:top={narrow || !panelBox ? undefined : `${panelBox.top}px`}
    style:height={narrow || !panelBox ? undefined : `${panelBox.height}px`}
    style:width={narrow ? undefined : `${panelWidth}px`}
    role="dialog"
    aria-label={ctx.i18n.t('notifications.title')}
  >
    <header class="panel-header">
      <span class="panel-title">{ctx.i18n.t('notifications.title')}</span>
      <button class="icon-btn" onclick={close} title={ctx.i18n.t('common.close')} aria-label={ctx.i18n.t('common.close')}>
        <Icon name="x" size={14} />
      </button>
    </header>

    <div class="panel-toolbar">
      <div class="filter-bar">
        {#each ['all', 'critical', 'error', 'info'] as sev (sev)}
          <button
            class="filter-btn"
            class:active={filter === sev}
            onclick={() => (filter = sev as NotificationSeverity | 'all')}
          >
            {sev === 'all' ? ctx.i18n.t('notifications.filterAll') : ctx.i18n.t(`notifications.sev.${sev}`)}
          </button>
        {/each}
      </div>

      <button
        class="icon-btn"
        onclick={() => center.dismissAll()}
        title={ctx.i18n.t('notifications.dismissAll')}
        aria-label={ctx.i18n.t('notifications.dismissAll')}
      >
        <Icon name="trash" size={14} />
      </button>

      <button
        class="icon-btn"
        class:active={settingsOpen}
        onclick={() => (settingsOpen = !settingsOpen)}
        title={ctx.i18n.t('notifications.settings')}
        aria-label={ctx.i18n.t('notifications.settings')}
        aria-expanded={settingsOpen}
      >
        <Icon name="settings" size={14} />
      </button>
    </div>

    {#if settingsOpen}
      <div class="settings-panel">
        <label class="check">
          <input
            type="checkbox"
            checked={center.soundEnabled}
            onchange={(e) => center.setSoundEnabled(e.currentTarget.checked)}
          />
          {ctx.i18n.t('notifications.soundEnabled')}
        </label>

        <div class="pat-title">{ctx.i18n.t('notifications.ignoredPatterns')}</div>
        <div class="pat-hint">{ctx.i18n.t('notifications.ignoredHint')}</div>

        {#if center.ignoredPatterns.length > 0}
          <div class="pat-list">
            {#each center.ignoredPatterns as p, i (i)}
              <div class="pat-row">
                <code class="pat-regex">{p}</code>
                <button
                  class="icon-btn"
                  onclick={() => removePattern(i)}
                  title={ctx.i18n.t('notifications.remove')}
                  aria-label={ctx.i18n.t('notifications.remove')}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            {/each}
          </div>
        {/if}

        <div class="pat-add">
          <input
            type="text"
            placeholder={ctx.i18n.t('notifications.patternPlaceholder')}
            bind:value={newPattern}
            onkeydown={(e) => e.key === 'Enter' && addPattern()}
          />
          <button class="btn" onclick={addPattern}>{ctx.i18n.t('notifications.addPattern')}</button>
        </div>
      </div>
    {/if}

    <div class="panel-body">
      {#if filtered.length === 0}
        <p class="empty">{ctx.i18n.t('notifications.empty')}</p>
      {:else}
        {#each filtered as n (n.id)}
          <div
            class="notif"
            class:critical={n.severity === 'critical'}
            class:error={n.severity === 'error'}
            class:info={n.severity === 'info'}
            class:unseen={!n.seen}
          >
            <div class="notif-head">
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
              <span class="time">{fmtTime(ctx, n.time, true)}</span>
              <button
                class="icon-btn"
                title={ctx.i18n.t('notifications.ignore')}
                aria-label={ctx.i18n.t('notifications.ignore')}
                onclick={() => center.ignoreText(n.text)}
              >
                <Icon name="filter" size={12} />
              </button>
              <button
                class="icon-btn"
                title={ctx.i18n.t('notifications.dismiss')}
                aria-label={ctx.i18n.t('notifications.dismiss')}
                onclick={() => center.dismiss(n.id)}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
            <div class="notif-text">
              <span>{n.text}</span>
              <NotificationActions pluginId={n.pluginId} actions={n.actions} />
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .notifications-panel {
    position: fixed;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border-inline-start: 1px solid var(--border-color);
    box-shadow: var(--np-shadow-x, -8px) 0 16px -8px rgba(0, 0, 0, 0.35);
    z-index: 450;
    overflow: hidden;
    animation: np-in 300ms ease-out;
  }

  @keyframes np-in {
    from {
      clip-path: inset(-32px 0 -32px 100%);
    }
    to {
      clip-path: inset(-32px -32px -32px -32px);
    }
  }

  /* RTL: панель растёт от левого края (правая колонка в RTL слева) */
  @keyframes np-in-rtl {
    from {
      clip-path: inset(-32px 100% -32px 0);
    }
    to {
      clip-path: inset(-32px -32px -32px -32px);
    }
  }
  :global([dir='rtl']) .notifications-panel {
    --np-shadow-x: 8px;
    animation-name: np-in-rtl;
  }

  /* Нет колонки правой панели: прижимаемся к краю окна под шапкой */
  .notifications-panel.detached {
    inset-inline-end: 0;
    top: var(--header-height, 48px);
    bottom: 0;
  }

  /* Узкий экран: лист на всю ширину под шапкой хоста (поверх боковых панелей, z-index 450) */
  .notifications-panel.sheet {
    inset-inline: 0;
    top: var(--header-height, 48px);
    bottom: 0;
    border-inline-start: none;
    box-shadow: none;
    animation: np-fade 150ms ease-out;
  }

  @keyframes np-fade {
    from { opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .notifications-panel.sheet { animation: none; }
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .panel-title {
    flex: 1;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .panel-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .filter-bar {
    display: flex;
    gap: 2px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex: 1;
  }

  .filter-btn {
    flex: 1;
    padding: var(--space-xs);
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .filter-btn:hover { background: var(--bg-surface-hover); }
  .filter-btn.active { background: var(--bg-surface-active); color: var(--accent); }

  .icon-btn {
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
    flex-shrink: 0;
  }

  .icon-btn:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .icon-btn.active { background: var(--bg-surface-active); color: var(--accent); }

  .btn {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    white-space: nowrap;
  }

  .btn:hover { background: var(--bg-surface-active); }

  .settings-panel {
    padding: var(--space-md);
    border-bottom: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    flex-shrink: 0;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .pat-title {
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .pat-hint {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
  }

  .pat-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 120px;
    overflow-y: auto;
  }

  .pat-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 2px var(--space-xs);
    background: var(--bg-surface-hover);
    border-radius: var(--radius-sm);
  }

  .pat-regex {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-sm);
    color: var(--accent);
  }

  .pat-add {
    display: flex;
    gap: var(--space-xs);
  }

  .pat-add input {
    flex: 1;
    min-width: 0;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-app, var(--bg-surface));
    color: var(--text-primary);
    font-family: monospace;
    font-size: var(--font-size-sm);
  }

  .pat-add input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .empty {
    color: var(--text-muted);
    text-align: center;
    padding: var(--space-md);
    font-size: var(--font-size-sm);
  }

  .notif {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface-hover);
  }

  .notif.unseen {
    border-inline-start: 3px solid var(--accent);
  }

  .notif.critical { border-color: var(--danger); }
  .notif.error { border-color: var(--warning); }
  .notif.info { border-color: var(--accent); }

  .notif-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    font-size: var(--font-size-xs);
    color: var(--text-muted);
  }

  .notif .sev {
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .notif.critical .sev { color: var(--danger); }
  .notif.error .sev { color: var(--warning); }
  .notif.info .sev { color: var(--accent); }

  .notif .src {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Бейдж принтера: компактный чип с именем. inactive = muted (не-активный принтер). */
  .notif .printer {
    padding: 0 6px;
    border-radius: 3px;
    background: var(--bg-surface-active);
    color: var(--accent);
    font-weight: 600;
    font-size: var(--font-size-2xs);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
    flex-shrink: 0;
  }

  .notif .printer.inactive {
    background: var(--bg-surface-hover);
    color: var(--text-muted);
  }

  .notif .time {
    font-family: monospace;
    flex-shrink: 0;
    margin-inline-start: auto;
  }

  .notif-text {
    min-width: 0;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: monospace;
  }

</style>
