<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../shared/icons/Icon.svelte';
  import { useNotifications, type NotificationItem, type NotificationSeverity } from '../../use-notifications.svelte.ts';
  import { systemUiState } from '../../system-ui-state.svelte.ts';
  import { ensurePrintTracker } from '../../print-tracker.ts';

  let panelBox = $state({ right: 0, top: 0, height: 0 });
  let vw = $state(typeof window !== 'undefined' ? window.innerWidth : 1200);
  let panelWidth = $derived(Math.max(200, Math.min(400, vw - panelBox.right - 16)));

  /** Источник правды — колонка хоста aside.right-panel: она включает шапку
   *  «Machine Control», футер «Collapse menu», паддинги и рамку, поэтому
   *  центр встанет вплотную к её левой кромке и по всей её высоте.
   *  Кастом-элемент mpu-system-right-panel меньше колонки — его не меряем. */
  function measureColumn(): void {
    const col = document.querySelector('aside.right-panel') as HTMLElement | null;
    if (!col) return;
    const r = col.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    panelBox = {
      right: Math.round(r.width),
      top: Math.round(r.top),
      height: Math.round(r.height),
    };
    vw = window.innerWidth;
  }

  $effect(() => {
    if (!open) return;
    measureColumn();

    const col = document.querySelector('aside.right-panel') as HTMLElement | null;

    const ro = new ResizeObserver(() => measureColumn());
    if (col) ro.observe(col);

    let mo: MutationObserver | null = null;
    if (col?.parentElement) {
      mo = new MutationObserver(() => measureColumn());
      mo.observe(col.parentElement, { childList: true });
    }

    window.addEventListener('resize', measureColumn);

    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (settingsOpen) settingsOpen = false;
      else close();
    }
    window.addEventListener('keydown', onKey);

    return () => {
      ro.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', measureColumn);
      window.removeEventListener('keydown', onKey);
    };
  });

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useNotifications(api);

  // Оверлей смонтирован всегда (постоянная поверхность): он запускает трекер состояния
  // печати всех принтеров для гарда system-print-safety (идемпотентно).
  ensurePrintTracker(api);

  let open = $derived(systemUiState.notificationsOpen);

  let filter = $state<NotificationSeverity | 'all'>('all');
  let settingsOpen = $state(false);

  let filtered = $derived.by(() => {
    const list = store.items;
    if (filter === 'all') return list;
    return list.filter((n) => n.severity === filter);
  });

  function severityLabel(s: NotificationSeverity): string {
    return i18n.t(`system.notifications.sev.${s}`);
  }

  function sourceLabel(s: NotificationItem['source']): string {
    return i18n.t(`system.notifications.src.${s}`);
  }

  /** Имя принтера: из реестра; fallback на id (удалённый принтер). */
  function printerName(id: string): string {
    return api.printers.find((p) => p.id === id)?.name ?? id;
  }

  function isPrinterActive(id: string): boolean {
    return id === api.printer.id;
  }

  function fmtTime(t: number): string {
    return new Date(t).toLocaleString(i18n.locale);
  }

  function close(): void {
    systemUiState.notificationsOpen = false;
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
    const list = [...store.settings.ignoredPatterns, p];
    store.setIgnoredPatterns(list);
    newPattern = '';
  }

  function removePattern(i: number): void {
    const list = store.settings.ignoredPatterns.filter((_, idx) => idx !== i);
    store.setIgnoredPatterns(list);
  }
</script>

{#if open && panelBox.right > 0}
  <div
    class="notifications-panel"
    style:inset-inline-end="{panelBox.right}px"
    style:top="{panelBox.top}px"
    style:height="{panelBox.height}px"
    style:width="{panelWidth}px"
    role="dialog"
    aria-label={i18n.t('system.notifications.title')}
  >
    <header class="panel-header">
      <span class="panel-title">{i18n.t('system.notifications.title')}</span>
      <button class="icon-btn" onclick={close} title={i18n.t('system.notifications.dismiss')}>
        <Icon name="x" size={14} />
      </button>
    </header>

    <div class="panel-toolbar">
      <div class="filter-bar">
        {#each ['all', 'critical', 'error', 'info'] as sev (sev)}
          <button
            class="filter-btn"
            class:active={filter === sev}
            onclick={() => (filter = sev as any)}
          >
            {sev === 'all' ? i18n.t('system.notifications.filterAll') : i18n.t(`system.notifications.sev.${sev}`)}
          </button>
        {/each}
      </div>

      <button class="icon-btn" onclick={() => store.dismissAll()} title={i18n.t('system.notifications.dismissAll')}>
        <Icon name="trash" size={14} />
      </button>

      <button
        class="icon-btn"
        class:active={settingsOpen}
        onclick={() => (settingsOpen = !settingsOpen)}
        title={i18n.t('system.notifications.settings')}
      >
        <Icon name="settings" size={14} />
      </button>
    </div>

    {#if settingsOpen}
      <div class="settings-panel">
        <label class="check">
          <input
            type="checkbox"
            checked={store.settings.soundEnabled}
            onchange={(e) => store.setSoundEnabled(e.currentTarget.checked)}
          />
          {i18n.t('system.notifications.soundEnabled')}
        </label>

        <div class="pat-title">{i18n.t('system.notifications.ignoredPatterns')}</div>

        {#if store.settings.ignoredPatterns.length > 0}
          <div class="pat-list">
            {#each store.settings.ignoredPatterns as p, i (i)}
              <div class="pat-row">
                <code class="pat-regex">{p}</code>
                <button class="icon-btn" onclick={() => removePattern(i)} title={i18n.t('system.notifications.remove')}>
                  <Icon name="x" size={12} />
                </button>
              </div>
            {/each}
          </div>
        {/if}

        <div class="pat-add">
          <input
            type="text"
            placeholder={i18n.t('system.notifications.patternPlaceholder')}
            bind:value={newPattern}
            onkeydown={(e) => e.key === 'Enter' && addPattern()}
          />
          <button class="btn" onclick={addPattern}>{i18n.t('system.notifications.addPattern')}</button>
        </div>
      </div>
    {/if}

    <div class="panel-body">
      {#if filtered.length === 0}
        <p class="empty">{i18n.t('system.notifications.empty')}</p>
      {:else}
        {#each filtered as n (n.id)}
          <div class="notif" class:critical={n.severity === 'critical'} class:error={n.severity === 'error'} class:info={n.severity === 'info'} class:unseen={!n.seen}>
            <div class="notif-head">
              <span class="sev">{severityLabel(n.severity)}</span>
              <span class="src">{sourceLabel(n.source)}</span>
              <span class="printer" class:inactive={!isPrinterActive(n.printerId)} title={printerName(n.printerId)}>
                {printerName(n.printerId)}
              </span>
              <span class="time">{fmtTime(n.time)}</span>
              <button
                class="icon-btn"
                title={i18n.t('system.notifications.dismiss')}
                onclick={() => store.dismiss(n.id)}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
            <div class="notif-text">{n.text}</div>
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
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
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
    font-size: 11px;
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
    font-size: 10px;
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
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: monospace;
  }
</style>