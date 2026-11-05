import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Layout of the BUILT-IN plugins (`plugins/*`, docs: plugin-development.md → "Layout of built-in
 * plugins"). Extensions in `extensions/` are free-form and not covered.
 *
 *   <plugin>/ index.ts manifest.ts [types.ts guards.ts hotkeys.ts]
 *             lib/        pure logic: no Svelte, no runes modules, no upward imports
 *             data/       subscriptions to Moonraker / the plugin API (the "cores", use-*.svelte.ts)
 *             state/      $state holders without network: UI state and settings-backed prefs
 *             components/ .svelte files only, grouped by surface
 *             __tests__/  the only place for tests
 *             i18n/ icons/
 *
 * Import direction: components -> data / state -> lib -> types. The test exists so the structure
 * cannot drift back into a flat pile of files.
 */

const PLUGINS_DIR = fileURLToPath(new URL('../..', import.meta.url));

/** `shared` is a library, not a plugin; `dummy` is a git-ignored local dev fixture. */
const NOT_PLUGINS = new Set(['shared', 'dummy']);

const PLUGIN_ROOT = {
  files: new Set(['index.ts', 'manifest.ts', 'types.ts', 'guards.ts', 'hotkeys.ts']),
  dirs: new Set(['__tests__', 'components', 'data', 'state', 'lib', 'i18n', 'icons']),
};

/** Extra root entries that are part of a specific plugin's contract (see docs). */
const PLUGIN_EXTRA_FILES: Record<string, string[]> = {
  system: ['notification-producers.ts', 'fleet-index.ts'],
};

/** widgets-core is a bundle of tiles: each tile is laid out like a plugin, minus index/i18n/icons. */
const TILE_ROOT = {
  files: new Set(['manifest.ts', 'types.ts']),
  dirs: new Set(['__tests__', 'components', 'data', 'state', 'lib']),
};
const BUNDLES = new Set(['widgets-core']);
const BUNDLE_ROOT = { files: new Set(['index.ts', 'manifest.ts']), dirs: new Set(['__tests__', 'i18n']) };

const SURFACE_DIRS = new Set([
  'chips', 'overlays', 'banners', 'widgets', 'page', 'fleet', 'right-panel', 'shared',
]);

interface Unit {
  /** `calibrations` or `widgets-core/temperature` */
  id: string;
  dir: string;
}

function list(dir: string): string[] {
  return readdirSync(dir).filter((n) => n !== 'node_modules' && n !== 'dist');
}

function isDir(p: string): boolean {
  return statSync(p).isDirectory();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of list(dir)) {
    const full = join(dir, name);
    if (isDir(full)) walk(full, out);
    else out.push(full);
  }
  return out;
}

const plugins = list(PLUGINS_DIR)
  .filter((n) => isDir(join(PLUGINS_DIR, n)) && !NOT_PLUGINS.has(n))
  .sort();

/** Every unit that follows the layered layout: ordinary plugins and the tiles of bundles. */
const units: Unit[] = [];
for (const p of plugins) {
  const dir = join(PLUGINS_DIR, p);
  if (BUNDLES.has(p)) {
    for (const t of list(dir)) {
      if (isDir(join(dir, t)) && !BUNDLE_ROOT.dirs.has(t)) units.push({ id: `${p}/${t}`, dir: join(dir, t) });
    }
  } else {
    units.push({ id: p, dir });
  }
}

const posix = (p: string) => p.split(sep).join('/');

/** Relative import specifiers of a source file (static imports, re-exports, side-effect imports). */
function relativeImports(src: string): string[] {
  const out: string[] = [];
  const re = /(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const m of src.matchAll(re)) out.push(m[1] as string);
  return out;
}

/** First path segment of `target` relative to the unit, or null when it lies outside the unit. */
function layerOf(unit: Unit, fromFile: string, spec: string): string | null {
  const rel = relative(unit.dir, resolve(dirname(fromFile), spec));
  if (rel.startsWith('..')) return null;
  return posix(rel).split('/')[0] ?? null;
}

describe('built-in plugin layout', () => {
  it('finds the plugins (the scan itself is not vacuous)', () => {
    expect(plugins.length).toBeGreaterThanOrEqual(8);
    expect(units.length).toBeGreaterThanOrEqual(16);
  });

  it('keeps only the allowed entries in each plugin / tile root', () => {
    const offenders: string[] = [];
    for (const p of plugins) {
      const dir = join(PLUGINS_DIR, p);
      const spec = BUNDLES.has(p) ? BUNDLE_ROOT : PLUGIN_ROOT;
      const extra = new Set(PLUGIN_EXTRA_FILES[p] ?? []);
      for (const name of list(dir)) {
        const full = join(dir, name);
        const ok = isDir(full)
          ? spec.dirs.has(name) || (BUNDLES.has(p) && !spec.dirs.has(name))
          : spec.files.has(name) || extra.has(name);
        if (!ok) offenders.push(`${p}/${name}`);
      }
    }
    for (const u of units.filter((x) => x.id.includes('/'))) {
      for (const name of list(u.dir)) {
        const full = join(u.dir, name);
        const ok = isDir(full) ? TILE_ROOT.dirs.has(name) : TILE_ROOT.files.has(name);
        if (!ok) offenders.push(`${u.id}/${name}`);
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  it('has index.ts and manifest.ts in every plugin and manifest.ts in every tile', () => {
    const missing: string[] = [];
    for (const p of plugins) {
      const names = new Set(list(join(PLUGINS_DIR, p)));
      for (const f of ['index.ts', 'manifest.ts']) if (!names.has(f)) missing.push(`${p}/${f}`);
    }
    for (const u of units.filter((x) => x.id.includes('/'))) {
      if (!list(u.dir).includes('manifest.ts')) missing.push(`${u.id}/manifest.ts`);
    }
    expect(missing).toEqual([]);
  });

  it('puts tests only in __tests__ folders', () => {
    const offenders = walk(PLUGINS_DIR)
      .filter((f) => /\.(test|spec)\.ts$/.test(f))
      .filter((f) => !posix(relative(PLUGINS_DIR, f)).split('/').includes('__tests__'))
      .map((f) => posix(relative(PLUGINS_DIR, f)));
    expect(offenders).toEqual([]);
  });

  it('keeps components/ to .svelte files in known surface folders', () => {
    const offenders: string[] = [];
    for (const u of units) {
      const comps = join(u.dir, 'components');
      let top: string[] = [];
      try {
        top = list(comps);
      } catch {
        continue; // a unit may have no components
      }
      for (const n of top) {
        if (!isDir(join(comps, n))) offenders.push(`${u.id}/components/${n} (loose file; use a surface folder)`);
        else if (!SURFACE_DIRS.has(n)) offenders.push(`${u.id}/components/${n} (unknown surface folder)`);
      }
      for (const f of walk(comps)) {
        if (!f.endsWith('.svelte')) offenders.push(`${u.id}/${posix(relative(u.dir, f))} (not a .svelte file)`);
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  it('keeps .svelte components out of lib/, data/ and state/', () => {
    const offenders: string[] = [];
    for (const u of units) {
      for (const layer of ['lib', 'data', 'state']) {
        let files: string[] = [];
        try {
          files = walk(join(u.dir, layer));
        } catch {
          continue;
        }
        for (const f of files) if (f.endsWith('.svelte')) offenders.push(`${u.id}/${posix(relative(u.dir, f))}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('respects the import direction (components -> data/state -> lib) and does not reach into other plugins', () => {
    // What each layer may NOT import from inside its own plugin / tile.
    const forbidden: Record<string, string[]> = {
      lib: ['data', 'state', 'components'],
      data: ['components'],
      state: ['data', 'components'],
    };
    const offenders: string[] = [];

    for (const u of units) {
      for (const [layer, banned] of Object.entries(forbidden)) {
        let files: string[] = [];
        try {
          files = walk(join(u.dir, layer)).filter((f) => /\.(ts|svelte)$/.test(f));
        } catch {
          continue;
        }
        for (const f of files) {
          const src = readFileSync(f, 'utf8');
          const where = `${u.id}/${posix(relative(u.dir, f))}`;

          for (const spec of relativeImports(src)) {
            const target = layerOf(u, f, spec);
            if (target && banned.includes(target)) offenders.push(`${where} imports ${spec} (${layer} -> ${target})`);
          }

          // lib stays framework-free: no Svelte package and no runes modules.
          if (layer === 'lib') {
            if (/from\s*['"]svelte(\/[^'"]*)?['"]/.test(src)) offenders.push(`${where} imports svelte (lib must be pure)`);
            if (/\$(state|derived|effect|props)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'))) {
              offenders.push(`${where} uses runes (lib must be pure)`);
            }
          }
        }
      }
    }

    // Plugins talk to each other only through the host; `shared` and the SDK are the common ground.
    for (const f of walk(PLUGINS_DIR)) {
      if (!/\.(ts|svelte)$/.test(f) || posix(f).includes('/__tests__/')) continue;
      const owner = posix(relative(PLUGINS_DIR, f)).split('/')[0] as string;
      if (NOT_PLUGINS.has(owner)) continue;
      for (const spec of relativeImports(readFileSync(f, 'utf8'))) {
        const rel = posix(relative(PLUGINS_DIR, resolve(dirname(f), spec)));
        if (rel.startsWith('..')) continue;
        const target = rel.split('/')[0] as string;
        if (target !== owner && !NOT_PLUGINS.has(target)) {
          offenders.push(`${posix(relative(PLUGINS_DIR, f))} imports another plugin (${spec})`);
        }
      }
    }

    expect(offenders.sort()).toEqual([]);
  });

  it('names the plugin folder after the manifest folder it is registered under', () => {
    // A cheap guard against a plugin folder that was renamed without updating its entry path.
    for (const p of plugins) {
      const src = readFileSync(join(PLUGINS_DIR, p, 'manifest.ts'), 'utf8');
      const m = src.match(/entry:\s*['"]\/plugins\/([^/'"]+)\//);
      if (m) expect(m[1], `${basename(p)}/manifest.ts entry`).toBe(p);
    }
  });
});
