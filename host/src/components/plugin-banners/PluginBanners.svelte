<script lang="ts">
  import { getAppContext } from '../../app-context';
  import { computeBannerLayout } from '../../core/banner-layout.ts';
  import Collapsible from '../Collapsible.svelte';
  import Icon from '../icons/Icon.svelte';
  import PluginSurface from '../PluginSurface.svelte';

  let {
    mode = 'expanded',
    routeKind = 'dashboard',
    narrow = false,
    available = 0,
  }: {
    mode?: 'expanded' | 'collapsed';
    routeKind?: string;
    /** Рабочая область уже брейкпоинта (считает AppMain), а не окно. */
    narrow?: boolean;
    /** Высота рабочей области: от неё считается, помещаются ли баннеры. */
    available?: number;
  } = $props();

  const ctx = getAppContext();

  let banners = $derived(ctx.registry.getBanners());
  let collapsedBanners = $derived(ctx.registry.getCollapsedBanners());

  const keyOf = (pluginId: string, id: string) => `${pluginId}:${id}`;

  // Баннер всегда смонтирован и сам рисует «ничего», когда сообщать нечего, поэтому
  // считать «видимые» по числу регистраций нельзя — меряем реальную высоту элементов.
  // Collapsible сохраняет естественную высоту содержимого и в свёрнутом виде.
  let fullHeights = $state<Record<string, number>>({});
  let rowHeights = $state<Record<string, number>>({});
  let collapsedElementHeights = $state<Record<string, number>>({});

  function observeHeight(node: HTMLElement, [store, key]: [Record<string, number>, string]) {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      store[key] = node.offsetHeight;
    });
    ro.observe(node);
    return {
      destroy() {
        ro.disconnect();
        delete store[key];
      },
    };
  }

  let layout = $derived(
    computeBannerLayout({
      narrow,
      available,
      banners: banners.map((banner) => {
        const key = keyOf(banner.pluginId, banner.contribution.id);
        return {
          key,
          fullHeight: fullHeights[key] ?? 0,
          collapsedHeight: rowHeights[key] ?? 0,
        };
      }),
    }),
  );

  const isVisible = (key: string) => (fullHeights[key] ?? 0) > 0;

  let visibleCount = $derived(
    banners.filter((banner) => isVisible(keyOf(banner.pluginId, banner.contribution.id))).length,
  );

  // ---------- Ручные решения: сильнее расчёта и на него не влияют ----------
  let manuallyExpanded = $state<Record<string, boolean>>({});
  let accordionOpen = $state(false);

  const isCollapsed = (key: string) => layout.collapsed.has(key) && !manuallyExpanded[key];

  /** Скролл вниз на узком экране: возврат к исходному свёрнутому виду. */
  export function collapseAll(): void {
    manuallyExpanded = {};
    accordionOpen = false;
  }

  $effect(() => {
    void narrow;
    collapseAll();
  });

  // Исчезнувший баннер при следующем появлении снова следует расчёту; то же для аккордеона.
  $effect(() => {
    for (const key of Object.keys(manuallyExpanded)) {
      if (!isVisible(key)) delete manuallyExpanded[key];
    }
  });

  $effect(() => {
    if (!layout.grouped) accordionOpen = false;
  });

  // Намерения плагина относятся к его баннеру.
  function bannerIntents(node: HTMLElement, key: string) {
    const onExpand = () => {
      manuallyExpanded[key] = true;
    };
    const onCollapse = () => {
      delete manuallyExpanded[key];
    };
    node.addEventListener('mpu:banner-expand', onExpand);
    node.addEventListener('mpu:banner-collapse', onCollapse);
    return {
      destroy() {
        node.removeEventListener('mpu:banner-expand', onExpand);
        node.removeEventListener('mpu:banner-collapse', onCollapse);
      },
    };
  }

  function onRowKeydown(event: KeyboardEvent, key: string) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    manuallyExpanded[key] = true;
  }

  /** Отступ сверху нужен полному баннеру только после другого полного. */
  function followsFullBanner(index: number): boolean {
    for (let i = index - 1; i >= 0; i--) {
      const previous = banners[i];
      if (!previous) continue;
      const key = keyOf(previous.pluginId, previous.contribution.id);
      if (isVisible(key)) return !isCollapsed(key);
    }
    return false;
  }
</script>

{#if banners.length > 0}
  <div class="plugin-banners">
    <Collapsible open={layout.grouped}>
      <button
        class="banners-toggle"
        onclick={() => (accordionOpen = !accordionOpen)}
        aria-expanded={accordionOpen}
        title={ctx.i18n.t(accordionOpen ? 'banners.hideAll' : 'banners.showAll')}
      >
        <span class="banners-summary">
          {ctx.i18n.t('banners.summary', { count: String(visibleCount) })}
        </span>
        <span class="banners-chevron" class:open={accordionOpen}>
          <Icon name="chevron-down" size={18} />
        </span>
      </button>
    </Collapsible>

    <Collapsible open={!layout.grouped || accordionOpen}>
      {#each banners as banner, index (keyOf(banner.pluginId, banner.contribution.id))}
        {@const key = keyOf(banner.pluginId, banner.contribution.id)}
        {@const views = collapsedBanners.filter(
          (item) => item.pluginId === banner.pluginId && item.contribution.banner === banner.contribution.id,
        )}
        {@const hasCollapsedContent = views.some(
          (item) => (collapsedElementHeights[keyOf(item.pluginId, item.contribution.id)] ?? 0) > 0,
        )}
        <div use:bannerIntents={key}>
          <Collapsible open={isVisible(key) && isCollapsed(key)}>
            <div class="banner-row-slot">
              <!-- div, а не button: внутри — элементы плагинов -->
              <div
                class="banner-row"
                role="button"
                tabindex="0"
                onclick={() => (manuallyExpanded[key] = true)}
                onkeydown={(event) => onRowKeydown(event, key)}
                aria-expanded={false}
                title={ctx.i18n.t('banners.show')}
                use:observeHeight={[rowHeights, key]}
              >
                <div class="banner-row-content">
                  {#each views as item (keyOf(item.pluginId, item.contribution.id))}
                    <div use:observeHeight={[collapsedElementHeights, keyOf(item.pluginId, item.contribution.id)]}>
                      <PluginSurface
                        pluginId={item.pluginId}
                        tag={item.contribution.element}
                        params={{ route: routeKind, narrow: narrow ? 'true' : 'false' }}
                      />
                    </div>
                  {/each}

                  {#if !hasCollapsedContent}
                    <span class="banners-summary">
                      {ctx.loader.getLoadedPlugin(banner.pluginId)?.manifest.name ?? banner.pluginId}
                    </span>
                  {/if}
                </div>

                <span class="banners-chevron">
                  <Icon name="chevron-down" size={18} />
                </span>
              </div>
            </div>
          </Collapsible>

          <Collapsible open={isVisible(key) && !isCollapsed(key)}>
            <div class:spaced={followsFullBanner(index)}>
              <div
                class="plugin-banner-item"
                class:attached={layout.collapsed.has(key)}
                use:observeHeight={[fullHeights, key]}
              >
                <PluginSurface
                  pluginId={banner.pluginId}
                  tag={banner.contribution.element}
                  params={{
                    mode: isCollapsed(key) || mode === 'collapsed' ? 'collapsed' : 'expanded',
                    route: routeKind,
                    narrow: narrow ? 'true' : 'false',
                  }}
                />
              </div>

              {#if layout.collapsed.has(key)}
                <button
                  class="banner-collapse"
                  onclick={() => delete manuallyExpanded[key]}
                  aria-label={ctx.i18n.t('banners.hide')}
                  title={ctx.i18n.t('banners.hide')}
                >
                  <span class="banners-chevron open">
                    <Icon name="chevron-down" size={16} />
                  </span>
                </button>
              {/if}
            </div>
          </Collapsible>
        </div>
      {/each}
    </Collapsible>
  </div>
{/if}

<style>
  .plugin-banners {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    flex-shrink: 0;
  }

  .plugin-banner-item {
    min-width: 0;
  }

  /* К баннеру снизу прилегает кнопка сворачивания: низ корня плагина плоский и без отступа */
  .plugin-banner-item.attached :global(.host > * > *) {
    margin-bottom: 0;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .spaced {
    padding-top: var(--space-sm);
  }

  .banners-toggle,
  .banner-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    width: 100%;
    min-height: var(--touch-target);
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    text-align: start;
    cursor: pointer;
  }

  .banners-toggle {
    margin-bottom: var(--space-sm);
  }

  .banner-row-slot {
    padding-bottom: var(--space-sm);
  }

  .banner-row-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-xs);
    flex: 1;
    min-width: 0;
  }

  /* Тонкая полоса вплотную к баннеру. Зона нажатия расширена только вниз: сверху — сам баннер */
  .banner-collapse {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 20px;
    margin-bottom: var(--space-md);
    border: 1px solid var(--border-color);
    border-top: none;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    background: var(--bg-surface);
    box-shadow: var(--shadow-sm);
    color: var(--text-muted);
    cursor: pointer;
  }

  .banner-collapse::after {
    content: '';
    position: absolute;
    inset: 0 0 calc(-1 * var(--space-md));
  }

  .banner-collapse:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .banners-summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .banners-chevron {
    display: flex;
    flex-shrink: 0;
    transition: transform var(--transition-fast);
  }

  .banners-chevron.open {
    transform: rotate(180deg);
  }
</style>
