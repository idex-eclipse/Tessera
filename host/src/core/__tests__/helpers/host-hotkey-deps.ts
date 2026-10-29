import { vi } from 'vitest';

import type { Route } from '../../router.svelte.ts';

/**
 * Полный набор зависимостей createHostHotkeys для тестов, которым хостовые клавиши
 * нужны лишь для проверки конфликтов (действия не вызываются).
 */
export function fakeHostHotkeyDeps() {
  return {
    router: {
      navigateToPrinter: vi.fn(),
      navigateToDashboard: vi.fn(),
      navigateToPluginPage: vi.fn(),
    },
    printerManager: { printers: [], activePrinterId: null } as never,
    ui: { toggleFleet: vi.fn(), setFleet: vi.fn(), toggleRightPanel: vi.fn(), toggleSidebar: vi.fn() },
    registry: { getVisiblePages: () => [] },
    getRoute: (): Route => ({ kind: 'dashboard', printerId: null, query: {} }),
  };
}
