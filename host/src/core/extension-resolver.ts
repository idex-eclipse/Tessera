import type { ExtensionMode, ExtensionPointDecl } from '../../../plugin-sdk/src/types';

import type { RegisteredExtension, RegisteredExtensionPoint } from './surfaces';

/**
 * Чистая логика точек расширения: связывание вкладов с точками, версии, сон,
 * конфликты и выбор варианта. Без состояния и без Svelte — всё, что меняется
 * (реестр, применимость к принтеру, решения пользователя, доступность),
 * приходит параметрами. Рантайм — extension-host.svelte.ts.
 */

/** Решение конфликта: победители среди кандидатов того набора, для которого оно принято. */
export interface ExtensionResolution {
  winners: string[];
  candidates: string[];
}

export type ExtensionRejectReason = 'kind-mismatch' | 'version-mismatch' | 'duplicate';

export interface ResolvedPoint {
  /** `<owner>#<point>` */
  address: string;
  owner: string;
  decl: ExtensionPointDecl;
  mode: ExtensionMode;
  /** Сколько вкладов точка показывает одновременно. */
  capacity: number;
  /** Применимые и совместимые вклады, в порядке order → регистрации. */
  candidates: RegisteredExtension[];
  /** Кандидаты после разрешения конфликта (при конфликте — пусто). */
  enabled: RegisteredExtension[];
  conflict: boolean;
}

export interface ExtensionGraph {
  points: Map<string, ResolvedPoint>;
  /** Точки (или её владельца) нет: вклад ждёт. */
  sleeping: RegisteredExtension[];
  rejected: Array<{ ext: RegisteredExtension; reason: ExtensionRejectReason }>;
}

export interface ExtensionGraphInput {
  points: RegisteredExtensionPoint[];
  extensions: RegisteredExtension[];
  /** Плагин включён для принтера (scope плагина). */
  applies: (pluginId: string) => boolean;
  resolutions: Record<string, ExtensionResolution>;
}

export function pointAddress(ownerId: string, pointId: string): string {
  return `${ownerId}#${pointId}`;
}

export function extensionRef(ext: RegisteredExtension): string {
  return `${ext.pluginId}/${ext.contribution.id}`;
}

/** id плагина может содержать '/', id вклада — нет: режем по последнему '/'. */
export function parseExtensionRef(ref: string): { pluginId: string; id: string } | null {
  const at = ref.lastIndexOf('/');
  if (at <= 0 || at === ref.length - 1) return null;
  return { pluginId: ref.slice(0, at), id: ref.slice(at + 1) };
}

export function pointCapacity(decl: ExtensionPointDecl): number {
  const mode = decl.mode ?? 'append';
  if (mode === 'replacement') return 1;
  if (mode === 'append') return decl.max ?? Number.POSITIVE_INFINITY;
  return Number.POSITIVE_INFINITY;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

export function buildExtensionGraph(input: ExtensionGraphInput): ExtensionGraph {
  const points = new Map<string, ResolvedPoint>();
  for (const p of input.points) {
    const address = pointAddress(p.pluginId, p.contribution.id);
    if (points.has(address)) continue;
    points.set(address, {
      address,
      owner: p.pluginId,
      decl: p.contribution,
      mode: p.contribution.mode ?? 'append',
      capacity: pointCapacity(p.contribution),
      candidates: [],
      enabled: [],
      conflict: false,
    });
  }

  const sleeping: RegisteredExtension[] = [];
  const rejected: ExtensionGraph['rejected'] = [];
  const seen = new Set<string>();
  const index = new Map<RegisteredExtension, number>();

  input.extensions.forEach((ext, i) => {
    index.set(ext, i);
    const ref = extensionRef(ext);
    if (seen.has(ref)) {
      rejected.push({ ext, reason: 'duplicate' });
      return;
    }
    seen.add(ref);

    const point = points.get(ext.contribution.point);
    if (!point) {
      sleeping.push(ext);
      return;
    }
    if (ext.contribution.kind !== point.decl.kind) {
      rejected.push({ ext, reason: 'kind-mismatch' });
      return;
    }
    if (ext.contribution.version !== point.decl.version) {
      rejected.push({ ext, reason: 'version-mismatch' });
      return;
    }
    if (!input.applies(ext.pluginId)) return;
    point.candidates.push(ext);
  });

  for (const point of points.values()) {
    point.candidates.sort(
      (a, b) =>
        (a.contribution.order ?? 0) - (b.contribution.order ?? 0) ||
        (index.get(a) ?? 0) - (index.get(b) ?? 0),
    );

    if (point.candidates.length <= point.capacity) {
      point.enabled = point.candidates;
      continue;
    }

    const refs = point.candidates.map(extensionRef);
    const resolution = input.resolutions[point.address];
    const valid =
      resolution !== undefined &&
      sameSet(resolution.candidates, refs) &&
      resolution.winners.length <= point.capacity &&
      resolution.winners.every((w) => refs.includes(w));

    if (valid) {
      const winners = new Set(resolution.winners);
      point.enabled = point.candidates.filter((ext) => winners.has(extensionRef(ext)));
    } else {
      point.conflict = true;
      point.enabled = [];
    }
  }

  return { points, sleeping, rejected };
}

export interface PointStateInput {
  /** alternative: ref, null — оригинал явно, undefined — выбора не было. */
  choice: string | null | undefined;
  isAvailable: (ext: RegisteredExtension) => boolean;
}

export interface PointState {
  original: boolean;
  active: RegisteredExtension[];
  options: RegisteredExtension[];
  conflict: boolean;
}

/** Что показать в точке сейчас. Нет точки — только оригинал. */
export function resolvePointState(point: ResolvedPoint | undefined, input: PointStateInput): PointState {
  if (!point) return { original: true, active: [], options: [], conflict: false };

  const available = point.enabled.filter(input.isAvailable);
  const base = { conflict: point.conflict };

  if (point.mode === 'append') {
    return { ...base, original: true, active: available, options: [] };
  }

  if (point.mode === 'replacement') {
    const winner = available[0];
    return winner
      ? { ...base, original: false, active: [winner], options: [] }
      : { ...base, original: true, active: [], options: [] };
  }

  // alternative
  let picked: RegisteredExtension | undefined;
  if (input.choice === undefined) {
    if ((point.decl.default ?? 'extension') === 'extension') picked = available[0];
  } else if (input.choice !== null) {
    picked = available.find((ext) => extensionRef(ext) === input.choice);
  }
  return picked
    ? { ...base, original: false, active: [picked], options: available }
    : { ...base, original: true, active: [], options: available };
}
