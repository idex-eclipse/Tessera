<script lang="ts">
  import { useWidget, useI18n } from '../../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../../shared/icons/Icon.svelte';
  import HeaderHelp from '../../../../shared/header-help/HeaderHelp.svelte';
  import KlippyNotReadyChip from '../../../../shared/klippy-state/KlippyNotReadyChip.svelte'

  import { useMacros } from '../../use-macros.svelte.ts';
  import { isRtl } from '../../../../shared/popover-align';

  const api = useWidget();
  const i18n = useI18n();
  const store = useMacros(api);

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
    if (e.key === 'Escape') {
      menuOpen = false;
      store.setEditMode(false);
    }
  }

  $effect(() => {
    if (!menuOpen) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="hdr">
  <KlippyNotReadyChip />

  <button
    class="hdr-btn"
    class:active={store.editMode}
    title={store.editMode
      ? i18n.t('widgets.macros.exitEdit')
      : i18n.t('widgets.macros.edit')}
    onclick={() => store.setEditMode(!store.editMode)}
  >
    <Icon name="edit" size={15} />
  </button>

  <button
    class="hdr-btn"
    class:active={menuOpen}
    bind:this={btnEl}
    title={i18n.t('widgets.macros.settings')}
    onclick={toggleMenu}
  >
    <Icon name="settings" size={15} />
  </button>

  <HeaderHelp title={i18n.t('widgets.macros.help.Title')}>
    <h4>{i18n.t('widgets.macros.help.EditModeTitle')}</h4>
    <p>{i18n.t('widgets.macros.help.EditModeText')}</p>

    <h4>{i18n.t('widgets.macros.help.HiddenTitle')}</h4>
    <p>{i18n.t('widgets.macros.help.HiddenText')}</p>

    <h4>{i18n.t('widgets.macros.help.ParamsTitle')}</h4>
    <p>{i18n.t('widgets.macros.help.ParamsText')}</p>

    <h4>{i18n.t('widgets.macros.help.DndTitle')}</h4>
    <p>{i18n.t('widgets.macros.help.DndText')}</p>
  </HeaderHelp>
</div>

{#if menuOpen}
  <div class="menu-backdrop" onclick={() => (menuOpen = false)} role="presentation"></div>
  <div
    class="menu"
    style:top="{pos.top}px"
    style:left={pos.left !== undefined ? `${pos.left}px` : undefined}
    style:right={pos.right !== undefined ? `${pos.right}px` : undefined}
  >
    <button
      class="menu-item"
      class:checked={store.cfg.ui.tooltips}
      onclick={() => store.setTooltips(!store.cfg.ui.tooltips)}
    >
      <span class="check">{store.cfg.ui.tooltips ? '✓' : ''}</span>
      {i18n.t('widgets.macros.tooltips')}
    </button>
  </div>
{/if}

<style>
  .hdr {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
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
    transition: background var(--transition-fast), color var(--transition-fast);
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
    min-width: 200px;
    padding: var(--space-xs);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
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

  .menu-item .check {
    width: 14px;
    flex-shrink: 0;
    color: var(--accent);
    font-size: 12px;
  }

  .hdr {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }

  .hdr > :global(.knr-chip) {
    flex-shrink: 0;
  }
</style>