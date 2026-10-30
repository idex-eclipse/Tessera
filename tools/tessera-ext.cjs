#!/usr/bin/env node

/**
 * Tessera extensions CLI: installs prebuilt plugins from the plugin registry
 * into ~/extensions/ and regenerates ~/extensions/index.json.
 *
 * Usage (on the printer usually via the `tessera-ext` command, deploy/install-ext.sh):
 *   node tools/tessera-ext.cjs              interactive menu (in a terminal)
 *   node tools/tessera-ext.cjs list
 *   node tools/tessera-ext.cjs install <name> [--force]
 *   node tools/tessera-ext.cjs update [<name> | --all]
 *   node tools/tessera-ext.cjs remove <name>
 *   node tools/tessera-ext.cjs sync
 * <name> is the plugin id ("tessera/spoolman") or its short name ("spoolman").
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
  'https://raw.githubusercontent.com/idex-eclipse/Tessera-Ext/main/registry/registry.json';

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

/**
 * One row per known plugin: registry entries first, then installed plugins
 * the registry does not know (put there by hand, or dropped from the registry).
 * state: 'available' | 'installed' | 'update' | 'local'
 */
function collectStatus(plugins, installed) {
  const rows = plugins.map((p) => {
    const cur = installed.get(p.id);
    return {
      id: p.id,
      name: p.name || p.id,
      version: p.version,
      installedVersion: cur?.version,
      state: !cur ? 'available' : cur.version === p.version ? 'installed' : 'update',
      description: p.description || '',
      entry: p,
    };
  });
  for (const [id, cur] of installed) {
    if (plugins.some((p) => p.id === id)) continue;
    rows.push({
      id, name: id, version: cur.version, installedVersion: cur.version,
      state: 'local', description: cur.origin ? 'not in registry any more' : 'installed by hand', entry: null,
    });
  }
  return rows;
}

function stateLabel(row) {
  if (row.state === 'installed') return 'installed';
  if (row.state === 'update') return `update ${row.installedVersion} → ${row.version}`;
  if (row.state === 'local') return 'local';
  return '';
}

/**
 * Accepts the full id ("tessera/spoolman"), the folder name ("spoolman") or
 * the last id segment, case-insensitive. Ambiguity is an error, not a guess.
 */
function resolveId(query, plugins, installed) {
  if (!query) return null;
  const known = new Map(); // id → dir
  for (const p of plugins) known.set(p.id, p.dir);
  for (const [id, cur] of installed) if (!known.has(id)) known.set(id, cur.dir);
  if (known.has(query)) return query;

  const q = query.toLowerCase();
  const matches = [...known].filter(([id, dir]) =>
    id.toLowerCase() === q || dir.toLowerCase() === q || id.split('/').pop().toLowerCase() === q);
  if (matches.length === 1) return matches[0][0];
  if (matches.length > 1) {
    throw new Error(`"${query}" is ambiguous: ${matches.map(([id]) => id).join(', ')}`);
  }
  throw new Error(`"${query}" not found. Known: ${[...known.keys()].join(', ') || 'none'}`);
}

const UI_HINT = 'Open the UI: Settings → Plugins → Refresh, then Install / Update (F5 if the plugin was updated).';

async function cmdList() {
  const { plugins } = await loadRegistry();
  for (const row of collectStatus(plugins, scanInstalled())) {
    const state = stateLabel(row);
    console.log(`${row.id}@${row.version}  ${row.name}${state ? `  [${state}]` : ''}`);
    if (row.description) console.log(`    ${row.description}`);
  }
}

async function cmdInstall(query, opts) {
  if (!query) throw new Error('Usage: install <id> [--force]');
  const { url, plugins } = await loadRegistry();
  const id = resolveId(query, plugins, scanInstalled());
  const entry = plugins.find((p) => p.id === id);
  if (!entry) throw new Error(`${id} is not in registry ${url.href}`);
  if (await install(entry, url, opts)) {
    scanExtensions();
    console.log(UI_HINT);
  }
}

async function cmdUpdate(query, opts) {
  const { url, plugins } = await loadRegistry();
  const installed = scanInstalled();
  const ids = opts.all || !query
    ? [...installed].filter(([, cur]) => cur.origin).map(([pid]) => pid)
    : [resolveId(query, plugins, installed)];

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
  if (changed) {
    scanExtensions();
    if (!opts.quiet) console.log(UI_HINT);
  }
  return changed;
}

function removeInstalled(id) {
  const cur = scanInstalled().get(id);
  if (!cur) throw new Error(`${id} is not installed`);
  rmrf(path.join(EXTENSIONS_DIR, cur.dir));
  console.log(`Removed ${id} (extensions/${cur.dir})`);
  scanExtensions();
}

async function cmdRemove(query) {
  if (!query) throw new Error('Usage: remove <id>');
  const installed = scanInstalled();
  // Removal must work offline: fall back to installed plugins only.
  const plugins = await loadRegistry().then((r) => r.plugins).catch(() => []);
  removeInstalled(resolveId(query, plugins, installed));
}

// ------------------------------------------------------------------
// Interactive menu
// ------------------------------------------------------------------

/**
 * Line reader that also works with piped input (tests, scripts): queued
 * lines are consumed in order, end of input answers null (= quit).
 */
function createPrompter() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  const lines = [];
  const waiters = [];
  let closed = false;
  rl.on('line', (line) => (waiters.length ? waiters.shift()(line) : lines.push(line)));
  rl.on('close', () => {
    closed = true;
    while (waiters.length) waiters.shift()(null);
  });
  return {
    ask(question) {
      process.stdout.write(question);
      if (lines.length) return Promise.resolve(lines.shift());
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiters.push(resolve));
    },
    close: () => rl.close(),
  };
}

async function cmdMenu() {
  const prompt = createPrompter();
  let changed = false;
  try {
    for (;;) {
      const { url, plugins } = await loadRegistry();
      const rows = collectStatus(plugins, scanInstalled());

      console.log(`\nTessera plugins — registry: ${url.href}`);
      if (rows.length === 0) console.log('  (registry is empty)');
      const nameWidth = Math.max(4, ...rows.map((r) => r.name.length));
      const stateWidth = Math.max(9, ...rows.map((r) => stateLabel(r).length));
      rows.forEach((r, i) => {
        const state = stateLabel(r).padEnd(stateWidth);
        console.log(`  ${String(i + 1).padStart(2)}) ${r.name.padEnd(nameWidth)}  ${r.version.padEnd(8)} ${state} ${r.description}`);
      });

      const answer = (await prompt.ask('\nNumber = install / update / remove, a = update all, q = quit: '))?.trim().toLowerCase();
      if (answer == null || answer === '' || answer === 'q') break;

      try {
        if (answer === 'a') {
          changed = (await cmdUpdate(null, { all: true, quiet: true })) || changed;
          continue;
        }
        const row = rows[Number(answer) - 1];
        if (!/^\d+$/.test(answer) || !row) {
          console.log(`Unknown choice "${answer}"`);
          continue;
        }

        if (row.state === 'available') {
          if (await install(row.entry, url)) {
            scanExtensions();
            changed = true;
          }
          continue;
        }

        const options = row.state === 'update' ? 'u = update, r = remove' : 'r = remove';
        const action = (await prompt.ask(`${row.name}: ${options}, Enter = back: `))?.trim().toLowerCase();
        if (action === 'u' && row.state === 'update') {
          if (await install(row.entry, url)) {
            scanExtensions();
            changed = true;
          }
        } else if (action === 'r') {
          const sure = (await prompt.ask(`Remove ${row.id}? [y/N]: `))?.trim().toLowerCase();
          if (sure === 'y' || sure === 'yes') {
            removeInstalled(row.id);
            changed = true;
          }
        }
      } catch (e) {
        // One failed action (bad hash, network) must not close the menu.
        console.error(`[tessera-ext] ${e.message}`);
      }
    }
  } finally {
    prompt.close();
  }
  if (changed) console.log(`\n${UI_HINT}`);
}

const USAGE = `Usage: tessera-ext [command]
  (no command)          interactive menu
  list                  registry plugins and installed state
  install <name>        install from the registry ("spoolman" or "tessera/spoolman")
  update [<name>|--all] update one or all registry plugins
  remove <name>         delete an installed plugin
  sync                  rebuild extensions/index.json
Options: --force (replace a hand-installed plugin / reinstall the same version)`;

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const [arg] = rest.filter((a) => !a.startsWith('--'));
  const opts = { force: flags.has('--force'), all: flags.has('--all') };

  switch (cmd) {
    case 'menu': return cmdMenu();
    case 'list': return cmdList();
    case 'install': return cmdInstall(arg, opts);
    case 'update': return void (await cmdUpdate(arg, opts));
    case 'remove': return cmdRemove(arg);
    case 'sync': return scanExtensions();
    case undefined:
      if (process.stdin.isTTY) return cmdMenu();
      console.log(USAGE);
      return;
    default:
      console.log(USAGE);
      process.exitCode = cmd === 'help' || cmd === '--help' ? 0 : 1;
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(`[tessera-ext] ${e.message}`);
  process.exit(1);
});
