<script lang="ts">
  import { usePluginApi } from '../../../../plugin-sdk/src/svelte/index';

  import Icon from '../../../shared/icons/Icon.svelte';

  import { useSystem, type UpdateItemModel } from '../../use-system.svelte.ts';
  import ConfirmDialog from '../../../shared/confirm-dialog.svelte';

  const api = usePluginApi();
  const i18n = api.i18n;
  const store = useSystem(api);

  let expanded = $state<Record<string, boolean>>({});
  let logEl = $state<HTMLDivElement | null>(null);
  let confirm = $state<{ title: string; message: string; label: string; action: () => void } | null>(
    null,
  );

  function toggle(name: string): void {
    expanded = { ...expanded, [name]: !expanded[name] };
  }

  function hasUpdate(item: UpdateItemModel): boolean {
    if (item.type === 'system') return item.packageCount > 0;
    if (item.commitsBehindCount > 0) return true;
    if (item.remoteVersion && item.remoteVersion !== item.version) return true;
    return false;
  }

  // Для system/unknown, где behind не определён — считаем «количеством за»
  $effect(() => {
    // синхронизация expanded-состояния с текущим списком
    const keys = new Set(store.updates.items.map((i) => i.name));
    const next: Record<string, boolean> = {};
    for (const k of Object.keys(expanded)) {
      if (keys.has(k)) next[k] = expanded[k];
    }
    if (Object.keys(next).length !== Object.keys(expanded).length) {
      expanded = next;
    }
  });

  function fmtDate(t: string): string {
    const n = Number(t);
    if (!Number.isFinite(n)) return t;
    return new Date(n * 1000).toLocaleString();
  }

  function fmtHash(h: string): string {
    return h.slice(0, 7);
  }

  function statusBadges(item: UpdateItemModel): Array<{ cls: string; label: string }> {
    const list: Array<{ cls: string; label: string }> = [];
    if (item.corrupt) list.push({ cls: 'danger', label: i18n.t('system.updates.corrupt') });
    if (item.dirty) list.push({ cls: 'warn', label: i18n.t('system.updates.dirty') });
    if (item.detached) list.push({ cls: 'warn', label: i18n.t('system.updates.detached') });
    if (!item.pristine && !item.dirty)
      list.push({ cls: 'warn', label: i18n.t('system.updates.notPristine') });
    if (!item.isValid) list.push({ cls: 'danger', label: i18n.t('system.updates.invalid') });
    return list;
  }

  $effect(() => {
    void store.updateLog;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });
</script>

{#if store.updates.items.length > 0}
  <section class="panel">
    <header class="panel-header">
      <span class="panel-title">{i18n.t('system.updates.title')}</span>
      <button
        class="icon-btn"
        title={i18n.t('system.updates.refresh')}
        disabled={store.busy !== '' || store.updates.busy}
        onclick={() => store.refreshUpdates()}
      >
        <Icon name="refresh" size={14} />
      </button>
    </header>

    <div class="panel-body rows">
      {#each store.updates.items as item (item.name)}
        {@const upd = hasUpdate(item)}
        {@const badges = statusBadges(item)}
        <div class="item">
          <button
            class="row"
            onclick={() => toggle(item.name)}
            aria-expanded={!!expanded[item.name]}
          >
            <span class="chev" class:open={expanded[item.name]}>
              <Icon name="chevron-down" size={14} />
            </span>
            <div class="row-main">
              <span class="row-name">
                {item.name}
                <span class="row-type">· {item.configuredType}</span>
              </span>
              <span class="row-sub">
                {#if item.type === 'system'}
                  {item.packageCount} {i18n.t('system.updates.packages')}
                {:else}
                  {item.version}
                  {#if item.remoteVersion && item.remoteVersion !== item.version}
                    → {item.remoteVersion}
                  {/if}
                  {#if item.branch}· {item.branch}{/if}
                  {#if item.owner}· {item.owner}{/if}
                {/if}
              </span>
            </div>

            <div class="badge-row">
              {#each badges as b (b.label)}
                <span class="badge {b.cls}">{b.label}</span>
              {/each}
              {#if upd}
                <span class="badge upd">{i18n.t('system.updates.available')}</span>
              {:else if item.type !== 'system'}
                <span class="badge ok">{i18n.t('system.updates.upToDate')}</span>
              {/if}
            </div>

            <div class="row-actions">
              {#if item.type !== 'system' && upd}
                <button
                  class="btn"
                  disabled={store.busy !== '' || store.updates.busy}
                  onclick={(e) => {
                    e.stopPropagation();
                    store.updateItem(item.name);
                  }}
                >
                  {#if store.updates.busy}
                    <span class="spinner" aria-hidden="true"></span>
                  {:else}
                    <Icon name="download" size={14} />
                  {/if}
                  {i18n.t('system.updates.update')}
                </button>
              {:else if item.type === 'system' && upd}
                <button
                  class="btn"
                  disabled={store.busy !== '' || store.updates.busy}
                  onclick={(e) => {
                    e.stopPropagation();
                    store.updateItem(item.name);
                  }}
                >
                  {#if store.updates.busy}
                    <span class="spinner" aria-hidden="true"></span>
                  {:else}
                    <Icon name="download" size={14} />
                  {/if}
                  {i18n.t('system.updates.update')}
                </button>
              {/if}

              {#if item.type === 'git_repo' && item.rollbackVersion}
                <button
                  class="btn"
                  disabled={store.busy !== '' || store.updates.busy}
                  onclick={(e) => {
                    e.stopPropagation();
                    confirm = {
                      title: i18n.t('system.updates.rollback'),
                      message: i18n.t('system.updates.confirmRollback', {
                        name: item.name,
                        version: item.rollbackVersion,
                      }),
                      label: i18n.t('system.updates.rollback'),
                      action: () => store.rollbackItem(item.name),
                    };
                  }}
                >
                  <Icon name="rollback" size={14} />
                  {i18n.t('system.updates.rollback')}
                </button>
              {/if}
            </div>
          </button>

          {#if expanded[item.name]}
            <div class="details">
              {#if item.type === 'system'}
                <div class="pkg-list">
                  {#each item.packageList as pkg (pkg)}
                    <span class="pkg-chip">{pkg}</span>
                  {/each}
                </div>
              {:else}
                <table class="kv">
                  <tbody>
                    {#if item.fullVersionString}
                      <tr>
                        <td class="k">{i18n.t('system.updates.fullVersion')}</td>
                        <td class="v">{item.fullVersionString}</td>
                      </tr>
                    {/if}
                    {#if item.currentHash}
                      <tr>
                        <td class="k">{i18n.t('system.updates.currentHash')}</td>
                        <td class="v">{fmtHash(item.currentHash)}</td>
                      </tr>
                    {/if}
                    {#if item.remoteHash && item.remoteHash !== item.currentHash}
                      <tr>
                        <td class="k">{i18n.t('system.updates.remoteHash')}</td>
                        <td class="v">{fmtHash(item.remoteHash)}</td>
                      </tr>
                    {/if}
                    {#if item.remoteUrl}
                      <tr>
                        <td class="k">{i18n.t('system.updates.remoteUrl')}</td>
                        <td class="v">
                          <a href={item.remoteUrl} target="_blank" rel="noopener noreferrer">
                            {item.remoteUrl}
                          </a>
                        </td>
                      </tr>
                    {/if}
                    {#if item.rollbackVersion}
                      <tr>
                        <td class="k">{i18n.t('system.updates.rollbackVersion')}</td>
                        <td class="v">{item.rollbackVersion}</td>
                      </tr>
                    {/if}
                  </tbody>
                </table>

                {#if item.warnings.length > 0}
                  <div class="warn-block">
                    <div class="block-title warn">{i18n.t('system.updates.warnings')}</div>
                    <ul class="list">
                      {#each item.warnings as w (w)}
                        <li>{w}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}

                {#if item.anomalies.length > 0}
                  <div class="warn-block">
                    <div class="block-title warn">{i18n.t('system.updates.anomalies')}</div>
                    <ul class="list">
                      {#each item.anomalies as a (a)}
                        <li>{a}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}

                {#if item.gitMessages.length > 0}
                  <div class="warn-block">
                    <div class="block-title danger">{i18n.t('system.updates.gitErrors')}</div>
                    <ul class="list">
                      {#each item.gitMessages as m (m)}
                        <li>{m}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}

                {#if item.commitsBehind.length > 0}
                  <div class="commits">
                    <div class="block-title">
                      {i18n.t('system.updates.commitsBehind', { count: item.commitsBehindCount })}
                    </div>
                    {#each item.commitsBehind as c (c.sha)}
                      <div class="commit">
                        <div class="commit-head">
                          <span class="commit-sha">{fmtHash(c.sha)}</span>
                          <span class="commit-author">{c.author}</span>
                          <span class="commit-date">{fmtDate(c.date)}</span>
                          {#if c.tag}<span class="badge ok">{c.tag}</span>{/if}
                        </div>
                        <div class="commit-subject">{c.subject}</div>
                        {#if c.message && c.message !== c.subject}
                          <pre class="commit-body">{c.message}</pre>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if store.updateLog.length > 0}
      <div class="log-head">
        <span class="log-title">{i18n.t('system.updates.log')}</span>
        <button
          class="icon-btn"
          title={i18n.t('system.updates.clearLog')}
          onclick={() => store.clearUpdateLog()}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <div class="log-box" bind:this={logEl}>
        {#each store.updateLog as entry, i (i)}
          <div class="log-line">
            {#if entry.app}<span class="log-app">[{entry.app}]</span>{/if}
            {entry.line}
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<ConfirmDialog
  open={confirm !== null}
  title={confirm?.title ?? ''}
  message={confirm?.message ?? ''}
  confirmLabel={confirm?.label ?? i18n.t('system.confirm')}
  danger={true}
  onConfirm={() => confirm?.action()}
  onClose={() => (confirm = null)}
/>

<style>
  .panel {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
  }

  .panel-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .panel-body.rows {
    display: flex;
    flex-direction: column;
  }

  .item {
    border-bottom: 1px solid var(--border-color);
  }

  .item:last-child {
    border-bottom: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    background: transparent;
    border: none;
    width: 100%;
    text-align: start;
    cursor: pointer;
  }

  .row:hover {
    background: var(--bg-surface-hover);
  }

  .chev {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    transform: rotate(-90deg);
    transition: transform var(--transition-fast);
    flex-shrink: 0;
  }

  .chev.open {
    transform: rotate(0deg);
  }

  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row-name {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-type {
    color: var(--text-muted);
    font-weight: 400;
  }

  .row-sub {
    font-size: 11px;
    font-family: monospace;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge-row {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }

  .badge {
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }

  .badge.ok {
    background: color-mix(in srgb, var(--success) 18%, transparent);
    color: var(--success);
  }

  .badge.upd {
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
  }

  .badge.warn {
    background: color-mix(in srgb, var(--warning) 18%, transparent);
    color: var(--warning);
  }

  .badge.danger {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
  }

  .row-actions {
    display: flex;
    gap: var(--space-xs);
    flex-shrink: 0;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    white-space: nowrap;
  }

  .btn:hover:not(:disabled) {
    background: var(--bg-surface-active);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .icon-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* details panel */
  .details {
    padding: var(--space-sm) var(--space-md) var(--space-md) calc(var(--space-md) + 22px);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    background: color-mix(in srgb, var(--bg-surface-hover) 50%, transparent);
    border-top: 1px solid var(--border-color);
  }

  .kv {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }

  .kv td {
    padding: var(--space-xs) 0;
    border-bottom: 1px solid var(--border-color);
    vertical-align: top;
  }

  .kv tr:last-child td {
    border-bottom: none;
  }

  .kv .k {
    color: var(--text-muted);
    white-space: nowrap;
    width: 1%;
    padding-right: var(--space-md);
  }

  .kv .v {
    color: var(--text-primary);
    font-family: monospace;
    word-break: break-all;
  }

  .kv .v a {
    color: var(--accent);
  }

  .warn-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .block-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .block-title.warn {
    color: var(--warning);
  }

  .block-title.danger {
    color: var(--danger);
  }

  .list {
    margin: 0;
    padding-left: var(--space-md);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .pkg-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }

  .pkg-chip {
    padding: 2px var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    font-size: 11px;
    font-family: monospace;
    color: var(--text-primary);
  }

  .commits {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .commit {
    padding: var(--space-xs) var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
  }

  .commit-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }

  .commit-sha {
    font-family: monospace;
    color: var(--accent);
    font-size: 11px;
  }

  .commit-author {
    color: var(--text-primary);
    font-size: 11px;
  }

  .commit-date {
    margin-inline-start: auto;
    color: var(--text-muted);
    font-size: 11px;
  }

  .commit-subject {
    margin-top: var(--space-xs);
    font-weight: 600;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .commit-body {
    margin: var(--space-xs) 0 0;
    font-family: monospace;
    font-size: 11px;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* log */
  .log-head {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-md);
    border-top: 1px solid var(--border-color);
  }

  .log-title {
    flex: 1;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .log-box {
    max-height: 240px;
    overflow-y: auto;
    padding: var(--space-sm) var(--space-md);
    background: var(--bg-app);
    font-family: monospace;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .log-app {
    color: var(--accent);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border-color);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>