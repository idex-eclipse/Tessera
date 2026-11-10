<script lang="ts">
  import { ExtensionPoint, usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import type { ExtensionRef } from '../../../../plugin-sdk/src/types';
  import Icon from '../../../shared/icons/Icon.svelte';
  import ConfirmDialog from '../../../shared/confirm-dialog.svelte';
  import HeaderHelp from '../../../shared/header-help/HeaderHelp.svelte';

  import StatusSettingsMenu from '../shared/StatusSettingsMenu.svelte';
  import StatusStats from '../shared/StatusStats.svelte';
  import {
    usePrintStatus,
    computeProgress,
    computeEta,
    fmtClock,
  } from '../../data/use-print-status.svelte.ts';

  import { useStatusPrefs } from '../../state/status-prefs.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = usePrintStatus(api);

  const prefs = useStatusPrefs(api);
  let mode = $derived(prefs.mode);
  let fieldsOpen = $derived(prefs.bannerFieldsOpen);
  let fields = $derived(prefs.fields);

  function toggleFields(): void {
    prefs.setBannerFieldsOpen(!fieldsOpen);
  }

  let m = $derived(store.model);
  let printing = $derived(m.state === 'printing' || m.state === 'paused');
  let progress = $derived(computeProgress(m, mode));
  let eta = $derived(computeEta(m, mode));

  let visible = $derived(prefs.banner && m.klippyReady);

  // ---------------- extension actions (banner-status-actions) ----------------
  // Re-read on any registry change, same pattern as the Machine page tabs.
  let extVersion = $state(0);
  $effect(() => api.extensions.onChange(() => extVersion++));
  let extActions = $derived.by<ExtensionRef[]>(() => {
    void extVersion;
    return api.extensions.list('banner-status-actions');
  });

  /** Runs a contributed action with the print context documented for the point. */
  function runExtAction(ref: string): void {
    void api.extensions.invoke(ref, { state: m.state, filename: m.filename });
  }

  // ---------------- pause / resume / cancel ----------------
  let busy = $state('');
  let confirmCancel = $state(false);

  async function act(method: 'printer.print.pause' | 'printer.print.resume' | 'printer.print.cancel'): Promise<void> {
    if (busy) return;
    busy = method;
    try {
      await api.moonrakerFor(api.printer.id).request(method);
    } catch (e) {
      console.error('[status] print action failed:', method, e);
    } finally {
      busy = '';
    }
  }
</script>

{#if visible}
  <!-- banner-status replaces the whole banner body, Pause/Resume/Cancel included: a contribution
       taking it over must provide print controls itself. Visibility stays the plugin's decision. -->
  <ExtensionPoint point="banner-status">
    {#snippet original()}
      <div class="status-banner">
        <div class="sb-row">
          <span class="state" class:printing class:paused={m.state === 'paused'}>
            {m.state}
          </span>
          <span class="fname" title={m.filename}>{m.filename || '—'}</span>

          {#if printing}
            <ExtensionPoint point="banner-status-progress">
              {#snippet original()}
                <div class="bar">
                  <div class="fill" style="width: {progress != null ? progress * 100 : 0}%"></div>
                </div>
                <span class="pct">{progress != null ? `${Math.round(progress * 100)}%` : '—'}</span>
              {/snippet}
            </ExtensionPoint>
            <ExtensionPoint point="banner-status-eta">
              {#snippet original()}
                <span class="eta">{i18n.t('system.status.eta')}: {fmtClock(eta, i18n.locale)}</span>
              {/snippet}
            </ExtensionPoint>

            <span class="sb-actions">
              {#if m.state === 'printing'}
                <button
                  class="sb-btn"
                  disabled={busy !== ''}
                  title={i18n.t('system.status.pause')}
                  onclick={() => act('printer.print.pause')}
                >
                  <Icon name="pause" size={13} />
                  {i18n.t('system.status.pause')}
                </button>
              {:else}
                <button
                  class="sb-btn"
                  disabled={busy !== ''}
                  title={i18n.t('system.status.resume')}
                  onclick={() => act('printer.print.resume')}
                >
                  <Icon name="play" size={13} />
                  {i18n.t('system.status.resume')}
                </button>
              {/if}
              <button
                class="sb-btn danger"
                disabled={busy !== ''}
                title={i18n.t('system.status.cancel')}
                onclick={() => (confirmCancel = true)}
              >
                <Icon name="stop" size={13} />
                {i18n.t('system.status.cancel')}
              </button>

              <!-- banner-status-actions (append): extra buttons drawn by us from the extensions' actions;
                   print controls above are intentionally not replaceable. -->
              {#each extActions as a (a.ref)}
                <button class="sb-btn" title={a.title} onclick={() => runExtAction(a.ref)}>
                  {#if a.icon}<Icon name={a.icon} size={13} />{/if}
                  {a.title}
                </button>
              {/each}
            </span>

            <button
              class="sb-chev"
              title={i18n.t('system.status.fields')}
              aria-expanded={fieldsOpen}
              onclick={toggleFields}
            >
              <span class="chev" class:open={fieldsOpen}>
                <Icon name="chevron-down" size={14} />
              </span>
            </button>
          {/if}

          <span class="banner-actions">
            <StatusSettingsMenu {api} showBannerToggle={false} />
            <HeaderHelp title={i18n.t('system.status.help.Title')}>
              <h4>{i18n.t('system.status.help.ModesTitle')}</h4>
              <p>{i18n.t('system.status.help.ModesText')}</p>

              <h4>{i18n.t('system.status.help.FieldsTitle')}</h4>
              <p>{i18n.t('system.status.help.FieldsText')}</p>

              <h4>{i18n.t('system.status.help.BannerTitle')}</h4>
              <p>{i18n.t('system.status.help.BannerText')}</p>
            </HeaderHelp>
          </span>
        </div>

        {#if printing && fieldsOpen}
          <div class="sb-fields">
            <StatusStats {m} {mode} {fields} />
          </div>
        {/if}
      </div>
    {/snippet}
  </ExtensionPoint>
{/if}

<ConfirmDialog
  open={confirmCancel}
  title={i18n.t('system.status.cancel')}
  message={i18n.t('system.status.cancelConfirm')}
  confirmLabel={i18n.t('system.status.cancel')}
  danger={true}
  onConfirm={() => {
    confirmCancel = false;
    void act('printer.print.cancel');
  }}
  onClose={() => (confirmCancel = false)}
/>

<style>
  .status-banner {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    margin-bottom: var(--space-md);
  }

  .sb-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-width: 0;
  }

  .state {
    padding: 1px 8px;
    border-radius: 999px;
    font-size: var(--font-size-md);
    font-weight: 700;
    background: var(--bg-surface-hover-no-override);
    color: var(--text-secondary);
    flex-shrink: 0;
    text-transform: capitalize;
  }

  .state.printing {
    background: color-mix(in srgb, var(--success) 18%, transparent);
    color: var(--success);
  }

  .state.paused {
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
  }

  .fname {
    min-width: 0;
    max-width: 30%;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-surface-hover);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    transition: width var(--transition-normal);
  }

  /* A replacing contribution is mounted in .mpu-ext-item, a real box (the point wrapper is
     display: contents). Without this it would not stretch like the original .bar and, in a
     narrow banner, could push the buttons out of the row. */
  :global(.mpu-ext-point[data-point='banner-status-progress'] > .mpu-ext-item) {
    flex: 1;
    min-width: 0;
  }

  .pct {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    flex-shrink: 0;
  }

  .eta {
    font-size: var(--font-size-sm);
    font-family: monospace;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .sb-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    flex-shrink: 0;
  }

  .sb-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-xs-plus);
    cursor: pointer;
  }

  .sb-btn:hover:not(:disabled) {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .sb-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .sb-btn.danger {
    border-color: color-mix(in srgb, var(--danger) 60%, transparent);
    color: var(--danger);
  }

  .sb-chev {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }

  .sb-chev:hover { background: var(--bg-surface-hover); color: var(--text-primary); }

  .chev {
    display: flex;
    color: inherit;
    transform: rotate(-90deg);
    transition: transform var(--transition-fast);
  }

  .chev.open { transform: rotate(0deg); }

  .sb-fields {
    border-top: 1px solid var(--border-color);
    padding-top: var(--space-xs);
  }

  .banner-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    flex-shrink: 0;
    margin-inline-start: auto;
  }

  /* свёрнутый шеврон «указывает в сторону содержимого»: в RTL — влево */
  :global([dir='rtl']) .chev:not(.open) { transform: rotate(90deg); }
</style>
