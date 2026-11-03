import { mount, unmount } from 'svelte';

import type {
  ExtensionMount,
  ExtensionPointState,
  ExtensionRef,
  MpuParams,
  PluginApi,
} from '../../../plugin-sdk/src/types';

import ExtensionView from '../components/extensions/ExtensionView.svelte';
import {
  buildExtensionGraph,
  extensionRef,
  parseExtensionRef,
  pointAddress,
  resolvePointState,
  type ExtensionGraph,
  type ResolvedPoint,
} from './extension-resolver';
import { getMoonrakerProxy } from './moonraker-proxy';
import type { HostI18n } from './host-i18n.svelte';
import type { PluginLoader } from './plugin-loader.svelte';
import type { PluginRegistry } from './plugin-registry.svelte';
import type { PrinterManager } from './printer-manager.svelte';
import type { SettingsStore } from './settings-store.svelte';
import type { RegisteredExtension } from './surfaces';

/**
 * Рантайм точек расширения для АКТИВНОГО принтера: граф (resolver), кэш
 * доступности (`available` дополнений), монтирование вкладов с api дополнения,
 * action-вызовы, popover выбора варианта и очередь конфликтов для диалога хоста.
 *
 * Хост не читает данные принтера: доступность решает экспорт дополнения,
 * кэш сбрасывается на notify_klippy_ready / notify_config_changed / onReady.
 */

export interface ExtensionHostDeps {
  registry: PluginRegistry;
  loader: PluginLoader;
  settings: SettingsStore;
  printerManager: PrinterManager;
  i18n: HostI18n;
  getApi: (pluginId: string) => PluginApi | null;
}

export interface ChooserRequest {
  owner: string;
  pointId: string;
  params: MpuParams;
  x: number;
  y: number;
}

export type ExtensionHost = ReturnType<typeof createExtensionHost>;

type AvailableFn = (api: PluginApi, params: MpuParams) => boolean | Promise<boolean>;
type ActionFn = (api: PluginApi, context: unknown) => void | Promise<void>;

function paramsKey(params: MpuParams | undefined): string {
  if (!params) return '';
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

export function createExtensionHost(deps: ExtensionHostDeps) {
  const { registry, loader, settings, printerManager, i18n } = deps;

  const activeId = (): string => printerManager.activePrinterId ?? '';

  function buildGraph(printerId: string): ExtensionGraph {
    return buildExtensionGraph({
      points: registry.getExtensionPoints(),
      extensions: registry.getExtensions(),
      applies: (pluginId) => loader.pluginAppliesToPrinter(pluginId, printerId),
      ownerLoaded: (pluginId) => loader.isLoaded(pluginId),
      pluginVersion: (pluginId) => loader.getLoadedPlugin(pluginId)?.manifest.version,
      requiredVersion: (extPluginId, ownerId) =>
        loader.getLoadedPlugin(extPluginId)?.manifest.dependencies?.[ownerId],
      resolutions: settings.ui.extensionResolutions,
    });
  }

  const graph = $derived(buildGraph(activeId()));

  // ------------------------------------------------------------------
  // Доступность
  // ------------------------------------------------------------------

  /** `${printerId}|${ref}|${paramsKey}` → результат available(). */
  let availability = $state<Record<string, boolean>>({});
  const pending = new Set<string>();
  /** Поколение кэша: результат запроса, начатого до сброса, отбрасывается. */
  let epoch = 0;

  function invalidateAvailability(): void {
    epoch++;
    pending.clear();
    availability = {};
  }

  function isAvailable(ext: RegisteredExtension, params: MpuParams | undefined): boolean {
    const name = ext.contribution.available;
    if (!name) return true;

    const printerId = activeId();
    const key = `${printerId}|${extensionRef(ext)}|${paramsKey(params)}`;
    const cached = availability[key];
    if (cached !== undefined) return cached;
    if (!pending.has(key)) evaluate(ext, name, key, params ?? {});
    return false;
  }

  function evaluate(ext: RegisteredExtension, name: string, key: string, params: MpuParams): void {
    pending.add(key);
    const started = epoch;
    const finish = (value: boolean) => {
      if (started !== epoch) return;
      pending.delete(key);
      availability = { ...availability, [key]: value };
    };

    // microtask: isAvailable читают из шаблонов и $derived — писать $state синхронно нельзя
    queueMicrotask(() => {
      const fn = (loader.getModule(ext.pluginId) as Record<string, unknown> | undefined)?.[name];
      const api = deps.getApi(ext.pluginId);
      if (typeof fn !== 'function' || !api) {
        console.warn(`[extensions] ${extensionRef(ext)}: available export "${name}" not found`);
        finish(false);
        return;
      }
      Promise.resolve()
        .then(() => (fn as AvailableFn)(api, params))
        .then((value) => finish(Boolean(value)))
        .catch((error) => {
          console.warn(`[extensions] ${extensionRef(ext)}: available() failed`, error);
          finish(false);
        });
    });
  }

  // Сброс доступности на события Klipper активного принтера.
  let offNotify: Array<() => void> = [];
  function watchPrinter(): void {
    offNotify.forEach((off) => off());
    offNotify = [];
    invalidateAvailability();
    const printer = printerManager.activePrinter;
    if (!printer?.url) return;
    const handle = getMoonrakerProxy(printer.url).handle;
    offNotify = [
      handle.onNotify('notify_klippy_ready', invalidateAvailability),
      handle.onNotify('notify_config_changed', invalidateAvailability),
      handle.onReady(invalidateAvailability),
    ];
  }

  // ------------------------------------------------------------------
  // Состояние точек
  // ------------------------------------------------------------------

  function toRef(ext: RegisteredExtension): ExtensionRef {
    const ref: ExtensionRef = {
      ref: extensionRef(ext),
      pluginId: ext.pluginId,
      kind: ext.contribution.kind,
      title: i18n.t(ext.contribution.titleKey),
      order: ext.contribution.order ?? 0,
    };
    if (ext.contribution.icon) ref.icon = ext.contribution.icon;
    return ref;
  }

  function getPoint(owner: string, pointId: string): ResolvedPoint | undefined {
    return graph.points.get(pointAddress(owner, pointId));
  }

  function getChoice(owner: string, pointId: string): string | null | undefined {
    const printerId = activeId();
    if (!printerId) return undefined;
    return settings.getExtensionChoice(printerId, pointAddress(owner, pointId));
  }

  function setChoice(owner: string, pointId: string, ref: string | null | undefined): void {
    const printerId = activeId();
    if (!printerId) return;
    settings.setExtensionChoice(printerId, pointAddress(owner, pointId), ref);
  }

  function resolve(owner: string, pointId: string, params?: MpuParams): ExtensionPointState {
    const point = getPoint(owner, pointId);
    const state = resolvePointState(point, {
      choice: getChoice(owner, pointId),
      isAvailable: (ext) => isAvailable(ext, params),
    });
    return {
      mode: point?.mode ?? null,
      original: state.original,
      active: state.active.map(toRef),
      options: state.options.map(toRef),
      conflict: state.conflict,
    };
  }

  // ------------------------------------------------------------------
  // Вклады: монтирование и действия
  // ------------------------------------------------------------------

  function findExtension(ref: string): RegisteredExtension | undefined {
    const parsed = parseExtensionRef(ref);
    if (!parsed) return undefined;
    return registry
      .getExtensions()
      .find((e) => e.pluginId === parsed.pluginId && e.contribution.id === parsed.id);
  }

  /** Сколько вкладов плагина смонтировано сейчас (для хоткеев scope 'plugin'). */
  let mounted = $state<Record<string, number>>({});

  function countMount(pluginId: string, delta: number): void {
    const next = (mounted[pluginId] ?? 0) + delta;
    const { [pluginId]: _old, ...rest } = mounted;
    mounted = next > 0 ? { ...rest, [pluginId]: next } : rest;
  }

  function mountExtension(container: HTMLElement, ref: string, params: MpuParams = {}): ExtensionMount {
    const ext = findExtension(ref);
    const api = ext ? deps.getApi(ext.pluginId) : null;
    const props = $state({
      contribution: ext?.contribution ?? null,
      api,
      params,
      title: ext ? i18n.t(ext.contribution.titleKey) : ref,
    });
    const instance = mount(ExtensionView, { target: container, props });
    if (ext) countMount(ext.pluginId, 1);

    let destroyed = false;
    return {
      update(next: MpuParams) {
        if (!destroyed) props.params = next;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        void unmount(instance);
        if (ext) countMount(ext.pluginId, -1);
      },
    };
  }

  async function invoke(owner: string, ref: string, context: unknown): Promise<void> {
    const ext = findExtension(ref);
    if (!ext || ext.contribution.kind !== 'action' || !ext.contribution.handler) {
      console.warn(`[extensions] ${owner}: unknown action "${ref}"`);
      return;
    }
    const point = graph.points.get(ext.contribution.point);
    if (!point || point.owner !== owner || !point.enabled.includes(ext)) {
      console.warn(`[extensions] ${owner}: action "${ref}" is not active in its point`);
      return;
    }
    const fn = (loader.getModule(ext.pluginId) as Record<string, unknown> | undefined)?.[
      ext.contribution.handler
    ];
    const api = deps.getApi(ext.pluginId);
    if (typeof fn !== 'function' || !api) {
      console.warn(`[extensions] ${ref}: handler export "${ext.contribution.handler}" not found`);
      return;
    }
    try {
      await (fn as ActionFn)(api, context);
    } catch (error) {
      console.warn(`[extensions] ${ref}: action failed`, error);
    }
  }

  // ------------------------------------------------------------------
  // Popover выбора и конфликты
  // ------------------------------------------------------------------

  let chooser = $state<ChooserRequest | null>(null);

  function openChooser(
    owner: string,
    pointId: string,
    anchor: HTMLElement | { x: number; y: number },
    params: MpuParams = {},
  ): void {
    const point = getPoint(owner, pointId);
    if (!point || point.mode !== 'alternative') return;
    let x: number;
    let y: number;
    if (anchor instanceof HTMLElement) {
      const rect = anchor.getBoundingClientRect();
      x = rect.left;
      y = rect.bottom;
    } else {
      ({ x, y } = anchor);
    }
    chooser = { owner, pointId, params, x, y };
  }

  /** Конфликты, отложенные в этой сессии («Позже»): адрес|кандидаты. */
  let postponed = $state<string[]>([]);

  const conflicts = $derived([...graph.points.values()].filter((p) => p.conflict));

  function conflictKey(point: ResolvedPoint): string {
    return `${point.address}|${point.candidates.map(extensionRef).sort().join(',')}`;
  }

  /** Конфликт, открытый явно (Settings → Plugins → «Разрешить»). */
  let requested = $state<string | null>(null);

  /** Конфликт для диалога: запрошенный явно, иначе первый не отложенный в этой сессии. */
  const nextConflict = $derived(
    (requested ? conflicts.find((p) => p.address === requested) : undefined) ??
      conflicts.find((p) => !postponed.includes(conflictKey(p))) ??
      null,
  );

  function showConflict(address: string): void {
    requested = address;
  }

  function resolveConflict(address: string, winners: string[]): void {
    const point = graph.points.get(address);
    if (!point) return;
    settings.setExtensionResolution(address, {
      winners,
      candidates: point.candidates.map(extensionRef),
    });
    if (requested === address) requested = null;
  }

  function postponeConflict(address: string): void {
    const point = graph.points.get(address);
    if (point) postponed = [...postponed, conflictKey(point)];
    if (requested === address) requested = null;
  }

  // ------------------------------------------------------------------
  // Подписка владельцев (api.extensions.onChange)
  // ------------------------------------------------------------------

  const listeners = new Set<() => void>();
  let scheduled = false;

  function notify(): void {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      for (const cb of Array.from(listeners)) {
        try {
          cb();
        } catch (error) {
          console.error('[extensions] change listener error', error);
        }
      }
    });
  }

  let stop: (() => void) | null = null;

  /** Запуск наблюдения (из App, после создания контекста). */
  function start(): () => void {
    if (stop) return stop;
    watchPrinter();
    const offPrinter = printerManager.onPrinterChange(() => watchPrinter());
    const offEffect = $effect.root(() => {
      $effect(() => {
        void graph;
        void availability;
        const id = activeId();
        if (id) void settings.getPrinterSettings(id).extensionChoices;
        notify();
      });
    });
    stop = () => {
      offPrinter();
      offEffect();
      offNotify.forEach((off) => off());
      offNotify = [];
      stop = null;
    };
    return stop;
  }

  function onChange(callback: () => void): () => void {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  return {
    start,
    get graph() {
      return graph;
    },
    resolve,
    getChoice,
    setChoice,
    mount: mountExtension,
    invoke,
    onChange,
    openChooser,
    get chooser() {
      return chooser;
    },
    closeChooser() {
      chooser = null;
    },
    get conflicts() {
      return conflicts;
    },
    get nextConflict() {
      return nextConflict;
    },
    resolveConflict,
    postponeConflict,
    showConflict,
    isMounted(pluginId: string): boolean {
      return (mounted[pluginId] ?? 0) > 0;
    },
    invalidateAvailability,
  };
}
