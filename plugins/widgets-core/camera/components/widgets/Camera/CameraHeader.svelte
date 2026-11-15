<script lang="ts">
  import { ExtensionPoint, useWidget, useI18n } from '../../../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../../../shared/icons/Icon.svelte';
  import { isRtl } from '../../../../../shared/popover-align';

  import { useCameras } from '../../../data/use-cameras.svelte.ts';
  import type { ExtensionRef } from '../../../../../../plugin-sdk/src/types';

  const api = useWidget();
  const i18n = useI18n();
  const store = useCameras(api);

  // Extension changes can add or remove tabs while this header remains mounted.
  let extensionVersion = $state(0);
  $effect(() => api.extensions.onChange(() => extensionVersion++));
  let extensionTabs = $derived.by<ExtensionRef[]>(() => {
    void extensionVersion;
    return api.extensions.list('camera-tabs');
  });
  $effect(() => {
    if (store.activeTab !== 'live' && !extensionTabs.some((tab) => tab.ref === store.activeTab)) {
      store.setActiveTab('live');
    }
  });

  let menuOpen = $state(false);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let pos = $state<{ top: number; left?: number; right?: number }>({ top: 0, right: 0 });

  function toggleMenu(): void {
    if (!menuOpen && btnEl) {
      const r = btnEl.getBoundingClientRect();
      // меню выравнивается по краю кнопки со стороны конца (в RTL — по левому)
      pos = isRtl()
        ? { top: r.bottom + 4, left: Math.max(8, r.left) }
        : { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) };
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

<!-- header-camera (replacement): the header bar; its menu below opens only from the original. Replace it together with widget-camera: the buttons drive the original body -->
<ExtensionPoint point="header-camera">
  {#snippet original()}
    <div class="hdr">
      {#if extensionTabs.length > 0}
        <div class="tabs" role="tablist" aria-label={i18n.t('widgets.camera.views')}>
          <button class="tab" class:active={store.activeTab === 'live'} role="tab"
            aria-selected={store.activeTab === 'live'} onclick={() => store.setActiveTab('live')}>
            {i18n.t('widgets.camera.live')}
          </button>
          {#each extensionTabs as tab (tab.ref)}
            <button class="tab" class:active={store.activeTab === tab.ref} role="tab"
              aria-selected={store.activeTab === tab.ref} onclick={() => store.setActiveTab(tab.ref)}>
              {tab.title}
            </button>
          {/each}
        </div>
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
  {/snippet}
</ExtensionPoint>

{#if menuOpen}
  <div class="menu-backdrop" onclick={() => (menuOpen = false)} role="presentation"></div>
  <div
    class="menu"
    style:top="{pos.top}px"
    style:left={pos.left !== undefined ? `${pos.left}px` : undefined}
    style:right={pos.right !== undefined ? `${pos.right}px` : undefined}
  >
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
    min-width: 0;
    max-width: 100%;
  }

  /* Long translations scroll inside the card header, preserving the settings button at narrow widths. */
  .tabs {
    display: flex;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .tab {
    flex: 0 0 auto;
    padding-inline: var(--space-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    white-space: nowrap;
    cursor: pointer;
  }

  .tab:hover { background: var(--bg-surface-hover); }
  .tab.active { background: var(--bg-surface-active); color: var(--accent); font-weight: 600; }
  .tab:focus-visible { outline: 2px solid var(--border-focus); outline-offset: -2px; }

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
