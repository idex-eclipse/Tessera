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
  import { createCollapseOnScroll } from '../../core/collapse-on-scroll.ts';
  import { narrowWidth } from '../../core/narrow-width.ts';

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

  // Ширина рабочей области (а не окна): баннеры и чипы принимают мобильный вид, когда область
  // уже брейкпоинта — в том числе на широком экране с двумя открытыми сайдбарами.
  let narrow = $state(false);

  let bannerMode = $state<'expanded' | 'collapsed'>('expanded');
  let lock = $state<'none' | 'expanded' | 'collapsed'>('none');
  let lastY = 0;
  /** true сразу после смены маршрута: инертный сброс скролла не должен
   *  управлять баннером (иначе авто-expand при переходе на короткую страницу). */
  let scrollGuard = false;

  // Узкий экран: баннеры и чипы сворачиваются скроллом вниз, раскрываются только нажатием.
  // Скролл считаем у самой main (раскрытые поверхности не поместились в экран) и у внутренних
  // контейнеров страницы (.settings-content), но не у мелких списков внутри виджетов и не внутри
  // самих поверхностей. Автопрокрутка без действий пользователя (лог консоли) не в счёт:
  // иначе она сворачивала бы поверхность сразу после каждого раскрытия.
  const MIN_SCROLLER_SHARE = 0.5;
  const USER_INPUT_WINDOW_MS = 1000;

  const collapser = createCollapseOnScroll({ threshold: COLLAPSE_THRESHOLD });
  let lastInputAt = -Infinity;
  let chipsOpen = $state(false);
  let bannersRef: { collapseAll(): void } | null = null;
  let mainHeight = $state(0);

  function onNarrowScroll(main: HTMLElement, sc: HTMLElement, target: EventTarget | null): void {
    if (!(target instanceof HTMLElement)) return;
    const pageLevel =
      target === main ||
      target === sc ||
      (sc.contains(target) && target.clientHeight >= sc.clientHeight * MIN_SCROLLER_SHARE);
    if (!pageLevel) return;

    if (scrollGuard || performance.now() - lastInputAt > USER_INPUT_WINDOW_MS) {
      collapser.sync(target, target.scrollTop);
      return;
    }

    if (collapser.update(target, target.scrollTop)) {
      bannersRef?.collapseAll();
      chipsOpen = false;
    }
  }

  $effect(() => {
    const root = mainEl;
    if (!root) return;

    const onUserInput = () => {
      lastInputAt = performance.now();
    };
    const inputOptions = { capture: true, passive: true };
    const inputEvents = ['wheel', 'touchmove', 'pointerdown', 'keydown'];
    for (const type of inputEvents) root.addEventListener(type, onUserInput, inputOptions);

    return () => {
      for (const type of inputEvents) root.removeEventListener(type, onUserInput, inputOptions);
    };
  });

  // bannerMode и lock относятся только к широкому экрану: при смене режима начинаем заново.
  let wasNarrow = false;
  $effect(() => {
    if (wasNarrow !== narrow) {
      bannerMode = 'expanded';
      lock = 'none';
      chipsOpen = false;
    }
    wasNarrow = narrow;
  });

  $effect(() => {
    const root = mainEl;
    const sc = scrollerEl;
    if (!root || !sc) return;

    lastY = sc.scrollTop;

    const onScroll = (event: Event) => {
      if (narrow) {
        onNarrowScroll(root, sc, event.target);
        lastY = sc.scrollTop;
        return;
      }

      if (event.target !== sc) return;

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

    // capture: scroll не всплывает, а нужны и внутренние контейнеры страницы
    const scrollOptions = { capture: true, passive: true };
    root.addEventListener('scroll', onScroll, scrollOptions);
    return () => root.removeEventListener('scroll', onScroll, scrollOptions);
  });

  // намерения плагина
  $effect(() => {
    const root = mainEl;
    if (!root) return;

    const onExpand = () => {
      if (narrow) return;
      lock = 'expanded';
      bannerMode = 'expanded';
      console.log('[banners] manual expand (override until top)');
    };
    const onCollapse = () => {
      if (narrow) return;
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

<main
  class="main"
  class:narrow
  bind:this={mainEl}
  bind:clientHeight={mainHeight}
  use:narrowWidth={(v) => (narrow = v)}
>
  <PluginBanners
    bind:this={bannersRef}
    mode={bannerMode}
    routeKind={route.kind}
    {narrow}
    available={mainHeight}
  />
  <QuickAccessPanel {route} {narrow} available={mainHeight} bind:accordionOpen={chipsOpen} />

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

  /* Раскрытые баннеры и чипы могут занять весь экран: контент не сжимается в ноль,
     main прокручивается, и этот же жест сворачивает поверхности. */
  .main.narrow {
    overflow-x: hidden;
    overflow-y: auto;
  }

  .main.narrow .route-scroll {
    flex-shrink: 0;
    min-height: 50vh;
  }
</style>