<script lang="ts">
  import { getAppContext } from '../../app-context';
  import Icon from '../icons/Icon.svelte';
  import PluginSurface from '../PluginSurface.svelte';

  let {
    mode = 'expanded',
    routeKind = 'dashboard',
  }: {
    mode?: 'expanded' | 'collapsed';
    routeKind?: string;
  } = $props();

  const ctx = getAppContext();

  let banners = $derived(ctx.registry.getBanners());

  // Баннер всегда смонтирован и сам рисует «ничего», когда сообщать нечего, поэтому
  // считать «видимые» по числу регистраций нельзя — меряем реальную высоту элементов.
  // Скрытый список клипуется (а не display:none), чтобы высоты оставались измеримыми.
  let heights = $state<Record<string, number>>({});
  let visibleCount = $derived(Object.values(heights).filter((h) => h > 0).length);

  function observeHeight(node: HTMLElement, key: string) {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) heights[key] = entry.contentRect.height;
    });
    ro.observe(node);
    return {
      destroy() {
        ro.disconnect();
        delete heights[key];
      },
    };
  }

  // На узком экране несколько видимых баннеров группируются под одну строку-«аккордеон».
  // Состояние раскрытия — это bannerMode scroll-машинки AppMain; строка лишь
  // шлёт те же намерения (expand/collapse), что и плагины.
  let grouped = $derived(ctx.ui.isNarrow && visibleCount > 1);
  let expanded = $derived(mode === 'expanded');

  function toggle(event: MouseEvent) {
    (event.currentTarget as HTMLElement).dispatchEvent(
      new CustomEvent(expanded ? 'mpu:banner-collapse' : 'mpu:banner-expand', { bubbles: true }),
    );
  }
</script>

{#if banners.length > 0}
  <div class="plugin-banners">
    {#if grouped}
      <button
        class="banners-toggle"
        onclick={toggle}
        aria-expanded={expanded}
        title={ctx.i18n.t(expanded ? 'banners.hide' : 'banners.show')}
      >
        <span class="banners-summary">
          {ctx.i18n.t('banners.summary', { count: String(visibleCount) })}
        </span>
        <span class="banners-chevron" class:open={expanded}>
          <Icon name="chevron-down" size={18} />
        </span>
      </button>
    {/if}

    <!-- Скрываем через CSS, а не {#if}: иначе плагины теряют состояние при сворачивании -->
    <div class="banner-list" class:hidden={grouped && !expanded}>
      {#each banners as banner (`${banner.pluginId}:${banner.contribution.id}`)}
        <div
          class="plugin-banner-item"
          use:observeHeight={`${banner.pluginId}:${banner.contribution.id}`}
        >
          <PluginSurface
            pluginId={banner.pluginId}
            tag={banner.contribution.element}
            params={{
              mode,
              route: routeKind,
              narrow: ctx.ui.isNarrow ? 'true' : 'false',
            }}
          />
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .plugin-banners {
    position: relative;
    display: grid;
    gap: var(--space-sm);
    min-width: 0;
    flex-shrink: 0;
  }

  .banner-list {
    display: grid;
    gap: var(--space-sm);
    min-width: 0;
  }

  /* вне потока и невидим, но элементы сохраняют натуральную высоту для измерения */
  .banner-list.hidden {
    position: absolute;
    inset-inline: 0;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
  }

  .plugin-banner-item {
    min-width: 0;
  }

  .banners-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    width: 100%;
    min-height: var(--touch-target);
    padding: 0 var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    text-align: start;
    cursor: pointer;
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
