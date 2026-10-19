<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PrinterManager, PrinterConnectionState } from '../../core/printer-manager.svelte.ts';

  let {
    printerManager,
    i18n,
  }: {
    printerManager: PrinterManager;
    i18n: HostI18n;
  } = $props();

  // Local reactive state (printer-manager теперь event-based, не $state)
  let activeConnection = $state<PrinterConnectionState | null>(printerManager.activeConnection);
  let shouldShow = $state(printerManager.shouldShowOfflineOverlay);

  // Подписка на изменения connection state
  $effect(() => {
    return printerManager.onConnectionStateChange(() => {
      activeConnection = printerManager.activeConnection;
      shouldShow = printerManager.shouldShowOfflineOverlay;
    });
  });

  // Также подписываемся на смену активного принтера (он может измениться без изменения connections)
  $effect(() => {
    return printerManager.onPrinterChange(() => {
      activeConnection = printerManager.activeConnection;
      shouldShow = printerManager.shouldShowOfflineOverlay;
    });
  });

  let lastSeenText = $derived.by(() => {
    if (!activeConnection?.lastSuccessfulAt) {
      return '—';
    }
    return new Date(activeConnection.lastSuccessfulAt).toLocaleTimeString();
  });

  function handleRetry() {
    printerManager.retry();
  }
</script>

{#if shouldShow}
  <div class="overlay">
    <div class="overlay-content">
      <div class="overlay-icon">📡</div>

      <h3 class="overlay-title">
        {i18n.t('printer.statusOffline')}
      </h3>

      <p class="overlay-detail">
        {i18n.t('printer.lastSuccessfulConnection')}: {lastSeenText}
      </p>

      <button class="retry-btn" onclick={handleRetry}>
        {i18n.t('printer.retryConnection')}
      </button>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    top: var(--header-height);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-overlay);
    backdrop-filter: blur(2px);
    z-index: 100;
    pointer-events: none;
  }

  .overlay-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-md);
    padding: var(--space-xl);
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    pointer-events: auto;
    text-align: center;
  }

  .overlay-icon {
    font-size: 2rem;
  }

  .overlay-title {
    font-size: var(--font-size-lg);
    font-weight: 600;
  }

  .overlay-detail {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .retry-btn {
    padding: var(--space-sm) var(--space-lg);
    border: none;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--accent-text);
    font-size: var(--font-size-md);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .retry-btn:hover {
    background: var(--accent-hover);
  }
</style>