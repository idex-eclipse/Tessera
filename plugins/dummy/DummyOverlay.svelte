<script lang="ts">
  import { usePluginApi } from '../../plugin-sdk/src/svelte/use-plugin-api';
  import { dummyState } from './dummy-state.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;

  let open = $derived(dummyState.overlayOpen);

  $effect(() => {
    console.log('[dummy-overlay] $effect triggered, open =', open);
  });

    // И добавьте watcher на state
  $effect(() => {
    console.log('[dummy-overlay] watching state:', dummyState.overlayOpen);
  });

  function close() {
    dummyState.overlayOpen = false;
  }

  function onKeydown(event: KeyboardEvent) {
    // слушатель живёт всегда, реагируем только когда оверлей открыт
    if (!dummyState.overlayOpen) return;
    if (event.key === 'Escape') close();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="overlay-backdrop" onclick={close} role="presentation"></div>

  <div
    class="overlay-panel"
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t('overlay.title')}
  >
    <header class="overlay-header">
      <span class="overlay-title">{i18n.t('overlay.title')}</span>

      <button
        class="overlay-icon-btn"
        onclick={close}
        title={i18n.t('overlay.close')}
        aria-label={i18n.t('overlay.close')}
      >
        ✕
      </button>
    </header>

    <div class="overlay-body">
      <p>{i18n.t('overlay.content')}</p>
    </div>

    <footer class="overlay-footer">
      <button class="overlay-action" onclick={close}>
        {i18n.t('overlay.close')}
      </button>
    </footer>
  </div>
{/if}

<style>
  :global(mpu-dummy-overlay) {
    display: block;
  }

  .overlay-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    pointer-events: auto;
    z-index: 1;
  }

  .overlay-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    pointer-events: auto;
    z-index: 2;
  }

  .overlay-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .overlay-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .overlay-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
    flex-shrink: 0;
  }

  .overlay-icon-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .overlay-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-md);
  }

  .overlay-body p {
    margin: 0;
    color: var(--text-secondary);
    line-height: 1.6;
    font-size: var(--font-size-sm);
  }

  .overlay-footer {
    display: flex;
    justify-content: flex-end;
    padding: var(--space-sm) var(--space-md);
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .overlay-action {
    padding: var(--space-xs) var(--space-lg);
    border: none;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: #fff;
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .overlay-action:hover {
    background: var(--accent-hover);
  }
</style>