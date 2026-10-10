<script lang="ts">
  import { usePluginApi } from '../../../../../plugin-sdk/src/svelte/index';
  import { shaper, gallerySorted, loadPreview } from '../../../shaper-state.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;

  let items = $derived(gallerySorted());
  // артефакты последнего прогона ЛЮБОЙ панели (shaper pipe / belts pipe)
  let newSet = $derived(new Set([...shaper.lastArtifacts, ...shaper.beltArtifacts]));

  function fmtTime(modified: number): string {
    return new Date(modified * 1000).toLocaleString();
  }
</script>

<div class="graphs">
  {#if !shaper.galleryLoaded}
    <p class="hint">…</p>
  {:else if items.length === 0}
    <p class="hint">{i18n.t('calibrations.shaper.galleryEmpty')}</p>
  {:else}
    <div class="gallery">
      {#each items as it (it.path)}
        <button
          class="g-item"
          class:active={shaper.selected === it.path}
          class:artifact={newSet.has(it.path)}
          onclick={() => loadPreview(api, it.path)}
          title={fmtTime(it.modified)}
        >
          <span class="g-name">{it.path.split('/').pop()}</span>
          <span class="g-meta">
            {#if it.tag}<span class="tag">{it.tag}</span>{/if}
            {#if newSet.has(it.path)}
              <span class="tag new">{i18n.t('calibrations.shaper.newBadge')}</span>
            {/if}
          </span>
        </button>
      {/each}
    </div>

    {#if shaper.previewUrl}
      <img class="preview" src={shaper.previewUrl} alt={shaper.selected ?? ''} />
    {/if}
  {/if}
</div>

<style>
  .graphs { display: flex; flex-direction: column; gap: var(--space-sm); }
  .hint { margin: 0; color: var(--text-muted); font-size: var(--font-size-sm); }

  .gallery { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
  .g-item {
    display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    background: transparent; color: var(--text-secondary); cursor: pointer;
    font-size: 11px; max-width: 220px;
  }
  .g-item:hover { background: var(--bg-surface-hover); }
  .g-item.active { border-color: var(--accent); color: var(--accent); }
  .g-item.artifact { border-style: dashed; border-color: var(--accent); }
  .g-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .g-meta { display: flex; gap: 4px; }
  .tag {
    padding: 0 5px; border-radius: 4px; background: var(--bg-surface-active);
    color: var(--accent); font-size: 10px; font-weight: 600;
  }
  .tag.new { background: var(--accent); color: #fff; }

  .preview {
    max-width: 100%; max-height: 420px; object-fit: contain;
    border: 1px solid var(--border-color); border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
  }
</style>