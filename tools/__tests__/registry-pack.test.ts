import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The packer requires GNU tar; Windows' bundled bsdtar cannot create its stable format.
const gnuTar = spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout?.includes('GNU tar') ?? false;
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe.skipIf(!gnuTar)('registry packer', () => {
  it('retains older releases and refuses to rewrite a published version', () => {
    const base = mkdtempSync(join(tmpdir(), 'tessera-pack-test-'));
    folders.push(base);
    const dist = join(base, 'dist');
    const registryDir = join(base, 'registry');
    mkdirSync(dist);
    mkdirSync(registryDir);
    const packer = resolve('tools/registry-pack.cjs');
    const pack = () => execFileSync(process.execPath, [packer, dist, '--dir', 'hello', '--url-base', '.', '--out', registryDir]);
    const manifest = (version: string) => ({ id: 'acme/hello', name: 'Hello', version, entry: 'index.js', pluginApi: '1.0' });
    const publish = (version: string, code: string) => {
      writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest(version)));
      writeFileSync(join(dist, 'index.js'), code);
      pack();
    };

    publish('1.0.0', 'old');
    publish('2.0.0', 'new');
    const before = readFileSync(join(registryDir, 'registry.json'), 'utf8');
    const entry = JSON.parse(before).plugins[0];
    expect(entry.versions.map((v: { version: string }) => v.version)).toEqual(['2.0.0', '1.0.0']);
    expect(readdirSync(registryDir).filter((name) => name.endsWith('.tar.gz'))).toHaveLength(2);
    expect(entry.version).toBe('2.0.0');
    pack();
    expect(readFileSync(join(registryDir, 'registry.json'), 'utf8')).toBe(before);

    writeFileSync(join(dist, 'index.js'), 'changed without a version bump');
    expect(pack).toThrow();
    expect(readFileSync(join(registryDir, 'registry.json'), 'utf8')).toBe(before);
  });
});
