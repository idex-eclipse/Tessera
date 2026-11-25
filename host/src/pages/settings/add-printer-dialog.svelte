<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { closeAddPrinter, isAddPrinterOpen } from './add-printer-dialog-store.svelte';
  import { normalizePrinterUrl } from './printer-url';

  const { printerManager, i18n } = getAppContext();

  let open = $derived(isAddPrinterOpen());

  let name = $state('');
  let url = $state('');
  let testing = $state(false);
  let testResult = $state<{ ok: boolean; message: string } | null>(null);

  // Both actions use the same parsed origin, so the tested address is the saved one.
  let normalizedUrl = $derived(normalizePrinterUrl(url));
  let invalidUrl = $derived(Boolean(url.trim() && !normalizedUrl));

  async function testConnection(): Promise<void> {
    const base = normalizedUrl;
    if (!base) return;
    testing = true;
    testResult = null;
    try {
      const res = await fetch(`${base}/server/info`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // A reachable Moonraker can omit its version; the connection test still succeeds.
      const data = await res.json() as { result?: { moonraker_version?: string } };
      testResult = { ok: true, message: `Moonraker ${data?.result?.moonraker_version ?? 'ok'}` };
    } catch (e) {
      testResult = { ok: false, message: e instanceof Error ? e.message : String(e) };
    } finally {
      testing = false;
    }
  }

  function handleAdd(): void {
    const base = normalizedUrl;
    if (!name.trim() || !base) return;
    printerManager.addPrinter({ name: name.trim(), url: base });
    name = '';
    url = '';
    testResult = null;
    closeAddPrinter();
  }
</script>

{#if open}
  <div class="dialog-backdrop" onclick={closeAddPrinter} role="presentation"></div>

  <div class="dialog" role="dialog" aria-modal="true">
    <div class="dialog-header"><h3>{i18n.t('settings.addPrinterTitle')}</h3></div>

    <div class="dialog-body">
      <label class="field">
        <span>{i18n.t('settings.printerName')}</span>
        <input bind:value={name} placeholder={i18n.t('settings.printerNamePlaceholder')} />
      </label>

      <label class="field">
        <span>{i18n.t('settings.printerUrl')}</span>
        <!-- An address stays left-to-right even when the surrounding dialog is RTL. -->
        <input bind:value={url} dir="ltr" inputmode="url" autocomplete="url" spellcheck="false" aria-invalid={invalidUrl} aria-describedby={invalidUrl ? 'add-printer-url-error' : undefined} placeholder={i18n.t('settings.printerUrlPlaceholder')} />
      </label>

      {#if invalidUrl}
        <p id="add-printer-url-error" class="url-error">{i18n.t('settings.invalidPrinterUrl')}</p>
      {/if}

      {#if testResult}
        <p class="test-result" class:ok={testResult.ok} class:fail={!testResult.ok}>
          {testResult.message}
        </p>
      {/if}
    </div>

    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={testConnection} disabled={testing || !normalizedUrl}>
        {testing ? '…' : i18n.t('settings.testConnection')}
      </button>
      <button class="btn btn-secondary" onclick={closeAddPrinter}>{i18n.t('common.cancel')}</button>
      <button class="btn btn-primary" onclick={handleAdd} disabled={!name.trim() || !normalizedUrl}>
        {i18n.t('common.add')}
      </button>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop { position: fixed; inset: 0; background: var(--bg-overlay); z-index: 300; }
  /* Logical insets center the dialog in either direction; the height cap keeps actions reachable on short screens. */
  .dialog { position: fixed; top: 50%; inset-inline: 0; margin-inline: auto; transform: translateY(-50%); inline-size: min(90vw, 420px); max-block-size: calc(100dvh - 2 * var(--space-md)); background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); z-index: 301; overflow: auto; }
  .dialog-header { padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--border-color); }
  .dialog-header h3 { font-size: var(--font-size-lg); font-weight: 600; }
  .dialog-body { padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-md); }
  .field { display: flex; flex-direction: column; gap: var(--space-xs); font-size: var(--font-size-sm); color: var(--text-secondary); }
  .field input { box-sizing: border-box; inline-size: 100%; min-inline-size: 0; padding: var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-primary); font-size: var(--font-size-md); }
  .field input:focus { outline: none; border-color: var(--border-focus); }
  .url-error { color: var(--danger); font-size: var(--font-size-sm); overflow-wrap: anywhere; }
  .test-result { font-size: var(--font-size-sm); }
  .test-result.ok { color: var(--success); }
  .test-result.fail { color: var(--danger); }
  /* Wrapping protects long translations and keeps touch targets available on narrow screens. */
  .dialog-footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-sm); padding: var(--space-md) var(--space-lg); border-top: 1px solid var(--border-color); }
  .btn { min-block-size: 44px; padding: var(--space-sm) var(--space-lg); border: none; border-radius: var(--radius-md); font-size: var(--font-size-md); cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-secondary { background: var(--bg-surface-hover); color: var(--text-primary); }

  /* Stack full-width actions on phones so wrapping never leaves an off-center last button in LTR or RTL. */
  @media (max-width: 480px) {
    .dialog-footer { flex-direction: column; align-items: stretch; }
    .dialog-footer .btn { inline-size: 100%; }
  }
</style>
