<script lang="ts">
  import { getAppContext } from '../../app-context';

  import { onMount } from 'svelte';
  import { guardAgent, type ParkedChainView, type RegisteredGuardView } from '../../core/guard-agent';
  import { BUILD_INFO } from '../../core/build-info';
  import { confirm } from '../../components/confirm/confirm-dialog.svelte.ts';
  import { readStoredAuth } from '../../core/auth-store.svelte.ts';
  import { findHostPrinter } from '../../core/extensions-installer.svelte.ts';
  import { createUiUpdater, type UiBuild } from '../../core/ui-updater.svelte.ts';
  import {
    UPDATE_CHECK_MAX_HOURS,
    UPDATE_CHECK_MIN_HOURS,
    normalizeUpdateCheckHours,
  } from '../../core/settings-store.svelte.ts';
  import Loader from '../../../../plugins/shared/loader/Loader.svelte';

  let guards = $state<RegisteredGuardView[]>([]);
  let parked = $state<ParkedChainView[]>([]);

  onMount(() => {
    const refresh = () => {
      guards = guardAgent.getRegisteredGuards();
      parked = guardAgent.getParkedChains();
    };
    refresh();
    return guardAgent.onChange(refresh);
  });


  const { loader, i18n, printerManager, settings } = getAppContext();

  let loaded = $derived(loader.getLoadedPlugins());
  let importError = $state(false);

  // Update of Tessera itself: the block is shown only when the tessera-update-manager
  // service answers (see core/ui-updater.svelte.ts); otherwise a hint about the CLI is shown.
  const updater = createUiUpdater({
    getToken: () => {
      const host = findHostPrinter(printerManager.printers, window.location);
      return host ? (readStoredAuth(host.id)?.token ?? null) : null;
    },
  });
  void updater.refresh();

  // import() caches modules and chunk names change per build: the new build runs after a reload only.
  let updated = $state(false);

  /** "v1.2.3 (abc1234)", whichever parts the service knows. */
  function describeBuild(build: UiBuild | null | undefined): string {
    if (!build) return '?';
    const parts = [build.version ? `v${build.version}` : null, build.commit ? `(${build.commit})` : null];
    return parts.filter(Boolean).join(' ') || '?';
  }

  // The store clamps the value (1..168 h); the input is rewritten so it never shows a rejected number.
  function setCheckInterval(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const hours = normalizeUpdateCheckHours(input.valueAsNumber);
    settings.setUpdateCheckSettings({ intervalHours: hours });
    input.value = String(hours);
  }

  async function runUpdate(): Promise<void> {
    const ok = await confirm({
      title: i18n.t('settings.about.update.title'),
      message: i18n.t('settings.about.update.confirm', { branch: updater.status?.branch ?? '' }),
    });
    if (!ok) return;
    if (await updater.update()) updated = true;
  }

  // Branch switch: the list is fetched once, when the service says this installation can update itself.
  let chosenBranch = $state('');
  let branchesRequested = false;
  $effect(() => {
    if (!updater.status?.canUpdate || branchesRequested) return;
    branchesRequested = true;
    void updater.loadBranches();
  });
  // The current branch is always an option, even when GitHub could not be asked for the list.
  let branchOptions = $derived.by(() => {
    const current = updater.status?.branch;
    return current && !updater.branches.includes(current) ? [current, ...updater.branches] : updater.branches;
  });
  let selectedBranch = $derived(chosenBranch || updater.status?.branch || '');

  async function switchBranch(): Promise<void> {
    const ok = await confirm({
      title: i18n.t('settings.about.branch.title'),
      message: i18n.t('settings.about.branch.confirm', { branch: selectedBranch }),
    });
    if (!ok) return;
    if (await updater.update(selectedBranch)) updated = true;
    chosenBranch = '';
  }

  function exportSettings(): void {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('mpu:v2:')) continue;
      // Токены авторизации не должны попадать в файл, которым могут поделиться
      if (k.startsWith('mpu:v2:auth:')) continue;
      try {
        data[k] = JSON.parse(localStorage.getItem(k) ?? 'null');
      } catch {
        data[k] = localStorage.getItem(k);
      }
    }

    const payload = {
      app: 'modular-klipper-ui',
      version: BUILD_INFO.version,
      exportedAt: new Date().toISOString(),
      data,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mpu-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function onImportFile(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const data = parsed?.data;
        if (!data || typeof data !== 'object') throw new Error('bad file');

        for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
          if (!k.startsWith('mpu:v2:')) continue;
          localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        }

        location.reload();
      } catch {
        importError = true;
      }
    };
    reader.readAsText(file);
  }
</script>

<div class="section">
  <div class="about-row">
    <span class="about-label">Tessera</span>
    <span class="about-value">v{BUILD_INFO.version}</span>
  </div>
  <div class="about-row">
    <span class="about-label">{i18n.t('settings.about.build')}</span>
    <span class="about-value">{BUILD_INFO.branch} · {BUILD_INFO.commit}</span>
  </div>
  <div class="about-row">
    <span class="about-label">{i18n.t('settings.about.pluginApi')}</span>
    <span class="about-value">{BUILD_INFO.pluginApi}</span>
  </div>

  <!-- Update of Tessera itself -->
  <div class="about-sub">{i18n.t('settings.about.update.title')}</div>
  <div class="about-row">
    <label class="about-label" for="update-check-hours">{i18n.t('settings.about.update.interval')}</label>
    <span class="interval">
      <input
        id="update-check-hours"
        type="number"
        inputmode="numeric"
        min={UPDATE_CHECK_MIN_HOURS}
        max={UPDATE_CHECK_MAX_HOURS}
        step="1"
        value={settings.ui.updateCheck.intervalHours}
        onchange={setCheckInterval}
      />
      <span class="about-value">{i18n.t('settings.about.update.hours')}</span>
    </span>
  </div>
  {#if updated}
    <div class="about-row">
      <span class="notice">{i18n.t('settings.about.update.done', { to: describeBuild(updater.status?.installed) })}</span>
      <button class="btn btn-primary" onclick={() => location.reload()}>
        {i18n.t('settings.about.update.reload')}
      </button>
    </div>
  {:else if updater.loading && !updater.status && !updater.error}
    <Loader block text={i18n.t('common.loading')} />
  {:else if !updater.available}
    <p class="about-empty">{i18n.t('settings.about.update.unavailable')}</p>
  {:else}
    {@const status = updater.status}
    <div class="about-row">
      <span class="about-label">
        {#if status?.updateAvailable}
          {i18n.t('settings.about.update.available')}
        {:else if status && status.canUpdate && !status.remoteError}
          {i18n.t('settings.about.update.upToDate')}
        {/if}
      </span>
      {#if status?.updateAvailable}
        <!-- Build ids are LTR content: keep them isolated in RTL. -->
        <span class="about-value" dir="ltr">{describeBuild(status.installed)} → {describeBuild(status.remote)}</span>
      {/if}
    </div>
    {#if status && !status.canUpdate}
      <p class="about-empty">{i18n.t('settings.about.update.sourceCheckout')}</p>
    {/if}
    {#if status?.remoteError}
      <p class="error">{i18n.t('settings.about.update.remoteError', { error: status.remoteError })}</p>
    {/if}
    {#if updater.error}
      <p class="error">
        {updater.error.status === 401 ? i18n.t('settings.about.update.unauthorized') : updater.error.message}
      </p>
    {/if}
    {#if status?.canUpdate}
      <div class="about-row">
        <label class="about-label" for="update-branch">{i18n.t('settings.about.branch.label')}</label>
        <!-- Branch names are LTR content; the row wraps on narrow screens. -->
        <span class="interval">
          <select
            id="update-branch"
            dir="ltr"
            value={selectedBranch}
            onchange={(e) => (chosenBranch = e.currentTarget.value)}
            disabled={updater.busy}
          >
            {#each branchOptions as name (name)}
              <option value={name}>{name}</option>
            {/each}
          </select>
          <button
            class="btn btn-secondary"
            onclick={switchBranch}
            disabled={updater.busy || selectedBranch === status.branch}
          >
            {i18n.t('settings.about.branch.switch')}
          </button>
        </span>
      </div>
      {#if updater.branchesError}
        <p class="about-empty">{i18n.t('settings.about.branch.listError', { error: updater.branchesError })}</p>
      {/if}
    {/if}
    <div class="about-actions">
      {#if updater.busy}
        <Loader size="md" inline text={i18n.t('settings.about.update.working')} />
      {:else}
        {#if status?.updateAvailable}
          <button class="btn btn-primary" onclick={runUpdate}>{i18n.t('settings.about.update.run')}</button>
        {/if}
        <button class="btn btn-secondary" onclick={() => updater.refresh(true)} disabled={updater.loading}>
          {i18n.t('settings.about.update.check')}
        </button>
      {/if}
    </div>
  {/if}

  <div class="plugin-list">
    {#if guards.length > 0}
      <div class="about-sub">{i18n.t('settings.about.guards')}</div>
      <div class="plugin-list">
        {#each guards as g (`${g.pluginId}:${g.guardId}`)}
          <div class="about-row">
            <span class="about-label">{g.pluginId} / {g.guardId}</span>
            <span class="about-value">{g.matchers.join(', ')}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="about-sub">{i18n.t('settings.about.parkedChains')}</div>
    {#if parked.length === 0}
      <p class="about-empty">{i18n.t('settings.about.noParked')}</p>
    {:else}
      <div class="plugin-list">
        {#each parked as p (p.token)}
          <div class="about-row">
            <span class="about-label">{p.method}</span>
            <span class="about-value">
              {i18n.t('settings.about.parkedBy', { plugin: p.frozenByPluginId, guard: p.frozenByGuardId })}
              · {Math.round(p.ageMs / 1000)}s
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if importError}
    <p class="error">{i18n.t('settings.importError')}</p>
  {/if}

  <div class="about-actions">
    <button class="btn btn-secondary" onclick={exportSettings}>
      {i18n.t('settings.exportSettings')}
    </button>
    <label class="btn btn-secondary">
      {i18n.t('settings.importSettings')}
      <input type="file" accept="application/json" hidden onchange={onImportFile} />
    </label>
  </div>
</div>

<style>
  .section { display: flex; flex-direction: column; gap: var(--space-md); }
  .plugin-list { display: flex; flex-direction: column; gap: var(--space-xs); }
  .about-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-md);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
  }
  .about-label { font-weight: 500; }
  .about-value { min-width: 0; overflow-wrap: anywhere; color: var(--text-muted); font-family: monospace; font-size: var(--font-size-sm); }
  .about-actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
  .error { color: var(--danger); font-size: var(--font-size-sm); }
  .btn { padding: var(--space-sm) var(--space-lg); border: none; border-radius: var(--radius-md); font-size: var(--font-size-md); cursor: pointer; }
  .btn-secondary { background: var(--bg-surface-hover); color: var(--text-primary); }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn:disabled { opacity: 0.55; cursor: default; }
  .notice { min-width: 0; overflow-wrap: anywhere; }
  /* Touch-sized input; the row wraps on narrow screens and follows the text direction in RTL. */
  .interval { display: inline-flex; align-items: center; gap: var(--space-sm); }
  .interval input {
    width: 5.5rem;
    min-height: 2.5rem;
    padding: var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    text-align: start;
  }

  .about-sub { font-weight: 600; margin-top: var(--space-xs); }
  .interval select {
    min-width: 0;
    max-width: 100%;
    min-height: 2.5rem;
    padding: var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
  }
  .about-empty { color: var(--text-muted); font-size: var(--font-size-sm); }
</style>