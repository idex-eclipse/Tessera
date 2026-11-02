import { onDestroy } from 'svelte';

import type { PluginApi, PluginSettingsApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';
import {
  createCoreKeeper,
  createDelegateStore,
} from '../../shared/core-keeper/core-keeper';
import {
  OFF,
  buildSetLed,
  buildSetTemplate,
  isLit,
  parseColorData,
  parseLedItems,
  parseTemplates,
  type LedItem,
  type LedTemplate,
  type Rgbw,
} from './led-data';

const HIDDEN_KEY = 'leds.hiddenTemplates';

// ------------------------------------------------------------------
// Module-level кэш метаданных (items + templates) per-printer.
// Инвалидация по notify_klippy_ready / notify_config_changed.
// ------------------------------------------------------------------
interface MetaCacheEntry {
  items: LedItem[];
  templates: LedTemplate[];
}
const metaCache = new Map<string, MetaCacheEntry>();

function createLedsCore(api: PluginApi, printerId: string) {
  let items = $state<LedItem[]>([]);
  let templates = $state<LedTemplate[]>([]);
  let colors = $state<Record<string, Rgbw[]>>({});
  /**
   * Шаблоны, назначенные ИЗ ЭТОГО UI: ledId → имя шаблона на пиксель.
   * Klipper не отдаёт активный шаблон в статусе, поэтому это лишь память
   * сессии: назначения из макросов здесь не видны, F5 её сбрасывает.
   */
  let assigned = $state<Record<string, Array<string | null>>>({});
  let hidden = $state<string[]>([]);
  /** последний «включённый» цвет — для переключателя вкл/выкл */
  const lastOn = new Map<string, Rgbw>();

  let generation = 0;
  let unsubMeta: (() => void) | null = null;
  const unsubs: Array<() => void> = [];

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonrakerFor(printerId);
    } catch {
      return null;
    }
  }

  function script(cmd: string): void {
    safeHandle()
      ?.request('printer.gcode.script', { script: cmd })
      .catch((e) => console.error('[leds] gcode failed:', cmd, e));
  }

  function applyDelta(d: any): void {
    if (!d) return;
    let changed = false;
    const next = { ...colors };
    for (const it of items) {
      const raw = d[it.id]?.color_data;
      if (raw === undefined) continue;
      const px = parseColorData(raw, it.count);
      next[it.id] = px;
      const on = px.find(isLit);
      if (on) lastOn.set(it.id, on);
      changed = true;
    }
    if (changed) colors = next;
  }

  async function loadMeta(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;

    const cached = metaCache.get(printerId);
    if (cached) {
      items = cached.items;
      templates = cached.templates;
    } else {
      const [list, cfgRes] = await Promise.all([
        h.request<any>('printer.objects.list').catch(() => null),
        h.request<any>('printer.objects.query', { objects: { configfile: ['settings'] } }).catch(() => null),
      ]);
      if (gen !== generation || !list) return;

      const settings = (cfgRes?.status?.configfile?.settings ?? {}) as Record<string, any>;
      items = parseLedItems(list.objects ?? [], settings);
      templates = parseTemplates(settings);
      metaCache.set(printerId, { items, templates });
    }

    if (unsubMeta) {
      unsubMeta();
      unsubMeta = null;
    }
    if (items.length === 0) return;

    const subObjects: Record<string, string[]> = {};
    for (const it of items) subObjects[it.id] = ['color_data'];

    unsubMeta = h.subscribe(
      subObjects,
      (d: any) => {
        if (gen === generation) applyDelta(d);
      },
      { immediate: true },
    );

    // SEED: статичная подсветка не шлёт дельт — после F5 цвет иначе не узнать
    const seeded = await h
      .request<any>('printer.objects.query', { objects: subObjects })
      .catch(() => null);
    if (gen === generation && seeded?.status) applyDelta(seeded.status);
  }

  // --- скрытые шаблоны (настройка принтера) ---
  function safeSettings(): PluginSettingsApi | null {
    try {
      return api.settingsFor(printerId);
    } catch {
      return null;
    }
  }

  function readHidden(): void {
    const v = safeSettings()?.get<string[]>(HIDDEN_KEY);
    hidden = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }

  function setTemplateHidden(name: string, hide: boolean): void {
    const next = hide ? [...new Set([...hidden, name])] : hidden.filter((n) => n !== name);
    hidden = next;
    safeSettings()?.set(HIDDEN_KEY, next);
  }

  // --- память назначенных шаблонов ---
  function remember(it: LedItem, name: string | null, indices?: readonly number[] | null): void {
    const cur = assigned[it.id] ?? new Array<string | null>(it.count).fill(null);
    const next = [...cur];
    const all = !indices || indices.length === 0;
    for (let i = 0; i < it.count; i++) if (all || indices!.includes(i)) next[i] = name;
    assigned = { ...assigned, [it.id]: next };
  }

  function find(id: string): LedItem | null {
    return items.find((x) => x.id === id) ?? null;
  }

  // --- Actions ---
  /** Ручной цвет: шаблон снимаем, иначе Klipper перезапишет цвет на следующем рендере. */
  function setColor(id: string, color: Rgbw, indices?: readonly number[] | null): void {
    const it = find(id);
    if (!it) return;
    if (isLit(color)) lastOn.set(id, color);
    remember(it, null, indices);
    script(`${buildSetTemplate(it, null, {}, indices)}\n${buildSetLed(it, color, indices)}`);
  }

  function setOff(id: string, indices?: readonly number[] | null): void {
    setColor(id, OFF, indices);
  }

  function toggle(id: string): void {
    const lit = (colors[id] ?? []).some(isLit);
    if (lit) setOff(id);
    else setColor(id, lastOn.get(id) ?? [1, 1, 1, 0]);
  }

  function setTemplate(
    id: string,
    name: string | null,
    params: Record<string, string>,
    indices?: readonly number[] | null,
  ): void {
    const it = find(id);
    if (!it) return;
    remember(it, name, indices);
    script(buildSetTemplate(it, name, params, indices));
  }

  /** Шаблон, назначенный из UI на пиксель (или общий, если он одинаковый у всех выбранных). */
  function assignedTemplate(id: string, indices?: readonly number[] | null): string | null {
    const arr = assigned[id];
    if (!arr) return null;
    const pick = !indices || indices.length === 0 ? arr : indices.map((i) => arr[i] ?? null);
    const first = pick[0] ?? null;
    return pick.every((n) => n === first) ? first : null;
  }

  // Lifecycle
  function teardown(): void {
    generation++;
    if (unsubMeta) {
      unsubMeta();
      unsubMeta = null;
    }
    for (const u of unsubs.splice(0)) u();
  }

  async function init(): Promise<void> {
    const gen = ++generation;
    readHidden();
    const off = safeSettings()?.onChange(() => readHidden());
    if (off) unsubs.push(off);

    const h = safeHandle();
    if (!h) return;

    unsubs.push(
      h.onReady(() => {
        if (gen === generation) void loadMeta(gen);
      }),
    );
    unsubs.push(
      h.onNotify('notify_klippy_ready', () => {
        if (gen !== generation) return;
        metaCache.delete(printerId);
        // перезапуск Klipper сбрасывает все шаблоны
        assigned = {};
        void loadMeta(gen);
      }),
    );
    unsubs.push(
      h.onNotify('notify_config_changed', () => {
        if (gen !== generation) return;
        metaCache.delete(printerId);
        void loadMeta(gen);
      }),
    );

    await loadMeta(gen);
  }

  void init();

  return {
    get items() {
      return items;
    },
    get templates() {
      return templates;
    },
    /** шаблоны без скрытых пользователем */
    get visibleTemplates() {
      return templates.filter((t) => !hidden.includes(t.name));
    },
    get hiddenTemplates() {
      return hidden;
    },
    get colors() {
      return colors;
    },
    setColor,
    setOff,
    toggle,
    setTemplate,
    assignedTemplate,
    setTemplateHidden,
    destroy: teardown,
  };
}

export type LedsStore = ReturnType<typeof createLedsCore>;

const keeper = createCoreKeeper<LedsStore>({
  create: (pid, api) => createLedsCore(api, pid),
  cap: 4,
});

/**
 * Хук LED (led / neopixel / dotstar / pca9533 / pca9632) и display_template.
 *
 * Без printerId — делегирующий store, следующий за активным принтером;
 * с printerId — прямое ядро с удержанием (fleet). Метаданные кэшируются
 * per-printer; инвалидация по notify_klippy_ready / notify_config_changed.
 */
export function useLeds(api: PluginApi, printerId?: string): LedsStore {
  if (printerId !== undefined) {
    const core = keeper.acquire(printerId, api);
    const offPrinters = api.onPrintersChange((printers) => {
      keeper.prune(printers.map((p) => p.id));
    });
    onDestroy(() => {
      offPrinters();
      keeper.release(printerId);
    });
    return core;
  }

  let heldPid = api.printer.id;
  keeper.acquire(heldPid, api);

  const offPrinter = api.onPrinterChange((p) => {
    keeper.release(heldPid);
    heldPid = p.id;
    keeper.acquire(heldPid, api);
  });

  const offPrinters = api.onPrintersChange((printers) => {
    keeper.prune(printers.map((p) => p.id));
  });

  onDestroy(() => {
    offPrinter();
    offPrinters();
    keeper.release(heldPid);
  });

  return createDelegateStore<LedsStore>(() => keeper.get(api.printer.id, api));
}
