#!/usr/bin/env python3
"""Tessera extensions manager: CLI and the service behind "install from the UI".

Installs prebuilt plugins from the plugin registry into extensions/ and
regenerates extensions/index.json. Standard library only, no virtualenv.

Usage (on the printer usually via the `tessera-ext` command, deploy/install-ext.sh):
  tessera-ext.py              interactive menu (in a terminal)
  tessera-ext.py list
  tessera-ext.py install <name> [--force]
  tessera-ext.py update [<name> | --all]
  tessera-ext.py remove <name>
  tessera-ext.py sync
  tessera-ext.py branch [<name>]   show / switch the registry branch
  tessera-ext.py serve [--socket <path>]   HTTP API on a unix socket (systemd unit)
<name> is the plugin id ("tessera/spoolman") or its short name ("spoolman").

Registry: registry/registry.json of the Tessera-Ext repository on the chosen
branch (default main; saved in ~/.config/tessera/tessera-ext.conf).
Env:
  TESSERA_EXTENSIONS_DIR — extensions directory (default: ../extensions)
  TESSERA_REGISTRY_URL   — registry.json (https://, file:// or local path); overrides the branch
  TESSERA_EXT_BRANCH     — branch for this run only
  TESSERA_MOONRAKER      — Moonraker host:port that authorizes `serve` requests

Nothing is built or executed on the host: the registry ships prebuilt archives,
each archive is verified against sha256 from registry.json before it is
unpacked. Only plain files and directories are accepted from archives.
`serve` accepts nothing but a plugin id: the registry address is never taken
from a request, and it uses https only.
"""

import datetime
import hashlib
import http.client
import http.server
import json
import os
import pathlib
import posixpath
import re
import shutil
import socket
import socketserver
import sys
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zlib

try:
    import fcntl
except ImportError:  # Windows dev checkout: no service there, CLI works without the lock
    fcntl = None

# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------

REGISTRY_REPO = 'idex-eclipse/Tessera-Ext'
EXTENSIONS_DIR = os.path.abspath(
    os.environ.get('TESSERA_EXTENSIONS_DIR')
    or os.path.join(os.path.dirname(os.path.realpath(__file__)), '..', 'extensions')
)
CONF_FILE = os.path.join(
    os.environ.get('XDG_CONFIG_HOME') or os.path.join(os.path.expanduser('~'), '.config'),
    'tessera',
    'tessera-ext.conf',
)
# Written next to manifest.json of registry plugins.
ORIGIN_FILE = '.tessera-origin.json'
LOCK_FILE = '.lock'

# Major version of the plugin contract (PluginApi + CE contract) this host implements.
HOST_PLUGIN_API = 1

MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_UNPACKED_BYTES = 100 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 5000
NETWORK_TIMEOUT = 30

BRANCH_RE = re.compile(r'[A-Za-z0-9._/-]{1,100}')
DIR_NAME_RE = re.compile(r'[a-z0-9][a-z0-9._-]{0,63}', re.IGNORECASE)
SHA256_RE = re.compile(r'[0-9a-fA-F]{64}')
URL_SCHEME_RE = re.compile(r'[a-z][a-z0-9+.-]*://', re.IGNORECASE)
# Registry data ends up in a terminal: no escape sequences from there.
CONTROL_RE = re.compile('[\x00-\x1f\x7f-\x9f]')

UI_HINT = 'Open the UI: Settings → Plugins → Refresh, then Install / Update (F5 if the plugin was updated).'

# `serve` turns this off: file:// and local paths are for the CLI only.
local_sources_allowed = True


class ExtError(Exception):
    """An expected failure: its text is shown to the user as is."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def clean(value):
    return CONTROL_RE.sub('', str(value))


# ------------------------------------------------------------------
# Registry location and branch
# ------------------------------------------------------------------

def read_conf():
    """KEY=value lines; the file is data, never code."""
    conf = {}
    try:
        with open(CONF_FILE, encoding='utf-8') as f:
            for line in f:
                m = re.match(r'([A-Z_]+)=(.*)$', line.rstrip('\r\n'))
                if m:
                    conf[m.group(1)] = m.group(2)
    except OSError:
        pass  # no settings yet
    return conf


def save_branch(branch):
    os.makedirs(os.path.dirname(CONF_FILE), exist_ok=True)
    with open(CONF_FILE, 'w', encoding='utf-8') as f:
        f.write(f'# Tessera plugin manager settings — written by deploy/tessera-ext.py\nBRANCH={branch}\n')


def valid_branch(name):
    return bool(BRANCH_RE.fullmatch(name)) and '..' not in name


def set_branch(name, known):
    """Validates and saves the branch; `known` = remote branches ([] = cannot check)."""
    if not valid_branch(name):
        raise ExtError(f'invalid branch name "{clean(name)}"')
    if known and name not in known:
        raise ExtError(f'branch "{name}" not found in {REGISTRY_REPO}. Available: {", ".join(known)}')
    save_branch(name)
    # The saved choice wins over the per-run variable for the rest of this run.
    os.environ.pop('TESSERA_EXT_BRANCH', None)


def registry_source():
    """{branch, url, custom}: custom = TESSERA_REGISTRY_URL overrides the branch."""
    if local_sources_allowed:
        branch = os.environ.get('TESSERA_EXT_BRANCH') or read_conf().get('BRANCH') or 'main'
        custom = os.environ.get('TESSERA_REGISTRY_URL')
        if custom:
            return {'branch': branch, 'url': custom, 'custom': True}
    else:
        branch = read_conf().get('BRANCH') or 'main'
    if not valid_branch(branch):
        raise ExtError(f'invalid registry branch "{clean(branch)}" in {CONF_FILE}')
    return {
        'branch': branch,
        'url': f'https://raw.githubusercontent.com/{REGISTRY_REPO}/{branch}/registry/registry.json',
        'custom': False,
    }


def remote_branches():
    """Branch names of the registry repository on GitHub ([] when offline)."""
    try:
        data = json.loads(fetch_bytes(f'https://api.github.com/repos/{REGISTRY_REPO}/branches?per_page=100'))
        return sorted(b['name'] for b in data)
    except (ExtError, ValueError, TypeError, KeyError):
        return []


# ------------------------------------------------------------------
# IO helpers
# ------------------------------------------------------------------

class HttpsOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != 'https':
            raise ExtError(f'Refusing redirect to non-https URL: {newurl}')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def to_url(ref):
    if URL_SCHEME_RE.match(ref):
        return ref
    return pathlib.Path(ref).resolve().as_uri()


def fetch_bytes(url):
    scheme = urllib.parse.urlsplit(url).scheme.lower()
    if scheme == 'file':
        if not local_sources_allowed:
            raise ExtError(f'Refusing local source: {url}')
        path = urllib.request.url2pathname(urllib.parse.urlsplit(url).path)
        try:
            if os.path.getsize(path) > MAX_ARCHIVE_BYTES:
                raise ExtError(f'File too large: {url}')
            with open(path, 'rb') as f:
                return f.read()
        except OSError as e:
            raise ExtError(f'Cannot read {url}: {e}') from e
    if scheme != 'https':
        raise ExtError(f'Refusing non-https URL: {url}')

    opener = urllib.request.build_opener(HttpsOnlyRedirect)
    request = urllib.request.Request(url, headers={'User-Agent': 'tessera-ext'})
    try:
        with opener.open(request, timeout=NETWORK_TIMEOUT) as res:
            data = res.read(MAX_ARCHIVE_BYTES + 1)
    except urllib.error.HTTPError as e:
        raise ExtError(f'HTTP {e.code} for {url}', 500) from e
    except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
        raise ExtError(f'Cannot fetch {url}: {e}', 500) from e
    if len(data) > MAX_ARCHIVE_BYTES:
        raise ExtError(f'Response too large: {url}')
    return data


def load_registry():
    url = to_url(registry_source()['url'])
    try:
        data = json.loads(fetch_bytes(url).decode('utf-8'))
    except ValueError as e:
        raise ExtError(f'Invalid registry at {url}: {e}', 500) from e
    if not isinstance(data, dict) or data.get('schema') != 1 or not isinstance(data.get('plugins'), list):
        raise ExtError(f'Unsupported registry format at {url} (expected schema 1)', 500)
    for p in data['plugins']:
        if (not isinstance(p, dict) or
                not all(isinstance(p.get(k), str) for k in ('id', 'version', 'url', 'sha256', 'dir')) or
                not DIR_NAME_RE.fullmatch(p['dir']) or
                not SHA256_RE.fullmatch(p['sha256'])):
            raise ExtError(f'Invalid registry entry: {clean(json.dumps(p))}', 500)
    return {'url': url, 'plugins': data['plugins']}


def read_json_safe(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def plugin_dirs(extensions_dir=None):
    """Sorted folders of extensions/; hidden ones are the installer's staging/backup."""
    with os.scandir(extensions_dir or EXTENSIONS_DIR) as it:
        return sorted(
            d.name for d in it
            if d.is_dir(follow_symlinks=False) and not d.name.startswith('.')
        )


def scan_installed():
    """manifest.id → {dir, version, origin} for everything in extensions/."""
    result = {}
    if not os.path.isdir(EXTENSIONS_DIR):
        return result
    for name in plugin_dirs():
        manifest = read_json_safe(os.path.join(EXTENSIONS_DIR, name, 'manifest.json'))
        if not isinstance(manifest, dict) or not isinstance(manifest.get('id'), str):
            continue
        origin = read_json_safe(os.path.join(EXTENSIONS_DIR, name, ORIGIN_FILE))
        result[manifest['id']] = {
            'dir': name,
            'version': manifest.get('version'),
            'origin': origin,
        }
    return result


def write_text_atomic(path, text):
    # Not mkstemp: its mode 0600 would hide the file from nginx.
    tmp = f'{path}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def scan_extensions():
    """Generates extensions/index.json (same format as tools/extensions-sync.cjs)."""
    if not os.path.isdir(EXTENSIONS_DIR):
        raise ExtError(f'Extensions directory not found: {EXTENSIONS_DIR}')

    entries = []
    for name in plugin_dirs():
        manifest_path = os.path.join(EXTENSIONS_DIR, name, 'manifest.json')
        if not os.path.exists(manifest_path):
            print(f'Skipping {name}: no manifest.json', file=sys.stderr)
            continue
        try:
            with open(manifest_path, encoding='utf-8') as f:
                manifest = json.load(f)
            if not isinstance(manifest, dict):
                raise ValueError('not an object')
        except (OSError, ValueError) as e:
            print(f'Failed to parse {manifest_path}: {e}', file=sys.stderr)
            continue

        origin = None
        origin_path = os.path.join(EXTENSIONS_DIR, name, ORIGIN_FILE)
        if os.path.exists(origin_path):
            origin = read_json_safe(origin_path)
            if origin is None:
                print(f'Ignoring broken {origin_path}', file=sys.stderr)

        entry = {}
        if 'id' in manifest:
            entry['id'] = manifest['id']
        if manifest.get('name') or 'id' in manifest:
            entry['name'] = manifest.get('name') or manifest.get('id')
        entry['version'] = manifest.get('version') or '?'
        entry['manifestUrl'] = f'/extensions/{name}/manifest.json'
        if manifest.get('icon'):
            entry['icon'] = manifest['icon']
        if manifest.get('description'):
            entry['description'] = manifest['description']
        entry['origin'] = 'registry' if origin is not None else 'local'
        if isinstance(origin, dict) and origin.get('sha256'):
            entry['sha256'] = origin['sha256']
        entries.append(entry)

    index_path = os.path.join(EXTENSIONS_DIR, 'index.json')
    write_text_atomic(index_path, json.dumps(entries, indent=2, ensure_ascii=False))
    print(f'Generated {index_path} with {len(entries)} plugins')
    return entries


class ExtensionsLock:
    """One writer at a time: the CLI and the service share extensions/."""

    def __enter__(self):
        os.makedirs(EXTENSIONS_DIR, exist_ok=True)
        self.file = open(os.path.join(EXTENSIONS_DIR, LOCK_FILE), 'w')
        if fcntl:
            fcntl.flock(self.file, fcntl.LOCK_EX)
        recover_interrupted()
        return self

    def __exit__(self, *exc):
        self.file.close()


def recover_interrupted():
    """A killed install leaves .staging-*/.old-*: bring the previous version back."""
    with os.scandir(EXTENSIONS_DIR) as it:
        leftovers = [d.name for d in it if d.is_dir(follow_symlinks=False)]
    for name in leftovers:
        path = os.path.join(EXTENSIONS_DIR, name)
        if name.startswith('.old-'):
            target = os.path.join(EXTENSIONS_DIR, name[len('.old-'):])
            if os.path.exists(target):
                shutil.rmtree(path, ignore_errors=True)
            else:
                os.rename(path, target)
        elif name.startswith('.staging-'):
            shutil.rmtree(path, ignore_errors=True)


# ------------------------------------------------------------------
# Archive handling
# ------------------------------------------------------------------

def gunzip_limited(data, out):
    """gzip → file, at most MAX_UNPACKED_BYTES: tarfile alone would read a bomb into memory."""
    decoder = zlib.decompressobj(wbits=31)
    total = 0
    try:
        chunk = decoder.decompress(data, 1024 * 1024)
        while chunk:
            total += len(chunk)
            if total > MAX_UNPACKED_BYTES:
                raise ExtError(f'Archive unpacks to more than {MAX_UNPACKED_BYTES} bytes')
            out.write(chunk)
            chunk = decoder.decompress(decoder.unconsumed_tail, 1024 * 1024)
    except zlib.error as e:
        raise ExtError(f'Archive is not a valid gzip file: {e}') from e
    if not decoder.eof:
        raise ExtError('Archive is truncated')
    out.seek(0)


def safe_member_path(name):
    """Normalized relative path; rejects absolute paths, `..` and odd characters."""
    if '\\' in name or CONTROL_RE.search(name):
        raise ExtError(f'Archive contains unsafe path: {clean(name)}')
    if posixpath.isabs(name) or '..' in name.split('/'):
        raise ExtError(f'Archive contains unsafe path: {clean(name)}')
    return posixpath.normpath(name)


def extract_archive(data, dest):
    """Unpacks into dest. Modes and owners of the archive are ignored, links are rejected."""
    with tempfile.TemporaryFile(dir=EXTENSIONS_DIR) as plain:
        gunzip_limited(data, plain)
        try:
            with tarfile.open(fileobj=plain, mode='r:') as tar:
                members = tar.getmembers()
                if len(members) > MAX_ARCHIVE_ENTRIES:
                    raise ExtError(f'Archive has more than {MAX_ARCHIVE_ENTRIES} entries')
                for m in members:
                    if not (m.isdir() or m.isreg()) or m.issparse():
                        raise ExtError(f'Archive contains unsupported entry: {clean(m.name)}')
                    safe_member_path(m.name)

                for m in members:
                    target = os.path.join(dest, *safe_member_path(m.name).split('/'))
                    if m.isdir():
                        os.makedirs(target, mode=0o755, exist_ok=True)
                        continue
                    os.makedirs(os.path.dirname(target), mode=0o755, exist_ok=True)
                    source = tar.extractfile(m)
                    with open(target, 'wb') as out:
                        shutil.copyfileobj(source, out)
                    os.chmod(target, 0o644)
        except (tarfile.TarError, EOFError) as e:
            raise ExtError(f'Archive is not a valid tar file: {e}') from e

    # makedirs obeys the umask, and nginx has to read these folders under any umask.
    for root, dirs, _ in os.walk(dest):
        for name in dirs:
            os.chmod(os.path.join(root, name), 0o755)


# ------------------------------------------------------------------
# Commands
# ------------------------------------------------------------------

def archive_url(entry, registry_url):
    url = urllib.parse.urljoin(registry_url, entry['url'])
    scheme = urllib.parse.urlsplit(url).scheme.lower()
    # An https registry must not point at files of this machine.
    if scheme == 'file' and urllib.parse.urlsplit(registry_url).scheme.lower() != 'file':
        raise ExtError(f'Refusing local archive from a remote registry: {url}')
    return url


def install(entry, registry_url, force=False):
    """Must run under ExtensionsLock. True when extensions/ changed."""
    plugin_api = entry.get('pluginApi', 1)
    if isinstance(plugin_api, bool) or not isinstance(plugin_api, int):
        raise ExtError(f'Invalid pluginApi of {clean(entry["id"])}: {clean(plugin_api)}')
    if plugin_api > HOST_PLUGIN_API and not force:
        raise ExtError(
            f'{clean(entry["id"])}@{clean(entry["version"])} needs plugin API {plugin_api}, '
            f'host provides {HOST_PLUGIN_API}. Update Tessera first.'
        )

    current = scan_installed().get(entry['id'])
    target = os.path.join(EXTENSIONS_DIR, entry['dir'])

    if current and current['dir'] != entry['dir']:
        raise ExtError(f'{clean(entry["id"])} is already installed in extensions/{current["dir"]}; remove it first.', 409)
    if not current and os.path.exists(target):
        raise ExtError(f'extensions/{entry["dir"]} already exists and is not {clean(entry["id"])}.', 409)
    if current and not current['origin'] and not force:
        raise ExtError(f'{clean(entry["id"])} in extensions/{entry["dir"]} was installed manually; use --force to replace it.', 409)
    if current and current['version'] == entry['version'] and not force:
        print(f'{clean(entry["id"])}@{clean(entry["version"])} is up to date')
        return False

    url = archive_url(entry, registry_url)
    print(f'Downloading {clean(entry["id"])}@{clean(entry["version"])} from {clean(url)}')
    data = fetch_bytes(url)

    actual = hashlib.sha256(data).hexdigest()
    if actual != entry['sha256'].lower():
        raise ExtError(f'sha256 mismatch for {clean(entry["id"])}: expected {entry["sha256"]}, got {actual}')

    os.makedirs(EXTENSIONS_DIR, exist_ok=True)
    # staging inside extensions/: rename into target is atomic (same filesystem)
    staging = tempfile.mkdtemp(prefix=f'.staging-{entry["dir"]}-', dir=EXTENSIONS_DIR)
    # mkdtemp makes it 0700, and nginx has to read the renamed folder.
    os.chmod(staging, 0o755)
    backup = os.path.join(EXTENSIONS_DIR, f'.old-{entry["dir"]}')

    try:
        extract_archive(data, staging)

        manifest = read_json_safe(os.path.join(staging, 'manifest.json'))
        if not isinstance(manifest, dict):
            raise ExtError('Archive has no valid manifest.json at its root')
        if manifest.get('id') != entry['id'] or manifest.get('version') != entry['version']:
            raise ExtError(
                f'Archive manifest {clean(manifest.get("id"))}@{clean(manifest.get("version"))} '
                f'does not match registry {clean(entry["id"])}@{clean(entry["version"])}'
            )

        write_text_atomic(
            os.path.join(staging, ORIGIN_FILE),
            json.dumps({
                'registry': registry_url,
                'id': entry['id'],
                'version': entry['version'],
                'sha256': actual,
                'installedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
            }, indent=2),
        )

        shutil.rmtree(backup, ignore_errors=True)
        if os.path.exists(target):
            os.rename(target, backup)
        os.rename(staging, target)
        shutil.rmtree(backup, ignore_errors=True)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        if not os.path.exists(target) and os.path.exists(backup):
            os.rename(backup, target)
        raise

    print(f'Installed {clean(entry["id"])}@{clean(entry["version"])} → extensions/{entry["dir"]}')
    return True


def collect_status(plugins, installed):
    """
    One row per known plugin: registry entries first, then installed plugins
    the registry does not know (put there by hand, or dropped from the registry).
    state: 'available' | 'installed' | 'update' | 'local'
    """
    rows = []
    known = set()
    for p in plugins:
        known.add(p['id'])
        cur = installed.get(p['id'])
        if not cur:
            state = 'available'
        elif cur['version'] == p['version']:
            state = 'installed'
        else:
            state = 'update'
        rows.append({
            'id': p['id'],
            'name': clean(p.get('name') or p['id']),
            'version': clean(p['version']),
            'installed_version': clean(cur['version']) if cur else None,
            'state': state,
            'description': clean(p.get('description') or ''),
            'entry': p,
            'dir': cur['dir'] if cur else p['dir'],
            'managed': bool(cur and cur['origin']),
        })
    for pid, cur in installed.items():
        if pid in known:
            continue
        rows.append({
            'id': pid,
            'name': clean(pid),
            'version': clean(cur['version']),
            'installed_version': clean(cur['version']),
            'state': 'local',
            'description': 'not in registry any more' if cur['origin'] else 'installed by hand',
            'entry': None,
            'dir': cur['dir'],
            'managed': bool(cur['origin']),
        })
    return rows


def state_label(row):
    if row['state'] == 'installed':
        return 'installed'
    if row['state'] == 'update':
        return f'update {row["installed_version"]} → {row["version"]}'
    if row['state'] == 'local':
        return 'local'
    return ''


def resolve_id(query, plugins, installed):
    """
    Accepts the full id ("tessera/spoolman"), the folder name ("spoolman") or
    the last id segment, case-insensitive. Ambiguity is an error, not a guess.
    """
    if not query:
        return None
    known = {}  # id → dir
    for p in plugins:
        known[p['id']] = p['dir']
    for pid, cur in installed.items():
        known.setdefault(pid, cur['dir'])
    if query in known:
        return query

    q = query.lower()
    matches = [
        pid for pid, d in known.items()
        if pid.lower() == q or d.lower() == q or pid.split('/')[-1].lower() == q
    ]
    if len(matches) == 1:
        return matches[0]
    if matches:
        raise ExtError(f'"{clean(query)}" is ambiguous: {", ".join(clean(m) for m in matches)}')
    raise ExtError(f'"{clean(query)}" not found. Known: {", ".join(clean(k) for k in known) or "none"}')


def cmd_list():
    registry = load_registry()
    for row in collect_status(registry['plugins'], scan_installed()):
        state = state_label(row)
        print(f'{clean(row["id"])}@{row["version"]}  {row["name"]}{f"  [{state}]" if state else ""}')
        if row['description']:
            print(f'    {row["description"]}')


def cmd_install(query, force=False):
    if not query:
        raise ExtError('Usage: install <id> [--force]')
    registry = load_registry()
    with ExtensionsLock():
        pid = resolve_id(query, registry['plugins'], scan_installed())
        entry = next((p for p in registry['plugins'] if p['id'] == pid), None)
        if not entry:
            raise ExtError(f'{clean(pid)} is not in registry {registry["url"]}')
        if install(entry, registry['url'], force):
            scan_extensions()
            print(UI_HINT)


def cmd_update(query, update_all=False, force=False, quiet=False):
    registry = load_registry()
    changed = False
    with ExtensionsLock():
        installed = scan_installed()
        if update_all or not query:
            ids = [pid for pid, cur in installed.items() if cur['origin']]
        else:
            ids = [resolve_id(query, registry['plugins'], installed)]

        for pid in ids:
            entry = next((p for p in registry['plugins'] if p['id'] == pid), None)
            if not entry:
                print(f'{clean(pid)} not found in registry, skipped', file=sys.stderr)
                continue
            if pid not in installed:
                print(f'{clean(pid)} is not installed, skipped (use install)', file=sys.stderr)
                continue
            changed = install(entry, registry['url'], force) or changed
        if changed:
            scan_extensions()
    if changed and not quiet:
        print(UI_HINT)
    return changed


def remove_installed(pid):
    """Must run under ExtensionsLock."""
    cur = scan_installed().get(pid)
    if not cur:
        raise ExtError(f'{clean(pid)} is not installed')
    shutil.rmtree(os.path.join(EXTENSIONS_DIR, cur['dir']))
    print(f'Removed {clean(pid)} (extensions/{cur["dir"]})')
    scan_extensions()


def cmd_remove(query):
    if not query:
        raise ExtError('Usage: remove <id>')
    # Removal must work offline: fall back to installed plugins only.
    try:
        plugins = load_registry()['plugins']
    except ExtError:
        plugins = []
    with ExtensionsLock():
        remove_installed(resolve_id(query, plugins, scan_installed()))


def cmd_branch(name):
    source = registry_source()
    if not name:
        if source['custom']:
            print(f'registry: {source["url"]} (TESSERA_REGISTRY_URL; branch {source["branch"]} is ignored)')
        else:
            print(f'branch:   {source["branch"]}\nregistry: {source["url"]}')
        branches = remote_branches()
        if branches:
            print(f'available: {", ".join(branches)}')
        return
    set_branch(name, remote_branches())
    print(f'branch: {name} (saved in {CONF_FILE})')


# ------------------------------------------------------------------
# Service: HTTP API for the UI
# ------------------------------------------------------------------

API_PREFIX = '/tessera-api/v1/'
MAX_REQUEST_BODY = 4096
MAX_DRAINED_BODY = 64 * 1024
IDLE_EXIT_SECONDS = 300
PLUGIN_ID_RE = re.compile(r'[^\x00-\x1f\x7f]{1,200}')
MOONRAKER_RE = re.compile(r'[A-Za-z0-9.\-:\[\]]{1,255}')
# nginx sets them: the socket is reachable by nginx only, see tessera-ext.socket.
FORWARDED_AUTH_HEADERS = ('Authorization', 'X-Api-Key', 'X-Real-IP', 'X-Forwarded-For')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check_moonraker_auth(headers):
    """Asks Moonraker if this client may act: JWT, API key and trusted_clients are all its job."""
    if not headers.get('X-Real-IP'):
        # Without it Moonraker would see the service itself, a local (often trusted) client.
        raise ExtError('Missing X-Real-IP: requests must come through nginx', 403)

    moonraker = os.environ.get('TESSERA_MOONRAKER') or '127.0.0.1:7125'
    if not MOONRAKER_RE.fullmatch(moonraker):
        raise ExtError('Invalid TESSERA_MOONRAKER', 500)

    request = urllib.request.Request(f'http://{moonraker}/access/user')
    for name in FORWARDED_AUTH_HEADERS:
        value = headers.get(name)
        if value:
            request.add_header(name, value)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
    try:
        with opener.open(request, timeout=10) as res:
            authorized = res.status == 200
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise ExtError('Unauthorized: log in to this printer', 401) from e
        raise ExtError(f'Moonraker answered HTTP {e.code}', 503) from e
    except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
        raise ExtError(f'Moonraker is unreachable: {e}', 503) from e
    if not authorized:
        raise ExtError('Unauthorized: log in to this printer', 401)


def check_same_origin(headers):
    origin = headers.get('Origin')
    if origin and urllib.parse.urlsplit(origin).netloc.lower() != (headers.get('Host') or '').lower():
        raise ExtError('Cross-origin request refused', 403)


def plugin_view(row):
    """A row of collect_status() for the UI."""
    return {
        'id': clean(row['id']),
        'name': row['name'],
        'version': row['version'],
        'installedVersion': row['installed_version'],
        'state': row['state'],
        'description': row['description'],
        # A folder put there by hand is not the UI's to replace or delete.
        'managed': row['managed'],
        'manifestUrl': f'/extensions/{row["dir"]}/manifest.json',
    }


def api_status():
    installed = scan_installed()
    try:
        registry = load_registry()
    except ExtError as e:
        rows = collect_status([], installed)
        return {'pluginApi': HOST_PLUGIN_API, 'registryError': str(e), 'plugins': [plugin_view(r) for r in rows]}
    rows = collect_status(registry['plugins'], installed)
    return {'pluginApi': HOST_PLUGIN_API, 'registryError': None, 'plugins': [plugin_view(r) for r in rows]}


def api_result(pid, changed):
    cur = scan_installed().get(pid)
    return {
        'id': clean(pid),
        'changed': changed,
        'version': clean(cur['version']) if cur else None,
        'manifestUrl': f'/extensions/{cur["dir"]}/manifest.json' if cur else None,
    }


def registry_entry(pid):
    registry = load_registry()
    entry = next((p for p in registry['plugins'] if p['id'] == pid), None)
    if not entry:
        raise ExtError(f'{clean(pid)} is not in the registry')
    return entry, registry['url']


def api_install(pid):
    entry, url = registry_entry(pid)
    with ExtensionsLock():
        changed = install(entry, url)
        if changed:
            scan_extensions()
        return api_result(pid, changed)


def api_update(pid):
    entry, url = registry_entry(pid)
    with ExtensionsLock():
        if pid not in scan_installed():
            raise ExtError(f'{clean(pid)} is not installed', 409)
        changed = install(entry, url)
        if changed:
            scan_extensions()
        return api_result(pid, changed)


def api_remove(pid):
    with ExtensionsLock():
        cur = scan_installed().get(pid)
        if not cur:
            raise ExtError(f'{clean(pid)} is not installed', 409)
        if not cur['origin']:
            raise ExtError(f'{clean(pid)} in extensions/{cur["dir"]} was installed manually; remove it with tessera-ext.', 409)
        remove_installed(pid)
        return {'id': clean(pid), 'changed': True}


API_ACTIONS = {'install': api_install, 'update': api_update, 'remove': api_remove}


class ApiHandler(http.server.BaseHTTPRequestHandler):
    # One thread: a client that stops sending must not hold up the others.
    timeout = 30

    def log_message(self, format, *args):  # pylint: disable=redefined-builtin
        # The default implementation reads the client address, a unix socket has none.
        # A request that timed out before its first line has no command or path yet.
        print(f'{getattr(self, "command", None) or "-"} {getattr(self, "path", "-")}: {format % args}', file=sys.stderr)

    def send_json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)

    def respond(self, handler):
        try:
            self.send_json(200, handler())
        except ExtError as e:
            self.send_json(e.status, {'error': str(e)})
        except Exception as e:  # pylint: disable=broad-except
            print(f'[tessera-ext] {e!r}', file=sys.stderr)
            self.send_json(500, {'error': 'Internal error, see: journalctl -u tessera-ext'})

    def read_body(self):
        """
        Comes before any refusal: closing a socket with unread data breaks the
        connection, and nginx would answer 502 instead of that refusal.
        """
        try:
            length = int(self.headers.get('Content-Length') or '')
        except ValueError as e:
            raise ExtError('Content-Length required', 411) from e
        if length < 0:
            raise ExtError('Invalid Content-Length')
        # nginx limits the body to client_max_body_size, far below this.
        data = self.rfile.read(min(length, MAX_DRAINED_BODY))
        if length > MAX_REQUEST_BODY:
            raise ExtError('Request body too large', 413)
        return data

    def parse_plugin_id(self, data):
        if (self.headers.get('Content-Type') or '').split(';')[0].strip().lower() != 'application/json':
            # A form on another site cannot send this type without a CORS preflight.
            raise ExtError('Content-Type must be application/json', 415)
        try:
            body = json.loads(data.decode('utf-8'))
        except ValueError as e:
            raise ExtError('Request body must be JSON') from e
        # A plugin id and nothing else: no URLs, paths or force from a request.
        if not isinstance(body, dict) or set(body) != {'id'} or not isinstance(body['id'], str):
            raise ExtError('Request body must be {"id": "<plugin id>"}')
        if not PLUGIN_ID_RE.fullmatch(body['id']):
            raise ExtError('Invalid plugin id')
        return body['id']

    def do_GET(self):
        def handler():
            if self.path != f'{API_PREFIX}status':
                raise ExtError('Not found', 404)
            check_same_origin(self.headers)
            check_moonraker_auth(self.headers)
            return api_status()
        self.respond(handler)

    def do_POST(self):
        def handler():
            data = self.read_body()
            if not self.path.startswith(API_PREFIX) or self.path[len(API_PREFIX):] not in API_ACTIONS:
                raise ExtError('Not found', 404)
            check_same_origin(self.headers)
            pid = self.parse_plugin_id(data)
            check_moonraker_auth(self.headers)
            return API_ACTIONS[self.path[len(API_PREFIX):]](pid)
        self.respond(handler)


class ApiServer(socketserver.UnixStreamServer):
    def __init__(self, socket_path=None):
        super().__init__(socket_path or '', ApiHandler, bind_and_activate=False)
        self.idle = False
        if socket_path:
            if os.path.exists(socket_path):
                os.unlink(socket_path)
            self.server_bind()
            self.server_activate()
        else:
            # Socket activation: systemd passes the listening socket as fd 3.
            self.socket.close()
            self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM, fileno=3)

    def handle_timeout(self):
        self.idle = True


def cmd_serve(socket_path=None, idle_seconds=IDLE_EXIT_SECONDS):
    global local_sources_allowed  # pylint: disable=global-statement
    local_sources_allowed = False
    os.umask(0o022)

    if not socket_path and os.environ.get('LISTEN_FDS') != '1':
        raise ExtError('serve expects a systemd socket (LISTEN_FDS=1) or --socket <path>')

    with ApiServer(socket_path) as server:
        # Exits when idle, systemd starts it again on the next connection.
        server.timeout = idle_seconds
        while not server.idle:
            server.handle_request()


# ------------------------------------------------------------------
# Interactive menu
# ------------------------------------------------------------------

BOX = 55  # inner width of every box: 57 columns with the borders, like kiauh
MAIN_COLS = (18, 36)  # two-column layout of the main menu: actions | status
ANSI_RE = re.compile(r'\x1b\[[0-9;]*m')


def paint(code):
    def apply(s):
        if sys.stdout.isatty() and not os.environ.get('NO_COLOR'):
            return f'\x1b[{code}m{s}\x1b[0m'
        return s
    return apply


GREEN, RED, YELLOW, CYAN, DIM = paint(32), paint(31), paint(33), paint(36), paint(2)


def visible(s):
    return len(ANSI_RE.sub('', s))


def fit(s, width):
    """Pads to `width` visible columns; too long → plain text cut with '…'."""
    if visible(s) > width:
        s = ANSI_RE.sub('', s)[:width - 1] + '…'
    return s + ' ' * (width - visible(s))


def wrap(text, width, max_lines):
    """Word-wraps plain text into at most `max_lines` lines; the rest is cut by row()."""
    out = []
    line = ''
    for word in text.split():
        if line and len(line) + 1 + len(word) > width:
            if len(out) == max_lines - 1:
                out.append(f'{line} {word}')
                return out
            out.append(line)
            line = word
        else:
            line = f'{line} {word}' if line else word
    if line:
        out.append(line)
    return out


def center(s, width=BOX):
    left = max(0, (width - visible(s)) // 2)
    return fit(' ' * left + s, width)


def box_top():
    return f'╔{"═" * BOX}╗'


def box_bottom():
    return f'╚{"═" * BOX}╝'


def rule(cols=(BOX,), joint=''):
    return f'╟{joint.join("─" * w for w in cols)}╢'


def cell(s, width):
    # Text cut with '…' keeps one space before the border, like kiauh.
    return f'{fit(s, width - 1)} ' if visible(s) > width else fit(s, width)


def row(cells, cols=(BOX,)):
    return f'║{"│".join(cell(s, cols[i]) for i, s in enumerate(cells))}║'


def title(text):
    """"║ ~~~~~~ [ Text ] ~~~~~~ ║" """
    mid = f' [ {text} ] '
    rest = BOX - 2 - len(mid)
    left = rest // 2
    return row([f' {"~" * left} [ {CYAN(text)} ] {"~" * (rest - left)} '])


def render_header():
    return [
        box_top(),
        title('TESSERA'),
        row([center('Tessera Extensions Manager')]),
        row([f' {"~" * (BOX - 2)} ']),
        box_bottom(),
    ]


def registry_label(url):
    """"idex-eclipse/Tessera-Ext" for GitHub raw URLs, a short form otherwise."""
    if not url:
        return 'unreachable'
    parts = urllib.parse.urlsplit(url)
    if parts.scheme == 'file':
        return 'local file'
    if parts.hostname == 'raw.githubusercontent.com':
        return '/'.join(parts.path.split('/')[1:3])
    return parts.netloc


def status_text(r):
    if r['state'] == 'installed':
        return GREEN(f'Installed {r["version"]}')
    if r['state'] == 'update':
        return YELLOW(f'Update {r["installed_version"]} → {r["version"]}')
    if r['state'] == 'local':
        return DIM(f'Local {r["installed_version"]}')
    return RED('Not installed')


def branch_label(source):
    return YELLOW('custom') if source['custom'] else CYAN(source['branch'])


def render_main(rows, registry_url, source):
    left = ['', '  1) [Install]', '  2) [Update]', '  3) [Remove]', '', '  S) [Settings]', '  R) [Refresh]']
    name_width = min(14, max([len(r['name']) for r in rows] + [0]))
    right = ['']
    for r in rows[:8]:
        right.append(f' {r["name"][:name_width].rjust(name_width)}: {status_text(r)}')
    if len(rows) > 8:
        right.append(DIM(f' … {len(rows) - 8} more'))
    if not rows:
        right.append(DIM(' Registry is empty' if registry_url else ' No plugins installed'))

    lines = [box_top(), title('Main Menu'), rule(MAIN_COLS, '┬')]
    for i in range(max(len(left), len(right))):
        lines.append(row([
            left[i] if i < len(left) else '',
            right[i] if i < len(right) else '',
        ], MAIN_COLS))
    registry_text = registry_label(registry_url) if registry_url else RED('unreachable')
    lines += [
        rule(MAIN_COLS, '┼'),
        row([f' Branch: {branch_label(source)}', f' Registry: {registry_text}'], MAIN_COLS),
        rule(MAIN_COLS, '┴'),
        row([center('Q) Quit')]),
        box_bottom(),
    ]
    return lines


def render_settings(source):
    lines = [box_top(), title('Settings'), rule(), row([''])]
    lines.append(row([f'  1) [Branch]   {branch_label(source)}']))
    if source['custom']:
        lines.append(row([YELLOW('     TESSERA_REGISTRY_URL is set: the branch is ignored')]))
    lines += [
        row(['']),
        row([DIM(f'  Registry:   {source["url"]}')]),
        row([DIM(f'  Plugin API: v{HOST_PLUGIN_API}')]),
        row([DIM(f'  Saved in:   {CONF_FILE}')]),
        row(['']),
        rule(),
        row([center('B) « Back')]),
        box_bottom(),
    ]
    return lines


def render_list(heading, items, empty_text, extra=()):
    """Submenu: numbered plugin list + extra actions + "B) « Back"."""
    lines = [box_top(), title(heading), rule(), row([''])]
    if not items:
        lines.append(row([DIM(f'  {empty_text}')]))
    for i, item in enumerate(items):
        note = f' {item["note"]}' if item.get('note') else ''
        lines.append(row([f'  {i + 1}) [{item["label"]}]{note}']))
        for part in wrap(item.get('description') or '', BOX - 7, 2):
            lines.append(row([DIM(f'      {part}')]))
    if extra:
        lines.append(row(['']))
        lines += [row([f'  {e}']) for e in extra]
    lines += [row(['']), rule(), row([center('B) « Back')]), box_bottom()]
    return lines


def install_items(rows):
    return [{
        'row': r,
        'label': r['name'],
        'note': DIM(r['version']) if r['state'] == 'available' else GREEN(f'(installed {r["installed_version"]})'),
        'description': r['description'],
    } for r in rows if r['entry']]


def update_items(rows):
    return [{
        'row': r,
        'label': r['name'],
        'note': YELLOW(f'{r["installed_version"]} → {r["version"]}') if r['state'] == 'update'
                else GREEN(f'{r["version"]} up to date'),
    } for r in rows if r['entry'] and r['state'] in ('installed', 'update')]


def remove_items(rows):
    return [{
        'row': r,
        'label': r['name'],
        'note': DIM(f'{r["installed_version"]} (local)' if r['state'] == 'local' else r['installed_version']),
    } for r in rows if r['state'] != 'available']


class Menu:
    """
    kiauh-like navigation: type a letter or number, press Enter.
    Screens: main → install | update | remove → back to main.
    The screen is not cleared, so install output stays visible above the
    redrawn menu.
    """

    def __init__(self):
        # The registry is fetched once and on R) Refresh, not on every redraw.
        self.registry = None
        self.changed = False

    def prompt(self, question):
        """Also works with piped input (tests, scripts): end of input answers None (= quit)."""
        sys.stdout.write(question)
        sys.stdout.flush()
        line = sys.stdin.readline()
        if not line:
            if not sys.stdin.isatty():
                print()
            return None
        answer = line.rstrip('\r\n')
        # A terminal echoes the typed line; piped input does not, so logs read
        # like an interactive session.
        if not sys.stdin.isatty():
            print(answer)
        return answer

    def ask(self):
        answer = self.prompt('###### Perform action: ')
        return None if answer is None else answer.strip().lower()

    def confirm(self, question):
        answer = self.prompt(f'###### {question} (y/N): ')
        return answer is not None and answer.strip().lower() in ('y', 'yes')

    def refresh(self):
        try:
            self.registry = load_registry()
        except ExtError as e:
            self.registry = None
            print(f'[tessera-ext] registry: {e}', file=sys.stderr)

    def status(self):
        return collect_status(self.registry['plugins'] if self.registry else [], scan_installed())

    def need_registry(self):
        if not self.registry:
            print('[tessera-ext] registry is unreachable — press R in the main menu to retry', file=sys.stderr)
        return bool(self.registry)

    def act(self, fn):
        """Runs one action; a failure (bad hash, network) must not close the menu."""
        try:
            if fn():
                self.changed = True
        except (ExtError, OSError) as e:
            print(f'[tessera-ext] {e}', file=sys.stderr)

    def install_entry(self, entry, force=False):
        with ExtensionsLock():
            done = install(entry, self.registry['url'], force)
            if done:
                scan_extensions()
        return done

    def remove_plugin(self, pid):
        with ExtensionsLock():
            remove_installed(pid)
        return True

    def pick_branch(self):
        """Lists the registry's branches and saves the choice; refetches on a change."""
        current = registry_source()['branch']
        branches = remote_branches()
        if branches:
            print(f'Branches of {REGISTRY_REPO}:')
            for i, b in enumerate(branches):
                suffix = f' {GREEN("(current)")}' if b == current else ''
                print(f'  {str(i + 1).rjust(2)}) {b}{suffix}')
        else:
            print('[tessera-ext] cannot list branches (offline?) — type the name')
        raw = self.prompt(f'###### Branch (number or name, Enter = keep {current}): ')
        value = (raw or '').strip()
        if not value:
            return False
        if value.isdigit() and branches:
            index = int(value) - 1
            name = branches[index] if 0 <= index < len(branches) else None
        else:
            name = value
        if not name:
            print('###### Invalid input!')
            return False
        if name == current:
            return False
        set_branch(name, branches)
        print(f'###### Branch: {name}')
        # A new branch = another registry.json: fetch it right away.
        self.refresh()
        return False

    def run(self):
        self.refresh()
        screen = 'main'
        print('\n'.join(render_header()))

        while True:
            rows = self.status()

            if screen == 'main':
                registry_url = self.registry['url'] if self.registry else None
                print('\n'.join(render_main(rows, registry_url, registry_source())))
                a = self.ask()
                if a is None or a == 'q':
                    break
                if a == '1':
                    screen = 'install'
                elif a == '2':
                    screen = 'update'
                elif a == '3':
                    screen = 'remove'
                elif a == 's':
                    screen = 'settings'
                elif a == 'r':
                    self.refresh()
                else:
                    print('###### Invalid input!')
                continue

            if screen == 'settings':
                print('\n'.join(render_settings(registry_source())))
                a = self.ask()
                if a is None:
                    break
                if a == 'b':
                    screen = 'main'
                elif a == '1':
                    self.act(self.pick_branch)
                else:
                    print('###### Invalid input!')
                continue

            if screen == 'install':
                items = install_items(rows)
                empty = 'Registry is empty' if self.registry else 'Registry is unreachable'
            elif screen == 'update':
                items = update_items(rows)
                empty = 'No plugins installed'
            else:
                items = remove_items(rows)
                empty = 'No plugins installed'
            heading = {'install': 'Installation Menu', 'update': 'Update Menu', 'remove': 'Remove Menu'}[screen]
            extra = ['A) [Update all]'] if screen == 'update' and items else []
            print('\n'.join(render_list(heading, items, empty, extra)))

            a = self.ask()
            if a is None:
                break
            if a == 'b':
                screen = 'main'
                continue
            if screen == 'update' and a == 'a' and items:
                if self.need_registry():
                    self.act(lambda: cmd_update(None, update_all=True, quiet=True))
                continue
            index = int(a) - 1 if a.isdigit() else -1
            if not 0 <= index < len(items):
                print('###### Invalid input!')
                continue
            r = items[index]['row']

            if screen == 'install':
                if not self.need_registry():
                    continue
                if r['state'] == 'available':
                    self.act(lambda: self.install_entry(r['entry']))
                elif self.confirm(f'{r["name"]} is installed. Reinstall?'):
                    self.act(lambda: self.install_entry(r['entry'], force=True))
            elif screen == 'update':
                if not self.need_registry():
                    continue
                if r['state'] == 'installed':
                    print(f'###### {r["name"]} is up to date')
                else:
                    self.act(lambda: self.install_entry(r['entry']))
            elif self.confirm(f'Remove {r["name"]}?'):
                self.act(lambda: self.remove_plugin(r['id']))

        if self.changed:
            print(UI_HINT)
        print('###### Happy printing!')


USAGE = f"""Usage: tessera-ext [command]
  (no command)          interactive menu
  list                  registry plugins and installed state
  install <name>        install from the registry ("spoolman" or "tessera/spoolman")
  update [<name>|--all] update one or all registry plugins
  remove <name>         delete an installed plugin
  sync                  rebuild extensions/index.json
  branch [<name>]       show / switch the registry branch (saved in {CONF_FILE})
  serve                 HTTP API for the UI (started by systemd, see tessera-ext.socket)
Options: --force (replace a hand-installed plugin / reinstall the same version)"""


def main(argv):
    # Box characters must not crash a non-UTF-8 terminal.
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(errors='replace')
        sys.stderr.reconfigure(errors='replace')

    cmd = argv[0] if argv else None
    rest = argv[1:]
    flags = {a for a in rest if a.startswith('--')}
    args = [a for a in rest if not a.startswith('--')]
    arg = args[0] if args else None
    force = '--force' in flags

    if cmd == 'menu':
        Menu().run()
    elif cmd == 'list':
        cmd_list()
    elif cmd == 'install':
        cmd_install(arg, force)
    elif cmd == 'update':
        cmd_update(arg, update_all='--all' in flags, force=force)
    elif cmd == 'remove':
        cmd_remove(arg)
    elif cmd == 'sync':
        with ExtensionsLock():
            scan_extensions()
    elif cmd == 'branch':
        cmd_branch(arg)
    elif cmd == 'serve':
        cmd_serve(arg if '--socket' in flags else None)
    elif cmd is None:
        if sys.stdin.isatty():
            Menu().run()
        else:
            print(USAGE)
    else:
        print(USAGE)
        return 0 if cmd in ('help', '--help') else 1
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except (ExtError, OSError) as e:
        print(f'[tessera-ext] {e}', file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
