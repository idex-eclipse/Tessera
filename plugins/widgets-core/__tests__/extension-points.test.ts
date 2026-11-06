import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SURFACE_SPECS } from '../../../host/src/core/surfaces';
import { SLIDER_POINT_ID } from '../../shared/slider-field/extension-points';
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';
import { widgetsCoreManifest } from '../manifest';

const points = widgetsCoreManifest.extensionPoints ?? [];
const PLUGIN_DIR = join(__dirname, '..');
const SLIDER_SRC = join(__dirname, '..', '..', 'shared', 'slider-field', 'SliderField.svelte');

/** All .svelte files under a directory, tests excluded. */
function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : svelteFiles(path);
    return path.endsWith('.svelte') ? [path] : [];
  });
}

/** Point ids the markup actually uses: <ExtensionPoint point="…"> and api.extensions.list('…'). */
function usedPointIds(): Set<string> {
  const used = new Set<string>();
  for (const file of svelteFiles(PLUGIN_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/<ExtensionPoint\s+point="([^"]+)"/g)) used.add(m[1] ?? '');
    for (const m of src.matchAll(/extensions\.list\('([^']+)'/g)) used.add(m[1] ?? '');
  }
  // The slider point lives in the shared SliderField, which every widget of this plugin embeds.
  if (readFileSync(SLIDER_SRC, 'utf8').includes('point={SLIDER_POINT_ID}')) used.add(SLIDER_POINT_ID);
  return used;
}

/** Walks a dotted key such as `widgets.ext.toolsMove` through a locale tree. */
function pick(root: unknown, key: string[]): unknown {
  return key.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], root);
}

describe('widgets-core / extension points', () => {
  it('declares valid points with unique ids', () => {
    const validate = SURFACE_SPECS.extensionPoints.validate!;
    for (const p of points) expect(validate(p), p.id).toBe(true);
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);
  });

  it('every point title exists in en and ru', () => {
    for (const p of points) {
      const key = p.titleKey!.split('.');
      expect(pick({ ...en }, key), `en ${p.id}`).toBeTypeOf('string');
      expect(pick({ ...ru }, key), `ru ${p.id}`).toBeTypeOf('string');
    }
  });

  // Guards against drift: a point nobody renders is dead API, an undeclared one is silently ignored.
  it('points declared in the manifest and used in the markup are the same set', () => {
    expect([...usedPointIds()].sort()).toEqual(points.map((p) => p.id).sort());
  });

  it('has a replaceable body for every widget and a header for those that have one', () => {
    const ids = new Set(points.map((p) => p.id));
    for (const w of widgetsCoreManifest.widgets ?? []) {
      // the Temperature widget type is `temperature-graph`, its points are named after the feature
      const name = w.type.replace(/-graph$/, '');
      expect(ids.has(`widget-${name}`), `widget-${name}`).toBe(true);
      expect(ids.has(`header-${name}`), `header-${name}`).toBe(Boolean(w.headerElement));
    }
  });

  it('has the documented kinds and modes', () => {
    const byId = new Map<string, (typeof points)[number]>(points.map((p) => [p.id, p]));
    const replaced = points.filter((p) => !['temperature-extra', 'tools-sections', 'camera-stream'].includes(p.id));
    for (const p of replaced) expect(p, p.id).toMatchObject({ kind: 'element', mode: 'replacement' });
    expect(byId.get('camera-stream')).toMatchObject({ kind: 'element', mode: 'alternative' });
    expect(byId.get('temperature-extra')).toMatchObject({ kind: 'panel', mode: 'append' });
    expect(byId.get('tools-sections')).toMatchObject({ kind: 'panel', mode: 'append' });
  });
});
