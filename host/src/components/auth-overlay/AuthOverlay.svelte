<script lang="ts">
  import { getAppContext } from '../../app-context';
  import {
    getAuthRequiredPrinterId,
    login,
    readStoredAuth,
  } from '../../core/auth-store.svelte';

  const ctx = getAppContext();

  let requiredId = $derived(getAuthRequiredPrinterId());
  let activeId = $derived(ctx.settings.activePrinterId);

  // показываем только для АКТИВНОГО принтера, чтобы фоновый 401 не блокировал UI
  let visible = $derived(requiredId !== null && requiredId === activeId);

  let printer = $derived(
    ctx.settings.printers.find((p) => p.id === requiredId) ?? null,
  );

  let username = $state('');
  let password = $state('');
  let busy = $state(false);
  let failed = $state(false);

  // при смене принтера в форме — сброс; сохранённый юзер как подсказка
  $effect(() => {
    if (visible && requiredId) {
      const stored = readStoredAuth(requiredId);
      username = stored?.user ?? '';
      password = '';
      failed = false;
    }
  });

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!printer || busy) return;
    busy = true;
    failed = false;

    const ok = await login(printer.id, normalizeBase(printer.url), username, password);
    if (!ok) failed = true;

    busy = false;
  }

  function normalizeBase(url: string): string {
    return url.trim().replace(/\/+$/, '');
  }
</script>

{#if visible && printer}
  <div class="auth-overlay" role="dialog" aria-modal="true" aria-label={ctx.i18n.t('common.auth.title')}>
    <form class="auth-card" onsubmit={submit}>
      <h2 class="auth-title">{ctx.i18n.t('common.auth.title')}</h2>
      <p class="auth-hint">
        {printer.name} — {ctx.i18n.t('common.auth.hint')}
      </p>

      <label class="field">
        <span>{ctx.i18n.t('common.auth.username')}</span>
        <input type="text" autocomplete="username" bind:value={username} required />
      </label>

      <label class="field">
        <span>{ctx.i18n.t('common.auth.password')}</span>
        <input type="password" autocomplete="current-password" bind:value={password} required />
      </label>

      {#if failed}
        <p class="auth-error">{ctx.i18n.t('common.auth.failed')}</p>
      {/if}

      <button class="auth-submit" type="submit" disabled={busy}>
        {#if busy}
          <span class="spinner" aria-hidden="true"></span>
        {/if}
        {ctx.i18n.t('common.auth.submit')}
      </button>
    </form>
  </div>
{/if}

<style>
  .auth-overlay {
    position: fixed;
    inset: 0;
    z-index: 900; /* выше overlays, ниже offline-overlay */
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-overlay);
    pointer-events: auto;
  }

  .auth-card {
    width: min(92vw, 360px);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-lg);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }

  .auth-title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  .auth-hint {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .field input {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-app);
    color: var(--text-primary);
    font-size: var(--font-size-md);
  }

  .field input:focus {
    outline: none;
    border-color: var(--border-focus);
  }

  .auth-error {
    color: var(--danger);
    font-size: var(--font-size-sm);
  }

  .auth-submit {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding: var(--space-sm);
    border: none;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: #fff;
    font-size: var(--font-size-md);
    font-weight: 600;
    cursor: pointer;
  }

  .auth-submit:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>