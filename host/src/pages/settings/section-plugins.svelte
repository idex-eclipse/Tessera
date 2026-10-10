<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { confirm } from '../../components/confirm/confirm-dialog.svelte.ts';
  import { useExtensionsCatalog } from '../../core/extensions-catalog.svelte.ts';
  import { absoluteManifestUrl } from '../../core/extensions-catalog.svelte.ts';

  const { settings, loader, printerManager, i18n } = getAppContext();

  let remotePlugins = $derived(settings.plugins);
  let loaded = $derived(loader.getLoadedPlugins());
  let printers = $derived(printerManager.printers);

  let addOpen = $state(false);
  let url = $state('');
  let scope = $state<string[]>([]);
  let preview = $state<{ id: string; name: string; version: string } | null>(null);
  let fetching = $state(false);
  let error = $state<string | null>(null);

  function loadedByUrl(u: string) {
    return loaded.find((p: any) => p.manifestUrl === u);
  }

  async function fetchManifest(): Promise<void> {
    const u = url.trim();
    if (!u) return;
    fetching = true;
    error = null;
    preview = null;
    try {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m = await res.json(); // ← упадёт, если сервер отдаёт HTML
      if (!m || typeof m.id !== 'string' || typeof m.entry !== 'string') {
        throw new Error('invalid manifest');
      }
      preview = { id: m.id, name: m.name ?? m.id, version: m.version ?? '?' };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      fetching = false;
    }
  }

  async function handleAdd(): Promise<void> {
    if (!preview) return;
    settings.addPlugin(url.trim(), scope);
    await loader.loadEnabledPlugins();
    addOpen = false;
    url = ''; scope = []; preview = null; error = null;
  }

  function openAdd(): void {
    addOpen = true;
    url = ''; scope = []; preview = null; error = null;
  }

  async function toggle(u: string, enabled: boolean): Promise<void> {
    settings.setPluginEnabled(u, enabled);
    await loader.loadEnabledPlugins();
  }

  async function remove(u: string): Promise<void> {
    const ok = await confirm({
      title: i18n.t('settings.plugins'),
      message: `${i18n.t('common.remove')}: ${u}?`,
      danger: true,
    });
    if (!ok) return;
    settings.removePlugin(u);
    await loader.loadEnabledPlugins();
  }

  function scopeLabel(entry: { printerIds: string[] }): string {
    if (!entry.printerIds || entry.printerIds.length === 0) return i18n.t('settings.allPrinters');
    return entry.printerIds
      .map((id) => printers.find((p) => p.id === id)?.name ?? id)
      .join(', ');
  }

  function toggleScope(id: string): void {
    scope = scope.includes(id) ? scope.filter((s) => s !== id) : [...scope, id];
  }

//catalog

  const catalog = useExtensionsCatalog();
  let catalogEntries = $derived(catalog.catalog.entries);
  let catalogLoading = $derived(catalog.catalog.loading);
  let catalogError = $derived(catalog.catalog.error);

  function catalogStatus(entry: any) {
    return catalog.getStatus(entry, remotePlugins);
  }

  async function installFromCatalog(manifestUrl: string, printerIds: string[] = []): Promise<void> {
    settings.addPlugin(absoluteManifestUrl(manifestUrl), printerIds, 'catalog');
    await loader.loadEnabledPlugins();
  }

  async function updateFromCatalog(manifestUrl: string): Promise<void> {
    await loader.reloadRemotePlugin(manifestUrl);
  }

  let addAdvancedOpen = $state(false);
  let advancedUrl = $state('');
  let advancedScope = $state<string[]>([]);
  let advancedPreview = $state<{ id: string; name: string; version: string } | null>(null);
  let advancedFetching = $state(false);
  let advancedError = $state<string | null>(null);

  async function fetchAdvancedManifest(): Promise<void> {
    const u = advancedUrl.trim();
    if (!u) return;
    advancedFetching = true;
    advancedError = null;
    advancedPreview = null;
    try {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m = await res.json();
      if (!m || typeof m.id !== 'string' || typeof m.entry !== 'string') {
        throw new Error('invalid manifest');
      }
      advancedPreview = { id: m.id, name: m.name ?? m.id, version: m.version ?? '?' };
    } catch (e) {
      advancedError = e instanceof Error ? e.message : String(e);
    } finally {
      advancedFetching = false;
    }
  }

  async function handleAdvancedAdd(): Promise<void> {
    if (!advancedPreview) return;
    const ok = await confirm({
      title: i18n.t('settings.addPlugin'),
      message: i18n.t('settings.advancedConfirm'),
      danger: true,
    });
    if (!ok) return;
    settings.addPlugin(advancedUrl.trim(), advancedScope, 'url', advancedPreview.version);
    await loader.loadEnabledPlugins();
    addAdvancedOpen = false;
    advancedUrl = ''; advancedScope = []; advancedPreview = null; advancedError = null;
  }

  function toggleAdvancedScope(id: string): void {
    advancedScope = advancedScope.includes(id) ? advancedScope.filter((s) => s !== id) : [...advancedScope, id];
  }

</script>

<div class="section">
  <!-- Catalog -->
  <div class="section-header">
    <h3>{i18n.t('settings.catalog')}</h3>
    <button class="btn btn-secondary" onclick={() => catalog.refresh()} disabled={catalogLoading}>
      {i18n.t('common.refresh')}
    </button>
  </div>

  {#if catalogLoading}
    <p class="loading">{i18n.t('common.loading')}</p>
  {:else if catalogError}
    <p class="error">{catalogError}</p>
  {:else if catalogEntries.length === 0}
    <p class="empty">{i18n.t('settings.catalogEmpty')}</p>
  {:else}
    <div class="plugin-list">
      {#each catalogEntries as entry (entry.id)}
        {@const status = catalogStatus(entry)}
        <div class="plugin-row">
          <div class="plugin-info">
            <span class="plugin-name">{entry.name}</span>
            <span class="plugin-meta">{entry.id} · v{entry.version}</span>
          </div>
          <div class="plugin-actions">
            {#if status.status === 'not-installed'}
              <button class="btn btn-primary" onclick={() => installFromCatalog(entry.manifestUrl)}>
                {i18n.t('common.install')}
              </button>
            {:else if status.status === 'installed'}
              <span class="badge installed">{i18n.t('settings.installed')}</span>
            {:else if status.status === 'update-available'}
              <span class="badge update">v{status.installedVersion} → v{status.catalogVersion}</span>
              <button class="btn btn-primary" onclick={() => updateFromCatalog(entry.manifestUrl)}>
                {i18n.t('settings.update')}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Installed plugins -->
  <div class="section-header">
    <h3>{i18n.t('settings.installedPlugins')}</h3>
    <button class="btn btn-secondary" onclick={() => (addAdvancedOpen = true)}>
      + {i18n.t('settings.addPluginAdvanced')}
    </button>
  </div>

  <div class="plugin-list">
    {#each loaded as p (p.manifest.id)}
      {@const isCore = !p.manifestUrl || (p as any).builtin}
      {@const record = remotePlugins.find((r) => r.manifestUrl === p.manifestUrl)}
      <div class="plugin-row">
        <div class="plugin-info">
          <span class="plugin-name">{p.manifest.name}</span>
          <span class="plugin-meta">
            {p.manifest.id} · v{p.manifest.version}
            {#if record?.source === 'url'}
              <span class="badge external">{i18n.t('settings.external')}</span>
            {/if}
          </span>
        </div>
        <div class="plugin-actions">
          {#if !isCore}
            <button class="btn btn-secondary" onclick={() => toggle(p.manifestUrl, !record?.enabled)}>
              {record?.enabled ? i18n.t('settings.disable') : i18n.t('settings.enable')}
            </button>
            <button class="btn btn-danger" onclick={() => remove(p.manifestUrl)}>
              {i18n.t('common.remove')}
            </button>
          {/if}
          <label class="sync-toggle">
            <input
              type="checkbox"
              checked={settings.getPluginSync(p.manifest.id)}
              onchange={(e) => settings.setPluginSync(p.manifest.id, e.currentTarget.checked)}
            />
            {i18n.t('settings.syncSettings')}
          </label>
          {#if isCore}
            <span class="badge">{i18n.t('settings.builtin')}</span>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

{#if addAdvancedOpen}
  <div class="dialog-backdrop" onclick={() => (addAdvancedOpen = false)} role="presentation"></div>
  <div class="dialog" role="dialog" aria-modal="true">
    <div class="dialog-header"><h3>{i18n.t('settings.addPluginAdvanced')}</h3></div>
    <div class="dialog-body">
      <p class="warning">{i18n.t('settings.advancedWarning')}</p>
      <label class="field">
        <span>Manifest URL</span>
        <input bind:value={advancedUrl} placeholder="http://192.168.0.10:8080/manifest.json" />
      </label>

      <div class="field">
        <span>{i18n.t('settings.printers')}</span>
        <div class="scope-list">
          {#each printers as p (p.id)}
            <label class="scope-item">
              <input type="checkbox" checked={advancedScope.includes(p.id)} onchange={() => toggleAdvancedScope(p.id)} />
              {p.name}
            </label>
          {/each}
        </div>
        <span class="field-hint">{i18n.t('settings.scopeHint')}</span>
      </div>

      {#if advancedPreview}
        <p class="preview">✓ {advancedPreview.name} · v{advancedPreview.version} ({advancedPreview.id})</p>
      {/if}
      {#if advancedError}
        <p class="test-result fail">{advancedError}</p>
      {/if}
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={fetchAdvancedManifest} disabled={advancedFetching || !advancedUrl.trim()}>
        {i18n.t('settings.testConnection')}
      </button>
      <button class="btn btn-secondary" onclick={() => (addAdvancedOpen = false)}>{i18n.t('common.cancel')}</button>
      <button class="btn btn-primary" onclick={handleAdvancedAdd} disabled={!advancedPreview}>
        {i18n.t('common.add')}
      </button>
    </div>
  </div>
{/if}

{#if addOpen}
  <div class="dialog-backdrop" onclick={() => (addOpen = false)} role="presentation"></div>
  <div class="dialog" role="dialog" aria-modal="true">
    <div class="dialog-header"><h3>{i18n.t('settings.addPlugin')}</h3></div>
    <div class="dialog-body">
      <label class="field">
        <span>Manifest URL</span>
        <input bind:value={url} placeholder="http://192.168.0.10:8080/manifest.json" />
      </label>

      <div class="field">
        <span>{i18n.t('settings.printers')}</span>
        <div class="scope-list">
          {#each printers as p (p.id)}
            <label class="scope-item">
              <input type="checkbox" checked={scope.includes(p.id)} onchange={() => toggleScope(p.id)} />
              {p.name}
            </label>
          {/each}
        </div>
        <span class="field-hint">{i18n.t('settings.scopeHint')}</span>
      </div>

      {#if preview}
        <p class="preview">✓ {preview.name} · v{preview.version} ({preview.id})</p>
      {/if}
      {#if error}
        <p class="test-result fail">{error}</p>
      {/if}
    </div>
    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={fetchManifest} disabled={fetching || !url.trim()}>
        {i18n.t('settings.testConnection')}
      </button>
      <button class="btn btn-secondary" onclick={() => (addOpen = false)}>{i18n.t('common.cancel')}</button>
      <button class="btn btn-primary" onclick={handleAdd} disabled={!preview}>
        {i18n.t('common.add')}
      </button>
    </div>
  </div>
{/if}

<style>
  .section { display: flex; flex-direction: column; gap: var(--space-md); }
  .section-actions { display: flex; justify-content: flex-end; }
  .plugin-list { display: flex; flex-direction: column; gap: var(--space-sm); }
  .plugin-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); padding: var(--space-sm) var(--space-md); border: 1px solid var(--border-color); border-radius: var(--radius-md); }
  .plugin-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .plugin-name { font-weight: 600; }
  .plugin-meta { color: var(--text-muted); font-size: var(--font-size-sm); font-family: monospace; overflow: hidden; text-overflow: ellipsis; }
  .plugin-actions { display: flex; gap: var(--space-sm); flex-shrink: 0; }
  .badge { padding: 2px var(--space-sm); border-radius: var(--radius-sm); background: var(--bg-surface-active); color: var(--accent); font-size: var(--font-size-sm); }
  .dialog-backdrop { position: fixed; inset: 0; background: var(--bg-overlay); z-index: 300; }
  .dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 90%; max-width: 460px; background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); z-index: 301; overflow: hidden; }
  .dialog-header { padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--border-color); }
  .dialog-header h3 { font-size: var(--font-size-lg); font-weight: 600; }
  .dialog-body { padding: var(--space-lg); display: flex; flex-direction: column; gap: var(--space-md); }
  .field { display: flex; flex-direction: column; gap: var(--space-xs); font-size: var(--font-size-sm); color: var(--text-secondary); }
  .field input { padding: var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-primary); font-size: var(--font-size-md); }
  .field-hint { color: var(--text-muted); }
  .scope-list { display: flex; flex-direction: column; gap: var(--space-xs); }
  .scope-item { display: flex; align-items: center; gap: var(--space-sm); }
  .preview { color: var(--success); font-size: var(--font-size-sm); }
  .test-result.fail { color: var(--danger); font-size: var(--font-size-sm); }
  .dialog-footer { display: flex; justify-content: flex-end; gap: var(--space-sm); padding: var(--space-md) var(--space-lg); border-top: 1px solid var(--border-color); }
  .btn { padding: var(--space-sm) var(--space-lg); border: none; border-radius: var(--radius-md); font-size: var(--font-size-md); cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-secondary { background: var(--bg-surface-hover); color: var(--text-primary); }
.sync-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
}
.sync-toggle input {
  cursor: pointer;
}

.section-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); }
.section-header h3 { font-size: var(--font-size-lg); font-weight: 600; }
.loading { color: var(--text-muted); font-style: italic; }
.error { color: var(--danger); }
.empty { color: var(--text-muted); font-style: italic; }
.badge.installed { background: var(--success); color: #fff; }
.badge.update { background: var(--warning); color: #fff; }
.badge.external { background: var(--text-muted); color: #fff; font-size: 10px; }
.warning { color: var(--warning); font-size: var(--font-size-sm); }
.btn-danger { background: var(--danger); color: #fff; }

</style>