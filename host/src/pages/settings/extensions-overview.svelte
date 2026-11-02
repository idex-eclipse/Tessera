<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { extensionRef, parseExtensionRef } from '../../core/extension-resolver';

  /**
   * Settings → Plugins → «Дополнения» (активный принтер): точки, у которых есть
   * вклады, их статус, конфликты и выбор варианта; спящие и отброшенные вклады.
   */
  const { extensions, i18n, loader, settings } = getAppContext();

  let graph = $derived(extensions.graph);
  let points = $derived(
    [...graph.points.values()].filter((p) => p.candidates.length > 0 || p.conflict),
  );

  function pluginName(pluginId: string): string {
    return loader.getLoadedPlugin(pluginId)?.manifest.name ?? pluginId;
  }

  function pointTitle(p: (typeof points)[number]): string {
    return p.decl.titleKey ? i18n.t(p.decl.titleKey) : p.decl.id;
  }

  function ownerOf(point: string): string {
    return point.slice(0, point.lastIndexOf('#'));
  }

  function pointIdOf(address: string): string {
    return address.slice(address.lastIndexOf('#') + 1);
  }

  function onVariant(p: (typeof points)[number], value: string): void {
    // '' — default точки, '@original' — оригинал явно, иначе ref
    const ref = value === '' ? undefined : value === '@original' ? null : value;
    extensions.setChoice(p.owner, pointIdOf(p.address), ref);
  }

  function variantValue(p: (typeof points)[number]): string {
    const choice = extensions.getChoice(p.owner, pointIdOf(p.address));
    if (choice === undefined) return '';
    return choice === null ? '@original' : choice;
  }
</script>

{#if points.length > 0 || graph.sleeping.length > 0 || graph.rejected.length > 0}
  <div class="section-header">
    <h3>{i18n.t('extensions.settings.title')}</h3>
  </div>

  <div class="ext-list">
    {#each points as p (p.address)}
      <div class="ext-point" class:conflict={p.conflict}>
        <div class="ext-head">
          <div class="ext-info">
            <span class="ext-title">{pluginName(p.owner)} → {pointTitle(p)}</span>
            <span class="ext-meta">{p.address} · {i18n.t(`extensions.settings.modes.${p.mode}`)} · v{p.decl.version}</span>
          </div>
          <div class="ext-actions">
            {#if p.conflict}
              <span class="badge danger">{i18n.t('extensions.settings.conflict')}</span>
              <button class="btn btn-primary" onclick={() => extensions.showConflict(p.address)}>
                {i18n.t('extensions.settings.resolve')}
              </button>
            {:else if settings.ui.extensionResolutions[p.address]}
              <button class="btn btn-secondary" onclick={() => settings.setExtensionResolution(p.address, null)}>
                {i18n.t('extensions.settings.resetResolution')}
              </button>
            {/if}
            {#if p.mode === 'alternative'}
              <label class="variant">
                <span>{i18n.t('extensions.settings.variant')}</span>
                <select value={variantValue(p)} onchange={(e) => onVariant(p, e.currentTarget.value)}>
                  <option value="">{i18n.t('extensions.settings.variantDefault')}</option>
                  <option value="@original">{i18n.t('extensions.settings.original')}</option>
                  {#each p.enabled as ext (extensionRef(ext))}
                    <option value={extensionRef(ext)}>{i18n.t(ext.contribution.titleKey)}</option>
                  {/each}
                </select>
              </label>
            {/if}
          </div>
        </div>
        <ul class="ext-items">
          {#each p.candidates as ext (extensionRef(ext))}
            <li>
              <span>{i18n.t(ext.contribution.titleKey)}</span>
              <span class="ext-meta">{pluginName(ext.pluginId)}</span>
              {#if p.enabled.includes(ext)}
                <span class="badge">{i18n.t('extensions.settings.active')}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/each}

    {#each graph.sleeping as ext (extensionRef(ext))}
      <div class="ext-point muted">
        <span class="ext-title">{pluginName(ext.pluginId)}: {i18n.t(ext.contribution.titleKey)}</span>
        <span class="ext-meta">
          {i18n.t('extensions.settings.contributes')} {ext.contribution.point} ·
          {i18n.t('extensions.settings.sleeping', { owner: ownerOf(ext.contribution.point) })}
        </span>
      </div>
    {/each}

    {#each graph.rejected as r (`${extensionRef(r.ext)}-${r.reason}`)}
      {@const point = graph.points.get(r.ext.contribution.point)}
      <div class="ext-point muted">
        <span class="ext-title">{pluginName(r.ext.pluginId)}: {i18n.t(r.ext.contribution.titleKey)}</span>
        <span class="ext-meta warn">
          {i18n.t('extensions.settings.contributes')} {r.ext.contribution.point} ·
          {#if r.reason === 'version-mismatch'}
            {i18n.t('extensions.settings.rejectedVersion', { need: r.ext.contribution.version, have: point?.decl.version ?? '?' })}
          {:else if r.reason === 'kind-mismatch'}
            {i18n.t('extensions.settings.rejectedKind')}
          {:else}
            {i18n.t('extensions.settings.rejectedDuplicate')} ({parseExtensionRef(extensionRef(r.ext))?.id})
          {/if}
        </span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .section-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); }
  .section-header h3 { font-size: var(--font-size-lg); font-weight: 600; }
  .ext-list { display: flex; flex-direction: column; gap: var(--space-sm); }
  .ext-point {
    display: flex; flex-direction: column; gap: var(--space-xs);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--border-color); border-radius: var(--radius-md);
  }
  .ext-point.conflict { border-color: var(--danger); }
  .ext-point.muted { opacity: 0.8; }
  .ext-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); flex-wrap: wrap; }
  .ext-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ext-title { font-weight: 600; }
  .ext-meta { color: var(--text-muted); font-size: var(--font-size-sm); font-family: monospace; overflow-wrap: anywhere; }
  .ext-meta.warn { color: var(--warning); }
  .ext-actions { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
  .ext-items { margin: 0; padding-inline-start: var(--space-md); display: flex; flex-direction: column; gap: 2px; font-size: var(--font-size-sm); }
  .ext-items li { display: flex; align-items: center; gap: var(--space-sm); }
  .variant { display: flex; align-items: center; gap: var(--space-xs); font-size: var(--font-size-sm); color: var(--text-secondary); }
  .variant select {
    padding: 2px var(--space-xs); border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    background: var(--bg-surface); color: var(--text-primary); font-size: var(--font-size-sm);
  }
  .badge { padding: 2px var(--space-sm); border-radius: var(--radius-sm); background: var(--bg-surface-active); color: var(--accent); font-size: var(--font-size-sm); }
  .badge.danger { background: var(--danger); color: #fff; }
  .btn { padding: var(--space-sm) var(--space-lg); border: none; border-radius: var(--radius-md); font-size: var(--font-size-md); cursor: pointer; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-secondary { background: var(--bg-surface-hover); color: var(--text-primary); }
</style>
