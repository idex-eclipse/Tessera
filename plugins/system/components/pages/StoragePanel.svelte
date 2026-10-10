<script lang="ts">
  import { onDestroy } from 'svelte';

  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  const api = usePluginApi();
  const i18n = api.i18n;

  const ROOTS = ['config', 'logs', 'gcodes', 'config_examples', 'docs'];

  let root = $state('config');
  let dir = $state<any>(null);

  async function load(): Promise<void> {
    try {
      dir = await api.moonraker().request('server.files.get_directory', {
        path: root,
      });
    } catch {
      dir = null;
    }
  }

  $effect(() => {
    void root;
    void load();
  });

  const offFiles = api.moonraker().onNotify('notify_filelist_changed', () => void load());
  onDestroy(offFiles);

  function fmtBytes(n: number): string {
    if (!Number.isFinite(n)) return '—';
    if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GiB`;
    if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MiB`;
    if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KiB`;
    return `${n} B`;
  }

  let usage = $derived(dir?.disk_usage ?? null);
  let usedPct = $derived(
    usage && usage.total ? Math.round((usage.used / usage.total) * 100) : 0,
  );
  let folderSize = $derived(
    ((dir?.files ?? []) as any[]).reduce(
      (s: number, f: any) => s + (Number(f?.size) || 0),
      0,
    ),
  );
</script>

<div class="storage">
  <div class="tabs" role="tablist">
    {#each ROOTS as r (r)}
      <button
        class="tab"
        class:active={root === r}
        role="tab"
        aria-selected={root === r}
        onclick={() => (root = r)}
      >
        {r}
      </button>
    {/each}
  </div>

  {#if usage}
    <div class="usage">
      <div class="usage-bar">
        <div class="usage-fill" style="width: {usedPct}%"></div>
      </div>
      <span class="usage-text">
        {fmtBytes(usage.used)} {i18n.t('system.storage.used')} /
        {fmtBytes(usage.free)} {i18n.t('system.storage.free')}
      </span>
    </div>
  {/if}

  <div class="folder-line">
    <span class="folder-label">
      {i18n.t('system.storage.folderSize')} «{root}»:
    </span>
    <span class="folder-size">{fmtBytes(folderSize)}</span>
  </div>
</div>

<style>
  .storage {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .tabs {
    display: flex;
    gap: var(--space-xs);
    flex-wrap: wrap;
  }

  .tab {
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    font-family: monospace;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .tab:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--bg-surface-active);
    border-color: var(--accent);
    color: var(--accent);
  }

  .usage {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .usage-bar {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: var(--bg-surface-hover);
    overflow: hidden;
  }

  .usage-fill {
    height: 100%;
    background: var(--accent);
    transition: width var(--transition-normal);
  }

  .usage-text {
    font-size: var(--font-size-sm);
    font-family: monospace;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .folder-line {
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
    font-size: var(--font-size-sm);
  }

  .folder-label {
    color: var(--text-muted);
  }

  .folder-size {
    font-family: monospace;
    color: var(--text-primary);
  }
</style>