<script lang="ts">
  import { getAppContext } from '../../app-context';

  import { onMount } from 'svelte';
  import { guardAgent, type ParkedChainView, type RegisteredGuardView } from '../../core/guard-agent';

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

  const HOST_VERSION = '0.1.0';

  const { loader, i18n, hotkeys } = getAppContext();

  let loaded = $derived(loader.getLoadedPlugins());
  let importError = $state(false);

  function exportSettings(): void {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('mpu:v2:')) continue;
      try {
        data[k] = JSON.parse(localStorage.getItem(k) ?? 'null');
      } catch {
        data[k] = localStorage.getItem(k);
      }
    }

    const payload = {
      app: 'modular-klipper-ui',
      version: HOST_VERSION,
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
    <span class="about-value">v{HOST_VERSION}</span>
  </div>

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

  <div class="plugin-list">
    <div class="about-sub">{i18n.t('settings.about.hotkeys')}</div>
    {#if hotkeys.bindings.length === 0}
      <p class="about-empty">{i18n.t('settings.about.noHotkeys')}</p>
    {:else}
      {#each hotkeys.bindings as b (`${b.pluginId}:${b.contribution.id}`)}
        <div class="about-row" class:about-disabled={!b.enabled}>
          <span class="about-label">
            <kbd>{b.canonical}</kbd>
            {b.contribution.titleKey ? i18n.t(b.contribution.titleKey) : b.contribution.id}
          </span>
          <span class="about-value">
            {b.pluginId} · {i18n.t(`settings.about.hotkeyScope.${b.contribution.scope}`)}
            {#if !b.enabled} · {i18n.t('settings.about.hotkeyDisabled')}{/if}
          </span>
        </div>
      {/each}
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
    gap: var(--space-md);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
  }
  .about-label { font-weight: 500; }
  .about-value { color: var(--text-muted); font-family: monospace; font-size: var(--font-size-sm); }
  .about-actions { display: flex; gap: var(--space-sm); }
  .error { color: var(--danger); font-size: var(--font-size-sm); }
  .btn { padding: var(--space-sm) var(--space-lg); border: none; border-radius: var(--radius-md); font-size: var(--font-size-md); cursor: pointer; }
  .btn-secondary { background: var(--bg-surface-hover); color: var(--text-primary); }

  .about-sub { font-weight: 600; margin-top: var(--space-xs); }
  .about-disabled { opacity: 0.55; }
  .about-row kbd {
    font-family: var(--font-mono, monospace);
    padding: 0 var(--space-xs);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    margin-inline-end: var(--space-xs);
  }
  .about-empty { color: var(--text-muted); font-size: var(--font-size-sm); }
</style>