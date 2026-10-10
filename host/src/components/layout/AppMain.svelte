<script lang="ts">
  import type { HostI18n } from '../../core/host-i18n.svelte.ts';
  import type { PluginRegistry } from '../../core/plugin-registry.svelte.ts';
  import type { PrinterManager } from '../../core/printer-manager.svelte.ts';
  import type { Route } from '../../core/router.svelte.ts';

  import Dashboard from '../../pages/dashboard/Dashboard.svelte';
  import Settings from '../../pages/settings/Settings.svelte';
  import PluginSlot from '../plugin-slot/PluginSlot.svelte';
  import PluginBanners from '../plugin-banners/PluginBanners.svelte';
  import QuickAccessPanel from '../quick-access/QuickAccessPanel.svelte';

  let {
    printerManager,
    registry,
    i18n,
    route,
  }: {
    printerManager: PrinterManager;
    registry: PluginRegistry;
    i18n: HostI18n;
    route: Route;
  } = $props();

  // ------------------------------------------------------------------
  // Scroll-машинка баннеров
  // ------------------------------------------------------------------

  const COLLAPSE_THRESHOLD = 32;

  let mainEl: HTMLElement | null = null;
  let scrollerEl: HTMLElement | null = null;

  let bannerMode = $state<'expanded' | 'collapsed'>('expanded');
  let lock = $state<'none' | 'expanded' | 'collapsed'>('none');
  let lastY = 0;
  /** true сразу после смены маршрута: инертный сброс скролла не должен
   *  управлять баннером (иначе авто-expand при переходе на короткую страницу). */
  let scrollGuard = false;

  $effect(() => {
    const sc = scrollerEl;
    if (!sc) return;

    lastY = sc.scrollTop;

    const onScroll = () => {
      const y = sc.scrollTop;

      if (scrollGuard) {
        lastY = y;
        return;
      }

      if (y <= 2) {
        if (lock !== 'collapsed') {
          lock = 'none';
          if (bannerMode !== 'expanded') bannerMode = 'expanded';
        }
      } else if (lock === 'none' && y > lastY && y > COLLAPSE_THRESHOLD) {
        if (bannerMode !== 'collapsed') bannerMode = 'collapsed';
      }

      lastY = y;
    };

    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => sc.removeEventListener('scroll', onScroll);
  });

  // намерения плагина
  $effect(() => {
    const root = mainEl;
    if (!root) return;

    const onExpand = () => {
      lock = 'expanded';
      bannerMode = 'expanded';
      console.log('[banners] manual expand (override until top)');
    };
    const onCollapse = () => {
      lock = 'collapsed';
      bannerMode = 'collapsed';
      console.log('[banners] manual collapse (override until manual expand)');
    };

    root.addEventListener('mpu:banner-expand', onExpand);
    root.addEventListener('mpu:banner-collapse', onCollapse);
    return () => {
      root.removeEventListener('mpu:banner-expand', onExpand);
      root.removeEventListener('mpu:banner-collapse', onCollapse);
    };
  });

  // смена маршрута: начинаем с развёрнутого, блоки сброшены
  $effect(() => {
    void route;

    scrollGuard = true;
    if (scrollerEl) lastY = scrollerEl.scrollTop;

    const t = setTimeout(() => {
      scrollGuard = false;
    }, 120);

    return () => clearTimeout(t);
  });

  $effect(() => {
    if (route.kind !== 'dashboard' || !route.printerId) return;
    const preview = route.query.preview;
    if (!preview) return;

    const has = registry.getDashboardLayout(route.printerId)
      .some((i) => i.type === 'gcode-preview');

    if (!has) {
      globalThis.location.replace(
        `#/p/${route.printerId}/gcode-preview?file=${encodeURIComponent(preview)}`,
      );
    }
  });
</script>

<main class="main" bind:this={mainEl}>
  <PluginBanners mode={bannerMode} routeKind={route.kind} />
  <QuickAccessPanel {route} />

  <div class="route-scroll" bind:this={scrollerEl}>
    {#if route.kind === 'dashboard'}
      <Dashboard {printerManager} {registry} {i18n} params={route.query} />
    {:else if route.kind === 'settings'}
      <Settings />
    {:else if route.kind === 'plugin-page'}
      {#key route.pageId}
        <PluginSlot pageId={route.pageId} params={route.query} />
      {/key}
    {/if}
  </div>
</main>

<style>
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    padding: var(--space-lg);
  }

  .route-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    min-width: 0;
  }
</style>