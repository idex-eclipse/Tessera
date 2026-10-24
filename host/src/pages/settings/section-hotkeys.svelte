<script lang="ts">
  import { onDestroy } from 'svelte';

  import { getAppContext } from '../../app-context';
  import { confirm } from '../../components/confirm/confirm-dialog.svelte.ts';
  import { HOST_HOTKEY_OWNER } from '../../core/host-hotkeys';
  import type { HotkeyItem } from '../../core/hotkey-manager.svelte.ts';
  import { comboFromEvent, displayCombo, formatCombo, parseCombo } from '../../core/hotkeys';

  const { hotkeys, settings, loader, i18n } = getAppContext();

  /** Ключ записываемой сейчас клавиши (null — запись не идёт). */
  let recordingKey = $state<string | null>(null);
  let resume: (() => void) | null = null;

  interface Group {
    pluginId: string;
    title: string;
    items: HotkeyItem[];
  }

  let groups = $derived.by<Group[]>(() => {
    const byPlugin = new Map<string, HotkeyItem[]>();
    for (const item of hotkeys.items) {
      const list = byPlugin.get(item.pluginId);
      if (list) list.push(item);
      else byPlugin.set(item.pluginId, [item]);
    }

    const result: Group[] = [...byPlugin].map(([pluginId, items]) => ({
      pluginId,
      title:
        pluginId === HOST_HOTKEY_OWNER
          ? i18n.t('settings.hotkeys.hostGroup')
          : (loader.getLoadedPlugin(pluginId)?.manifest.name ?? pluginId),
      items,
    }));

    // Хост первым, остальные в порядке регистрации.
    return result.sort(
      (a, b) =>
        Number(b.pluginId === HOST_HOTKEY_OWNER) - Number(a.pluginId === HOST_HOTKEY_OWNER),
    );
  });

  let hasCustomized = $derived(hotkeys.items.some((i) => i.customized));

  function show(keys: string | null): string {
    const combo = keys ? parseCombo(keys) : null;
    return combo ? displayCombo(combo) : '—';
  }

  function titleOf(item: HotkeyItem): string {
    return item.titleKey ? i18n.t(item.titleKey) : item.id;
  }

  function stopRecording(): void {
    recordingKey = null;
    resume?.();
    resume = null;
    window.removeEventListener('keydown', onRecordKey, true);
  }

  function startRecording(item: HotkeyItem): void {
    if (recordingKey) stopRecording();
    recordingKey = item.key;
    // Пока идёт запись, хоткеи хоста и плагинов не срабатывают.
    resume = hotkeys.suspend();
    window.addEventListener('keydown', onRecordKey, true);
  }

  function onRecordKey(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      stopRecording();
      return;
    }

    const combo = comboFromEvent(event);
    if (!combo || !recordingKey) return; // только модификатор — ждём основную клавишу

    settings.setHotkeyOverride(recordingKey, formatCombo(combo));
    stopRecording();
  }

  function toggleDisabled(item: HotkeyItem): void {
    if (item.userDisabled) settings.clearHotkeyOverride(item.key);
    else settings.setHotkeyOverride(item.key, null);
  }

  async function resetAll(): Promise<void> {
    const ok = await confirm({
      title: i18n.t('settings.hotkeys.title'),
      message: i18n.t('settings.hotkeys.resetAllConfirm'),
      danger: true,
    });
    if (ok) settings.resetHotkeyOverrides();
  }

  onDestroy(() => {
    if (recordingKey) stopRecording();
  });
</script>

<div class="section">
  <div class="section-head">
    <p class="hint">{i18n.t('settings.hotkeys.hint')}</p>
    <button class="btn btn-secondary" disabled={!hasCustomized} onclick={resetAll}>
      {i18n.t('settings.hotkeys.resetAll')}
    </button>
  </div>

  {#if groups.length === 0}
    <p class="empty">{i18n.t('settings.about.noHotkeys')}</p>
  {/if}

  {#each groups as group (group.pluginId)}
    <div class="group">
      <div class="group-title">{group.title}</div>

      {#each group.items as item (item.key)}
        {@const recording = recordingKey === item.key}
        <div class="row" class:inactive={!item.enabled}>
          <div class="row-main">
            <span class="row-title">{titleOf(item)}</span>
            <span class="row-id">{item.id}</span>
            <span class="badge">{i18n.t(`settings.about.hotkeyScope.${item.scope}`)}</span>
            {#if item.userDisabled}
              <span class="badge">{i18n.t('settings.hotkeys.userDisabled')}</span>
            {:else if item.conflictsWith.length > 0}
              <span class="badge badge-warn" title={item.conflictsWith.join(', ')}>
                {i18n.t('settings.hotkeys.conflict', { with: item.conflictsWith.join(', ') })}
              </span>
            {/if}
          </div>

          <div class="row-keys">
            {#if recording}
              <kbd class="recording">{i18n.t('settings.hotkeys.pressKeys')}</kbd>
            {:else}
              <kbd class:muted={item.userDisabled}>{show(item.keys)}</kbd>
              {#if item.customized && !item.userDisabled}
                <span class="default" title={i18n.t('settings.hotkeys.default')}>
                  ({show(item.defaultKeys)})
                </span>
              {/if}
            {/if}
          </div>

          <div class="row-actions">
            {#if recording}
              <button class="btn btn-secondary" class:disable={recording} onclick={stopRecording}>
                {i18n.t('common.cancel')}
              </button>
            {:else}
              <button class="btn btn-secondary" onclick={() => startRecording(item)}>
                {i18n.t('settings.hotkeys.change')}
              </button>
              <button class="btn btn-primary" onclick={() => toggleDisabled(item)}>
                {item.userDisabled ? i18n.t('settings.enable') : i18n.t('settings.disable')}
              </button>
              <button
                class="btn btn-secondary"
                disabled={!item.customized}
                onclick={() => settings.clearHotkeyOverride(item.key)}
              >
                {i18n.t('common.reset')}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .section { display: flex; flex-direction: column; gap: var(--space-md); }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md);
  }
  .btn {
    padding: var(--space-sm) var(--space-lg);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--font-size-md);
    cursor: pointer;
    white-space: nowrap;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { background: var(--bg-surface-hover-no-override); color: var(--text-primary); }
  .btn-primary { background: var(--accent); color: var(--accent-text, #fff); }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover, var(--accent)); }
  .btn-secondary:hover:not(:disabled) { background: var(--bg-surface-active); }
  .row-actions .btn {
    padding: var(--space-xs) var(--space-md);
    font-size: var(--font-size-sm);
  }
  .hint, .empty { color: var(--text-muted); font-size: var(--font-size-sm); margin: 0; }
  .group { display: flex; flex-direction: column; gap: var(--space-xs); }
  .group-title { font-weight: 600; margin-top: var(--space-xs); }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--space-md);
    padding: var(--space-sm) var(--space-md);
    background: var(--bg-app);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
  }
  .row.inactive .row-main { opacity: 0.7; }
  .row-main { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-sm); min-width: 0; }
  .row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-id { color: var(--text-muted); font-size: var(--font-size-sm); }
  .row-keys { display: flex; align-items: center; gap: var(--space-xs); white-space: nowrap; }
  .row-actions { display: flex; gap: var(--space-xs); }
  kbd {
    font-family: var(--font-mono, monospace);
    padding: 2px var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
  }
  kbd.muted { color: var(--text-muted); }
  kbd.recording { border-color: var(--accent); color: var(--accent); }
  .default { color: var(--text-muted); font-size: var(--font-size-sm); }
  .badge {
    font-size: var(--font-size-sm);
    padding: 0 var(--space-xs);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
  }
  .badge-warn { border-color: var(--warning); color: var(--warning); }
</style>
