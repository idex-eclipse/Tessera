<script lang="ts">
  import { ExtensionPoint, useWidget, useI18n } from '../../../../../../plugin-sdk/src/svelte/index';
  import Icon from '../../../../../shared/icons/Icon.svelte';
  import HeaderHelp from '../../../../../shared/header-help/HeaderHelp.svelte';
  import { isRtl } from '../../../../../shared/popover-align';

  import { useLeds } from '../../../data/use-leds.svelte.ts';

  const api = useWidget();
  const i18n = useI18n();
  const store = useLeds(api);

  let menuOpen = $state(false);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let pos = $state<{ top: number; left?: number; right?: number }>({ top: 0, right: 0 });

  function toggleMenu(): void {
    if (!menuOpen && btnEl) {
      const r = btnEl.getBoundingClientRect();
      pos = isRtl()
        ? { top: r.bottom + 4, left: Math.max(8, r.left) }
        : { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) };
    }
    menuOpen = !menuOpen;
  }

  $effect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') menuOpen = false; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<!-- header-leds (replacement): the header bar; its menu below opens only from the original. Replace it together with widget-leds: the buttons drive the original body -->
<ExtensionPoint point="header-leds">
  {#snippet original()}
    <div class="hdr">
      {#if store.templates.length > 0}
        <button
          class="hdr-btn"
          class:active={menuOpen}
          bind:this={btnEl}
          title={i18n.t('widgets.leds.hiddenTemplates')}
          onclick={toggleMenu}
        >
          <Icon name="settings" size={15} />
        </button>
      {/if}

      <HeaderHelp title={i18n.t('widgets.leds.help.title')}>
        <h4>{i18n.t('widgets.leds.help.pixelsTitle')}</h4>
        <p>{i18n.t('widgets.leds.help.pixelsText')}</p>

        <h4>{i18n.t('widgets.leds.help.templatesTitle')}</h4>
        <p>{i18n.t('widgets.leds.help.templatesText')}</p>
        <p>{i18n.t('widgets.leds.help.templatesMemory')}</p>
      </HeaderHelp>
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
    <div class="menu-title">{i18n.t('widgets.leds.shownTemplates')}</div>
    {#each store.templates as t (t.name)}
      {@const shown = !store.hiddenTemplates.includes(t.name)}
      <button class="menu-item" onclick={() => store.setTemplateHidden(t.name, shown)}>
        <span class="check">{shown ? '✓' : ''}</span>
        <span class="name" dir="ltr">{t.name}</span>
      </button>
    {/each}
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
    max-height: 60vh;
    overflow-y: auto;
    padding: var(--space-xs);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .menu-title {
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-muted);
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
  .menu-item:hover { background: var(--bg-surface-hover); }
  .menu-item .check {
    width: 14px;
    flex-shrink: 0;
    color: var(--accent);
    font-size: 12px;
  }
  .menu-item .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, monospace;
  }
</style>
