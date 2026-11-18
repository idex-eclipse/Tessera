<script lang="ts">
  import { untrack } from 'svelte';
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import { EditorState } from '@codemirror/state';
  import { history as editorHistory, historyField } from '@codemirror/commands';
  import TextEditorDialog from '../../../shared/text-editor-dialog/text-editor-dialog.svelte';
  import ImageViewerDialog from '../../../shared/image-viewer-dialog/image-viewer-dialog.svelte';
  import Icon from '../../../shared/icons/Icon.svelte';
  import { configBackupRef, createFileOps, type FileRef } from '../../../shared/file-table/file-ops';
  import { loadMacroIndex, macroSectionEdit, type MacroDefinition } from '../../../shared/text-editor-dialog/macro-index';
  import type { KlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte.ts';
  import {
    clearConfigSession, closeConfigSessionTab, editorSession, openConfigSessionFile, requestConfigSessionClose,
    saveAllConfigSession, saveConfigSessionTab, selectConfigSessionTab, sessionTabId,
    type ConfigSessionTab,
  } from '../../state/editor-session.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const ops = createFileOps(api);
  let printerId = $derived(api.printer.id);
  let uiDir = $state<'ltr' | 'rtl'>(document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr');
  $effect(() => api.onLocaleChange((_locale, direction) => { uiDir = direction; }));
  let session = $derived(editorSession(printerId));
  let active = $derived(session.tabs.find((tab) => tab.id === session.activeId) ?? null);
  let macroNames = $state<string[]>([]);
  let macroDefinitions = $state<MacroDefinition[]>([]);
  let macroFiles = new Map<string, string>();
  let dirtyKlipper = $derived(Boolean(session.restartAttempt?.files.length) || session.tabs.some((tab) => tab.content !== tab.saved &&
    tab.ref.root === 'config' && /\.(cfg|conf)$/i.test(tab.ref.path) && !/^moonraker\.conf$/i.test(tab.ref.path)));
  let dirtyMoonraker = $derived(session.moonrakerRestartPending || session.tabs.some((tab) => tab.content !== tab.saved &&
    tab.ref.root === 'config' && /^moonraker\.conf$/i.test(tab.ref.path)));
  let saveLabel = $derived(dirtyKlipper ? i18n.t('ft.saveAllRestart')
    : dirtyMoonraker ? i18n.t('ft.saveRestartMk') : i18n.t('config.saveAllClose'));
  let hasSettings = $derived(active?.kind === 'text' && /\.(cfg|conf)$/i.test(active.ref.path));
  let settingsOpen = $state(false);
  let settingsToggle: ((anchor: HTMLElement) => void) | null = null;
  let actionsMatrix = $state(false);
  let toolbarEl = $state<HTMLDivElement | null>(null);
  let measureEl = $state<HTMLDivElement | null>(null);
  let beforeLeave: (() => void) | null = null;

  $effect(() => {
    const toolbar = toolbarEl;
    const measure = measureEl;
    void saveLabel;
    if (!toolbar || !measure) return;
    // The hidden, unwrapped row gives the real translated width without layout feedback.
    const update = () => { actionsMatrix = hasSettings && measure.getBoundingClientRect().width > toolbar.getBoundingClientRect().width / 2; };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(toolbar);
    observer?.observe(measure);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  });

  $effect(() => { if (!hasSettings) settingsOpen = false; });

  /** Commit a macro peek before the shared shell changes the active file or hides it. */
  function leaveActive(): void { beforeLeave?.(); }

  function selectTab(id: string): void {
    leaveActive();
    selectConfigSessionTab(printerId, id);
  }

  function minimize(): void {
    leaveActive();
    session.expanded = false;
  }

  function requestClose(): void {
    leaveActive();
    requestConfigSessionClose(printerId);
  }

  function saveAll(): Promise<boolean> {
    leaveActive();
    return saveAllConfigSession(api, printerId);
  }

  /** Reuse the host strip gesture so wheel scrolling follows LTR/RTL and releases at either end. */
  function horizontalWheel(node: HTMLElement) {
    function onWheel(event: WheelEvent): void {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (node.scrollWidth <= node.clientWidth) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? node.clientWidth : 1;
      const before = node.scrollLeft;
      node.scrollLeft += event.deltaY * unit * (uiDir === 'rtl' ? -1 : 1);
      if (node.scrollLeft !== before) event.preventDefault();
    }
    node.addEventListener('wheel', onWheel, { passive: false });
    return { destroy(): void { node.removeEventListener('wheel', onWheel); } };
  }

  $effect(() => {
    const owner = printerId;
    const tab = active;
    // Index reads only when a config tab becomes active, not after every keystroke.
    macroNames = [];
    macroDefinitions = [];
    macroFiles = new Map();
    if (tab?.ref.root === 'config' && /\.cfg$/i.test(tab.ref.path)) {
      untrack(() => { void refreshMacroIndex().catch(() => { /* Retry on the next lookup. */ }); });
    }
    void owner;
  });

  /** The modal does not own this list, so closing its DOM cannot discard a peek edit. */
  async function refreshMacroIndex(): Promise<void> {
    const owner = printerId;
    const buffered = new Map(session.tabs.filter((tab) => tab.ref.root === 'config' && tab.kind === 'text')
      .map((tab) => [tab.ref.path, tab.content]));
    const result = await loadMacroIndex(api.moonrakerFor(owner), ops.readText, buffered);
    if (printerId !== owner) return;
    macroFiles = result.files;
    macroDefinitions = result.definitions;
    macroNames = [...new Set(result.definitions.map((definition) => definition.name.toUpperCase()))];
  }

  async function lookupMacro(name: string): Promise<MacroDefinition[]> {
    await refreshMacroIndex();
    return macroDefinitions.filter((definition) => definition.name.toUpperCase() === name.toUpperCase());
  }

  function macroSource(path: string): string | null {
    return session.tabs.find((tab) => tab.ref.root === 'config' && tab.ref.path === path)?.content
      ?? macroFiles.get(path) ?? null;
  }

  /** Keep peek changes and CodeMirror undo history in the target file's session tab. */
  function editPeek(definition: MacroDefinition, section: string): void {
    const ref: FileRef = { root: 'config', path: definition.path, isDir: false };
    const tab = session.tabs.find((item) => item.id === sessionTabId(ref));
    const original = tab?.content ?? macroFiles.get(definition.path);
    if (original === undefined) return;
    const edit = macroSectionEdit(original, definition, section);
    if (!edit) return;
    const previous = tab?.snapshot
      ? EditorState.fromJSON(tab.snapshot, { extensions: [editorHistory()] }, { history: historyField })
      : EditorState.create({ doc: original, extensions: [editorHistory()] });
    const snapshot = previous.update({ changes: edit }).state.toJSON({ history: historyField });
    const next = original.slice(0, edit.from) + edit.insert + original.slice(edit.to);
    if (tab) { tab.content = next; tab.snapshot = snapshot; }
    else session.tabs.push({ id: sessionTabId(ref), ref, kind: 'text', content: next,
      saved: original, readonly: false, loading: false, snapshot });
    macroFiles.set(definition.path, next);
  }

  async function navigateToMacro(definition: MacroDefinition): Promise<void> {
    const ref: FileRef = { root: 'config', path: definition.path, isDir: false };
    await openConfigSessionFile(api, ref, { line: definition.firstLine });
  }

  function requestTabClose(id: string): void {
    leaveActive();
    const tab = session.tabs.find((item) => item.id === id);
    if (!tab || session.busy) return;
    if (tab.content !== tab.saved) session.tabCloseId = id;
    else void closeConfigSessionTab(api, printerId, id, false);
  }

  async function saveActive(text: string): Promise<boolean> {
    const tab = active;
    if (!tab) return false;
    tab.content = text;
    return saveConfigSessionTab(api, printerId, tab.id);
  }

  async function loadBackup(tab: ConfigSessionTab): Promise<{ text: string; path: string } | null> {
    const owner = printerId;
    const backup = tab.attemptBackup
      ? { text: await ops.readText(tab.attemptBackup, api.moonrakerFor(owner)), ref: tab.attemptBackup }
      : await ops.readConfigBackup(tab.ref, api.moonrakerFor(owner));
    return backup ? { text: backup.text.replace(/\r\n?/g, '\n'), path: backup.ref.path } : null;
  }

  function saveRestart(_text: string, _state: KlippyState): Promise<boolean> {
    return saveAllConfigSession(api, printerId);
  }
</script>

{#if active && session.expanded}
  <div class="session-window" role="dialog" aria-modal="true" aria-label={i18n.t('config.editorBannerTitle')} dir={uiDir}>
    <!-- One shell keeps mixed file tabs and session actions above every editor type. -->
    <div class="session-toolbar" bind:this={toolbarEl}>
      <div class="session-tabs" role="tablist" aria-label={i18n.t('config.editorBannerTitle')} use:horizontalWheel>
        {#each session.tabs as tab (tab.id)}
          <div class="session-tab" class:active={tab.id === active.id} role="presentation">
            <button class="session-tab-select" role="tab" aria-selected={tab.id === active.id}
              title={`${tab.ref.root}/${tab.ref.path}`} onclick={() => selectTab(tab.id)}>
              <span dir="ltr">{tab.ref.path}</span>{#if tab.content !== tab.saved}<span aria-hidden="true"> •</span>{/if}
            </button>
            <button class="session-tab-close" aria-label={i18n.t('config.closeTab', { file: tab.ref.path })}
              title={i18n.t('config.closeTab', { file: tab.ref.path })} disabled={session.busy}
              onclick={() => requestTabClose(tab.id)}><Icon name="x" size={13} /></button>
          </div>
        {/each}
      </div>
      <div class="session-actions" class:matrix={actionsMatrix && hasSettings}>
        <!-- Render order follows visual order so keyboard focus follows the active layout. -->
        {#snippet settingsAction()}
          {#if hasSettings}
            <button class="session-action" class:active={settingsOpen} title={i18n.t('config.editorSettings')}
              aria-label={i18n.t('config.editorSettings')}
              onclick={(event) => settingsToggle?.(event.currentTarget)}><Icon name="settings" size={15} /><span class="btn-label">{i18n.t('config.editorSettings')}</span></button>
          {/if}
        {/snippet}
        {#snippet minimizeAction()}
        <button class="session-action" title={i18n.t('config.minimizeEditor')} aria-label={i18n.t('config.minimizeEditor')}
          onclick={minimize}><Icon name="chevron-down" size={15} /><span class="btn-label">{i18n.t('config.minimizeEditor')}</span></button>
        {/snippet}
        {#snippet saveAction()}
          <button class="session-action primary" title={saveLabel} aria-label={saveLabel}
            disabled={session.busy || session.tabs.some((tab) => tab.loading)}
            onclick={() => void saveAll()}><Icon name="refresh" size={15} /><span class="btn-label">{saveLabel}</span></button>
        {/snippet}
        {#snippet closeAction()}
        <button class="session-action" title={i18n.t('ft.close')} aria-label={i18n.t('ft.close')}
          onclick={requestClose}><Icon name="x" size={15} /><span class="btn-label">{i18n.t('ft.close')}</span></button>
        {/snippet}
        {#if actionsMatrix && hasSettings}
          {@render minimizeAction()}
          {@render closeAction()}
          {@render settingsAction()}
          {@render saveAction()}
        {:else}
          {@render settingsAction()}
          {@render minimizeAction()}
          {@render saveAction()}
          {@render closeAction()}
        {/if}
      </div>
      <div class="session-measure-clip" aria-hidden="true">
        <div class="session-actions session-actions-measure" bind:this={measureEl}>
          <span class="session-action"><Icon name="chevron-down" size={15} /><span class="btn-label">{i18n.t('config.minimizeEditor')}</span></span>
          <span class="session-action"><Icon name="x" size={15} /><span class="btn-label">{i18n.t('ft.close')}</span></span>
          {#if hasSettings}<span class="session-action"><Icon name="settings" size={15} /><span class="btn-label">{i18n.t('config.editorSettings')}</span></span>{/if}
          <span class="session-action"><Icon name="refresh" size={15} /><span class="btn-label">{saveLabel}</span></span>
        </div>
      </div>
    </div>
  {#if active.kind === 'text'}
    {#key `${printerId}:${active.id}`}
      <TextEditorDialog
        open={session.expanded}
        embedded
        onRegisterBeforeLeave={(callback) => { beforeLeave = callback; }}
        onRegisterSettings={(callback) => { settingsToggle = callback; }}
        onSettingsOpenChange={(open) => { settingsOpen = open; }}
        title={active.ref.path.split('/').pop() ?? ''}
        loading={active.loading}
        saving={session.busy}
        content={active.content}
        filePath={active.ref.root === 'config' && /\.cfg$/i.test(active.ref.path) ? active.ref.path : undefined}
        activeTabId={active.id}
        tabs={session.tabs.map((tab) => ({ id: tab.id, path: tab.ref.path, dirty: tab.content !== tab.saved }))}
        jumpLine={active.jumpLine ?? 0}
        {macroNames}
        onBufferChange={(text) => { active!.content = text; }}
        editorSnapshot={active.snapshot}
        onEditorSnapshot={(_path, snapshot) => { active!.snapshot = snapshot; }}
        onSelectTab={selectTab}
        onCloseTab={(id, saveChanges) => closeConfigSessionTab(api, printerId, id, saveChanges)}
        onLookupMacro={lookupMacro}
        onMacroSource={macroSource}
        onPeekEdit={editPeek}
        onPeekSave={async (definition) => {
          const tab = session.tabs.find((item) => item.ref.root === 'config' && item.ref.path === definition.path);
          return tab ? saveConfigSessionTab(api, printerId, tab.id) : false;
        }}
        onMacroNavigate={navigateToMacro}
        onSaveAll={saveAll}
        readonly={active.readonly}
        canRestart={!active.readonly}
        restartRequired={dirtyKlipper || dirtyMoonraker}
        restartLabel={saveLabel}
        hasPendingSave={Boolean(session.restartAttempt?.files.length || session.moonrakerRestartPending)}
        restartKind={/^moonraker\.conf$/i.test(active.ref.path) ? 'moonraker' : 'klipper'}
        lang={/\.(cfg|conf)$/i.test(active.ref.path) ? 'klipper' : 'plain'}
        compareInitially={active.compareInitially ?? false}
        loadBackup={configBackupRef(active.ref) ? () => loadBackup(active!) : undefined}
        onSave={saveActive}
        onSaveRestart={saveRestart}
        onRequestClose={() => requestConfigSessionClose(printerId)}
        onClose={() => requestConfigSessionClose(printerId)}
      />
    {/key}
  {:else}
    <ImageViewerDialog
      open={session.expanded}
      embedded
      title={active.ref.path.split('/').pop() ?? ''}
      src={ops.viewUrl(active.ref)}
      onDownload={() => ops.download(active!.ref)}
      onClose={requestClose}
      tabs={session.tabs.map((tab) => ({ id: tab.id, path: tab.ref.path, dirty: tab.content !== tab.saved }))}
      activeTabId={active.id}
      onSelectTab={selectTab}
      onCloseTab={requestTabClose}
    />
  {/if}
  </div>
{/if}

{#if session.error && session.expanded && !session.closePrompt && !session.tabCloseId}
  <div class="session-error" role="alert">{session.error}</div>
{/if}

{#if session.closePrompt || session.tabCloseId}
  <div class="session-prompt-backdrop" role="presentation"></div>
  <div class="session-prompt" role="alertdialog" aria-modal="true" dir={uiDir}>
    <strong>{session.tabCloseId
      ? i18n.t('config.tabUnsaved', { file: session.tabs.find((tab) => tab.id === session.tabCloseId)?.ref.path ?? '' })
      : session.restartAttempt?.files.length || session.moonrakerRestartPending
        ? i18n.t('config.partialSaveWarning') : i18n.t('config.macroUnsaved')}</strong>
    {#if session.error}<p role="alert">{session.error}</p>{/if}
    <div class="prompt-actions">
      {#if session.tabCloseId}
        <button disabled={session.busy} onclick={() => void closeConfigSessionTab(api, printerId, session.tabCloseId!, true)}>{i18n.t('ft.save')}</button>
        <button disabled={session.busy} onclick={() => void closeConfigSessionTab(api, printerId, session.tabCloseId!, false)}>{i18n.t('config.macroDiscard')}</button>
        <button disabled={session.busy} onclick={() => { session.tabCloseId = null; }}>{i18n.t('common.cancel')}</button>
      {:else}
        <button disabled={session.busy} onclick={() => void saveAllConfigSession(api, printerId)}>{saveLabel}</button>
        <button disabled={session.busy} onclick={() => clearConfigSession(printerId)}>{i18n.t(session.restartAttempt?.files.length || session.moonrakerRestartPending ? 'config.closeWithoutRestart' : 'config.macroDiscard')}</button>
        <button disabled={session.busy} onclick={() => { session.closePrompt = false; }}>{i18n.t('common.cancel')}</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .session-window { position: fixed; inset: 0; z-index: 500; display: flex; flex-direction: column; min-inline-size: 0; background: var(--bg-surface); color: var(--text-primary); }
  /* Tabs scroll within the modal, while actions wrap on narrow and RTL layouts. */
  .session-toolbar { position: relative; display: flex; flex-wrap: wrap; align-items: stretch; min-inline-size: 0; border-block-end: 1px solid var(--border-color); background: var(--bg-surface-hover-no-override); }
  .session-tabs { display: flex; flex: 1 1 320px; min-inline-size: 0; gap: var(--space-xs); overflow-x: auto; padding-inline: var(--space-sm); }
  .session-tab { display: flex; flex: none; align-items: stretch; max-inline-size: 220px; border-block-end: 2px solid transparent; }
  .session-tab.active { border-block-end-color: var(--accent); }
  .session-tab-select, .session-tab-close { min-block-size: 44px; border: 0; background: transparent; color: var(--text-primary); cursor: pointer; }
  .session-tab-select { display: flex; align-items: center; min-inline-size: 0; padding-inline: var(--space-xs); }
  .session-tab-select span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-tab-close { display: grid; place-items: center; min-inline-size: 44px; }
  /* A wrapped action group stays at the inline end; translated labels decide the grid threshold. */
  .session-actions { display: flex; flex-wrap: nowrap; align-items: center; justify-content: flex-end; gap: var(--space-xs); box-sizing: border-box; max-inline-size: 100%; padding: var(--space-xs) var(--space-sm); margin-inline-start: auto; }
  /* Size the two columns to their longest labels, then fill width without stretching height. */
  .session-actions.matrix { display: grid; grid-template-columns: max-content max-content; align-items: center; inline-size: max-content; }
  .session-actions.matrix .session-action { min-inline-size: max-content; inline-size: auto; justify-self: stretch; }
  .session-measure-clip { position: absolute; inline-size: 0; block-size: 0; overflow: hidden; pointer-events: none; }
  .session-actions-measure { inline-size: max-content; max-inline-size: none; margin: 0; }
  /* Keep the original editor button colors and compact height in the shared top row. */
  .session-action { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs); max-inline-size: 100%; padding: var(--space-xs) var(--space-md); border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-surface-hover); color: var(--text-primary); font-size: var(--font-size-sm); cursor: pointer; }
  /* Icons keep their intrinsic width even when a translated label is long. */
  .session-action :global(.mpu-icon) { flex: none; }
  .session-action:hover:not(:disabled) { background: var(--border-color); }
  .session-action.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .session-action.primary { background: var(--accent); border-color: var(--accent); }
  .session-action.primary:hover:not(:disabled) { filter: brightness(1.1); }
  .session-action:disabled, .session-tab-close:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-label { white-space: nowrap; }
  /* Icon-only controls preserve the old 44px touch targets without page overflow. */
  @media (max-width: 768px) { .session-tabs { flex-basis: 100%; } .session-action { min-inline-size: 44px; min-block-size: 44px; padding: var(--space-xs); } .btn-label { display: none; } }
  .session-error { position: fixed; inset-block-start: var(--space-sm); inset-inline: var(--space-md); z-index: 550; max-inline-size: min(90vw, 800px); padding: var(--space-sm); background: var(--bg-surface); color: var(--danger); border: 1px solid var(--danger); border-radius: var(--radius-sm); overflow-wrap: anywhere; }
  /* The confirmation stays above either full-screen file surface in both directions. */
  .session-prompt-backdrop { position: fixed; inset: 0; z-index: 600; background: var(--bg-overlay); }
  .session-prompt { position: fixed; inset-inline: 0; top: 35%; margin-inline: auto; z-index: 601; inline-size: min(90vw, 480px); display: grid; gap: var(--space-md); padding: var(--space-lg); background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); }
  .session-prompt p { margin: 0; overflow-wrap: anywhere; }
  .prompt-actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
  .prompt-actions button { min-height: 44px; padding-inline: var(--space-md); background: var(--bg-surface-hover); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm); cursor: pointer; }
</style>
