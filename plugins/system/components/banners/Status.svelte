<script lang="ts">
  import { onDestroy } from 'svelte';

  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../shared/icons/Icon.svelte';
  import ConfirmDialog from '../../../shared/confirm-dialog.svelte';
  import HeaderHelp from '../../../shared/header-help/HeaderHelp.svelte';

  import StatusSettingsMenu from '../StatusSettingsMenu.svelte';
  import StatusStats from '../StatusStats.svelte';
  import {
    usePrintStatus,
    computeProgress,
    computeEta,
    fmtClock,
    type ProgressMode,
  } from '../../use-print-status.svelte.ts';

  import { readEnabledFields, type StatusFieldId } from '../../use-print-status.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = usePrintStatus(api);

  let mode = $state(api.settings.get<ProgressMode>('status.progressMode') ?? 'file');
  let banner = $state(api.settings.get<boolean>('status.banner') ?? true);
  let fieldsOpen = $state(api.settings.get<boolean>('status.bannerFieldsOpen') ?? true);
  let fields = $state<StatusFieldId[]>(readEnabledFields(api));

  const off = api.settings.onChange((k, v) => {
    if (k === 'status.progressMode') mode = v as ProgressMode;
    if (k === 'status.banner') banner = Boolean(v);
    if (k === 'status.bannerFieldsOpen') fieldsOpen = Boolean(v);
  });
  onDestroy(off);

  function toggleFields(): void {
    fieldsOpen = !fieldsOpen;
    api.settings.set('status.bannerFieldsOpen', fieldsOpen);
  }

  let m = $derived(store.model);
  let printing = $derived(m.state === 'printing' || m.state === 'paused');
  let progress = $derived(computeProgress(m, mode));
  let eta = $derived(computeEta(m, mode));

  let visible = $derived(banner && m.klippyReady);

  // ---------------- pause / resume / cancel ----------------
  let busy = $state('');
  let confirmCancel = $state(false);

  async function act(method: 'printer.print.pause' | 'printer.print.resume' | 'printer.print.cancel'): Promise<void> {
    if (busy) return;
    busy = method;
    try {
      await api.moonraker().request(method);
    } catch (e) {
      console.error('[status] print action failed:', method, e);
    } finally {
      busy = '';
    }
  }
</script>

{#if visible}
  <div class="status-banner">
    <div class="sb-row">
      <span class="state" class:printing class:paused={m.state === 'paused'}>
        {m.state}
      </span>
      <span class="fname" title={m.filename}>{m.filename || '—'}</span>

      {#if printing}
        <div class="bar">
          <div class="fill" style="width: {progress != null ? progress * 100 : 0}%"></div>
        </div>
        <span class="pct">{progress != null ? `${Math.round(progress * 100)}%` : '—'}</span>
        <span class="eta">{i18n.t('system.status.eta')}: {fmtClock(eta)}</span>

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
    font-size: 12px;
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
</style>