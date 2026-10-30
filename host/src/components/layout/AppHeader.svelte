<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PrinterManager } from '../../core/printer-manager.svelte.ts';
  import type { Router } from '../../core/router.svelte.ts';
  import type { UiStore } from '../../core/ui-store.svelte.ts';

  import { getAppContext } from '../../app-context.ts';
  import Icon from '../icons/Icon.svelte';
  import PrinterTabs from '../printer-tabs/PrinterTabs.svelte';

  let {
    printerManager,
    router,
    ui,
    i18n,
  }: {
    printerManager: PrinterManager;
    router: Router;
    ui: UiStore;
    i18n: HostI18n;
  } = $props();

  const ctx = getAppContext();

  // Те же условия, при которых AppRightPanel вообще рендерится.
  let hasRightPanel = $derived(
    Boolean(ctx.registry.getRightPanel()) && (ctx.settings?.printers?.length ?? 0) > 0,
  );

  let menuBtn = $state<HTMLButtonElement | null>(null);
  let rightBtn = $state<HTMLButtonElement | null>(null);

  // После закрытия панели фокус возвращается на её триггер.
  let lastPanel: typeof ui.mobilePanel = null;
  $effect(() => {
    const current = ui.mobilePanel;
    if (lastPanel !== null && current === null) {
      (lastPanel === 'nav' ? menuBtn : rightBtn)?.focus();
    }
    lastPanel = current;
  });
</script>

<header class="header">
  {#if ui.isNarrow}
    <button
      class="icon-btn"
      class:active={ui.mobilePanel === 'nav'}
      bind:this={menuBtn}
      onclick={() => ui.toggleMobilePanel('nav')}
      aria-label={i18n.t('nav.openMenu')}
      aria-expanded={ui.mobilePanel === 'nav'}
    >
      <Icon name="menu" />
    </button>
  {/if}

  <div class="header-left">
    <PrinterTabs {printerManager} {router} {ui} {i18n}/>
  </div>

  {#if ui.isNarrow && hasRightPanel}
    <button
      class="icon-btn"
      class:active={ui.mobilePanel === 'right'}
      bind:this={rightBtn}
      onclick={() => ui.toggleMobilePanel('right')}
      aria-label={i18n.t('common.rightPanel.open')}
      aria-expanded={ui.mobilePanel === 'right'}
    >
      <Icon name="sliders" />
    </button>
  {/if}
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    height: var(--header-height);
    padding: 0 var(--space-md);
    background: var(--bg-header);
    color: var(--text-on-header);
    flex: 1;
    min-width: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--touch-target);
    height: var(--touch-target);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-on-header-muted);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .icon-btn:hover,
  .icon-btn.active {
    background: var(--bg-header-hover-overlay, rgba(255, 255, 255, 0.1));
    color: var(--text-on-header);
  }
</style>
