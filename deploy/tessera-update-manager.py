#!/usr/bin/env python3
"""Tessera update manager: the service behind "Update Tessera" in Settings → About.

It replaces host/, deploy/ and build-info of the installation with the published build of
the configured branch, the same build deploy/install.sh downloads. Standard library only.

Usage (the service is a systemd socket unit written by deploy/install.sh):
  tessera-update-manager.py serve [--socket <path>]   HTTP API on a unix socket
  tessera-update-manager.py status                    installed and published build
  tessera-update-manager.py update [--branch <name>]  download and swap the build in (--branch switches)
  tessera-update-manager.py branches                  branches that have a published build

Why a separate service and not part of tessera-ext: replacing the UI needs write access
to the installation directory, while tessera-ext may write extensions/ only. Keeping them
apart keeps that sandbox narrow. Both authorize requests with Moonraker the same way
(the checks are imported from tessera-ext.py).

What it does NOT do: nginx, systemd units and Klipper config need root and stay with
`tessera update` (install.sh). A build that needs such a change says so in the release notes.

The repository comes from install.conf; the branch too, unless a request asks to switch
to another one (then the choice is saved back to install.conf). The archive is verified against the sha256 of the published build-info and unpacked into a
staging folder first, so a failed update leaves the working UI in place.
"""

import hashlib
import http.server
import importlib.util
import json
import os
import re
import shutil
import socket
import socketserver
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import fcntl
except ImportError:  # Windows dev checkout: no service there
    fcntl = None

HERE = os.path.dirname(os.path.realpath(__file__))


def load_ext():
    """tessera-ext.py has a dash in its name: load it by path (shared auth checks)."""
    # No __pycache__ in deploy/: that folder is replaced by an update and must stay clean.
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location('tessera_ext', os.path.join(HERE, 'tessera-ext.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ext = load_ext()
ExtError = ext.ExtError

# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------

INSTALL_DIR = os.path.abspath(os.environ.get('TESSERA_DIR') or os.path.join(HERE, '..'))
CONF_FILE = os.path.join(
    os.environ.get('XDG_CONFIG_HOME') or os.path.join(os.path.expanduser('~'), '.config'),
    'tessera',
    'install.conf',
)
DEFAULT_REPO_URL = 'https://github.com/idex-eclipse/tessera.git'
DEFAULT_BRANCH = 'main'

# Same as SWAP_ITEMS in deploy/install.sh: what a build replaces. extensions/ is never touched.
SWAP_ITEMS = ('host', 'deploy', 'build-info')
REQUIRED_FILES = (
    'host/dist/index.html',
    'deploy/install.sh',
    'deploy/install-ext.sh',
    'deploy/tessera-ext.py',
    'deploy/tessera-update-manager.py',
    'build-info',
)
LOCK_FILE = '.update.lock'

MAX_BUILD_INFO_BYTES = 16 * 1024
MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
MAX_UNPACKED_BYTES = 500 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 20000
NETWORK_TIMEOUT = 60
# GitHub is asked at most this often: the browser checks on every page open.
STATUS_CACHE_SECONDS = 600

API_PREFIX = '/tessera-update/v1/'
IDLE_EXIT_SECONDS = 300

COMMIT_RE = re.compile(r'[0-9a-f]{7,40}')
ARCHIVE_RE = re.compile(r'tessera-[0-9a-f]+\.tar\.gz')
SHA256_RE = re.compile(r'[0-9a-f]{64}')
SLUG_RE = re.compile(r'[A-Za-z0-9._-]+/[A-Za-z0-9._-]+')
VERSION_RE = re.compile(r'[0-9A-Za-z.+~-]{1,64}')


# ------------------------------------------------------------------
# Settings and build-info
# ------------------------------------------------------------------

def read_conf():
    """install.conf: KEY=value lines; the file is data, never code."""
    conf = {}
    try:
        with open(CONF_FILE, encoding='utf-8') as f:
            for line in f:
                m = re.match(r'([A-Z_]+)=(.*)$', line.rstrip('\r\n'))
                if m:
                    conf[m.group(1)] = m.group(2)
    except OSError:
        pass  # no settings yet: defaults and the installed build-info decide
    return conf


def parse_build_info(text):
    """KEY=value lines of a build-info file (written by tools/pack-release.sh)."""
    info = {}
    for line in text.splitlines():
        m = re.match(r'([A-Z0-9_]+)=(.*)$', line.rstrip('\r'))
        if m and m.group(1) not in info:
            info[m.group(1)] = m.group(2)
    return info


def installed_info():
    """build-info of the installation, or None (source checkout, nothing installed)."""
    try:
        with open(os.path.join(INSTALL_DIR, 'build-info'), encoding='utf-8') as f:
            return parse_build_info(f.read())
    except OSError:
        return None


def current_branch():
    """install.conf wins; an installation made before it existed knows its branch from build-info."""
    conf = read_conf()
    info = installed_info() or {}
    branch = conf.get('BRANCH') or info.get('BRANCH') or DEFAULT_BRANCH
    if not ext.BRANCH_RE.fullmatch(branch):
        raise ExtError('Invalid branch in install.conf', 500)
    return branch


def repo_slug(repo_url):
    """owner/repo of a GitHub URL; builds are GitHub releases of that repository."""
    slug = repo_url.strip().rstrip('/')
    if slug.endswith('.git'):
        slug = slug[:-4]
    for prefix in ('https://github.com/', 'git@github.com:', 'ssh://git@github.com/'):
        if slug.startswith(prefix):
            slug = slug[len(prefix):]
            break
    else:
        return None
    return slug if SLUG_RE.fullmatch(slug) else None


def valid_branch(name):
    return isinstance(name, str) and bool(ext.BRANCH_RE.fullmatch(name)) and '..' not in name


def release_slug():
    """owner/repo of the configured repository; builds are releases of it."""
    slug = repo_slug(read_conf().get('REPO_URL') or DEFAULT_REPO_URL)
    if not slug:
        raise ExtError('REPO_URL in install.conf is not a GitHub repository: update with `tessera update`', 409)
    return slug


def release_base(branch=None):
    """URL of the rolling release of the branch (.github/workflows/build.yml)."""
    return f'https://github.com/{release_slug()}/releases/download/build-{(branch or current_branch()).replace("/", "-")}'


def save_branch(branch):
    """Rewrites BRANCH in install.conf and keeps every other line, so `tessera update` stays on this branch.

    Replaced atomically (temp file + rename in the same folder): install.sh reads the file at any time.
    Returns the previous text (None if there was no file) so a failed switch can put it back.
    """
    try:
        with open(CONF_FILE, encoding='utf-8') as f:
            previous = f.read()
    except OSError:
        previous = None
    lines = (previous or '').splitlines()
    for i, line in enumerate(lines):
        if line.startswith('BRANCH='):
            lines[i] = f'BRANCH={branch}'
            break
    else:
        lines.append(f'BRANCH={branch}')
    write_conf('\n'.join(lines) + '\n')
    return previous


def restore_conf(previous):
    """Puts install.conf back after a failed switch (None = there was no file)."""
    try:
        if previous is None:
            os.unlink(CONF_FILE)
        else:
            write_conf(previous)
    except (OSError, ExtError):
        pass  # best effort: the original error is the one worth reporting


def write_conf(text):
    try:
        os.makedirs(os.path.dirname(CONF_FILE), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix='.install.conf-', dir=os.path.dirname(CONF_FILE))
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                f.write(text)
            os.chmod(tmp, 0o644)
            os.replace(tmp, CONF_FILE)
        except BaseException:
            os.unlink(tmp)
            raise
    except OSError as e:
        # Installations made before branch switching have the settings folder mounted read-only.
        raise ExtError(f'Cannot save the branch to install.conf ({e}): run `tessera update` on the printer once', 500) from e


# ------------------------------------------------------------------
# Network
# ------------------------------------------------------------------

class HttpsOnlyRedirect(urllib.request.HTTPRedirectHandler):
    """GitHub redirects downloads to its CDN; a redirect to anything but https is refused."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme.lower() != 'https':
            raise ExtError(f'Refusing a redirect to {ext.clean(newurl)}', 502)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_https(url):
    """Opens an https URL. Tests replace this to avoid the network."""
    if urllib.parse.urlsplit(url).scheme.lower() != 'https':
        raise ExtError('Only https is allowed', 500)
    opener = urllib.request.build_opener(HttpsOnlyRedirect)
    return opener.open(urllib.request.Request(url, headers={'User-Agent': 'tessera-update-manager'}),
                       timeout=NETWORK_TIMEOUT)


def download(url, limit, sink=None):
    """Reads url into memory (sink None) or into the file object `sink`; returns (bytes|None, sha256)."""
    digest = hashlib.sha256()
    chunks = []
    total = 0
    try:
        with open_https(url) as res:
            while True:
                chunk = res.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise ExtError(f'{ext.clean(url)} is larger than {limit} bytes', 502)
                digest.update(chunk)
                if sink is None:
                    chunks.append(chunk)
                else:
                    sink.write(chunk)
    except urllib.error.HTTPError as e:
        raise ExtError(f'{ext.clean(url)}: HTTP {e.code}', 502) from e
    except (urllib.error.URLError, OSError) as e:
        raise ExtError(f'Cannot download {ext.clean(url)}: {e}', 502) from e
    return (b''.join(chunks) if sink is None else None), digest.hexdigest()


def remote_info(branch=None):
    """Validated build-info of the published build of the branch (default: the configured one)."""
    data, _ = download(f'{release_base(branch)}/build-info', MAX_BUILD_INFO_BYTES)
    info = parse_build_info(data.decode('utf-8', errors='replace'))
    if not (COMMIT_RE.fullmatch(info.get('COMMIT', ''))
            and ARCHIVE_RE.fullmatch(info.get('ARCHIVE', ''))
            and SHA256_RE.fullmatch(info.get('SHA256', ''))):
        raise ExtError('The published build-info is invalid', 502)
    return info


# ------------------------------------------------------------------
# Swapping the build in
# ------------------------------------------------------------------

def recover_swap():
    """A killed update leaves .old/: bring the previous build back (like recover_swap in install.sh)."""
    shutil.rmtree(os.path.join(INSTALL_DIR, '.trash'), ignore_errors=True)
    old = os.path.join(INSTALL_DIR, '.old')
    if not os.path.isdir(old):
        return
    for item in SWAP_ITEMS:
        src = os.path.join(old, item)
        if not os.path.lexists(src):
            continue
        dst = os.path.join(INSTALL_DIR, item)
        remove_path(dst)
        os.rename(src, dst)
    shutil.rmtree(old, ignore_errors=True)


def remove_path(path):
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    elif os.path.lexists(path):
        os.unlink(path)


def swap_in(tree):
    """Moves the previous items to .old/, the new ones in; renaming .old to .trash commits."""
    old = os.path.join(INSTALL_DIR, '.old')
    os.mkdir(old)
    try:
        for item in SWAP_ITEMS:
            dst = os.path.join(INSTALL_DIR, item)
            if os.path.lexists(dst):
                os.rename(dst, os.path.join(old, item))
            os.rename(os.path.join(tree, item), dst)
    except OSError as e:
        recover_swap()
        raise ExtError(f'Cannot replace the installation: {e}', 500) from e
    trash = os.path.join(INSTALL_DIR, '.trash')
    os.rename(old, trash)
    shutil.rmtree(trash, ignore_errors=True)


def extract_build(archive, dest):
    """Unpacks the archive: plain files and directories only, no absolute or `..` paths."""
    try:
        with tarfile.open(archive, mode='r:gz') as tar:
            members = tar.getmembers()
            if len(members) > MAX_ARCHIVE_ENTRIES:
                raise ExtError(f'The archive has more than {MAX_ARCHIVE_ENTRIES} entries', 502)
            if sum(m.size for m in members if m.isreg()) > MAX_UNPACKED_BYTES:
                raise ExtError('The archive is too large when unpacked', 502)
            for m in members:
                if not (m.isdir() or m.isreg()) or m.issparse():
                    raise ExtError(f'The archive contains an unsupported entry: {ext.clean(m.name)}', 502)
                ext.safe_member_path(m.name)
            for m in members:
                target = os.path.join(dest, *ext.safe_member_path(m.name).split('/'))
                if m.isdir():
                    os.makedirs(target, exist_ok=True)
                    continue
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, 'wb') as out:
                    shutil.copyfileobj(tar.extractfile(m), out)
                # Owners and modes of the archive are ignored, only "executable" is kept.
                os.chmod(target, 0o755 if m.mode & 0o111 else 0o644)
    except (tarfile.TarError, EOFError) as e:
        raise ExtError(f'The archive is not a valid tar.gz: {e}', 502) from e
    # nginx reads these under any umask.
    for root, dirs, _ in os.walk(dest):
        for name in dirs:
            os.chmod(os.path.join(root, name), 0o755)


class UpdateLock:
    """One update at a time (the service is single-threaded, but the CLI can run too)."""

    def __enter__(self):
        self.file = open(os.path.join(INSTALL_DIR, LOCK_FILE), 'w', encoding='utf-8')
        if fcntl:
            fcntl.flock(self.file, fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc):
        self.file.close()


# ------------------------------------------------------------------
# API
# ------------------------------------------------------------------

_status_cache = {'at': float('-inf'), 'remote': None, 'error': None}


def short(commit):
    return (commit or '')[:7]


def view_build(info):
    """A build-info as the UI sees it; values are validated, not trusted."""
    if not info:
        return None
    version = info.get('VERSION', '')
    return {
        'commit': short(info.get('COMMIT')) if COMMIT_RE.fullmatch(info.get('COMMIT', '')) else None,
        'branch': ext.clean(info.get('BRANCH', '')) or None,
        'date': ext.clean(info.get('DATE', '')) or None,
        'version': version if VERSION_RE.fullmatch(version) else None,
    }


def api_status(force=False):
    """Installed build, published build and whether the UI may update itself."""
    local = installed_info()
    # A source checkout (.git) is migrated by `tessera update`, which asks before deleting anything.
    can_update = local is not None and not os.path.isdir(os.path.join(INSTALL_DIR, '.git'))

    now = time.monotonic()
    if force or now - _status_cache['at'] > STATUS_CACHE_SECONDS:
        try:
            _status_cache.update(at=now, remote=remote_info(), error=None)
        except ExtError as e:
            # Not cached for long: GitHub being unreachable should not stick for 10 minutes.
            _status_cache.update(at=now - STATUS_CACHE_SECONDS + 60, remote=None, error=str(e))
    remote = _status_cache['remote']

    update_available = bool(
        can_update and remote and local.get('COMMIT') and short(remote['COMMIT']) != short(local['COMMIT'])
    )
    return {
        'installed': view_build(local),
        'remote': view_build(remote),
        'branch': current_branch(),
        'updateAvailable': update_available,
        'canUpdate': can_update,
        'remoteError': _status_cache['error'],
    }


_branches_cache = {'at': float('-inf'), 'branches': None, 'error': None}


def api_branches(force=False):
    """Branches that have a published build, from the releases of the repository (like install.sh).

    The release tag is `build-<branch with / replaced by ->`, so a branch such as feature/x is
    listed as feature-x; that name selects the same release, which is all a switch needs.
    """
    now = time.monotonic()
    if force or now - _branches_cache['at'] > STATUS_CACHE_SECONDS:
        try:
            data, _ = download(f'https://api.github.com/repos/{release_slug()}/releases?per_page=100', MAX_BUILD_INFO_BYTES * 16)
            names = sorted({
                r['tag_name'][len('build-'):]
                for r in json.loads(data.decode('utf-8', errors='replace'))
                if isinstance(r, dict) and isinstance(r.get('tag_name'), str) and r['tag_name'].startswith('build-')
            })
            _branches_cache.update(at=now, branches=[n for n in names if valid_branch(n)], error=None)
        except (ExtError, ValueError, TypeError) as e:
            # Not cached for long: a GitHub hiccup must not hide the list for 10 minutes.
            _branches_cache.update(at=now - STATUS_CACHE_SECONDS + 60, branches=None, error=str(e))
    return {
        'current': current_branch(),
        'branches': _branches_cache['branches'] or [],
        'error': _branches_cache['error'],
    }


def api_update(branch=None):
    """Downloads the published build and swaps it in. The old build stays if anything fails.

    With `branch` the installation is switched to that branch: its build is installed even if
    the commit is the same, and the choice is saved to install.conf (so `tessera update` agrees).
    """
    local = installed_info()
    if local is None or os.path.isdir(os.path.join(INSTALL_DIR, '.git')):
        raise ExtError('This installation is a source checkout: update it with `tessera update`', 409)
    if branch is not None and not valid_branch(branch):
        raise ExtError('Invalid branch name')
    switching = branch is not None and branch != current_branch()

    with UpdateLock():
        recover_swap()
        # Also proves the branch has a published build before anything is changed.
        info = remote_info(branch)
        if not switching and short(info['COMMIT']) == short(local.get('COMMIT')):
            return {'changed': False, 'from': short(local.get('COMMIT')), 'to': short(info['COMMIT'])}
        # release_base() below must keep pointing at the target, whatever install.conf says now.
        target = branch if switching else current_branch()

        for stale in os.listdir(INSTALL_DIR):
            if stale.startswith('.staging-'):
                shutil.rmtree(os.path.join(INSTALL_DIR, stale), ignore_errors=True)
        staging = tempfile.mkdtemp(prefix='.staging-', dir=INSTALL_DIR)
        previous_conf, conf_saved = None, False
        try:
            archive = os.path.join(staging, 'build.tar.gz')
            with open(archive, 'wb') as sink:
                _, digest = download(f'{release_base(target)}/{info["ARCHIVE"]}', MAX_ARCHIVE_BYTES, sink)
            if digest != info['SHA256']:
                raise ExtError('sha256 of the downloaded build does not match build-info', 502)

            tree = os.path.join(staging, 'tree')
            os.mkdir(tree)
            extract_build(archive, tree)
            for must in REQUIRED_FILES:
                if not os.path.isfile(os.path.join(tree, *must.split('/'))):
                    raise ExtError(f'The archive has no {must}', 502)
            # The setting goes first: it fails cleanly (read-only folder) before the UI is touched.
            if switching:
                previous_conf, conf_saved = save_branch(target), True
            try:
                swap_in(tree)
            except ExtError:
                if conf_saved:
                    restore_conf(previous_conf)
                raise
        finally:
            shutil.rmtree(staging, ignore_errors=True)

        # The next status call must see the new build, not a cached answer.
        _status_cache.update(at=float('-inf'))
        new = installed_info() or {}
        return {
            'changed': True,
            'from': short(local.get('COMMIT')),
            'to': short(new.get('COMMIT') or info['COMMIT']),
        }


class ApiHandler(http.server.BaseHTTPRequestHandler):
    # One thread: a client that stops sending must not hold up the others.
    timeout = 30

    def log_message(self, format, *args):  # pylint: disable=redefined-builtin
        # The default implementation reads the client address, a unix socket has none.
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
            print(f'[tessera-update-manager] {e!r}', file=sys.stderr)
            self.send_json(500, {'error': 'Internal error, see: journalctl -u tessera-update-manager'})

    def read_body(self):
        """Comes before any refusal: closing a socket with unread data would turn it into a 502."""
        try:
            length = int(self.headers.get('Content-Length') or '')
        except ValueError as e:
            raise ExtError('Content-Length required', 411) from e
        if length < 0:
            raise ExtError('Invalid Content-Length')
        data = self.rfile.read(min(length, ext.MAX_DRAINED_BODY))
        if length > ext.MAX_REQUEST_BODY:
            raise ExtError('Request body too large', 413)
        return data

    def do_GET(self):
        def handler():
            url = urllib.parse.urlsplit(self.path)
            if url.path not in (f'{API_PREFIX}status', f'{API_PREFIX}branches'):
                raise ExtError('Not found', 404)
            ext.check_same_origin(self.headers)
            ext.check_moonraker_auth(self.headers)
            # "Check now" in the UI skips the cache; page opens use it.
            force = urllib.parse.parse_qs(url.query).get('refresh') == ['1']
            return api_branches(force) if url.path.endswith('/branches') else api_status(force)
        self.respond(handler)

    def do_POST(self):
        def handler():
            data = self.read_body()
            if self.path != f'{API_PREFIX}update':
                raise ExtError('Not found', 404)
            ext.check_same_origin(self.headers)
            if (self.headers.get('Content-Type') or '').split(';')[0].strip().lower() != 'application/json':
                # A form on another site cannot send this type without a CORS preflight.
                raise ExtError('Content-Type must be application/json', 415)
            try:
                body = json.loads(data.decode('utf-8'))
            except ValueError as e:
                raise ExtError('Request body must be JSON') from e
            # Only an optional branch is accepted; the repository is never taken from a request.
            # A branch is just a name of a release in the configured repository (validated, and
            # its sha256-checked build must exist), the same trust as the branch in install.conf.
            if not isinstance(body, dict) or set(body) - {'branch'}:
                raise ExtError('Request body must be {} or {"branch": "<name>"}')
            ext.check_moonraker_auth(self.headers)
            return api_update(body.get('branch'))
        self.respond(handler)


# No unix sockets on Windows: the CLI of a dev checkout must still load there.
UNIX_SERVER = getattr(socketserver, 'UnixStreamServer', None)


class ApiServer(UNIX_SERVER or object):
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
    if not UNIX_SERVER:
        raise ExtError('serve needs unix sockets: it runs on the printer, not on Windows')
    os.umask(0o022)
    if not socket_path and os.environ.get('LISTEN_FDS') != '1':
        raise ExtError('serve expects a systemd socket (LISTEN_FDS=1) or --socket <path>')

    with ApiServer(socket_path) as server:
        # Exits when idle, systemd starts it again on the next connection.
        server.timeout = idle_seconds
        while not server.idle:
            server.handle_request()


def main(argv):
    command = argv[1] if len(argv) > 1 else ''
    try:
        if command == 'serve':
            socket_path = argv[3] if len(argv) > 3 and argv[2] == '--socket' else None
            cmd_serve(socket_path)
        elif command == 'status':
            print(json.dumps(api_status(force=True), indent=2, ensure_ascii=False))
        elif command == 'branches':
            print(json.dumps(api_branches(force=True), indent=2, ensure_ascii=False))
        elif command == 'update':
            branch = argv[3] if len(argv) > 3 and argv[2] == '--branch' else None
            print(json.dumps(api_update(branch), indent=2, ensure_ascii=False))
        else:
            print(__doc__)
            return 0 if command in ('-h', '--help', 'help') else 1
    except ExtError as e:
        print(f'error: {e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
