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
 *   node tools/tessera-ext.cjs branch [<name>]   show / switch the registry branch
 * <name> is the plugin id ("tessera/spoolman") or its short name ("spoolman").
 *
 * Registry: registry/registry.json of the Tessera-Ext repository on the chosen
 * branch (default main; saved in ~/.config/tessera/tessera-ext.conf).
 * Env:
 *   TESSERA_REGISTRY_URL — registry.json (https://, file:// or local path); overrides the branch
 *   TESSERA_EXT_BRANCH   — branch for this run only
 *
 * Nothing is built or executed on the host: the registry ships prebuilt
 * archives, each archive is verified against sha256 from registry.json before
 * it is unpacked. Only plain files and directories are accepted from archives.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');

const { scanExtensions, EXTENSIONS_DIR, ORIGIN_FILE } = require('./extensions-sync.cjs');

// ------------------------------------------------------------------
// Registry location and branch
// ------------------------------------------------------------------

const REGISTRY_REPO = 'idex-eclipse/Tessera-Ext';
const CONF_FILE = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'tessera',
  'tessera-ext.conf',
);
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,100}$/;

/** KEY=value lines; the file is data, never code. */
function readConf() {
  const conf = {};
  try {
    for (const line of fs.readFileSync(CONF_FILE, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line);
      if (m) conf[m[1]] = m[2];
    }
  } catch {
    // no settings yet
  }
  return conf;
}

function saveBranch(branch) {
  fs.mkdirSync(path.dirname(CONF_FILE), { recursive: true });
  fs.writeFileSync(CONF_FILE, `# Tessera plugin manager settings — written by tools/tessera-ext.cjs\nBRANCH=${branch}\n`);
}

/** Validates and saves the branch; `known` = remote branches ([] = cannot check). */
function setBranch(name, known) {
  if (!BRANCH_RE.test(name) || name.includes('..')) throw new Error(`invalid branch name "${name}"`);
  if (known.length && !known.includes(name)) {
    throw new Error(`branch "${name}" not found in ${REGISTRY_REPO}. Available: ${known.join(', ')}`);
  }
  saveBranch(name);
  // The saved choice wins over the per-run variable for the rest of this run.
  delete process.env.TESSERA_EXT_BRANCH;
}

/** { branch, url, custom } — custom = TESSERA_REGISTRY_URL overrides the branch. */
function registrySource() {
  const branch = process.env.TESSERA_EXT_BRANCH || readConf().BRANCH || 'main';
  if (process.env.TESSERA_REGISTRY_URL) {
    return { branch, url: process.env.TESSERA_REGISTRY_URL, custom: true };
  }
  return { branch, url: `https://raw.githubusercontent.com/${REGISTRY_REPO}/${branch}/registry/registry.json`, custom: false };
}

/** Branch names of the registry repository on GitHub ([] when offline). */
function remoteBranches() {
  try {
    return execFileSync('git', ['ls-remote', '--heads', `https://github.com/${REGISTRY_REPO}.git`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    })
      .split('\n')
      .map((l) => l.split('refs/heads/')[1])
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

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
  const url = toUrl(registrySource().url);
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

// --- TUI (kiauh-style boxes) ---------------------------------------

/** Inner width of every box: 57 columns with the borders, like kiauh. */
const BOX = 55;
/** Two-column layout of the main menu: actions | status. */
const MAIN_COLS = [18, 36];

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { green: paint(32), red: paint(31), yellow: paint(33), cyan: paint(36), dim: paint(2) };

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const visible = (s) => s.replace(ANSI_RE, '').length;

/** Pads to `width` visible columns; too long → plain text cut with '…'. */
function fit(s, width) {
  if (visible(s) > width) s = s.replace(ANSI_RE, '').slice(0, width - 1) + '…';
  return s + ' '.repeat(width - visible(s));
}

/** Word-wraps plain text into at most `maxLines` lines; the rest is cut by row(). */
function wrap(text, width, maxLines) {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      if (out.length === maxLines - 1) {
        out.push(`${line} ${word}`);
        return out;
      }
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

function center(s, width = BOX) {
  const left = Math.max(0, Math.floor((width - visible(s)) / 2));
  return fit(' '.repeat(left) + s, width);
}

const boxTop = () => `╔${'═'.repeat(BOX)}╗`;
const boxBottom = () => `╚${'═'.repeat(BOX)}╝`;
const rule = (cols = [BOX], joint = '') => `╟${cols.map((w) => '─'.repeat(w)).join(joint)}╢`;
// Text cut with '…' keeps one space before the border, like kiauh.
const cell = (s, width) => (visible(s) > width ? `${fit(s, width - 1)} ` : fit(s, width));
const row = (cells, cols = [BOX]) => `║${cells.map((s, i) => cell(s, cols[i])).join('│')}║`;

/** "║ ~~~~~~ [ Text ] ~~~~~~ ║" */
function title(text) {
  const mid = ` [ ${text} ] `;
  const rest = BOX - 2 - mid.length;
  const left = Math.floor(rest / 2);
  return row([` ${'~'.repeat(left)} [ ${c.cyan(text)} ] ${'~'.repeat(rest - left)} `]);
}

function renderHeader() {
  return [
    boxTop(),
    title('TESSERA'),
    row([center('Tessera Extensions Manager')]),
    row([` ${'~'.repeat(BOX - 2)} `]),
    boxBottom(),
  ];
}

/** "idex-eclipse/Tessera-Ext" for GitHub raw URLs, a short form otherwise. */
function registryLabel(url) {
  if (!url) return 'unreachable';
  if (url.protocol === 'file:') return 'local file';
  if (url.hostname === 'raw.githubusercontent.com') return url.pathname.split('/').slice(1, 3).join('/');
  return url.host;
}

function statusText(r) {
  if (r.state === 'installed') return c.green(`Installed ${r.version}`);
  if (r.state === 'update') return c.yellow(`Update ${r.installedVersion} → ${r.version}`);
  if (r.state === 'local') return c.dim(`Local ${r.installedVersion}`);
  return c.red('Not installed');
}

function branchLabel(source) {
  return source.custom ? c.yellow('custom') : c.cyan(source.branch);
}

function renderMain(rows, registryUrl, source) {
  const left = ['', '  1) [Install]', '  2) [Update]', '  3) [Remove]', '', '  S) [Settings]', '  R) [Refresh]'];
  const nameWidth = Math.min(14, Math.max(0, ...rows.map((r) => r.name.length)));
  const right = [''];
  for (const r of rows.slice(0, 8)) right.push(` ${r.name.slice(0, nameWidth).padStart(nameWidth)}: ${statusText(r)}`);
  if (rows.length > 8) right.push(c.dim(` … ${rows.length - 8} more`));
  if (rows.length === 0) right.push(c.dim(registryUrl ? ' Registry is empty' : ' No plugins installed'));

  const lines = [boxTop(), title('Main Menu'), rule(MAIN_COLS, '┬')];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    lines.push(row([left[i] ?? '', right[i] ?? ''], MAIN_COLS));
  }
  lines.push(
    rule(MAIN_COLS, '┼'),
    row([` Branch: ${branchLabel(source)}`, ` Registry: ${registryUrl ? registryLabel(registryUrl) : c.red('unreachable')}`], MAIN_COLS),
    rule(MAIN_COLS, '┴'),
    row([center('Q) Quit')]),
    boxBottom(),
  );
  return lines;
}

function renderSettings(source) {
  const lines = [boxTop(), title('Settings'), rule(), row([''])];
  lines.push(row([`  1) [Branch]   ${branchLabel(source)}`]));
  if (source.custom) lines.push(row([c.yellow('     TESSERA_REGISTRY_URL is set: the branch is ignored')]));
  lines.push(
    row(['']),
    row([c.dim(`  Registry:   ${source.url}`)]),
    row([c.dim(`  Plugin API: v${HOST_PLUGIN_API}`)]),
    row([c.dim(`  Saved in:   ${CONF_FILE}`)]),
    row(['']),
    rule(),
    row([center('B) « Back')]),
    boxBottom(),
  );
  return lines;
}

/** Submenu: numbered plugin list + extra actions + "B) « Back". */
function renderList(heading, items, emptyText, extra = []) {
  const lines = [boxTop(), title(heading), rule(), row([''])];
  if (items.length === 0) lines.push(row([c.dim(`  ${emptyText}`)]));
  items.forEach((item, i) => {
    lines.push(row([`  ${i + 1}) [${item.label}]${item.note ? ` ${item.note}` : ''}`]));
    for (const part of wrap(item.description ?? '', BOX - 7, 2)) lines.push(row([c.dim(`      ${part}`)]));
  });
  if (extra.length) lines.push(row(['']), ...extra.map((e) => row([`  ${e}`])));
  lines.push(row(['']), rule(), row([center('B) « Back')]), boxBottom());
  return lines;
}

const installItems = (rows) =>
  rows.filter((r) => r.entry).map((r) => ({
    row: r,
    label: r.name,
    note: r.state === 'available' ? c.dim(r.version) : c.green(`(installed ${r.installedVersion})`),
    description: r.description,
  }));

const updateItems = (rows) =>
  rows.filter((r) => r.entry && (r.state === 'installed' || r.state === 'update')).map((r) => ({
    row: r,
    label: r.name,
    note: r.state === 'update' ? c.yellow(`${r.installedVersion} → ${r.version}`) : c.green(`${r.version} up to date`),
  }));

const removeItems = (rows) =>
  rows.filter((r) => r.state !== 'available').map((r) => ({
    row: r,
    label: r.name,
    note: c.dim(r.state === 'local' ? `${r.installedVersion} (local)` : r.installedVersion),
  }));

// --- Menu loop -----------------------------------------------------

/**
 * kiauh-like navigation: type a letter or number, press Enter.
 * Screens: main → install | update | remove → back to main.
 * The screen is not cleared, so install output stays visible above the
 * redrawn menu.
 */
async function cmdMenu() {
  const prompt = createPrompter();
  const print = (lines) => console.log(lines.join('\n'));
  const ask = async () => {
    const answer = await prompt.ask('###### Perform action: ');
    // A terminal echoes the typed line; piped input does not — echo it so
    // logs read like an interactive session.
    if (!process.stdin.isTTY) console.log(answer ?? '');
    return answer?.trim().toLowerCase() ?? null;
  };
  const invalid = () => console.log('###### Invalid input!');

  // The registry is fetched once and on R) Refresh, not on every redraw.
  let registry = null;
  async function refresh() {
    try {
      registry = await loadRegistry();
    } catch (e) {
      registry = null;
      console.error(`[tessera-ext] registry: ${e.message}`);
    }
  }
  const status = () => collectStatus(registry?.plugins ?? [], scanInstalled());
  const needRegistry = () => {
    if (!registry) console.error('[tessera-ext] registry is unreachable — press R in the main menu to retry');
    return Boolean(registry);
  };

  let changed = false;
  /** Runs one action; a failure (bad hash, network) must not close the menu. */
  async function act(fn) {
    try {
      if (await fn()) changed = true;
    } catch (e) {
      console.error(`[tessera-ext] ${e.message}`);
    }
  }
  const installEntry = async (entry, opts) => {
    const done = await install(entry, registry.url, opts);
    if (done) scanExtensions();
    return done;
  };
  const confirm = async (question) => {
    const raw = await prompt.ask(`###### ${question} (y/N): `);
    if (!process.stdin.isTTY) console.log(raw ?? '');
    const a = raw?.trim().toLowerCase();
    return a === 'y' || a === 'yes';
  };

  /** Lists the registry's branches and saves the choice; true when it changed. */
  async function pickBranch() {
    const current = registrySource().branch;
    const branches = remoteBranches();
    if (branches.length) {
      console.log(`Branches of ${REGISTRY_REPO}:`);
      branches.forEach((b, i) => console.log(`  ${String(i + 1).padStart(2)}) ${b}${b === current ? ` ${c.green('(current)')}` : ''}`));
    } else {
      console.log('[tessera-ext] cannot list branches (offline?) — type the name');
    }
    const raw = await prompt.ask(`###### Branch (number or name, Enter = keep ${current}): `);
    if (!process.stdin.isTTY) console.log(raw ?? '');
    const value = raw?.trim();
    if (!value) return false;
    const name = /^\d+$/.test(value) && branches.length ? branches[Number(value) - 1] : value;
    if (!name) {
      invalid();
      return false;
    }
    if (name === current) return false;
    setBranch(name, branches);
    console.log(`###### Branch: ${name}`);
    return true;
  }

  await refresh();
  let screen = 'main';
  print(renderHeader());

  try {
    for (;;) {
      const rows = status();

      if (screen === 'main') {
        print(renderMain(rows, registry?.url, registrySource()));
        const a = await ask();
        if (a === null || a === 'q') break;
        if (a === '1') screen = 'install';
        else if (a === '2') screen = 'update';
        else if (a === '3') screen = 'remove';
        else if (a === 's') screen = 'settings';
        else if (a === 'r') await refresh();
        else invalid();
        continue;
      }

      if (screen === 'settings') {
        print(renderSettings(registrySource()));
        const a = await ask();
        if (a === null) break;
        if (a === 'b') screen = 'main';
        // A new branch = another registry.json: fetch it right away.
        else if (a === '1') await act(async () => ((await pickBranch()) ? (await refresh(), false) : false));
        else invalid();
        continue;
      }

      const items = screen === 'install' ? installItems(rows)
        : screen === 'update' ? updateItems(rows)
          : removeItems(rows);
      const heading = { install: 'Installation Menu', update: 'Update Menu', remove: 'Remove Menu' }[screen];
      const empty = screen === 'install'
        ? (registry ? 'Registry is empty' : 'Registry is unreachable')
        : 'No plugins installed';
      print(renderList(heading, items, empty, screen === 'update' && items.length ? ['A) [Update all]'] : []));

      const a = await ask();
      if (a === null) break;
      if (a === 'b') {
        screen = 'main';
        continue;
      }
      if (screen === 'update' && a === 'a' && items.length) {
        if (needRegistry()) await act(() => cmdUpdate(null, { all: true, quiet: true }));
        continue;
      }
      const item = /^\d+$/.test(a) ? items[Number(a) - 1] : undefined;
      if (!item) {
        invalid();
        continue;
      }
      const r = item.row;

      if (screen === 'install') {
        if (!needRegistry()) continue;
        if (r.state === 'available') await act(() => installEntry(r.entry));
        else if (await confirm(`${r.name} is installed. Reinstall?`)) await act(() => installEntry(r.entry, { force: true }));
      } else if (screen === 'update') {
        if (!needRegistry()) continue;
        if (r.state === 'installed') console.log(`###### ${r.name} is up to date`);
        else await act(() => installEntry(r.entry));
      } else if (await confirm(`Remove ${r.name}?`)) {
        await act(() => {
          removeInstalled(r.id);
          return true;
        });
      }
    }
  } finally {
    prompt.close();
  }
  if (changed) console.log(UI_HINT);
  console.log('###### Happy printing!');
}

const USAGE = `Usage: tessera-ext [command]
  (no command)          interactive menu
  list                  registry plugins and installed state
  install <name>        install from the registry ("spoolman" or "tessera/spoolman")
  update [<name>|--all] update one or all registry plugins
  remove <name>         delete an installed plugin
  sync                  rebuild extensions/index.json
  branch [<name>]       show / switch the registry branch (saved in ${CONF_FILE})
Options: --force (replace a hand-installed plugin / reinstall the same version)`;

function cmdBranch(name) {
  const source = registrySource();
  if (!name) {
    console.log(source.custom
      ? `registry: ${source.url} (TESSERA_REGISTRY_URL; branch ${source.branch} is ignored)`
      : `branch:   ${source.branch}\nregistry: ${source.url}`);
    const branches = remoteBranches();
    if (branches.length) console.log(`available: ${branches.join(', ')}`);
    return;
  }
  setBranch(name, remoteBranches());
  console.log(`branch: ${name} (saved in ${CONF_FILE})`);
}

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
    case 'branch': return cmdBranch(arg);
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
