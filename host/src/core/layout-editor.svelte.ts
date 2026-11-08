import type { QuickChipLayoutItem } from '../../../plugin-sdk/src/types.ts';
import type { Route } from './router.svelte.ts';
import type { DashboardWidgetLayoutItem } from './settings-store.svelte.ts';
import type { QuickChipsLayoutMode } from './types.ts';

/** То, что правится в режиме редактирования дашборда: макет и быстрые чипы одного принтера. */
export interface EditSnapshot {
  dashboardLayout: DashboardWidgetLayoutItem[];
  dashboardLayoutCustomized: boolean;
  quickChips: QuickChipLayoutItem[];
  quickChipsCustomized: boolean;
  quickChipsLayout: QuickChipsLayoutMode;
}

export interface LayoutEditorDeps {
  getRoute(): Route;
  getPrinterId(): string | null;
  /** Копия сохранённого состояния (не виртуального стандарта: нужны флаги *Customized). */
  read(printerId: string): EditSnapshot;
  write(printerId: string, snapshot: EditSnapshot): void;
  /** Выход из режима редактирования (убирает `edit=1` из адреса). */
  leave(): void;
}

export type LayoutEditor = ReturnType<typeof createLayoutEditor>;

const same = (a: EditSnapshot, b: EditSnapshot): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Сессия редактирования дашборда: история правок (отмена/повтор) и откат всех правок разом.
 *
 * Правки пишутся в настройки сразу, как и раньше. Редактор лишь запоминает снимки: `changed()`
 * вызывают один раз после действия (после отпускания при перетаскивании), и он кладёт прежнее
 * состояние в историю. Режим включается адресом (`#/…?edit=1`), `sync()` связывает с ним сессию.
 */
export function createLayoutEditor(deps: LayoutEditorDeps) {
  let session: { printerId: string; initial: EditSnapshot; current: EditSnapshot } | null = null;
  let past = $state<EditSnapshot[]>([]);
  let future = $state<EditSnapshot[]>([]);
  let addDialogOpen = $state(false);

  function isEditing(): boolean {
    const route = deps.getRoute();
    return route.kind === 'dashboard' && route.query.edit === '1';
  }

  function drop(): void {
    session = null;
    past = [];
    future = [];
    addDialogOpen = false;
  }

  function restore(snapshot: EditSnapshot): void {
    if (!session) return;
    deps.write(session.printerId, snapshot);
    session.current = deps.read(session.printerId);
  }

  return {
    /** Режим редактирования включён адресом. */
    get active(): boolean {
      return isEditing();
    },
    get canUndo(): boolean {
      return past.length > 0;
    },
    get canRedo(): boolean {
      return future.length > 0;
    },
    /** Есть правки относительно входа в режим. */
    get dirty(): boolean {
      return past.length > 0;
    },
    get addDialogOpen(): boolean {
      return addDialogOpen;
    },
    set addDialogOpen(value: boolean) {
      addDialogOpen = value;
    },

    /** Начинает сессию при входе в режим и сбрасывает её при выходе или смене принтера. */
    sync(): void {
      const printerId = deps.getPrinterId();
      if (!isEditing() || !printerId) {
        if (session) drop();
        return;
      }
      if (session?.printerId === printerId) return;
      drop();
      const snapshot = deps.read(printerId);
      session = { printerId, initial: snapshot, current: snapshot };
    },

    /** Вызывается после каждого действия пользователя, изменившего макет или чипы. */
    changed(): void {
      if (!session) return;
      const next = deps.read(session.printerId);
      if (same(next, session.current)) return;
      past = [...past, session.current];
      future = [];
      session.current = next;
    },

    undo(): void {
      if (!session) return;
      const previous = past[past.length - 1];
      if (!previous) return;
      const present = session.current;
      past = past.slice(0, -1);
      future = [...future, present];
      restore(previous);
    },

    redo(): void {
      if (!session) return;
      const next = future[future.length - 1];
      if (!next) return;
      const present = session.current;
      future = future.slice(0, -1);
      past = [...past, present];
      restore(next);
    },

    /** Возвращает состояние на входе в режим и выходит. */
    cancel(): void {
      if (session) {
        deps.write(session.printerId, session.initial);
        drop();
      }
      deps.leave();
    },

    /** Оставляет правки и выходит. */
    end(): void {
      drop();
      deps.leave();
    },
  };
}
