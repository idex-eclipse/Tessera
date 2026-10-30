import { getContext, setContext } from 'svelte';

import type { HotkeyManager } from './core/hotkey-manager.svelte.ts';
import type { FleetIndex } from './core/fleet-index.svelte.ts';
import type { HostI18n } from './core/host-i18n.svelte.ts';
import type { PluginLoader } from './core/plugin-loader.svelte.ts';
import type { PluginRegistry } from './core/plugin-registry.svelte.ts';
import type { PrinterManager } from './core/printer-manager.svelte.ts';
import type { SettingsStore } from './core/settings-store.svelte.ts';
import type { UiStore } from './core/ui-store.svelte.ts';
import type { Router } from './core/router.svelte.ts';

/**
 * Central app context.
 * All stores are created once in main.ts and provided here.
 */
export interface AppContext {
  settings: SettingsStore;
  printerManager: PrinterManager;
  registry: PluginRegistry;
  ui: UiStore;
  i18n: HostI18n;
  loader: PluginLoader;
  router: Router;
  hotkeys: HotkeyManager;
  fleetIndex: FleetIndex;
}

const APP_CONTEXT_KEY = Symbol('app-context');

export function provideAppContext(ctx: AppContext): void {
  setContext(APP_CONTEXT_KEY, ctx);
}

export function getAppContext(): AppContext {
  return getContext<AppContext>(APP_CONTEXT_KEY);
}