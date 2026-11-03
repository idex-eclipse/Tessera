import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseVersion } from '../../../plugin-sdk/src/dependencies';
import type { PluginManifest } from '../../../plugin-sdk/src/types';
import { CORE_MANIFESTS, corePluginVersions } from '../core-manifests';

const PLUGINS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../plugins');

function isManifest(value: unknown): value is PluginManifest {
  return typeof value === 'object' && value !== null && 'id' in value && 'entry' in value;
}

describe('core manifests', () => {
  it('lists every built-in plugin (plugins/<name>/manifest.ts)', async () => {
    const ids: string[] = [];
    for (const name of fs.readdirSync(PLUGINS_DIR)) {
      const file = path.join(PLUGINS_DIR, name, 'manifest.ts');
      if (!fs.existsSync(file)) continue;
      const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      ids.push(...Object.values(mod).filter(isManifest).map((m) => m.id));
    }
    expect(CORE_MANIFESTS.map((m) => m.id).sort()).toEqual(ids.sort());
  });

  it('versions are semver: extensions require them in manifest.dependencies', () => {
    for (const [id, version] of Object.entries(corePluginVersions())) {
      expect(parseVersion(version), `${id} ${version}`).not.toBeNull();
    }
  });
});
