import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SURFACE_SPECS } from '../../../host/src/core/surfaces';
import { FILE_TABLE_POINT_IDS } from '../../shared/file-table/extension-points';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';
import { consoleManifest } from '../manifest';

const points = consoleManifest.extensionPoints ?? [];
const COMPONENTS_DIR = join(__dirname, '..', 'components');

/** All .svelte files under a directory (the plugin is small, a plain walk is enough). */
function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return svelteFiles(path);
    return path.endsWith('.svelte') ? [path] : [];
  });
}

/** Point ids the markup actually uses: <ExtensionPoint point="…"> and api.extensions.list('…'). */
function usedPointIds(): Set<string> {
  const used = new Set<string>();
  for (const file of svelteFiles(COMPONENTS_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/<ExtensionPoint\s+point="([^"]+)"/g)) used.add(m[1] ?? '');
    for (const m of src.matchAll(/extensions\.list\('([^']+)'/g)) used.add(m[1] ?? '');
  }
  return used;
}

describe('console / extension points', () => {
  it('declares valid points with unique ids', () => {
    const validate = SURFACE_SPECS.extensionPoints.validate!;
    for (const p of points) expect(validate(p), p.id).toBe(true);
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);
  });

  it('every point title exists in en and ru', () => {
    for (const p of points) {
      const key = p.titleKey!.replace(/^console\./, '').split('.');
      const pick = (root: unknown) =>
        key.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], root);
      expect(pick(en.console), `en ${p.id}`).toBeTypeOf('string');
      expect(pick(ru.console), `ru ${p.id}`).toBeTypeOf('string');
    }
  });

  // Guards against drift: a point nobody renders is dead API, an undeclared one is silently ignored.
  it('points declared in the manifest and used in the markup are the same set', () => {
    expect([...usedPointIds()].sort()).toEqual(points.map((p) => p.id).sort());
  });

  it('has the documented kinds and modes', () => {
    const byId = new Map<string, (typeof points)[number]>(points.map((p) => [p.id, p]));
    for (const id of ['page', 'widget-console']) {
      expect(byId.get(id), id).toMatchObject({ kind: 'element', mode: 'replacement' });
    }
    for (const id of ['panel-console', 'panel-commands']) {
      expect(byId.get(id), id).toMatchObject({ kind: 'element', mode: 'alternative' });
    }
    expect(byId.get('panels-bottom')).toMatchObject({ kind: 'panel', mode: 'append' });
  });

  it('does not declare the file table points: the console has no file operations', () => {
    const ids = points.map((p) => p.id);
    for (const id of Object.values(FILE_TABLE_POINT_IDS)) expect(ids).not.toContain(id);
  });
});
