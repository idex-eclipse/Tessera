#!/usr/bin/env node

/**
 * Packs a built plugin into a reproducible archive and upserts its entry
 * in registry.json (format read by deploy/tessera-ext.py).
 *
 * Usage:
 *   node tools/registry-pack.cjs <built-plugin-dir> --dir <name> --url-base <url> [--out <registry-dir>] [--plugin-api <n>]
 *
 *   <built-plugin-dir>  folder with manifest.json + entry (what goes to extensions/<name>/)
 *   --dir               folder name on the printer: extensions/<name>/
 *   --url-base          where archives will be published (e.g. GitHub Release download URL);
 *                       "." keeps URLs relative to registry.json
 *   --out               where to write <name>-<version>.tar.gz and registry.json (default: cwd)
 *   --plugin-api        only a check: must equal manifest.pluginApi ("MAJOR.MINOR"; none = legacy 1)
 *
 * pluginApi of the entry comes from manifest.pluginApi. A manifest without it gets the
 * legacy integer 1 ("0.7" for deploy/tessera-ext.py), which older CLIs also accept.
 *
 * requires — every plugin it depends on: owners of the points in manifest.extensions and
 * the keys of manifest.dependencies. dependencies — manifest.dependencies as is
 * ({ id: minimal semver }); a separate field, because older CLIs only accept strings in
 * `requires`.
 *
 * Same input → same bytes → same sha256 on any OS (sorted entries, zeroed mtime/owner, gzip
 * without timestamp and with a fixed OS byte).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PLUGIN_API_RE = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const LEGACY_PLUGIN_API = '0.7';

/** Same rules as plugin-sdk/src/api-level.ts: "MAJOR.MINOR", or missing / 1 for the legacy one. */
function normalizePluginApi(value) {
  if (value === undefined || value === 1 || value === '1') return LEGACY_PLUGIN_API;
  return typeof value === 'string' && PLUGIN_API_RE.test(value) ? value : null;
}

const DIR_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** Same as plugin-sdk/src/dependencies.ts. */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** { requires, dependencies } of the registry entry; throws on invalid manifest.dependencies. */
function manifestDependencies(manifest) {
  const deps = manifest.dependencies ?? {};
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new Error('manifest.json: "dependencies" must be an object { "<plugin id>": "X.Y.Z" }');
  }
  for (const [id, min] of Object.entries(deps)) {
    if (!id || id.includes('#') || typeof min !== 'string' || !SEMVER_RE.test(min)) {
      throw new Error(`manifest.json: invalid dependency ${JSON.stringify(id)}: ${JSON.stringify(min)} (expected "X.Y.Z")`);
    }
  }
  const requires = [];
  for (const ext of manifest.extensions ?? []) {
    const at = typeof ext?.point === 'string' ? ext.point.lastIndexOf('#') : -1;
    if (at > 0) requires.push(ext.point.slice(0, at));
  }
  requires.push(...Object.keys(deps));
  return {
    requires: [...new Set(requires)].filter((id) => id !== manifest.id).sort(),
    dependencies: Object.keys(deps).length > 0 ? deps : undefined,
  };
}

function parseArgs(argv) {
  const opts = { out: '.' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--url-base') opts.urlBase = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--plugin-api') opts.pluginApi = argv[++i];
    else rest.push(a);
  }
  opts.src = rest[0];
  return opts;
}

/** Sort published releases by semver so a prerelease never displaces its final release. */
function compareVersions(a, b) {
  const parts = (value) => {
    const match = SEMVER_RE.exec(value);
    if (!match) throw new Error(`Invalid published version: ${value}`);
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4]?.split('.')];
  };
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  if (!left[3] || !right[3]) return Number(Boolean(right[3])) - Number(Boolean(left[3]));
  for (let i = 0; i < Math.max(left[3].length, right[3].length); i++) {
    const x = left[3][i];
    const y = right[3][i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.src || !opts.dir || !opts.urlBase) {
    console.log('Usage: registry-pack.cjs <built-plugin-dir> --dir <name> --url-base <url> [--out <dir>] [--plugin-api <MAJOR.MINOR>]');
    process.exit(1);
  }
  if (!DIR_NAME_RE.test(opts.dir)) throw new Error(`Invalid --dir: ${opts.dir}`);

  const src = path.resolve(opts.src);
  const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  for (const key of ['id', 'name', 'version', 'entry']) {
    if (typeof manifest[key] !== 'string' || !manifest[key]) {
      throw new Error(`manifest.json: missing "${key}"`);
    }
  }
  if (!SEMVER_RE.test(manifest.version)) throw new Error(`manifest.json: invalid version ${manifest.version}`);
  if (!fs.existsSync(path.join(src, manifest.entry))) {
    throw new Error(`manifest.entry "${manifest.entry}" not found in ${src}`);
  }
  const pluginApi = normalizePluginApi(manifest.pluginApi);
  if (!pluginApi || (manifest.pluginApi !== undefined && typeof manifest.pluginApi !== 'string')) {
    throw new Error(`manifest.json: invalid "pluginApi" ${JSON.stringify(manifest.pluginApi)} (expected "MAJOR.MINOR")`);
  }
  if (opts.pluginApi !== undefined && normalizePluginApi(opts.pluginApi) !== pluginApi) {
    throw new Error(`--plugin-api ${opts.pluginApi} does not match manifest.pluginApi ${pluginApi}`);
  }
  const { requires, dependencies } = manifestDependencies(manifest);

  const out = path.resolve(opts.out);
  fs.mkdirSync(out, { recursive: true });
  const archiveName = `${opts.dir}-${manifest.version}.tar.gz`;

  const tarBytes = execFileSync('tar', [
    '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '--format=gnu', '-cf', '-', '.',
  ], { cwd: src, maxBuffer: 64 * 1024 * 1024 });
  // zlib не пишет mtime в заголовок gzip, а байт 9 — ОС упаковки (0x0a Windows, 0x03 Unix):
  // фиксируем его, чтобы архив не зависел от платформы
  const archive = zlib.gzipSync(tarBytes, { level: 9 });
  archive[9] = 0x03;
  const sha256 = crypto.createHash('sha256').update(archive).digest('hex');
  const url = opts.urlBase === '.' ? archiveName : `${opts.urlBase.replace(/\/+$/, '')}/${archiveName}`;

  const registryPath = path.join(out, 'registry.json');
  const registry = fs.existsSync(registryPath)
    ? JSON.parse(fs.readFileSync(registryPath, 'utf8'))
    : { schema: 1, plugins: [] };

  const release = {
    dir: opts.dir,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    pluginApi: manifest.pluginApi ?? 1,
    requires: requires.length > 0 ? requires : undefined,
    dependencies,
    url,
    sha256,
    size: archive.length,
  };
  if (registry.schema !== 1 || !Array.isArray(registry.plugins)) throw new Error('Invalid registry.json');
  const previous = registry.plugins.find((p) => p.id === manifest.id);
  if (previous && previous.dir !== opts.dir) throw new Error(`Published dir for ${manifest.id} cannot change`);
  if (registry.plugins.some((p) => p.id !== manifest.id && p.dir === opts.dir)) {
    throw new Error(`Published dir ${opts.dir} belongs to another plugin`);
  }
  const versions = previous ? (previous.versions ?? [Object.fromEntries(
    Object.entries(previous).filter(([key]) => key !== 'id' && key !== 'versions'),
  )]) : [];
  const existing = versions.find((v) => v.version === release.version);
  if (existing && JSON.stringify(existing) !== JSON.stringify(release)) {
    throw new Error(`${manifest.id}@${release.version} was already published; bump the version instead`);
  }
  const archivePath = path.join(out, archiveName);
  if (fs.existsSync(archivePath) && !fs.readFileSync(archivePath).equals(archive)) {
    throw new Error(`${archiveName} already exists with different bytes; bump the version instead`);
  }
  if (!existing) versions.push(release);
  versions.sort((a, b) => compareVersions(b.version, a.version));
  const latest = versions[0];
  const entry = { id: manifest.id, ...latest, versions };
  registry.plugins = registry.plugins
    .filter((p) => p.id !== entry.id)
    .concat(entry)
    .sort((a, b) => a.id.localeCompare(b.id));
  // Validate all collisions before writing either artifact so a failed republish is inert.
  if (!fs.existsSync(archivePath)) fs.writeFileSync(archivePath, archive, { flag: 'wx' });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');

  console.log(`${archiveName}  sha256=${sha256}  (${archive.length} bytes)`);
}

try {
  main();
} catch (e) {
  console.error(`[registry-pack] ${e.message}`);
  process.exit(1);
}
