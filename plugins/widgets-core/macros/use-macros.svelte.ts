import { onDestroy } from 'svelte';

import type { PluginApi, MoonrakerProxyHandle } from '../../../plugin-sdk/src/types';

import { parseMacroParams, type MacroParam } from '../../shared/macro-params';

export interface MacroItemCfg {
  alias?: string;
  color?: string | null;
  hidden?: boolean;
  confirm?: boolean;
}

export interface MacroGroupCfg {
  id: string;
  name: string;
  collapsed: boolean;
  macros: string[];
}

export interface MacrosCfg {
  groups: MacroGroupCfg[];
  items: Record<string, MacroItemCfg>;
  ui: { tooltips: boolean; ungroupedCollapsed: boolean };
  ungrouped: string[];
}

function emptyCfg(): MacrosCfg {
  return {
    groups: [],
    items: {},
    ui: { tooltips: true, ungroupedCollapsed: false },
    ungrouped: [],
  };
}

function createId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

let liveNames = $state<string[]>([]);
let help = $state<Record<string, string>>({});
let paramsByMacro = $state<Record<string, MacroParam[]>>({});
let cfg = $state<MacrosCfg>(emptyCfg());
let editMode = $state(false);

export function useMacros(api: PluginApi) {
  let generation = 0;
  const unsubs: Array<() => void> = [];

  function safeHandle(): MoonrakerProxyHandle | null {
    try {
      return api.moonraker();
    } catch {
      return null;
    }
  }

  // Settings
  // not sync by printers

  function readCfg(): MacrosCfg {
    const all = api.settings.get<{ byPrinter?: Record<string, MacrosCfg> }>('macros') ?? {};
    const slice = all.byPrinter?.[api.printer.id];
    if (!slice || typeof slice !== 'object') return emptyCfg();
    return {
      groups: Array.isArray(slice.groups) ? slice.groups : [],
      items: slice.items && typeof slice.items === 'object' ? slice.items : {},
      ui: {
        tooltips: slice.ui?.tooltips !== false,
        ungroupedCollapsed: slice.ui?.ungroupedCollapsed === true,
      },
      ungrouped: Array.isArray(slice.ungrouped) ? slice.ungrouped : [],
    };
  }

  function writeCfg(next: MacrosCfg): void {
    cfg = next;
    const all = api.settings.get<{ byPrinter?: Record<string, MacrosCfg> }>('macros') ?? {};
    api.settings.set('macros', {
      byPrinter: { ...(all.byPrinter ?? {}), [api.printer.id]: next },
    });
  }

  function commit(): void {
    writeCfg(JSON.parse(JSON.stringify(cfg)));
  }

  function mutate(fn: (draft: MacrosCfg) => void): void {
    const draft = JSON.parse(JSON.stringify(cfg)) as MacrosCfg;
    fn(draft);
    writeCfg(draft);
  }

  // Macr0 + description

  async function loadLive(gen: number): Promise<void> {
    const h = safeHandle();
    if (!h) return;

    const [list, helpRes, cfgRes] = await Promise.all([
      h.request<any>('printer.objects.list').catch(() => null),
      h.request<any>('printer.gcode.help').catch(() => null),
      h.request<any>('printer.objects.query', { objects: { configfile: ['config'] } }).catch(() => null),
    ]);
    if (gen !== generation) return;

    if (!list) return;

    const names = ((list.objects ?? []) as string[])
      .filter((n) => n.startsWith('gcode_macro '))
      .map((n) => n.slice('gcode_macro '.length));

    if (names.length === 0) return;

    liveNames = names;

    const map: Record<string, string> = {};
    const cfg = (cfgRes?.status?.configfile?.config ?? {}) as Record<string, any>;
    const pm: Record<string, MacroParam[]> = {};
    for (const n of names) {
      const body = cfg[`gcode_macro ${n}`]?.gcode;
      if (typeof body === 'string') {
        const p = parseMacroParams(body);
        if (p.length > 0) pm[n] = p;
      }
    }
    paramsByMacro = pm;
    help = map;

    const knownSet = new Set(liveNames);
    mutate((d) => {
      const groupedSet = new Set<string>();
      for (const g of d.groups) for (const n of g.macros) groupedSet.add(n);
      const presentSet = new Set(d.ungrouped);

      for (const g of d.groups) g.macros = g.macros.filter((n) => knownSet.has(n));
      d.ungrouped = d.ungrouped.filter((n) => knownSet.has(n));

      for (const n of liveNames) {
        if (!groupedSet.has(n) && !presentSet.has(n)) {
          d.ungrouped.push(n);
        }
      }
    });
  }

  // Show

  function itemOf(name: string): MacroItemCfg {
    return cfg.items[name] ?? {};
  }

  function isKnown(n: string): boolean {
    return liveNames.includes(n);
  }

  function isHidden(name: string): boolean {
    const h = cfg.items[name]?.hidden;
    if (typeof h === 'boolean') return h;
    return name.startsWith('_');
  }

  function viewGroups(): Array<MacroGroupCfg & { macros: string[] }> {
    return cfg.groups.map((g) => ({
      ...g,
      macros: g.macros.filter((n) => isKnown(n) && !isHidden(n)),
    }));
  }

  function ungrouped(): string[] {
    return cfg.ungrouped.filter((n) => isKnown(n) && !isHidden(n));
  }

  function hiddenList(): string[] {
    return liveNames.filter((n) => isHidden(n));
  }

  function groupOf(name: string): string {
    for (const g of cfg.groups) if (g.macros.includes(name)) return g.id;
    return '';
  }

  function containerOf(name: string): { container: string; index: number } {
    for (const g of cfg.groups) {
      const i = g.macros.indexOf(name);
      if (i >= 0) return { container: g.id, index: i };
    }
    return { container: '', index: cfg.ungrouped.indexOf(name) };
  }


  // Live DnD: transient-reorder.
  // Persist — one time in commit() (drop / dragend).


  function placeMacroTransient(name: string, container: string, index: number): void {
    const fromGroup = cfg.groups.find((g) => g.macros.includes(name));
    const toGroup = container ? cfg.groups.find((g) => g.id === container) : null;
    const fromArr = fromGroup ? fromGroup.macros : cfg.ungrouped;
    const toArr = toGroup ? toGroup.macros : cfg.ungrouped;

    const cur = fromArr.indexOf(name);
    if (cur < 0) return;

    let idx = Math.max(0, Math.min(index, toArr.length));

    if (fromArr === toArr) {
      if (cur === idx || cur + 1 === idx) return;
      fromArr.splice(cur, 1);
      if (cur < idx) idx--;
      toArr.splice(idx, 0, name);
    } else {
      fromArr.splice(cur, 1);
      toArr.splice(idx, 0, name);
    }

    const item = cfg.items[name] ?? (cfg.items[name] = {});
    if (item.hidden) item.hidden = false;
  }

  function moveGroupTransient(dragId: string, index: number): void {
    const cur = cfg.groups.findIndex((g) => g.id === dragId);
    if (cur < 0) return;
    let idx = Math.max(0, Math.min(index, cfg.groups.length));
    if (cur === idx || cur + 1 === idx) return;
    const [g] = cfg.groups.splice(cur, 1);
    if (cur < idx) idx--;
    cfg.groups.splice(idx, 0, g);
  }

  // Actions with persist

  function run(name: string): void {
    safeHandle()
      ?.request('printer.gcode.script', { script: name })
      .catch((e) => console.error('[macros] run failed:', name, e));
  }

  function setEditMode(v: boolean): void {
    editMode = v;
  }

  function toggleCollapsed(id: string): void {
    mutate((d) => {
      const g = d.groups.find((x) => x.id === id);
      if (g) g.collapsed = !g.collapsed;
    });
  }

  function toggleUngrouped(): void {
    mutate((d) => {
      d.ui.ungroupedCollapsed = !d.ui.ungroupedCollapsed;
    });
  }

  function addGroup(name: string): void {
    mutate((d) => {
      d.groups.push({ id: createId(), name: name || 'Group', collapsed: false, macros: [] });
    });
  }

  function renameGroup(id: string, name: string): void {
    mutate((d) => {
      const g = d.groups.find((x) => x.id === id);
      if (g) g.name = name;
    });
  }

  function deleteGroup(id: string): void {
    mutate((d) => {
      const g = d.groups.find((x) => x.id === id);
      if (!g) return;
      d.groups = d.groups.filter((x) => x.id !== id);
      for (const n of g.macros) {
        if (!d.ungrouped.includes(n)) d.ungrouped.push(n);
      }
    });
  }

  function moveMacro(name: string, groupId: string): void {
    mutate((d) => {
      d.ungrouped = d.ungrouped.filter((n) => n !== name);
      for (const g of d.groups) g.macros = g.macros.filter((n) => n !== name);
      if (groupId) {
        const g = d.groups.find((x) => x.id === groupId);
        if (g && !g.macros.includes(name)) g.macros.push(name);
      } else {
        if (!d.ungrouped.includes(name)) d.ungrouped.push(name);
      }
      const item = d.items[name] ?? (d.items[name] = {});
      item.hidden = false;
    });
  }

  function setAlias(name: string, alias: string): void {
    mutate((d) => {
      const item = d.items[name] ?? (d.items[name] = {});
      if (alias.trim()) item.alias = alias.trim();
      else delete item.alias;
    });
  }

  function setColor(name: string, color: string | null): void {
    mutate((d) => {
      const item = d.items[name] ?? (d.items[name] = {});
      item.color = color;
    });
  }

  function setHidden(name: string, hidden: boolean): void {
    mutate((d) => {
      const item = d.items[name] ?? (d.items[name] = {});
      item.hidden = hidden;
      if (hidden) {
        d.ungrouped = d.ungrouped.filter((n) => n !== name);
        for (const g of d.groups) g.macros = g.macros.filter((n) => n !== name);
      } else if (!d.ungrouped.includes(name)) {
        let inGroup = false;
        for (const g of d.groups) {
          if (g.macros.includes(name)) {
            inGroup = true;
            break;
          }
        }
        if (!inGroup) d.ungrouped.push(name);
      }
    });
  }

  function setConfirm(name: string, confirm: boolean): void {
    mutate((d) => {
      const item = d.items[name] ?? (d.items[name] = {});
      item.confirm = confirm;
    });
  }

  function setTooltips(v: boolean): void {
    mutate((d) => {
      d.ui.tooltips = v;
    });
  }

  // Lifecycle

  function teardown(): void {
    generation++;
    for (const u of unsubs.splice(0)) u();
  }

  async function init(): Promise<void> {
    const gen = ++generation;
    const h = safeHandle();
    cfg = readCfg();
    if (!h || !api.printer.url) return;

    unsubs.push(
      h.onReady(() => {
        if (gen === generation) void loadLive(gen);
      }),
    );
    unsubs.push(
      h.onNotify('notify_klippy_ready', () => {
        if (gen === generation) void loadLive(gen);
      }),
    );
    unsubs.push(
      h.onNotify('notify_config_changed', () => {
        if (gen === generation) void loadLive(gen);
      }),
    );

    await loadLive(gen);
  }

  init();

  const offSettings = api.settings.onChange((k) => {
    if (k === 'macros') cfg = readCfg();
  });

  const offPrinter = api.onPrinterChange(() => {
    teardown();
    liveNames = [];
    help = {};
    editMode = false;
    void init();
  });

  onDestroy(() => {
    teardown();
    offSettings();
    offPrinter();
  });

  return {
    get liveNames() {
      return liveNames;
    },
    get help() {
      return help;
    },
    get cfg() {
      return cfg;
    },
    get paramsByMacro() {
      return paramsByMacro;
    },
    get editMode() {
      return editMode;
    },
    itemOf,
    viewGroups,
    ungrouped,
    isHidden,
    hiddenList,
    groupOf,
    containerOf,
    run,
    setEditMode,
    toggleCollapsed,
    toggleUngrouped,
    addGroup,
    renameGroup,
    deleteGroup,
    moveMacro,
    setAlias,
    setColor,
    setHidden,
    setConfirm,
    setTooltips,
    placeMacroTransient,
    moveGroupTransient,
    commit,
  };
}

export type MacrosStore = ReturnType<typeof useMacros>;