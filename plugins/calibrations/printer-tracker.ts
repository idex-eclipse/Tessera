import type { PluginApi } from '../../plugin-sdk/src/types';

/**
 * Трекер состояния ВСЕХ принтеров реестра для гардов и hotkeys плагина.
 *
 * Зачем отдельно от ядер хуков (use-calibrations / use-bed-mesh): ядра создаются
 * лениво под потребителя (страница, виджет) и могут не существовать для
 * принтера, на который идёт запрос. Гард, читающий состояние из ядра, в этом
 * случае видел бы значения по умолчанию (idle / не homed) и ошибочно
 * разрешал/запрещал команды. Трекер подписан на все принтеры постоянно:
 * его запускает always-mounted поверхность плагина (оверлей), а список
 * принтеров синхронизируется по api.onPrintersChange.
 *
 * Состояние `null` = «ещё не получено»; потребитель сам решает, что делать
 * (гард в этом случае запрашивает значение у Moonraker).
 */

export type TrackedPrintState = 'printing' | 'paused' | 'idle' | 'standby' | 'complete' | 'cancelled' | 'error' | string;

export interface TrackedPrinter {
  printState: TrackedPrintState | null;
  homedAxes: string | null;
  manualProbeActive: boolean;
}

const states = new Map<string, TrackedPrinter>();
const unsubs = new Map<string, () => void>();

let trackerApi: PluginApi | null = null;
let offPrinters: (() => void) | null = null;

function stateOf(printerId: string): TrackedPrinter {
  let s = states.get(printerId);
  if (!s) {
    s = { printState: null, homedAxes: null, manualProbeActive: false };
    states.set(printerId, s);
  }
  return s;
}

function track(api: PluginApi, printerId: string): void {
  if (unsubs.has(printerId)) return;
  const state = stateOf(printerId);

  const off = api.moonrakerFor(printerId).subscribe(
    {
      print_stats: ['state'],
      toolhead: ['homed_axes'],
      manual_probe: ['is_active'],
    },
    (delta: any) => {
      if (typeof delta?.print_stats?.state === 'string') {
        state.printState = delta.print_stats.state;
      }
      if (delta?.toolhead?.homed_axes !== undefined) {
        state.homedAxes = String(delta.toolhead.homed_axes ?? '');
      }
      if (typeof delta?.manual_probe?.is_active === 'boolean') {
        state.manualProbeActive = delta.manual_probe.is_active;
      }
    },
    { immediate: true },
  );
  unsubs.set(printerId, off);
}

function untrack(printerId: string): void {
  unsubs.get(printerId)?.();
  unsubs.delete(printerId);
  states.delete(printerId);
}

function sync(api: PluginApi, printerIds: readonly string[]): void {
  const alive = new Set(printerIds);
  for (const id of Array.from(unsubs.keys())) {
    if (!alive.has(id)) untrack(id);
  }
  for (const id of alive) track(api, id);
}

/**
 * Запускает трекер (идемпотентно). Вызывать из always-mounted поверхности
 * плагина. Повторные вызовы лишь обновляют ссылку на актуальный api.
 */
export function ensurePrinterTracker(api: PluginApi): void {
  trackerApi = api;
  if (offPrinters) return;
  sync(api, api.printers.map((p) => p.id));
  offPrinters = api.onPrintersChange((printers) => {
    if (trackerApi) sync(trackerApi, printers.map((p) => p.id));
  });
}

/** Остановка и очистка (тесты, выгрузка плагина). */
export function stopPrinterTracker(): void {
  offPrinters?.();
  offPrinters = null;
  for (const id of Array.from(unsubs.keys())) untrack(id);
  states.clear();
  trackerApi = null;
}

export function getTracked(printerId: string): TrackedPrinter | undefined {
  return states.get(printerId);
}

export function isManualProbeActive(printerId: string): boolean {
  return states.get(printerId)?.manualProbeActive === true;
}

/**
 * Состояние принтера для гарда: отслеженное; недостающее — разовым запросом
 * к Moonraker. null — узнать не удалось (оффлайн, трекер не запущен).
 */
export async function resolvePrinterState(
  printerId: string,
): Promise<{ printState: TrackedPrintState; homedAxes: string } | null> {
  const tracked = states.get(printerId);
  if (tracked && tracked.printState !== null && tracked.homedAxes !== null) {
    return { printState: tracked.printState, homedAxes: tracked.homedAxes };
  }
  if (!trackerApi) return null;

  try {
    const res: any = await trackerApi.moonrakerFor(printerId).request('printer.objects.query', {
      objects: { print_stats: ['state'], toolhead: ['homed_axes'] },
    });
    const status = res?.status ?? {};
    const printState = String(status.print_stats?.state ?? tracked?.printState ?? 'standby');
    const homedAxes = String(status.toolhead?.homed_axes ?? tracked?.homedAxes ?? '');
    return { printState, homedAxes };
  } catch {
    return null;
  }
}
