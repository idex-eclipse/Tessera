<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import Icon from '../../../shared/icons/Icon.svelte';
  import { useKlippyState } from '../../../shared/klippy-state/use-klippy-state.svelte.ts';

  import { useSystem } from '../../use-system.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useSystem(api);
  const klippy = useKlippyState(api); // единственный источник состояния

  // видимость — решение плагина (M): только когда Klipper не ready
  const BAD_STATES = ['error', 'shutdown', 'startup', 'disconnected'];
  let visible = $derived(BAD_STATES.includes(klippy.state));

  let title = $derived(
    klippy.state === 'error'
      ? i18n.t('system.klipperBanner.error')
      : klippy.state === 'shutdown'
        ? i18n.t('system.klipperBanner.shutdown')
        : klippy.state === 'startup'
          ? i18n.t('system.klipperBanner.starting')
          : i18n.t('system.klipperBanner.disconnected'),
  );
  // ------------------------------------------------------------------
  // Pending-фидбек кнопок рестарта (поведение как во Fluidd):
  // - Klipper restart  → обе кнопки неактивны до state === 'startup';
  // - Firmware restart → неактивна только она до state === 'startup'.
  // Страховка: авто-снятие через 30s, если startup так и не пришёл.
  // ------------------------------------------------------------------

  let pending = $state<'klipper' | 'firmware' | null>(null);
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function armPending(kind: 'klipper' | 'firmware'): void {
    pending = kind;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pending = null;
      pendingTimer = null;
    }, 30_000);
  }

  // отпускаем кнопки, когда Klipper начал стартовать (или уже ready)
  $effect(() => {
    const st = klippy.state;
    if (pending && (st === 'startup' || st === 'ready')) {
      pending = null;
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  });

  function restartKlipper(): void {
    if (pending !== null || store.busy !== '') return;
    armPending('klipper');
    void store.serviceAction('klipper', 'restart');
  }

  function restartFirmware(): void {
    if (pending !== null || store.busy !== '') return;
    armPending('firmware');
    void store.firmwareRestart();
  }

  let klipperDisabled = $derived(pending === 'klipper' || store.busy !== '');
  let firmwareDisabled = $derived(pending !== null || store.busy !== '');

  // ------------------------------------------------------------------
  // Логи: выделенные GET-эндпоинты Moonraker,
  // /server/files/download для логов НЕ работает
  // ------------------------------------------------------------------

  async function downloadLog(kind: 'klippy' | 'moonraker'): Promise<void> {
    const h = api.moonraker();
    const headers: Record<string, string> = {};
    const tok = (h as { authToken?: string }).authToken;
    if (tok) headers.Authorization = `Bearer ${tok}`;

    const url =
      kind === 'klippy'
        ? `${h.httpBaseUrl}/server/files/klippy.log`
        : `${h.httpBaseUrl}/server/files/moonraker.log`;

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.error('[system] log download failed:', res.status);
        return;
      }

      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = kind === 'klippy' ? 'klippy.log' : 'moonraker.log';
      a.click();
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      console.error('[system] log download failed:', e);
    }
  }
</script>

{#if visible}
  <div class="klipper-banner">
    <div class="kb-actions">
      <button
        class="btn warn"
        disabled={klipperDisabled}
        onclick={restartKlipper}
      >
        {#if pending === 'klipper'}
          <span class="spinner" aria-hidden="true"></span>
        {:else}
          <Icon name="refresh" size={14} />
        {/if}
        {i18n.t('system.klipperBanner.restartKlipper')}
      </button>

      <button
        class="btn warn"
        disabled={firmwareDisabled}
        onclick={restartFirmware}
      >
        {#if pending === 'firmware'}
          <span class="spinner" aria-hidden="true"></span>
        {:else}
          <Icon name="refresh" size={14} />
        {/if}
        {i18n.t('system.klipperBanner.firmwareRestart')}
      </button>

      <button class="btn" onclick={() => downloadLog('klippy')}>
        <Icon name="download" size={14} />
        {i18n.t('system.klipperBanner.downloadKlippyLog')}
      </button>

      <button class="btn" onclick={() => downloadLog('moonraker')}>
        <Icon name="download" size={14} />
        {i18n.t('system.klipperBanner.downloadMoonrakerLog')}
      </button>
    </div>

    <div class="kb-message">
      <div class="kb-title">
        <Icon name="warning" size={16} />
        <span>{title}</span>
      </div>

      {#if klippy.stateMessage}
        <pre class="kb-text">{klippy.stateMessage}</pre>
      {/if}
    </div>
  </div>
{/if}

<style>
  .klipper-banner {
    display: grid;
    grid-template-columns: minmax(220px, 280px) 1fr;
    gap: var(--space-md);
    padding: var(--space-md);
    margin-bottom: var(--space-md);
    align-items: stretch;
    background: color-mix(in srgb, var(--danger) 8%, var(--bg-surface));
    border: 1px solid color-mix(in srgb, var(--danger) 55%, transparent);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }

  @media (max-width: 760px) {
    .klipper-banner {
      grid-template-columns: 1fr;
    }
  }

  .kb-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .kb-actions .btn {
    flex: 1 1 0;
    align-items: center;
  }

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .btn:hover:not(:disabled) {
    background: var(--bg-surface-active);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.warn {
    border-color: color-mix(in srgb, var(--warning) 60%, transparent);
    color: var(--warning);
    font-weight: 600;
  }

  .kb-message {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-start; /* колонка сообщений прижата к верху */
    gap: var(--space-xs);
  }

  .kb-title {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    color: var(--danger);
    font-size: var(--font-size-md);
    font-weight: 600;
  }

  .kb-text {
    margin: 0;
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
    font-family: monospace;
    font-size: var(--font-size-sm);
    line-height: 1.5;
    word-break: break-word;
    max-height: 220px;
    overflow-y: auto;
    flex: 1 1 auto;  /* высота бокса = высота текста, не растягивается на колонку */
    display: block;  /* явно НЕ flex/grid — никакого вертикального центрирования */
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border-color);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>