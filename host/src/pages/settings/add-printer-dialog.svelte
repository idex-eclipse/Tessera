<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { closeAddPrinter, isAddPrinterOpen } from './add-printer-dialog-store.svelte';

  const { printerManager, i18n } = getAppContext();

  let open = $derived(isAddPrinterOpen());

  let name = $state('');
  let url = $state('');
  let testing = $state(false);
  let testResult = $state<{ ok: boolean; message: string } | null>(null);

  function normalizedUrl(): string {
    return url.trim().replace(/\/+$/, '');
  }

  async function testConnection(): Promise<void> {
    const base = normalizedUrl();
    if (!base) return;
    testing = true;
    testResult = null;
    try {
      const res = await fetch(`${base}/server/info`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: any = await res.json();
      testResult = { ok: true, message: `Moonraker ${data?.result?.moonraker_version ?? 'ok'}` };
    } catch (e) {
      testResult = { ok: false, message: e instanceof Error ? e.message : String(e) };
    } finally {
      testing = false;
    }
  }

  function handleAdd(): void {
    if (!name.trim() || !normalizedUrl()) return;
    printerManager.addPrinter({ name: name.trim(), url: normalizedUrl() });
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
        <input bind:value={url} placeholder="http://192.168.0.X:7125" />
      </label>

      {#if testResult}
        <p class="test-result" class:ok={testResult.ok} class:fail={!testResult.ok}>
          {testResult.message}
        </p>
      {/if}
    </div>

    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={testConnection} disabled={testing || !normalizedUrl()}>
        {testing ? '…' : i18n.t('settings.testConnection')}
      </button>
      <button class="btn btn-secondary" onclick={closeAddPrinter}>{i18n.t('common.cancel')}</button>
      <button class="btn btn-primary" onclick={handleAdd} disabled={!name.trim() || !normalizedUrl()}>
        {i18n.t('common.add')}
      </button>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop { position: fixed; inset: 0; background: var(--bg-overlay); z-index: 300; }
  .dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 90%; max-width: 420px; background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); z-index: 301; overflow: hidden; }
  .dialog-header { padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--border-color); }
  .dialog-header h3 { font-size: var(--font-size-lg); font-weight: 600; }
  .dialog-body { padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-md); }
  .field { display: flex; flex-direction: column; gap: var(--space-xs); font-size: var(--font-size-sm); color: var(--text-secondary); }
  .field input { padding: var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-primary); font-size: var(--font-size-md); }
  .field input:focus { outline: none; border-color: var(--border-focus); }
  .test-result { font-size: var(--font-size-sm); }
  .test-result.ok { color: var(--success); }
  .test-result.fail { color: var(--danger); }
  .dialog-footer { display: flex; justify-content: flex-end; gap: var(--space-sm); padding: var(--space-md) var(--space-lg); border-top: 1px solid var(--border-color); }
  .btn { padding: var(--space-sm) var(--space-lg); border: none; border-radius: var(--radius-md); font-size: var(--font-size-md); cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-secondary { background: var(--bg-surface-hover); color: var(--text-primary); }
</style>