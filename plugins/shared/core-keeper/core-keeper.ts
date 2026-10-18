import type { PluginApi } from '../../../plugin-sdk/src/types';

/**
 * CoreKeeper — keep-alive реестр per-printer ядер хуков (Фаза 2 тёплых
 * переключений).
 *
 * Семантика:
 * - ядро создаётся один раз на принтер и живёт после освобождения всеми
 *   потребителями (refs = 0) до LRU-эвикции при превышении cap;
 * - эвиктим ТОЛЬКО ядра с refs = 0 (смонтированные потребители неприкосновенны);
 * - при превышении cap и отсутствии свободных ядер cap временно превышается
 *   до ближайшего release (никаких принудительных unmount подписок);
 * - destroy() ядра вызывается ровно один раз (эвикция/drop), двойной lifecycle
 *   запрещён архитектурой;
 * - resync по klippy-жизненному циклу остаётся ВНУТРИ ядер, keeper о нём не знает.
 *
 * Keeper не использует runes: реактивность переключения принтера даёт сигнал
 * api.printer.id, читаемый делегатом (createDelegateStore), а не сам реестр.
 */

export interface CoreKeeperOptions<Core> {
  create: (printerId: string, api: PluginApi) => Core;
  /** Максимум удерживаемых ядер (включая idle). Дефолт 4. */
  cap?: number;
}

interface Entry<Core> {
  core: Core;
  refs: number;
  lastUsed: number;
}

export interface CoreKeeper<Core> {
  /** Взять ядро с удержанием (refs++). Создать при отсутствии. */
  acquire(printerId: string, api: PluginApi): Core;
  /** Снять удержание (refs--). Ядро остаётся живым (keep-alive). */
  release(printerId: string): void;
  /** Читать ядро без удержания (для делегатов); создать idle при отсутствии. */
  get(printerId: string, api: PluginApi): Core;
  /** Принудительно уничтожить ядро принтера (удаление принтера из реестра). */
  drop(printerId: string): void;
  /** Уничтожить idle-ядра принтеров, отсутствующих в реестре. */
  prune(existingPrinterIds: readonly string[]): void;
  readonly size: number;
}

export function createCoreKeeper<Core extends { destroy(): void }>(
  options: CoreKeeperOptions<Core>,
): CoreKeeper<Core> {
  const cap = options.cap ?? 4;
  const entries = new Map<string, Entry<Core>>();

  function destroyEntry(pid: string): void {
    const e = entries.get(pid);
    if (!e) return;
    entries.delete(pid);
    try {
      e.core.destroy();
    } catch (err) {
      console.error('[core-keeper] core destroy failed:', pid, err);
    }
  }

  function evictIfNeeded(): void {
    while (entries.size > cap) {
      let victim: string | null = null;
      let oldest = Infinity;
      for (const [pid, e] of entries) {
        if (e.refs === 0 && e.lastUsed < oldest) {
          oldest = e.lastUsed;
          victim = pid;
        }
      }
      if (victim === null) return; // все ядра в использовании — cap превышен временно
      destroyEntry(victim);
    }
  }

  function touch(e: Entry<Core>): void {
    e.lastUsed = Date.now();
  }

  function createEntry(pid: string, api: PluginApi, refs: number): Entry<Core> {
    const e: Entry<Core> = { core: options.create(pid, api), refs, lastUsed: Date.now() };
    entries.set(pid, e);
    evictIfNeeded();
    return e;
  }

  return {
    acquire(printerId, api) {
      const ex = entries.get(printerId);
      if (ex) {
        ex.refs++;
        touch(ex);
        return ex.core;
      }
      return createEntry(printerId, api, 1).core;
    },

    release(printerId) {
      const e = entries.get(printerId);
      if (!e || e.refs === 0) return;
      e.refs--;
      touch(e);
      evictIfNeeded();
    },

    get(printerId, api) {
      const ex = entries.get(printerId);
      if (ex) {
        touch(ex);
        return ex.core;
      }
      return createEntry(printerId, api, 0).core;
    },

    drop(printerId) {
      destroyEntry(printerId);
    },

    prune(existingPrinterIds) {
      const alive = new Set(existingPrinterIds);
      for (const pid of Array.from(entries.keys())) {
        if (!alive.has(pid)) {
          const e = entries.get(pid);
          if (e && e.refs === 0) destroyEntry(pid);
        }
      }
    },

    get size() {
      return entries.size;
    },
  };
}

/**
 * Делегирующий store: каждое чтение/вызов уходит в ТЕКУЩЕЕ ядро через
 * getCore(). Реактивность смены принтера обеспечивается сигналом внутри
 * getCore (обычно api.printer.id), а не самим делегатом.
 * Форма строится один раз по образцу первого ядра (все ядра одной фабрики
 * имеют идентичную форму: геттеры + методы).
 */
export function createDelegateStore<Store extends object>(getCore: () => Store): Store {
  const sample = getCore();
  const delegate: Record<string | symbol, unknown> = {};

  for (const key of Reflect.ownKeys(sample)) {
    const desc = Object.getOwnPropertyDescriptor(sample, key);
    if (!desc) continue;

    if (desc.get) {
      Object.defineProperty(delegate, key, {
        get: () => (getCore() as Record<string | symbol, unknown>)[key],
        enumerable: true,
      });
    } else if (typeof desc.value === 'function') {
      delegate[key] = (...args: unknown[]) =>
        ((getCore() as Record<string | symbol, unknown>)[key] as (...a: unknown[]) => unknown)(...args);
    } else {
      Object.defineProperty(delegate, key, {
        get: () => (getCore() as Record<string | symbol, unknown>)[key],
        enumerable: true,
      });
    }
  }

  return delegate as Store;
}