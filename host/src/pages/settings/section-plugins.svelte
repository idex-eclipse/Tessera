<script lang="ts">
  import { getAppContext } from '../../app-context';
  import Loader from '../../../../plugins/shared/loader/Loader.svelte';
  import { confirm } from '../../components/confirm/confirm-dialog.svelte.ts';
  import { readStoredAuth } from '../../core/auth-store.svelte.ts';
  import { useExtensionsCatalog } from '../../core/extensions-catalog.svelte.ts';
  import { absoluteManifestUrl } from '../../core/extensions-catalog.svelte.ts';
  import type { CatalogEntry } from '../../core/extensions-catalog.svelte.ts';
  import { createExtensionsInstaller, findHostPrinter } from '../../core/extensions-installer.svelte.ts';
  import type { RegistryPlugin } from '../../core/extensions-installer.svelte.ts';
  import ExtensionsOverview from './extensions-overview.svelte';

  const { settings, loader, printerManager, i18n } = getAppContext();

  let remotePlugins = $derived(settings.plugins);
  let loaded = $derived(loader.getLoadedPlugins());
  let printers = $derived(printerManager.printers);

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

//catalog

  const catalog = useExtensionsCatalog();
  let catalogEntries = $derived(catalog.catalog.entries);
  let catalogLoading = $derived(catalog.catalog.loading);
  let catalogError = $derived(catalog.catalog.error);

  function catalogStatus(entry: CatalogEntry) {
    return catalog.getStatus(entry, remotePlugins);
  }

  async function installFromCatalog(entry: CatalogEntry, printerIds: string[] = []): Promise<void> {
    // версия обязательна: без неё getStatus никогда не покажет update-available
    settings.addPlugin(absoluteManifestUrl(entry.manifestUrl), printerIds, 'catalog', entry.version);
    await loader.loadEnabledPlugins();
  }

  // import() кэшируется по URL, а CE нельзя переопределить → новый код плагина
  // подхватывается только перезагрузкой страницы.
  let reloadRequired = $state(false);

  async function updateFromCatalog(entry: CatalogEntry): Promise<void> {
    // записи settings хранят абсолютный URL, каталог — относительный
    await loader.reloadRemotePlugin(absoluteManifestUrl(entry.manifestUrl));
    reloadRequired = true;
  }

//registry (служба tessera-ext: нет службы — блока нет, плагины ставятся через CLI)

  const installer = createExtensionsInstaller({
    getToken: () => {
      const host = findHostPrinter(printerManager.printers, window.location);
      return host ? (readStoredAuth(host.id)?.token ?? null) : null;
    },
    catalog,
    settings,
    loader,
  });
  void installer.refresh();

  // Папки, положенные вручную, — дело CLI: в реестре им нечего показывать.
  let registryPlugins = $derived(installer.plugins.filter((p) => p.state !== 'local' || p.managed));

  async function installFromRegistry(plugin: RegistryPlugin): Promise<void> {
    const deps = installer.dependenciesOf(plugin);
    const lines = [i18n.t('settings.registryConfirm', { name: plugin.name })];
    if (deps.install.length > 0) {
      lines.push(i18n.t('settings.registryDeps', { list: deps.install.map((d) => d.name).join(', ') }));
    }
    if (deps.missing.length > 0) {
      lines.push(i18n.t('settings.registryDepsMissing', { list: deps.missing.join(', ') }));
    }
    const ok = await confirm({
      title: i18n.t('settings.registry'),
      message: lines.join(' '),
    });
    if (ok) await installer.install(plugin);
  }

  async function updateFromRegistry(plugin: RegistryPlugin): Promise<void> {
    if (await installer.update(plugin)) reloadRequired = true;
  }

  async function removeFromRegistry(plugin: RegistryPlugin): Promise<void> {
    const ok = await confirm({
      title: i18n.t('settings.registry'),
      message: i18n.t('settings.registryRemoveConfirm', { name: plugin.name }),
      danger: true,
    });
    if (ok) await installer.remove(plugin);
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
  <!-- Registry -->
  {#if installer.available}
    <div class="section-header">
      <h3>{i18n.t('settings.registry')}</h3>
      <button class="btn btn-secondary" onclick={() => installer.refresh()} disabled={installer.loading || installer.busyId !== null}>
        {i18n.t('common.refresh')}
      </button>
    </div>

    {#if installer.error}
      <p class="error">
        {installer.error.status === 401 ? i18n.t('settings.registryUnauthorized') : installer.error.message}
      </p>
    {/if}
    {#if installer.registryError}
      <p class="error">{i18n.t('settings.registryUnreachable', { error: installer.registryError })}</p>
    {/if}

    {#if registryPlugins.length === 0}
      {#if !installer.loading && !installer.error && !installer.registryError}
        <p class="empty">{i18n.t('settings.registryEmpty')}</p>
      {/if}
    {:else}
      <div class="plugin-list">
        {#each registryPlugins as plugin (plugin.id)}
          <div class="plugin-row">
            <div class="plugin-info">
              <span class="plugin-name">{plugin.name}</span>
              <span class="plugin-meta">
                {plugin.id} · v{plugin.version}
                <span class="badge verified">{i18n.t('settings.verified')}</span>
              </span>
              {#if plugin.description}
                <span class="plugin-description">{plugin.description}</span>
              {/if}
            </div>
            <div class="plugin-actions">
              {#if installer.busyId === plugin.id}
                <Loader size="sm" inline text={i18n.t('settings.registryWorking')} />
              {:else if plugin.state === 'available'}
                <button class="btn btn-primary" onclick={() => installFromRegistry(plugin)} disabled={installer.busyId !== null}>
                  {i18n.t('common.install')}
                </button>
              {:else}
                {#if plugin.state === 'update'}
                  <span class="badge update">v{plugin.installedVersion} → v{plugin.version}</span>
                  {#if plugin.managed}
                    <button class="btn btn-primary" onclick={() => updateFromRegistry(plugin)} disabled={installer.busyId !== null}>
                      {i18n.t('settings.update')}
                    </button>
                  {/if}
                {:else}
                  <span class="badge installed">{i18n.t('settings.installed')}</span>
                {/if}
                {#if plugin.managed}
                  <button class="btn btn-danger" onclick={() => removeFromRegistry(plugin)} disabled={installer.busyId !== null}>
                    {i18n.t('common.remove')}
                  </button>
                {/if}
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- Catalog -->
  <div class="section-header">
    <h3>{i18n.t('settings.catalog')}</h3>
    <button class="btn btn-secondary" onclick={() => catalog.refresh()} disabled={catalogLoading}>
      {i18n.t('common.refresh')}
    </button>
  </div>

  {#if catalogLoading}
    <Loader block text={i18n.t('common.loading')} />
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
            <span class="plugin-meta">
              {entry.id} · v{entry.version}
              {#if entry.origin === 'registry'}
                <span class="badge verified">{i18n.t('settings.verified')}</span>
              {/if}
            </span>
            {#if entry.description}
              <span class="plugin-description">{entry.description}</span>
            {/if}
          </div>
          <div class="plugin-actions">
            {#if status.status === 'not-installed'}
              <button class="btn btn-primary" onclick={() => installFromCatalog(entry)}>
                {i18n.t('common.install')}
              </button>
            {:else if status.status === 'installed'}
              <span class="badge installed">{i18n.t('settings.installed')}</span>
            {:else if status.status === 'update-available'}
              <span class="badge update">v{status.installedVersion} → v{status.catalogVersion}</span>
              <button class="btn btn-primary" onclick={() => updateFromCatalog(entry)}>
                {i18n.t('settings.update')}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if reloadRequired}
    <div class="reload-notice">
      <span class="warning">{i18n.t('settings.reloadRequired')}</span>
      <button class="btn btn-primary" onclick={() => location.reload()}>
        {i18n.t('settings.reloadPage')}
      </button>
    </div>
  {/if}

  <!-- Installed plugins -->
  <div class="section-header">
    <h3>{i18n.t('settings.installedPlugins')}</h3>
    {#if catalog.catalog.allowRemotePlugins}
      <button class="btn btn-secondary" onclick={() => (addAdvancedOpen = true)}>
        + {i18n.t('settings.addPluginAdvanced')}
      </button>
    {/if}
  </div>

  <div class="plugin-list">
    {#each loaded as p (p.manifest.id)}
      {@const manifestUrl = p.manifestUrl}
      {@const isCore = !manifestUrl || p.source === 'core'}
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
          {#if manifestUrl && !isCore}
            <button class="btn btn-secondary" onclick={() => toggle(manifestUrl, !record?.enabled)}>
              {record?.enabled ? i18n.t('settings.disable') : i18n.t('settings.enable')}
            </button>
            <button class="btn btn-danger" onclick={() => remove(manifestUrl)}>
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

  <ExtensionsOverview />
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
.error { color: var(--danger); }
.empty { color: var(--text-muted); font-style: italic; }
.badge.installed { background: var(--success); color: #fff; }
.badge.update { background: var(--warning); color: #fff; }
.badge.external { background: var(--text-muted); color: #fff; font-size: 10px; }
.badge.verified { background: var(--success); color: #fff; font-size: 10px; }
.plugin-description { color: var(--text-secondary); font-size: var(--font-size-sm); }
.warning { color: var(--warning); font-size: var(--font-size-sm); }
.reload-notice { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); padding: var(--space-sm) var(--space-md); border: 1px solid var(--warning); border-radius: var(--radius-md); }
.btn-danger { background: var(--danger); color: #fff; }

</style>