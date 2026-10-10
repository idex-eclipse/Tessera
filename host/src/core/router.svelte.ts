import type { PrinterManager } from './printer-manager.svelte.ts';
import type { SettingsStore } from './settings-store.svelte.ts';

/**
 * Modular Printer UI v2
 * Hash-based router.
 *
 * URL patterns:
 *   #/                        → dashboard активного принтера
 *   #/settings                → страница Settings
 *   #/p/:printerId            → dashboard конкретного принтера
 *   #/p/:printerId/:pageId    → страница плагина
 *
 * Supports: deep-link, F5, browser back/forward.
 */

// ------------------------------------------------------------------
// Route types
// ------------------------------------------------------------------

export type Route =
  | { kind: 'dashboard'; printerId: string | null; query: Record<string, string>  }
  | { kind: 'settings'; section: string | null }
  | { kind: 'plugin-page'; printerId: string; pageId: string; query: Record<string, string> };

// ------------------------------------------------------------------
// Environment abstraction (for testing without real window)
// ------------------------------------------------------------------

export interface RouterEnv {
  getHash(): string;
  setHash(hash: string): void;
  onHashChange(callback: () => void): () => void;
}

function createBrowserEnv(): RouterEnv {
  return {
    getHash: () => window.location.hash,
    setHash: (hash: string) => {
      window.location.hash = hash;
    },
    onHashChange: (callback: () => void) => {
      window.addEventListener('hashchange', callback);
      return () => window.removeEventListener('hashchange', callback);
    },
  };
}

// ------------------------------------------------------------------
// Pure parse / serialize (testable without window)
// ------------------------------------------------------------------

function parseQuery(q: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!q) return out;
  for (const pair of q.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const qIndex = raw.indexOf('?');
  const query = parseQuery(qIndex >= 0 ? raw.slice(qIndex + 1) : undefined);
  const path = (qIndex >= 0 ? raw.slice(0, qIndex) : raw).replace(/\/+$/, '');

  if (path === '') return { kind: 'dashboard', printerId: null, query };

  const parts = path.split('/');

  if (parts[0] === 'p' && parts[1]) {
    const printerId = decodeURIComponent(parts[1]);
      if (parts[2]) return { kind: 'plugin-page', printerId, pageId: decodeURIComponent(parts[2]), query };
    return { kind: 'dashboard', printerId, query };
  }

  if (parts[0] === 'settings') {
    return { kind: 'settings', section: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  if (parts[0] === 'p' && parts[1]) {
    const printerId = decodeURIComponent(parts[1]);
    if (parts[2]) {
      return { kind: 'plugin-page', printerId, pageId: decodeURIComponent(parts[2]), query };
    }
    return { kind: 'dashboard', printerId, query };
  }

  return { kind: 'dashboard', printerId: null, query };
}

export function buildHash(route: Route): string {
  switch (route.kind) {
    case 'dashboard':
      if (route.printerId) {
        return `#/p/${encodeURIComponent(route.printerId)}`;
      }
      return '#/';

    case 'settings':
      return route.section
        ? `#/settings/${encodeURIComponent(route.section)}`
        : '#/settings';

    case 'plugin-page': {
      const qs = Object.entries(route.query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      return `#/p/${encodeURIComponent(route.printerId)}/${encodeURIComponent(route.pageId)}${qs ? `?${qs}` : ''}`;
    }

    default:
      return '#/';
  }
}

// ------------------------------------------------------------------
// Router factory
// ------------------------------------------------------------------

export interface RouterOptions {
  env?: RouterEnv;
}

export function createRouter(
  deps: {
    settings: SettingsStore;
    printerManager: PrinterManager;
  },
  options: RouterOptions = {},
) {
  const env = options.env ?? createBrowserEnv();
  const { printerManager } = deps;

  let hash = $state(env.getHash());

  // Subscribe to hash changes
  const unsubscribeHashChange = env.onHashChange(() => {
    hash = env.getHash();
    syncPrinterFromRoute();
  });

  // Initial sync on creation (handles F5 / deep-link)
  syncPrinterFromRoute();

  // ------------------------------------------------------------------
  // Derived route
  // ------------------------------------------------------------------

  let route = $derived(parseRoute(hash));

  // ------------------------------------------------------------------
  // Printer sync
  // ------------------------------------------------------------------

  function syncPrinterFromRoute(): void {
    const r = parseRoute(env.getHash());

    if (r.kind === 'dashboard' && r.printerId) {
      printerManager.setActivePrinter(r.printerId);
    } else if (r.kind === 'plugin-page') {
      printerManager.setActivePrinter(r.printerId);
    }
  }

  // ------------------------------------------------------------------
  // Navigation
  // ------------------------------------------------------------------

  function navigate(path: string): void {
    env.setHash(path.startsWith('#') ? path : `#${path}`);
  }

  function navigateToDashboard(printerId?: string): void {
    if (printerId) {
      navigate(`/p/${encodeURIComponent(printerId)}`);
    } else {
      navigate('/');
    }
  }

  function navigateToPluginPage(printerId: string, pageId: string): void {
    navigate(`/p/${encodeURIComponent(printerId)}/${encodeURIComponent(pageId)}`);
  }

  function navigateToSettings(section?: string): void {
    navigate(section ? `/settings/${encodeURIComponent(section)}` : '/settings');
  }

  function navigateToPrinter(printerId: string): void {
    navigate(`/p/${encodeURIComponent(printerId)}`);
  }

  /**
   * Navigate to current active printer's dashboard.
   * Used when clicking "Dashboard" in sidebar.
   */
  function navigateToActiveDashboard(): void {
    const activeId = printerManager.activePrinterId;
    if (activeId) {
      navigateToDashboard(activeId);
    } else {
      navigateToDashboard();
    }
  }

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------

  function destroy(): void {
    unsubscribeHashChange();
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  return {
    get route(): Route {
      return route;
    },

    get hash(): string {
      return hash;
    },

    navigate,
    navigateToDashboard,
    navigateToPluginPage,
    navigateToSettings,
    navigateToPrinter,
    navigateToActiveDashboard,

    destroy,
  };
}

export type Router = ReturnType<typeof createRouter>;