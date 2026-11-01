<script lang="ts">
  import { getAppContext } from '../../app-context';
  import Icon from '../../components/icons/Icon.svelte';
  import { settingsNarrow, settingsView, type SettingsView } from './settings-view';

  import SectionGeneral from './section-general.svelte';
  import SectionPrinters from './section-printers.svelte';
  import SectionPages from './section-pages.svelte';
  import SectionPlugins from './section-plugins.svelte';
  import SectionHotkeys from './section-hotkeys.svelte';
  import SectionAbout from './section-about.svelte';

  const { router, i18n, ui } = getAppContext();

  type SectionId = 'general' | 'printers' | 'plugins' | 'pages' | 'hotkeys' | 'about';  // 'dashboard' убран

  const sections: { id: SectionId; icon: string; labelKey: string }[] = [
    { id: 'general', icon: 'settings', labelKey: 'settings.general' },
    { id: 'printers', icon: 'printer', labelKey: 'settings.printers' },
    { id: 'plugins', icon: 'file', labelKey: 'settings.plugins' },
    { id: 'pages', icon: 'dashboard', labelKey: 'settings.pages' },
    { id: 'hotkeys', icon: 'keyboard', labelKey: 'settings.hotkeys.title' },
    { id: 'about', icon: 'globe', labelKey: 'settings.about.title' },
  ];

  const DASHBOARD_EDIT_HASH = '#/dashboard?edit=1';

  function goDashboardEdit(): void {
    window.location.hash = DASHBOARD_EDIT_HASH;
  }

  let section = $derived.by<SectionId>(() => {
    const r = router.route;
    if (r.kind !== 'settings' || !r.section) return 'general';
    return sections.some((s) => s.id === r.section) ? (r.section as SectionId) : 'general';
  });

  let active = $derived(sections.find((s) => s.id === section) ?? sections[0]!);

  function select(id: SectionId): void {
    router.navigateToSettings(id);
  }

  let pageWidth = $state(0);
  let narrow = $derived(settingsNarrow(ui.isNarrow, pageWidth));
  let view = $derived(settingsView(narrow, router.route.kind === 'settings' ? router.route.section : null));

  let pageEl = $state<HTMLElement>();
  let prevView: SettingsView | null = null;

  // Узкий режим: фокус переезжает вместе с экраном (на «Назад» и обратно на вкладку, откуда ушли)
  $effect(() => {
    const now = view;
    const before = prevView;
    prevView = now;
    if (before === null || before === now) return;
    if (now === 'detail') pageEl?.querySelector<HTMLElement>('.settings-back')?.focus();
    else if (now === 'list') pageEl?.querySelector<HTMLElement>('.settings-nav-item.active')?.focus();
  });
</script>

<div class="settings-page" class:narrow bind:this={pageEl} bind:clientWidth={pageWidth}>
  {#if view !== 'detail'}
    <nav class="settings-nav" class:list={view === 'list'}>
      {#each sections as s (s.id)}
        <button class="settings-nav-item" class:active={section === s.id} onclick={() => select(s.id)}>
          <Icon name={s.icon} size={16} />
          <span class="settings-nav-label">{i18n.t(s.labelKey)}</span>
          {#if view === 'list'}<Icon name="chevron-right" size={16} flip />{/if}
        </button>
        {#if s.id === 'pages'}
          <button class="settings-nav-item" onclick={goDashboardEdit}>
            <Icon name="dashboard" size={16} />
            <span class="settings-nav-label">{i18n.t('dashboard.editLayout')}</span>
            {#if view === 'list'}<Icon name="chevron-right" size={16} flip />{/if}
          </button>
        {/if}
      {/each}
    </nav>
  {/if}

  {#if view !== 'list'}
  <div class="settings-content" class:detail={view === 'detail'}>
    <div class="page-header">
      {#if view === 'detail'}
        <button
          class="settings-back"
          aria-label={i18n.t('common.back')}
          title={i18n.t('common.back')}
          onclick={() => router.navigateToSettings()}
        >
          <Icon name="chevron-left" size={18} flip />
        </button>
      {/if}
      <span class="page-title">{i18n.t(active.labelKey)}</span>
    </div>

    {#if section === 'general'}
      <SectionGeneral />
    {:else if section === 'printers'}
      <SectionPrinters />
    {:else if section === 'pages'}
      <SectionPages />
    {:else if section === 'plugins'}
      <SectionPlugins />
    {:else if section === 'hotkeys'}
      <SectionHotkeys />
    {:else if section === 'about'}
      <SectionAbout />
    {:else}
      <p class="placeholder">…</p>
    {/if}
  </div>
  {/if}
</div>

<style>
  .settings-page { display: flex; gap: var(--space-lg); height: 100%; }
  .settings-nav { display: flex; flex-direction: column; gap: var(--space-xs); width: 200px; flex-shrink: 0; background-color: var(--bg-app); border-radius: var(--radius-md); padding: var(--space-sm)}
  .settings-nav-item { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border: none; border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); cursor: pointer; text-align: start; }
  .settings-nav-item:hover { background: var(--bg-surface-hover); }
  .settings-nav-item.active { background: var(--bg-surface-active); color: var(--accent); }
  .settings-content { flex: 1; min-width: 0; overflow-y: auto; padding: var(--space-md); background: var(--bg-surface); border-radius: var(--radius-lg); }

  /* Узкая область: список вкладок на всю ширину, вкладка въезжает поверх него */
  .settings-nav.list { width: auto; flex: 1; }
  .settings-nav.list .settings-nav-item { min-height: var(--touch-target); }
  .settings-nav-label { flex: 1; min-width: 0; }
  .settings-content.detail { animation: drawer-in-end 200ms ease; }
  .settings-back { display: flex; align-items: center; justify-content: center; width: var(--touch-target); height: var(--touch-target); margin-inline-start: calc(-1 * var(--space-sm)); border: none; border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); cursor: pointer; flex-shrink: 0; }
  .settings-back:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  @media (prefers-reduced-motion: reduce) { .settings-content.detail { animation: none; } }
  .placeholder { color: var(--text-muted); }
</style>