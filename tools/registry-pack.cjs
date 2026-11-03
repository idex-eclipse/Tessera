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
  fs.writeFileSync(path.join(out, archiveName), archive);

  const sha256 = crypto.createHash('sha256').update(archive).digest('hex');
  const url = opts.urlBase === '.' ? archiveName : `${opts.urlBase.replace(/\/+$/, '')}/${archiveName}`;

  const registryPath = path.join(out, 'registry.json');
  const registry = fs.existsSync(registryPath)
    ? JSON.parse(fs.readFileSync(registryPath, 'utf8'))
    : { schema: 1, plugins: [] };

  const entry = {
    id: manifest.id,
    dir: opts.dir,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    pluginApi: manifest.pluginApi ?? 1,
    url,
    sha256,
    size: archive.length,
  };
  registry.plugins = registry.plugins
    .filter((p) => p.id !== entry.id)
    .concat(entry)
    .sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');

  console.log(`${archiveName}  sha256=${sha256}  (${archive.length} bytes)`);
}

try {
  main();
} catch (e) {
  console.error(`[registry-pack] ${e.message}`);
  process.exit(1);
}
