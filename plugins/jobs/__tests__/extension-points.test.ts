import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SURFACE_SPECS } from '../../../host/src/core/surfaces';
import { FILE_TABLE_POINT_IDS } from '../../shared/file-table/extension-points';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';
import { jobsManifest } from '../manifest';

const points = jobsManifest.extensionPoints ?? [];
const COMPONENTS_DIR = join(__dirname, '..', 'components');
const FILE_TABLE_IDS: string[] = Object.values(FILE_TABLE_POINT_IDS);

/** All .svelte files under a directory (the plugin is small, a plain walk is enough). */
function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return svelteFiles(path);
    return path.endsWith('.svelte') ? [path] : [];
  });
}

/** Point ids the markup uses itself: <ExtensionPoint point="…"> and api.extensions.list('…'). */
function ownUsedPointIds(): Set<string> {
  const used = new Set<string>();
  for (const file of svelteFiles(COMPONENTS_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/<ExtensionPoint\s+point="([^"]+)"/g)) used.add(m[1] ?? '');
    for (const m of src.matchAll(/extensions\.list\('([^']+)'/g)) used.add(m[1] ?? '');
  }
  return used;
}

describe('jobs / extension points', () => {
  it('declares valid points with unique ids', () => {
    const validate = SURFACE_SPECS.extensionPoints.validate!;
    for (const p of points) expect(validate(p), p.id).toBe(true);
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);
  });

  it('every point title exists in en and ru', () => {
    for (const p of points) {
      const key = p.titleKey!.replace(/^jobs\./, '').split('.');
      const pick = (root: unknown) =>
        key.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], root);
      expect(pick(en.jobs), `en ${p.id}`).toBeTypeOf('string');
      expect(pick(ru.jobs), `ru ${p.id}`).toBeTypeOf('string');
    }
  });

  // Guards against drift: a point nobody renders is dead API, an undeclared one is silently ignored.
  it('the own points declared in the manifest and used in the markup are the same set', () => {
    const declaredOwn = points.map((p) => p.id).filter((id) => !FILE_TABLE_IDS.includes(id));
    expect([...ownUsedPointIds()].sort()).toEqual([...declaredOwn].sort());
  });

  it('declares every point of the shared FileTable (the widget and the page embed it)', () => {
    for (const id of FILE_TABLE_IDS) expect(points.map((p) => p.id), id).toContain(id);
  });

  it('has the documented kinds and modes', () => {
    const byId = new Map<string, (typeof points)[number]>(points.map((p) => [p.id, p]));
    for (const id of ['widget-table', 'page', 'panel-table', 'file-editor', 'file-viewer']) {
      expect(byId.get(id), id).toMatchObject({ kind: 'element', mode: 'replacement' });
    }
    expect(byId.get('panels-bottom')).toMatchObject({ kind: 'panel', mode: 'append' });
    expect(byId.get('file-actions')).toMatchObject({ kind: 'action', mode: 'append' });
  });
});
