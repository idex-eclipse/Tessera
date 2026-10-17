<script lang="ts">
  import { onDestroy } from 'svelte';

  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../../shared/icons/Icon.svelte';

  import { useCameras } from '../../use-cameras.svelte.ts';

  const api = useWidget();
  const i18n = useI18n();
  const store = useCameras(api);

  let menuOpen = $state(false);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let pos = $state({ top: 0, right: 0 });

  function toggleMenu(): void {
    if (!menuOpen && btnEl) {
      const r = btnEl.getBoundingClientRect();
      pos = { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) };
    }
    menuOpen = !menuOpen;
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') menuOpen = false;
  }

  $effect(() => {
    if (!menuOpen) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="hdr">
  {#if store.enabled.length > 1}
    <select
      class="cam-select"
      value={store.active?.name ?? ''}
      onchange={(e) => store.setActive(e.currentTarget.value)}
    >
      {#each store.enabled as c (c.name)}
        <option value={c.name}>{c.name}</option>
      {/each}
    </select>
  {/if}

  <button
    class="hdr-btn"
    class:active={menuOpen}
    bind:this={btnEl}
    onclick={toggleMenu}
    title={i18n.t('widgets.camera.settings')}
  >
    <Icon name="settings" size={15} />
  </button>
</div>

{#if menuOpen}
  <div class="menu-backdrop" onclick={() => (menuOpen = false)} role="presentation"></div>
  <div class="menu" style:top="{pos.top}px" style:right="{pos.right}px">
    <button class="menu-item" onclick={() => { store.openAdd(); menuOpen = false; }}>
      {i18n.t('widgets.camera.add')}
    </button>
    {#if store.active}
      {#if store.active.source !== 'config'}
        <button class="menu-item" onclick={() => { store.openEdit(store.active!); menuOpen = false; }}>
          {i18n.t('widgets.camera.edit')}
        </button>
        <button class="menu-item danger" onclick={() => { store.askDelete(store.active!); menuOpen = false; }}>
          {i18n.t('widgets.camera.delete')}
        </button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .hdr {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }

  .cam-select {
    max-width: 160px;
    padding: 2px var(--space-xs);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
  }

  .hdr-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .hdr-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .hdr-btn.active {
    background: var(--bg-surface-active);
    color: var(--accent);
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 460;
    background: transparent;
  }

  .menu {
    position: fixed;
    z-index: 461;
    min-width: 180px;
    padding: var(--space-xs);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .menu-item {
    display: block;
    width: 100%;
    padding: var(--space-xs) var(--space-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    text-align: start;
    cursor: pointer;
  }

  .menu-item:hover {
    background: var(--bg-surface-hover);
  }

  .menu-item.danger {
    color: var(--danger);
  }
</style>