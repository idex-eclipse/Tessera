<script lang="ts">
  import type { HostI18n } from './core/host-i18n.svelte.ts';
  import type { PluginLoader } from './core/plugin-loader.svelte.ts';
  import type { PluginRegistry } from './core/plugin-registry.svelte.ts';
  import type { PrinterManager } from './core/printer-manager.svelte.ts';
  import type { Router } from './core/router.svelte.ts';
  import type { SettingsStore } from './core/settings-store.svelte.ts';
  import type { UiStore } from './core/ui-store.svelte.ts';
  import AuthOverlay from './components/auth-overlay/AuthOverlay.svelte';

  import { provideAppContext } from './app-context.ts';

  import AppHeader from './components/layout/AppHeader.svelte';
  import AppSidebar from './components/layout/AppSidebar.svelte';
  import AppMain from './components/layout/AppMain.svelte';
  import AppBrand from './components/layout/AppBrand.svelte';

  import PluginOverlaysLayer from './components/plugin-overlays-layer/PluginOverlaysLayer.svelte';
  import AppRightPanel from './components/app-right-panel/AppRightPanel.svelte';
  import FleetMode from './components/fleet/FleetMode.svelte';

  import OfflineOverlay from './components/offline-overlay/OfflineOverlay.svelte';
  import ConfirmDialog from './components/confirm/ConfirmDialog.svelte';

  import { detectLegacy } from './core/legacy-settings.ts';
  import MigrationDialog from './components/legacy/MigrationDialog.svelte';
  import AddPrinterDialog from './pages/settings/add-printer-dialog.svelte';

  let legacyOpen = $state(detectLegacy().length > 0);

  let {
    settings,
    printerManager,
    registry,
    ui,
    i18n,
    loader,
    router,
  }: {
    settings: SettingsStore;
    printerManager: PrinterManager;
    registry: PluginRegistry;
    ui: UiStore;
    i18n: HostI18n;
    loader: PluginLoader;
    router: Router;
  } = $props();

  provideAppContext({ settings, printerManager, registry, ui, i18n, loader, router });

  let route = $derived(router.route);
  let sidebarCollapsed = $derived(ui.sidebarCollapsed);
</script>

<div
  class="app-shell"
  class:collapsed={sidebarCollapsed}
  class:has-bg={Boolean(ui.bgImage)}
  style:background-image={ui.bgImage ? `url("${ui.bgImage}")` : undefined}
>
  <div class="top-row">
    <AppBrand collapsed={sidebarCollapsed} />
    <AppHeader {printerManager} {router} {ui} {i18n} />
  </div>

  <div class="app-body">
    <AppSidebar
      {registry}
      {settings}
      {printerManager}
      {router}
      {i18n}
      {route}
      collapsed={sidebarCollapsed}
      onToggleCollapse={() => ui.toggleSidebar()}
    />

    <div class="main-column">

      <AppMain
        {printerManager}
        {registry}
        {i18n}
        {route}
      />
    </div>

    <AppRightPanel />

  </div>

  {#if printerManager.shouldShowOfflineOverlay}
    <OfflineOverlay {printerManager} {i18n} />
  {/if}

  <ConfirmDialog />
  <MigrationDialog open={legacyOpen} onClose={() => (legacyOpen = false)} />
  <AddPrinterDialog />
  <PluginOverlaysLayer />
  <AuthOverlay />
  {#if ui.fleetOpen}
    <FleetMode {printerManager} {registry} {ui} {i18n} {router}/>
  {/if}
</div>

<style>
  .app-shell {
    --sidebar-w: var(--sidebar-width);
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .app-shell.has-bg {
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
  }

  .app-shell.collapsed {
    --sidebar-w: var(--sidebar-collapsed-width);
  }

  .top-row {
    display: flex;
    flex-shrink: 0;
  }

  .app-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .main-column {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
</style>