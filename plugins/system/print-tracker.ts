import type { PluginApi } from '../../plugin-sdk/src/types';

/**
 * Трекер состояния печати ВСЕХ принтеров реестра — для гарда `system-print-safety`.
 *
 * Гард принимает решение синхронно/асинхронно по ctx.targetPrinterId и не должен
 * зависеть от того, смонтирована ли страница или создано ли ядро хука для этого
 * принтера. Трекер запускает always-mounted поверхность плагина (оверлей уведомлений);
 * список принтеров синхронизируется по api.onPrintersChange.
 *
 * Состояние `null` = «ещё не получено»: гард разово спросит Moonraker.
 */

const states = new Map<string, string | null>();
const unsubs = new Map<string, () => void>();

let trackerApi: PluginApi | null = null;
let offPrinters: (() => void) | null = null;

function track(api: PluginApi, printerId: string): void {
  if (unsubs.has(printerId)) return;
  states.set(printerId, states.get(printerId) ?? null);

  unsubs.set(
    printerId,
    api.moonrakerFor(printerId).subscribe(
      { print_stats: ['state'] },
      (delta: any) => {
        const st = delta?.print_stats?.state;
        if (typeof st === 'string') states.set(printerId, st);
      },
      { immediate: true },
    ),
  );
}

function sync(api: PluginApi, ids: readonly string[]): void {
  const alive = new Set(ids);
  for (const id of Array.from(unsubs.keys())) {
    if (alive.has(id)) continue;
    unsubs.get(id)?.();
    unsubs.delete(id);
    states.delete(id);
  }
  for (const id of alive) track(api, id);
}

/** Запуск (идемпотентно); повторные вызовы лишь обновляют ссылку на api. */
export function ensurePrintTracker(api: PluginApi): void {
  trackerApi = api;
  if (offPrinters) return;
  sync(api, api.printers.map((p) => p.id));
  offPrinters = api.onPrintersChange((printers) => {
    if (trackerApi) sync(trackerApi, printers.map((p) => p.id));
  });
}

export function stopPrintTracker(): void {
  offPrinters?.();
  offPrinters = null;
  for (const off of unsubs.values()) off();
  unsubs.clear();
  states.clear();
  trackerApi = null;
}

/** true, если на принтере идёт печать или она на паузе. null — узнать не удалось. */
export async function isPrinting(printerId: string): Promise<boolean | null> {
  let state = states.get(printerId) ?? null;

  if (state === null && trackerApi) {
    try {
      const res: any = await trackerApi.moonrakerFor(printerId).request('printer.objects.query', {
        objects: { print_stats: ['state'] },
      });
      const st = res?.status?.print_stats?.state;
      if (typeof st === 'string') state = st;
    } catch {
      return null;
    }
  }
  if (state === null) return null;
  return state === 'printing' || state === 'paused';
}
