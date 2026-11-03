import type { PluginManifest } from './types';

/**
 * Зависимости плагина от других плагинов и их версий.
 *
 * - Владельцы точек, в которые плагин встраивается (manifest.extensions[].point), —
 *   неявные зависимости без версии: подойдёт любая.
 * - manifest.dependencies — `{ "<pluginId>": "<min semver>" }`: минимальная версия
 *   (">= X.Y.Z"). Новая точка или новая версия точки поднимает версию владельца, а не
 *   plugin API; дополнение пишет здесь версию владельца, в которой появилось всё нужное.
 *
 * Совместимость контракта точки (params/context) по-прежнему решает version точки,
 * поэтому верхней границы нет.
 *
 * Та же логика — в deploy/tessera-ext.py (parse_version, manifest_dependencies).
 */

/** MAJOR.MINOR.PATCH[-prerelease][+build] */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
}

export function parseVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== 'string') return null;
  const m = SEMVER_RE.exec(value);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

/** <0, 0, >0 по правилам semver (build-метаданные не учитываются). */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core !== 0) return core;
  // релиз старше любого своего prerelease
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Удовлетворяет ли версия `have` минимуму `min`. Нет минимума — да.
 * Нечитаемая версия владельца при заданном минимуме — нет.
 */
export function satisfiesMin(have: string | undefined, min: string | undefined): boolean {
  if (min === undefined) return true;
  const need = parseVersion(min);
  const got = parseVersion(have);
  if (!need || !got) return false;
  return compareVersions(got, need) >= 0;
}

/** Владелец точки по адресу `<owner>#<point>`; null для некорректного адреса. */
export function pointOwner(address: string): string | null {
  const at = address.lastIndexOf('#');
  return at > 0 ? address.slice(0, at) : null;
}

/**
 * Все зависимости плагина: id → минимальная версия (undefined — любая).
 * Себя не включает. manifest.dependencies должен быть уже проверен (sanitizeDependencies).
 */
export function manifestDependencies(manifest: PluginManifest): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const ext of manifest.extensions ?? []) {
    const owner = typeof ext?.point === 'string' ? pointOwner(ext.point) : null;
    if (owner && owner !== manifest.id && !out.has(owner)) out.set(owner, undefined);
  }
  for (const [id, min] of Object.entries(manifest.dependencies ?? {})) {
    if (id !== manifest.id) out.set(id, min);
  }
  return out;
}

/**
 * Оставляет в manifest.dependencies только записи `id → semver`; остальные отдаёт
 * в `invalid` (для предупреждения). Не-объект → undefined.
 */
export function sanitizeDependencies(value: unknown): {
  dependencies: Record<string, string> | undefined;
  invalid: Array<[string, unknown]>;
} {
  if (value === undefined) return { dependencies: undefined, invalid: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { dependencies: undefined, invalid: [['', value]] };
  }
  const dependencies: Record<string, string> = {};
  const invalid: Array<[string, unknown]> = [];
  for (const [id, min] of Object.entries(value)) {
    if (id && !id.includes('#') && parseVersion(min)) dependencies[id] = min as string;
    else invalid.push([id, min]);
  }
  return { dependencies, invalid };
}
