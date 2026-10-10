<script lang="ts">
  import { fade, slide } from 'svelte/transition';
  import { usePluginApi } from '../../plugin-sdk/src/svelte/use-plugin-api';
  import { dummyState } from './dummy-state.svelte.ts';

  const api = usePluginApi();
  const i18n = api.i18n;

  type BannerScope = 'all' | 'dashboard';

  let rootEl: HTMLElement | null = null;
  let hostEl: HTMLElement | null = null;

  let mode = $state<'expanded' | 'collapsed'>('expanded');
  let routeKind = $state<string>('dashboard');

  /** Дефолт из манифеста; настройка плагина переопределяет. */
  const defaultScope: BannerScope =
    api.manifest.banners?.find((b) => b.id === 'dummy-banner')?.scope === 'dashboard'
      ? 'dashboard'
      : 'all';

  function readScope(): BannerScope {
    const v = api.settings.get<string>('bannerScope');
    return v === 'dashboard' || v === 'all' ? v : defaultScope;
  }

  let scope = $state<BannerScope>(readScope());

  // live-обновление: правка настройки / смена sync-режима / другой принтер
  $effect(() => {
    return api.settings.onChange(() => {
      scope = readScope();
    });
  });

  // host → плагин: mode и маршрут через data-атрибуты
  $effect(() => {
    if (!rootEl) return;

    const host = rootEl.closest<HTMLElement>('mpu-dummy-banner');
    hostEl = host;
    if (!host) return;

    const read = () => {
      mode = host.dataset.mode === 'collapsed' ? 'collapsed' : 'expanded';
      routeKind = host.dataset.route ?? 'dashboard';
    };

    read();
    const mo = new MutationObserver(read);
    mo.observe(host, {
      attributes: true,
      attributeFilter: ['data-mode', 'data-route'],
    });
    return () => mo.disconnect();
  });

  /** Видимость — решение плагина (M): scope × маршрут × состояние. */
  let visible = $derived(scope === 'all' || routeKind === 'dashboard');

  let islandText = $derived(
    i18n.t('dummy.banner.island', { name: api.printer.name || '—' }),
  );

  function emitIntent(type: 'mpu:banner-expand' | 'mpu:banner-collapse') {
    hostEl?.dispatchEvent(new CustomEvent(type, { bubbles: true }));
  }

  function openOverlay() {
    dummyState.overlayOpen = true;
  }

  function onPanelClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea')) return;
    emitIntent('mpu:banner-collapse');
  }

  /** Временный контрол механизма; позже переедет в UI настроек плагина. */
  function onScopeChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value as BannerScope;
    api.settings.set('bannerScope', value);
  }
</script>

<div class="root" bind:this={rootEl}>
  {#if visible}
    {#if mode === 'expanded'}
      <section class="panel" onclick={onPanelClick} transition:slide={{ duration: 220 }}>
        <header class="banner-header">
          <span class="banner-title">{i18n.t('dummy.banner.title')}</span>
          <div class="banner-actions">
            <button class="banner-btn" onclick={openOverlay}>
              {i18n.t('dummy.overlay.trigger')}
            </button>
          </div>
        </header>

        <div class="banner-body">
          <p class="banner-text">{i18n.t('dummy.banner.text')}</p>

          <label class="scope-field">
            <span class="scope-label">{i18n.t('dummy.banner.scopeLabel')}</span>
            <select class="scope-select" value={scope} onchange={onScopeChange}>
              <option value="all">{i18n.t('dummy.banner.scopeAll')}</option>
              <option value="dashboard">{i18n.t('dummy.banner.scopeDashboard')}</option>
            </select>
          </label>
        </div>
      </section>
    {:else}
      <div class="island-wrap" transition:fade={{ duration: 160 }}>
        <button
          class="island"
          onclick={() => emitIntent('mpu:banner-expand')}
          title={i18n.t('dummy.banner.expand')}
          aria-label={i18n.t('dummy.banner.expand')}
        >
          <span class="island-dot" aria-hidden="true"></span>
          <span class="island-text">{islandText}</span>
          <span class="island-chevron" aria-hidden="true">⌄</span>
        </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  :global(mpu-dummy-banner) {
    display: block;
    width: 100%;
  }

  /* ---------- развёрнутая панель (панельный язык) ---------- */

  .panel {
    margin-bottom: var(--space-md);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    transition: border-color var(--transition-fast);
  }



  .banner-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
  }

  .banner-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .banner-actions {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin-inline-start: auto;
    flex-shrink: 0;
  }

  .banner-btn {
    padding: var(--space-xs) var(--space-sm);
    border: none;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .banner-btn:hover {
    background: var(--accent-hover);
  }

  .banner-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
  }

  .banner-text {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  /* ---------- scope-контрол (временный) ---------- */

  .scope-field {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .scope-label {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .scope-select {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    outline: none;
    transition: border-color var(--transition-fast);
  }

  .scope-select:focus {
    border-color: var(--accent);
  }

  /* ---------- остров ---------- */

  .island-wrap {
    display: flex;
    justify-content: center;
  }

  .island {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    max-width: 90%;
    margin-bottom: var(--space-md);
    padding: 6px 14px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-header);
    color: var(--text-on-header);
    box-shadow: var(--shadow-lg);
    cursor: pointer;
    transition: transform var(--transition-fast);
  }

  .island:hover {
    transform: scale(1.04);
  }

  .island:active {
    transform: scale(0.97);
  }

  .island-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
    animation: island-pulse 1.6s ease-in-out infinite;
  }

  .island-text {
    font-size: var(--font-size-sm);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .island-chevron {
    opacity: 0.7;
    flex-shrink: 0;
    font-size: var(--font-size-sm);
  }

  @keyframes island-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>