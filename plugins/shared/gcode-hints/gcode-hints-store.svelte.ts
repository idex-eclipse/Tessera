import type { PluginApi } from '../../../plugin-sdk/src/types';
import { parseMacroParams } from '../macro-params';

import { buildCatalog } from './catalog';
import { loadDoc } from './doc-source';
import { parseGcodeDocs } from './gcode-docs';
import type { MacroSource } from './local-macros';
import { buildObjectIndex, type ObjectIndex } from './object-names';
import type { Catalog, GcodeDocs } from './types';

/**
 * ЕДИНСТВЕННЫЙ источник подсказок о G-code и макросах (консоль, редактор конфигов).
 *
 * Per-printer состояние: `printer.gcode.help`, макросы из `configfile` и справочник
 * `G-Codes.md` из Moonraker (root `docs`). Подписка по счётчику потребителей:
 * `attachHints` вешает onReady / notify_config_changed на принтер при первом потребителе
 * и снимает при последнем; накопленные данные остаются.
 *
 * Без $effect (правило для *.svelte.ts): подписки императивные.
 */

export const GCODE_DOC_PATH = 'G-Codes.md';

interface PrinterHints {
  help: Record<string, string> | null;
  macros: MacroSource[];
  docs: GcodeDocs | null;
  /** секции конфигурации (имена объектов для FAN=, HEATER=…) */
  sections: string[];
  /** результат printer.objects.list (имена для printer[...] в jinja) */
  objects: string[];
}

const EMPTY: PrinterHints = { help: null, macros: [], docs: null, sections: [], objects: [] };

// $state.raw: данные крупные и заменяются целиком — глубокая реактивность не нужна
let hintsByPrinter = $state.raw<Record<string, PrinterHints>>({});

const catalogMemo = new Map<string, { src: PrinterHints; catalog: Catalog }>();
const objectsMemo = new Map<string, { src: PrinterHints; index: ObjectIndex }>();
const liveSeq = new Map<string, number>();

function patch(printerId: string, p: Partial<PrinterHints>): void {
  hintsByPrinter = {
    ...hintsByPrinter,
    [printerId]: { ...(hintsByPrinter[printerId] ?? EMPTY), ...p },
  };
}

/** Каталог команд принтера. Реактивен; пересобирается только при смене источников. */
export function getCatalog(printerId: string): Catalog {
  const src = hintsByPrinter[printerId] ?? EMPTY;
  const hit = catalogMemo.get(printerId);
  if (hit && hit.src === src) return hit.catalog;
  const catalog = buildCatalog(src);
  catalogMemo.set(printerId, { src, catalog });
  return catalog;
}

/** Имена объектов принтера (секции конфигурации, макросы, printer.objects.list). Реактивен. */
export function getObjects(printerId: string): ObjectIndex {
  const src = hintsByPrinter[printerId] ?? EMPTY;
  const hit = objectsMemo.get(printerId);
  if (hit && hit.src === src) return hit.index;
  const index = buildObjectIndex({
    sections: src.sections,
    macros: src.macros,
    objects: src.objects,
  });
  objectsMemo.set(printerId, { src, index });
  return index;
}

/** Загружен ли справочник G-Codes.md (иначе доступны только help, макросы и запасная таблица). */
export function hasDocs(printerId: string): boolean {
  return (hintsByPrinter[printerId] ?? EMPTY).docs !== null;
}

/**
 * Макросы из `printer.objects.query { configfile: ['config', 'settings'] }`.
 * `config` — сырые секции (регистр и тела гарантированы), `settings` — запасной источник;
 * имена сравниваем без учёта регистра.
 */
export function parseMacroSections(configfile: unknown): MacroSource[] {
  const cfg = (configfile ?? {}) as { config?: Record<string, unknown>; settings?: Record<string, unknown> };
  const seen = new Set<string>();
  const out: MacroSource[] = [];
  for (const sections of [cfg.config, cfg.settings]) {
    for (const [section, v] of Object.entries(sections ?? {})) {
      if (!section.toLowerCase().startsWith('gcode_macro ')) continue;
      const name = section.slice('gcode_macro '.length).trim();
      const key = name.toUpperCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const sec = (v ?? {}) as Record<string, unknown>;
      out.push({
        name,
        description: typeof sec.description === 'string' ? sec.description : '',
        params: typeof sec.gcode === 'string' ? parseMacroParams(sec.gcode) : [],
        variables: Object.keys(sec)
          .filter((k) => k.toLowerCase().startsWith('variable_') && k.length > 'variable_'.length)
          .map((k) => k.slice('variable_'.length)),
      });
    }
  }
  return out;
}

/** Имена всех секций конфигурации; `config` (исходный регистр) раньше `settings`. */
export function parseSectionNames(configfile: unknown): string[] {
  const cfg = (configfile ?? {}) as { config?: Record<string, unknown>; settings?: Record<string, unknown> };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sections of [cfg.config, cfg.settings]) {
    for (const section of Object.keys(sections ?? {})) {
      const key = section.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(section);
    }
  }
  return out;
}

async function loadLive(api: PluginApi, printerId: string): Promise<void> {
  const seq = (liveSeq.get(printerId) ?? 0) + 1;
  liveSeq.set(printerId, seq);
  try {
    const h = api.moonrakerFor(printerId);
    const [help, cfgRes, objRes] = await Promise.all([
      h.request<Record<string, string>>('printer.gcode.help'),
      h
        .request<{ status?: { configfile?: unknown } }>('printer.objects.query', {
          objects: { configfile: ['config', 'settings'] },
        })
        .catch(() => null),
      h.request<{ objects?: unknown }>('printer.objects.list').catch(() => null),
    ]);
    if (liveSeq.get(printerId) !== seq) return; // пришёл более свежий запрос
    const next: Partial<PrinterHints> = {};
    if (help && typeof help === 'object') next.help = help;
    if (cfgRes) {
      next.macros = parseMacroSections(cfgRes.status?.configfile);
      next.sections = parseSectionNames(cfgRes.status?.configfile);
    }
    if (objRes && Array.isArray(objRes.objects)) {
      next.objects = objRes.objects.filter((o): o is string => typeof o === 'string');
    }
    patch(printerId, next);
  } catch {
    // klippy ещё не готов / нет связи — повторим по onReady
  }
}

async function loadDocs(api: PluginApi, printerId: string): Promise<void> {
  if ((hintsByPrinter[printerId] ?? EMPTY).docs) return;
  try {
    const docs = await loadDoc({
      key: `${printerId}|${GCODE_DOC_PATH}`,
      handle: () => api.moonrakerFor(printerId),
      path: GCODE_DOC_PATH,
      parse: parseGcodeDocs,
    });
    patch(printerId, { docs });
  } catch {
    // docs недоступны (старый Moonraker, нет root) — остаются help, макросы и запасная таблица
  }
}

interface Attachment {
  consumers: number;
  unsubs: Array<() => void>;
}
const attachments = new Map<string, Attachment>();

/**
 * Подключает потребителя к подсказкам принтера. Возвращает функцию отключения
 * (в `$effect`/`onDestroy` потребителя). Данные принтера загружаются при первом
 * подключении и обновляются по onReady и notify_config_changed.
 */
export function attachHints(api: PluginApi, printerId: string): () => void {
  let att = attachments.get(printerId);
  if (att) {
    att.consumers++;
  } else {
    let h;
    try {
      h = api.moonrakerFor(printerId);
    } catch {
      return () => {};
    }
    const created: Attachment = { consumers: 1, unsubs: [] };
    att = created;
    attachments.set(printerId, created);

    void loadLive(api, printerId);
    void loadDocs(api, printerId);
    created.unsubs.push(
      h.onReady(() => {
        void loadLive(api, printerId);
        void loadDocs(api, printerId);
      }),
    );
    created.unsubs.push(
      h.onNotify('notify_config_changed', () => {
        void loadLive(api, printerId);
      }),
    );
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const a = attachments.get(printerId);
    if (!a) return;
    a.consumers--;
    if (a.consumers > 0) return;
    for (const u of a.unsubs) u();
    attachments.delete(printerId);
  };
}

/** Принтер удалён из реестра: забыть всё, что о нём накоплено. */
export function dropHints(printerId: string): void {
  const a = attachments.get(printerId);
  if (a) {
    for (const u of a.unsubs) u();
    attachments.delete(printerId);
  }
  if (printerId in hintsByPrinter) {
    const { [printerId]: _gone, ...rest } = hintsByPrinter;
    hintsByPrinter = rest;
  }
  catalogMemo.delete(printerId);
  objectsMemo.delete(printerId);
  liveSeq.delete(printerId);
}
