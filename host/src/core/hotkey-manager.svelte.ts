import type { PluginApi } from '../../../plugin-sdk/src/types';

import {
  analyzeHotkeys,
  eventMatches,
  hasCommandModifier,
  type HotkeyAnalysis,
  type HotkeyEntry,
  type HotkeyBinding,
  type HotkeyConflict,
} from './hotkeys';
import { HOST_HOTKEY_OWNER, type HostHotkey } from './host-hotkeys';
import type { RegisteredHotkey, RegisteredPage } from './surfaces';
import type { Route } from './router.svelte.ts';

/**
 * Modular Printer UI v2
 * Hotkey manager.
 *
 * Хост-инфраструктура: слушает keydown и вызывает обработчики плагинов.
 * Не шина: плагины друг с другом не общаются, хост лишь сопоставляет
 * комбинацию с декларацией манифеста (manifest.hotkeys) и вызывает
 * экспорт entry-модуля плагина-владельца.
 *
 * Области действия:
 * - global    — на любых поверхностях;
 * - dashboard — только когда открыт dashboard;
 * - plugin    — только на странице плагина-владельца.
 * Пока открыт fleet-drawer (он перекрывает main), dashboard/plugin-вклады
 * не срабатывают — активны только global.
 *
 * Конфликты разрешает analyzeHotkeys (см. hotkeys.ts): отключаются все
 * стороны конфликта, хост пишет предупреждение.
 */

export type HotkeyHandlerFn = (api: PluginApi, event: KeyboardEvent) => unknown;

export interface HotkeyManagerDeps {
  registry: {
    getHotkeys(): RegisteredHotkey[];
    getPages(): RegisteredPage[];
  };
  getRoute(): Route;
  /** Экспорт entry-модуля плагина по имени (loader.getModule). */
  getModule(pluginId: string): unknown;
  getApi(pluginId: string): PluginApi | null;
  /** Применим ли плагин к активному принтеру (scope printerIds). */
  appliesToActivePrinter(pluginId: string): boolean;
  /** true — поверх main открыт fleet-drawer. */
  isFleetOpen?(): boolean;
  /** Хостовые hotkeys (навигация). Конфликтуют с плагинными по общим правилам. */
  hostHotkeys?: readonly HostHotkey[];
  /** Подписка на keydown; по умолчанию window. */
  target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  warn?(message: string, detail?: unknown): void;
}

export type HotkeyManager = ReturnType<typeof createHotkeyManager>;

function isEditableTarget(event: KeyboardEvent): boolean {
  const raw = (typeof event.composedPath === 'function' ? event.composedPath()[0] : null) ?? event.target;
  const el = raw as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

function conflictSignature(c: HotkeyConflict): string {
  const members = c.members.map((m) => `${m.pluginId}/${m.id}(${m.scope})`).sort();
  return `${c.canonical}|${members.join(',')}`;
}

export function createHotkeyManager(deps: HotkeyManagerDeps) {
  const warn = deps.warn ?? ((message, detail) => console.warn(message, detail));

  const hostByKey = new Map((deps.hostHotkeys ?? []).map((h) => [h.id, h]));

  const hostEntries: HotkeyEntry[] = (deps.hostHotkeys ?? []).map((h) => ({
    pluginId: HOST_HOTKEY_OWNER,
    contribution: {
      id: h.id,
      keys: h.keys,
      scope: 'global',
      handler: h.id,
      titleKey: h.titleKey,
      allowInInputs: h.allowInInputs,
    },
  }));

  // Плагин не может выдать себя за хост: его вклады с владельцем '@host' отбрасываются.
  const analysis: HotkeyAnalysis = $derived(
    analyzeHotkeys([
      ...hostEntries,
      ...deps.registry.getHotkeys().filter((h) => h.pluginId !== HOST_HOTKEY_OWNER),
    ]),
  );

  const warnedConflicts = new Set<string>();
  const warnedHandlers = new Set<string>();

  function pageOwner(pageId: string): string | undefined {
    return deps.registry.getPages().find((p) => p.contribution.id === pageId)?.pluginId;
  }

  function isInScope(binding: HotkeyBinding): boolean {
    const scope = binding.contribution.scope;
    if (scope === 'global') return true;
    if (deps.isFleetOpen?.()) return false;

    const route = deps.getRoute();
    if (scope === 'dashboard') return route.kind === 'dashboard';
    return route.kind === 'plugin-page' && pageOwner(route.pageId) === binding.pluginId;
  }

  function resolveHandler(binding: HotkeyBinding): HotkeyHandlerFn | null {
    const name = binding.contribution.handler;
    const fn = (deps.getModule(binding.pluginId) as Record<string, unknown> | null | undefined)?.[name];
    if (typeof fn === 'function') return fn as HotkeyHandlerFn;

    const key = `${binding.pluginId}/${binding.contribution.id}`;
    if (!warnedHandlers.has(key)) {
      warnedHandlers.add(key);
      warn(`[hotkeys] ${binding.pluginId}: handler export "${name}" not found; hotkey "${binding.contribution.id}" ignored`);
    }
    return null;
  }

  /** Обработчик keydown. Возвращает true, если комбинация была обработана. */
  function handleKeydown(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.repeat || event.isComposing) return false;

    const editable = isEditableTarget(event);

    for (const binding of analysis.bindings) {
      if (!binding.enabled) continue;
      if (!eventMatches(event, binding.combo)) continue;
      // В полях ввода: по умолчанию только комбинации с Ctrl/Alt/Meta; allowInInputs переопределяет.
      const allowInInputs = binding.contribution.allowInInputs ?? hasCommandModifier(binding.combo);
      if (editable && !allowInInputs) continue;
      if (!isInScope(binding)) continue;
      if (binding.pluginId === HOST_HOTKEY_OWNER) {
        const host = hostByKey.get(binding.contribution.id);
        if (!host) continue;
        event.preventDefault();
        try {
          host.run(event);
        } catch (error) {
          reportHandlerError(binding, error);
        }
        return true;
      }

      if (!deps.appliesToActivePrinter(binding.pluginId)) continue;

      const handler = resolveHandler(binding);
      const api = deps.getApi(binding.pluginId);
      if (!handler || !api) continue;

      event.preventDefault();
      try {
        const result = handler(api, event);
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          (result as Promise<unknown>).catch((error) => reportHandlerError(binding, error));
        }
      } catch (error) {
        reportHandlerError(binding, error);
      }
      return true;
    }
    return false;
  }

  function reportHandlerError(binding: HotkeyBinding, error: unknown): void {
    warn(`[hotkeys] ${binding.pluginId}/${binding.contribution.id} handler failed`, error);
  }

  /** Предупреждает о новых конфликтах (по одному разу на конфликт). */
  function checkConflicts(): void {
    const conflicts = analysis.conflicts;
    const current = new Set<string>();
    for (const conflict of conflicts) {
      const signature = conflictSignature(conflict);
      current.add(signature);
      if (warnedConflicts.has(signature)) continue;
      warnedConflicts.add(signature);

      const who = conflict.members.map((m) => `${m.pluginId}/${m.id} [${m.scope}]`).join(', ');
      warn(`[hotkeys] Conflict on "${conflict.canonical}": ${who}. All of them are disabled.`);
    }
    // Разрешившиеся конфликты забываем: при повторном возникновении предупредим снова.
    for (const signature of warnedConflicts) {
      if (!current.has(signature)) warnedConflicts.delete(signature);
    }
  }

  /** Подключает слушатель и слежение за конфликтами. Возвращает stop. */
  function start(): () => void {
    const target = deps.target ?? window;
    const listener = (event: Event) => {
      handleKeydown(event as KeyboardEvent);
    };
    target.addEventListener('keydown', listener);

    checkConflicts();
    const stopEffects = $effect.root(() => {
      $effect(() => {
        checkConflicts();
      });
    });

    return () => {
      target.removeEventListener('keydown', listener);
      stopEffects();
    };
  }

  return {
    start,
    handleKeydown,
    checkConflicts,
    /** Все биндинги (включая отключённые из-за конфликтов). */
    get bindings(): HotkeyBinding[] {
      return analysis.bindings;
    },
    get conflicts(): HotkeyConflict[] {
      return analysis.conflicts;
    },
  };
}
