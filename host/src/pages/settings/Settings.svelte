<script lang="ts">
  import { getAppContext } from '../../app-context';
  import Icon from '../../components/icons/Icon.svelte';

  import SectionGeneral from './section-general.svelte';
  import SectionPrinters from './section-printers.svelte';
  import SectionPages from './section-pages.svelte';
  import SectionPlugins from './section-plugins.svelte';
  import SectionHotkeys from './section-hotkeys.svelte';
  import SectionAbout from './section-about.svelte';

  const { router, i18n } = getAppContext();

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
</script>

<div class="settings-page">
  <nav class="settings-nav">
    {#each sections as s (s.id)}
      <button class="settings-nav-item" class:active={section === s.id} onclick={() => select(s.id)}>
        <Icon name={s.icon} size={16} />
        <span>{i18n.t(s.labelKey)}</span>
      </button>
      {#if s.id === 'pages'}
        <button class="settings-nav-item" onclick={goDashboardEdit}>
          <Icon name="dashboard" size={16} />
          <span>{i18n.t('dashboard.editLayout')}</span>
        </button>
      {/if}
    {/each}
  </nav>

  <div class="settings-content">
    <div class="page-header">
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
</div>

<style>
  .settings-page { display: flex; gap: var(--space-lg); height: 100%; }
  .settings-nav { display: flex; flex-direction: column; gap: var(--space-xs); width: 200px; flex-shrink: 0; background-color: var(--bg-app); border-radius: var(--radius-md); padding: var(--space-sm)}
  .settings-nav-item { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border: none; border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); cursor: pointer; text-align: start; }
  .settings-nav-item:hover { background: var(--bg-surface-hover); }
  .settings-nav-item.active { background: var(--bg-surface-active); color: var(--accent); }
  .settings-content { flex: 1; overflow-y: auto; padding: var(--space-md); background: var(--bg-surface); border-radius: var(--radius-lg); }
  .placeholder { color: var(--text-muted); }
</style>