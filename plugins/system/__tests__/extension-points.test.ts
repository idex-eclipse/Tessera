import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SURFACE_SPECS } from '../../../host/src/core/surfaces';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';
import { systemManifest } from '../manifest';

const points = systemManifest.extensionPoints ?? [];
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

describe('system / extension points', () => {
  it('declares valid points with unique ids', () => {
    const validate = SURFACE_SPECS.extensionPoints.validate!;
    for (const p of points) expect(validate(p), p.id).toBe(true);
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);
  });

  it('every point title exists in en and ru', () => {
    for (const p of points) {
      const key = p.titleKey!.replace(/^system\./, '').split('.');
      const pick = (root: unknown) =>
        key.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], root);
      expect(pick(en.system), `en ${p.id}`).toBeTypeOf('string');
      expect(pick(ru.system), `ru ${p.id}`).toBeTypeOf('string');
    }
  });

  // Guards against drift: a point nobody renders is dead API, an undeclared one is silently ignored.
  it('points declared in the manifest and used in the markup are the same set', () => {
    const declared = new Set(points.map((p) => p.id));
    expect([...usedPointIds()].sort()).toEqual([...declared].sort());
  });

  it('keeps emergency and print controls out of replaceable points', () => {
    for (const p of points) {
      expect(p.id, p.id).not.toMatch(/estop|emergency|upload|pause|resume|cancel/);
    }
    // Buttons next to Pause/Resume/Cancel may only be appended, never replace them.
    const actions = points.filter((p) => p.kind === 'action');
    expect(actions.map((p) => p.id)).toEqual(['banner-status-actions']);
    for (const p of actions) expect(p.mode ?? 'append').toBe('append');
  });

  it('every built-in tab body and large panel is a replacement, extras are append', () => {
    // widen the literal id types of the manifest so plain strings can be looked up
    const byId = new Map<string, (typeof points)[number]>(points.map((p) => [p.id, p]));
    for (const id of ['tab-overview', 'tab-monitoring', 'tab-maintenance']) {
      expect(byId.get(id)).toMatchObject({ kind: 'tab', mode: 'replacement' });
    }
    for (const id of ['tabs']) expect(byId.get(id)).toMatchObject({ kind: 'tab', mode: 'append' });
    for (const id of ['panels-overview', 'panels-monitoring', 'panels-maintenance', 'panels-right']) {
      expect(byId.get(id)).toMatchObject({ kind: 'panel', mode: 'append' });
    }
  });
});
