import type { PrinterManager } from './printer-manager.svelte.ts';
import type { Router } from './router.svelte.ts';
import type { UiStore } from './ui-store.svelte.ts';

/**
 * Хостовые hotkeys навигации.
 *
 * Участвуют в общей проверке конфликтов наравне с плагинными (владелец
 * HOST_HOTKEY_OWNER, область global): плагин, объявивший такую же комбинацию,
 * отключит и себя, и хостовую клавишу — с предупреждением в консоли.
 */

export const HOST_HOTKEY_OWNER = '@host';

export interface HostHotkey {
  id: string;
  keys: string;
  /** i18n-ключ описания (About/Debug). */
  titleKey: string;
  allowInInputs?: boolean;
  run(event: KeyboardEvent): void;
}

/** Максимум принтеров, доступных по Ctrl+<цифра>. */
const MAX_NUMBERED_PRINTERS = 9;

export function createHostHotkeys(deps: {
  router: Pick<Router, 'navigateToPrinter'>;
  printerManager: Pick<PrinterManager, 'printers' | 'activePrinterId'>;
  ui: Pick<UiStore, 'toggleFleet' | 'setFleet'>;
}): HostHotkey[] {
  const { router, printerManager, ui } = deps;

  function goTo(printerId: string | undefined): void {
    if (!printerId) return;
    // Fleet-drawer перекрывает main: закрываем, чтобы переход был виден.
    ui.setFleet(false);
    router.navigateToPrinter(printerId);
  }

  function step(delta: 1 | -1 | 0): void {
    const printers = printerManager.printers;
    if (printers.length === 0) return;
    const index = printers.findIndex((p) => p.id === printerManager.activePrinterId);
    // Нет активного: вперёд → первый, назад → последний.
    const next = index === -1
      ? (delta === 1 ? 0 : printers.length - 1)
      : (index + delta + printers.length) % printers.length;
    goTo(printers[next]?.id);
  }

  const numbered: HostHotkey[] = Array.from({ length: MAX_NUMBERED_PRINTERS }, (_, i) => ({
    id: `printer-${i + 1}`,
    keys: `Ctrl+${i + 1}`,
    titleKey: 'settings.about.hostHotkeys.printerN',
    run: () => goTo(printerManager.printers[i]?.id),
  }));

  return [
    {
      id: 'toggle-fleet',
      keys: 'F',
      titleKey: 'settings.about.hostHotkeys.toggleFleet',
      run: () => ui.toggleFleet(),
    },
    ...numbered,
    {
      id: 'printer-next',
      keys: 'Ctrl+ArrowRight',
      titleKey: 'settings.about.hostHotkeys.printerNext',
      allowInInputs: false,
      run: () => step(1),
    },
    {
      id: 'printer-prev',
      keys: 'Ctrl+ArrowLeft',
      titleKey: 'settings.about.hostHotkeys.printerPrev',
      allowInInputs: false,
      run: () => step(-1),
    },
    {
      id: 'dashboard',
      keys: 'D',
      titleKey: 'settings.about.hostHotkeys.dashboard',
      run: () => step(0),
    },
  ];
}
