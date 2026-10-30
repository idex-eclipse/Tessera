#!/usr/bin/env node

/**
 * Tessera extensions CLI: installs prebuilt plugins from the plugin registry
 * into ~/extensions/ and regenerates ~/extensions/index.json.
 *
 * Usage:
 *   node tools/tessera-ext.cjs list
 *   node tools/tessera-ext.cjs install <id> [--force]
 *   node tools/tessera-ext.cjs update [<id> | --all]
 *   node tools/tessera-ext.cjs remove <id>
 *   node tools/tessera-ext.cjs sync
 *
 * Env:
 *   TESSERA_REGISTRY_URL — registry.json (https://, file:// or local path)
 *
 * Nothing is built or executed on the host: the registry ships archives built
 * in its CI, each archive is verified against sha256 from registry.json before
 * it is unpacked. Only plain files and directories are accepted from archives.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');

const { scanExtensions, EXTENSIONS_DIR, ORIGIN_FILE } = require('./extensions-sync.cjs');

const REGISTRY_URL =
  process.env.TESSERA_REGISTRY_URL ||
  'https://raw.githubusercontent.com/idex-eclipse/tessera-plugins/main/registry/registry.json';

/** Major version of the plugin contract (PluginApi + CE contract) this host implements. */
const HOST_PLUGIN_API = 1;

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const DIR_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

// ------------------------------------------------------------------
// IO helpers
// ------------------------------------------------------------------

function toUrl(ref) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) return new URL(ref);
  return pathToFileURL(path.resolve(ref));
}

async function fetchBytes(url) {
  if (url.protocol === 'file:') {
    return fs.readFileSync(fileURLToPath(url));
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Refusing non-https URL: ${url.href}`);
  }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.href}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_ARCHIVE_BYTES) throw new Error(`Response too large: ${url.href}`);
  return buf;
}

async function loadRegistry() {
  const url = toUrl(REGISTRY_URL);
  const data = JSON.parse((await fetchBytes(url)).toString('utf8'));
  if (!data || data.schema !== 1 || !Array.isArray(data.plugins)) {
    throw new Error(`Unsupported registry format at ${url.href} (expected schema 1)`);
  }
  for (const p of data.plugins) {
    if (!p || typeof p.id !== 'string' || typeof p.version !== 'string' ||
        typeof p.url !== 'string' || typeof p.sha256 !== 'string' ||
        typeof p.dir !== 'string' || !DIR_NAME_RE.test(p.dir)) {
      throw new Error(`Invalid registry entry: ${JSON.stringify(p)}`);
    }
  }
  return { url, plugins: data.plugins };
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** manifest.id → { dir, version, origin } for everything in extensions/. */
function scanInstalled() {
  const result = new Map();
  if (!fs.existsSync(EXTENSIONS_DIR)) return result;
  for (const d of fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    const manifest = readJsonSafe(path.join(EXTENSIONS_DIR, d.name, 'manifest.json'));
    if (!manifest || typeof manifest.id !== 'string') continue;
    result.set(manifest.id, {
      dir: d.name,
      version: manifest.version,
      origin: readJsonSafe(path.join(EXTENSIONS_DIR, d.name, ORIGIN_FILE)),
    });
  }
  return result;
}

// ------------------------------------------------------------------
// Archive handling
// ------------------------------------------------------------------

// Архив передаётся относительным именем через cwd: GNU tar читает "C:\..." как host:path.
function tar(args, cwd) {
  return execFileSync('tar', args, { cwd, encoding: 'utf8' });
}

/** Rejects absolute paths, `..`, links and anything that is not a file/dir. */
function assertSafeArchive(dir, archive) {
  const names = tar(['-tzf', archive], dir).split('\n').filter(Boolean);
  const verbose = tar(['-tvzf', archive], dir).split('\n').filter(Boolean);

  if (names.length !== verbose.length) throw new Error('Cannot verify archive listing');

  names.forEach((name, i) => {
    const type = verbose[i][0];
    if (type !== '-' && type !== 'd') {
      throw new Error(`Archive contains unsupported entry (type "${type}"): ${name}`);
    }
    const normalized = path.posix.normalize(name);
    if (name.includes('\\') || path.posix.isAbsolute(normalized) ||
        normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`Archive contains unsafe path: ${name}`);
    }
  });
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

// ------------------------------------------------------------------
// Commands
// ------------------------------------------------------------------

async function install(entry, registryUrl, { force = false } = {}) {
  const pluginApi = entry.pluginApi ?? 1;
  if (pluginApi > HOST_PLUGIN_API && !force) {
    throw new Error(
      `${entry.id}@${entry.version} needs plugin API ${pluginApi}, host provides ${HOST_PLUGIN_API}. Update Tessera first.`,
    );
  }

  const installed = scanInstalled();
  const current = installed.get(entry.id);
  const target = path.join(EXTENSIONS_DIR, entry.dir);

  if (current && current.dir !== entry.dir) {
    throw new Error(`${entry.id} is already installed in extensions/${current.dir}; remove it first.`);
  }
  if (!current && fs.existsSync(target)) {
    throw new Error(`extensions/${entry.dir} already exists and is not ${entry.id}.`);
  }
  if (current && !current.origin && !force) {
    throw new Error(`${entry.id} in extensions/${entry.dir} was installed manually; use --force to replace it.`);
  }
  if (current && current.version === entry.version && !force) {
    console.log(`${entry.id}@${entry.version} is up to date`);
    return false;
  }

  const archiveUrl = new URL(entry.url, registryUrl);
  console.log(`Downloading ${entry.id}@${entry.version} from ${archiveUrl.href}`);
  const bytes = await fetchBytes(archiveUrl);

  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== entry.sha256.toLowerCase()) {
    throw new Error(`sha256 mismatch for ${entry.id}: expected ${entry.sha256}, got ${actual}`);
  }

  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-ext-'));
  // staging внутри extensions/ — rename в target атомарен (одна ФС)
  const staging = fs.mkdtempSync(path.join(EXTENSIONS_DIR, `.staging-${entry.dir}-`));
  const backup = path.join(EXTENSIONS_DIR, `.old-${entry.dir}`);

  try {
    fs.writeFileSync(path.join(tmp, 'plugin.tar.gz'), bytes);
    assertSafeArchive(tmp, 'plugin.tar.gz');
    tar(['-xzf', 'plugin.tar.gz', '-C', staging, '--no-same-owner', '--no-same-permissions'], tmp);

    const manifest = readJsonSafe(path.join(staging, 'manifest.json'));
    if (!manifest) throw new Error('Archive has no valid manifest.json at its root');
    if (manifest.id !== entry.id || manifest.version !== entry.version) {
      throw new Error(
        `Archive manifest ${manifest.id}@${manifest.version} does not match registry ${entry.id}@${entry.version}`,
      );
    }

    fs.writeFileSync(
      path.join(staging, ORIGIN_FILE),
      JSON.stringify({
        registry: registryUrl.href,
        id: entry.id,
        version: entry.version,
        sha256: actual,
        installedAt: new Date().toISOString(),
      }, null, 2),
    );

    rmrf(backup);
    if (fs.existsSync(target)) fs.renameSync(target, backup);
    fs.renameSync(staging, target);
    rmrf(backup);
  } catch (e) {
    rmrf(staging);
    if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw e;
  } finally {
    rmrf(tmp);
  }

  console.log(`Installed ${entry.id}@${entry.version} → extensions/${entry.dir}`);
  return true;
}

async function cmdList() {
  const { plugins } = await loadRegistry();
  const installed = scanInstalled();
  for (const p of plugins) {
    const cur = installed.get(p.id);
    const state = !cur ? '' : cur.version === p.version ? '[installed]' : `[update: ${cur.version} → ${p.version}]`;
    console.log(`${p.id}@${p.version}  ${p.name ?? ''} ${state}`.trimEnd());
    if (p.description) console.log(`    ${p.description}`);
  }
  for (const [id, cur] of installed) {
    if (!plugins.some((p) => p.id === id)) {
      console.log(`${id}@${cur.version}  [${cur.origin ? 'not in registry' : 'local'}]`);
    }
  }
}

async function cmdInstall(id, opts) {
  if (!id) throw new Error('Usage: install <id> [--force]');
  const { url, plugins } = await loadRegistry();
  const entry = plugins.find((p) => p.id === id);
  if (!entry) throw new Error(`${id} not found in registry ${url.href}`);
  if (await install(entry, url, opts)) scanExtensions();
}

async function cmdUpdate(id, opts) {
  const { url, plugins } = await loadRegistry();
  const installed = scanInstalled();
  const ids = opts.all || !id
    ? [...installed].filter(([, cur]) => cur.origin).map(([pid]) => pid)
    : [id];

  let changed = false;
  for (const pid of ids) {
    const entry = plugins.find((p) => p.id === pid);
    if (!entry) {
      console.warn(`${pid} not found in registry, skipped`);
      continue;
    }
    if (!installed.has(pid)) {
      console.warn(`${pid} is not installed, skipped (use install)`);
      continue;
    }
    changed = (await install(entry, url, { force: opts.force })) || changed;
  }
  if (changed) scanExtensions();
}

function cmdRemove(id) {
  if (!id) throw new Error('Usage: remove <id>');
  const cur = scanInstalled().get(id);
  if (!cur) throw new Error(`${id} is not installed`);
  rmrf(path.join(EXTENSIONS_DIR, cur.dir));
  console.log(`Removed ${id} (extensions/${cur.dir})`);
  scanExtensions();
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const [arg] = rest.filter((a) => !a.startsWith('--'));
  const opts = { force: flags.has('--force'), all: flags.has('--all') };

  switch (cmd) {
    case 'list': return cmdList();
    case 'install': return cmdInstall(arg, opts);
    case 'update': return cmdUpdate(arg, opts);
    case 'remove': return cmdRemove(arg);
    case 'sync': return scanExtensions();
    default:
      console.log('Usage: tessera-ext.cjs <list|install <id>|update [<id>|--all]|remove <id>|sync> [--force]');
      process.exitCode = cmd ? 1 : 0;
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(`[tessera-ext] ${e.message}`);
  process.exit(1);
});
