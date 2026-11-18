<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../shared/icons/Icon.svelte';
  import {
    editorSession, requestConfigSessionClose, requestConfigSessionTabClose,
    saveAllConfigSession, selectConfigSessionTab,
  } from '../../state/editor-session.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  let session = $derived(editorSession(api.printer.id));
  let needsKlipper = $derived(Boolean(session.restartAttempt?.files.length) || session.tabs.some((tab) => tab.content !== tab.saved &&
    tab.ref.root === 'config' && /\.(cfg|conf)$/i.test(tab.ref.path) && !/^moonraker\.conf$/i.test(tab.ref.path)));
  let needsMoonraker = $derived(session.moonrakerRestartPending || session.tabs.some((tab) => tab.content !== tab.saved &&
    tab.ref.root === 'config' && /^moonraker\.conf$/i.test(tab.ref.path)));
  let saveLabel = $derived(needsKlipper ? i18n.t('ft.saveAllRestart')
    : needsMoonraker ? i18n.t('ft.saveRestartMk') : i18n.t('config.saveAllClose'));
</script>

{#if session.tabs.length && !session.expanded}
  <section class="editor-banner" aria-label={i18n.t('config.editorBannerTitle')}>
    <div class="banner-heading">
      <strong>{i18n.t('config.editorBannerTitle')}</strong>
      {#if session.error}<span class="error" role="alert">{session.error}</span>{/if}
    </div>
    <!-- File tabs wrap before the actions so long localized labels cannot cause page scroll. -->
    <div class="banner-content">
      <div class="file-tabs" role="tablist">
        {#each session.tabs as tab (tab.id)}
          <div class="file-tab" class:active={tab.id === session.activeId} role="presentation">
            <button class="tab-select" role="tab" aria-selected={tab.id === session.activeId}
              title={`${tab.ref.root}/${tab.ref.path}`}
              onclick={() => selectConfigSessionTab(api.printer.id, tab.id)}>
              <span dir="ltr">{tab.ref.path}</span>{#if tab.content !== tab.saved}<span aria-hidden="true"> •</span>{/if}
            </button>
            <button class="tab-close" aria-label={i18n.t('config.closeTab', { file: tab.ref.path })}
              title={i18n.t('config.closeTab', { file: tab.ref.path })} disabled={session.busy}
              onclick={() => requestConfigSessionTabClose(api.printer.id, tab.id)}><Icon name="x" size={13} /></button>
          </div>
        {/each}
      </div>
      <div class="actions">
        <button class="primary" disabled={session.busy || session.tabs.some((tab) => tab.loading)}
          onclick={() => void saveAllConfigSession(api, api.printer.id)}>{saveLabel}</button>
        <button disabled={session.busy} onclick={() => requestConfigSessionClose(api.printer.id)}>{i18n.t('ft.close')}</button>
      </div>
    </div>
  </section>
{/if}

<style>
  .editor-banner { min-inline-size: 0; padding: var(--space-sm) var(--space-md); background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); }
  .banner-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-xs); margin-block-end: var(--space-xs); }
  .error { color: var(--danger); overflow-wrap: anywhere; }
  .banner-content { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); }
  .file-tabs { display: flex; flex: 1 1 320px; min-inline-size: 0; gap: var(--space-xs); overflow-x: auto; }
  .file-tab { display: flex; align-items: stretch; flex: 0 1 auto; min-inline-size: 96px; max-inline-size: 220px; border-block-end: 2px solid transparent; }
  .file-tab.active { border-block-end-color: var(--accent); }
  .tab-select, .tab-close { min-block-size: 44px; border: 0; background: transparent; color: var(--text-primary); cursor: pointer; }
  .tab-select { display: flex; align-items: center; min-inline-size: 0; padding-inline: var(--space-xs); }
  .tab-select span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tab-close { flex: none; min-inline-size: 44px; display: grid; place-items: center; }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-xs); margin-inline-start: auto; }
  .actions button { min-block-size: 44px; padding-inline: var(--space-md); background: var(--bg-surface-hover); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm); cursor: pointer; }
  .actions button.primary { border-color: var(--accent); color: var(--accent); }
  .actions button:disabled, .tab-close:disabled { opacity: 0.6; cursor: default; }
  /* A single-column layout keeps actions reachable on narrow work areas and in RTL. */
  @media (max-width: 768px) { .banner-content { display: grid; } .file-tabs { inline-size: 100%; } .actions { margin-inline-start: 0; } }
</style>
