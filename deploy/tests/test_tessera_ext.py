"""Tests of deploy/tessera-ext.py: python -m unittest discover -s deploy/tests

The registry is a local folder, archives are real .tar.gz files; the API runs on
a unix socket with a fake Moonraker. Network and browsers are not involved.
"""

import contextlib
import hashlib
import http.client
import http.server
import importlib.util
import io
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent

spec = importlib.util.spec_from_file_location('tessera_ext', HERE.parent / 'tessera-ext.py')
ext = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ext)


def make_tar(files):
    """{name: bytes | TarInfo} → .tar.gz bytes."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tar:
        for name, content in files.items():
            if isinstance(content, tarfile.TarInfo):
                tar.addfile(content)
                continue
            info = tarfile.TarInfo(name)
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
    return buf.getvalue()


def manifest(pid='acme/hello', version='1.0.0'):
    return json.dumps({'id': pid, 'name': 'Hello', 'version': version, 'entry': 'index.js'}).encode()


def plugin_files(pid='acme/hello', version='1.0.0'):
    return {'manifest.json': manifest(pid, version), 'index.js': f'// {version}\n'.encode()}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.extensions = os.path.join(self.tmp, 'extensions')
        self.registry = os.path.join(self.tmp, 'registry')
        os.makedirs(self.extensions)
        os.makedirs(self.registry)
        self.entries = []

        patches = {
            'EXTENSIONS_DIR': self.extensions,
            'CONF_FILE': os.path.join(self.tmp, 'tessera-ext.conf'),
            # no build by default: core versions unknown (see DependencyVersionTests)
            'CORE_PLUGINS_FILE': os.path.join(self.tmp, 'core-plugins.json'),
            'SERVICES_DIR': os.path.join(self.tmp, 'services'),
            'local_sources_allowed': True,
        }
        for key, value in patches.items():
            original = getattr(ext, key)
            self.addCleanup(setattr, ext, key, original)
            setattr(ext, key, value)

        env = {'TESSERA_REGISTRY_URL': os.path.join(self.registry, 'registry.json')}
        original_env = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        def restore_env():
            for k, v in original_env.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        self.addCleanup(restore_env)

    def publish(self, files, pid='acme/hello', version='1.0.0', directory='hello', **extra):
        """Adds an archive and its entry to the registry; `extra` overrides fields of the entry."""
        data = make_tar(files)
        name = f'{directory}-{version}-{len(self.entries)}.tar.gz'
        with open(os.path.join(self.registry, name), 'wb') as f:
            f.write(data)
        entry = {
            'id': pid, 'dir': directory, 'name': 'Hello', 'version': version,
            'pluginApi': 1, 'url': name, 'sha256': hashlib.sha256(data).hexdigest(),
        }
        entry.update(extra)
        self.entries = [e for e in self.entries if e['id'] != pid] + [entry]
        with open(os.path.join(self.registry, 'registry.json'), 'w', encoding='utf-8') as f:
            json.dump({'schema': 1, 'plugins': self.entries}, f)
        return entry

    def path(self, *parts):
        return os.path.join(self.extensions, *parts)

    def read(self, *parts):
        with open(self.path(*parts), encoding='utf-8') as f:
            return f.read()

    def put_manual(self, name='hello', pid='acme/hello', version='1.0.0'):
        os.makedirs(self.path(name), exist_ok=True)
        for file, content in plugin_files(pid, version).items():
            with open(self.path(name, file), 'wb') as f:
                f.write(content)

    def no_leftovers(self):
        left = [n for n in os.listdir(self.extensions) if n.startswith(('.staging-', '.old-'))]
        self.assertEqual(left, [])

    @contextlib.contextmanager
    def quiet(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            yield


class InstallTests(Base):
    def install(self, query='hello', **kw):
        with self.quiet():
            ext.cmd_install(query, **kw)

    def assert_refused(self, text, query='hello', **kw):
        before = sorted(os.listdir(self.extensions))
        with self.assertRaises(ext.ExtError) as ctx:
            self.install(query, **kw)
        self.assertIn(text, str(ctx.exception))
        self.no_leftovers()
        self.assertEqual(sorted(n for n in os.listdir(self.extensions) if n != ext.LOCK_FILE),
                         sorted(n for n in before if n != ext.LOCK_FILE))

    def test_install_writes_plugin_origin_and_index(self):
        entry = self.publish(plugin_files())
        self.install()
        self.assertEqual(self.read('hello', 'index.js'), '// 1.0.0\n')
        origin = json.loads(self.read('hello', ext.ORIGIN_FILE))
        self.assertEqual(origin['sha256'], entry['sha256'])
        self.assertEqual(origin['id'], 'acme/hello')
        index = json.loads(self.read('index.json'))
        self.assertEqual(index[0]['origin'], 'registry')
        self.assertEqual(index[0]['manifestUrl'], '/extensions/hello/manifest.json')
        self.no_leftovers()

    @unittest.skipIf(os.name == 'nt', 'POSIX modes')
    def test_installed_files_are_readable_by_nginx(self):
        self.publish({**plugin_files(), 'assets/a.css': b'a{}'})
        old = os.umask(0o077)
        self.addCleanup(os.umask, old)
        self.install()
        self.assertEqual(os.stat(self.path('hello')).st_mode & 0o777, 0o755)
        self.assertEqual(os.stat(self.path('hello', 'index.js')).st_mode & 0o777, 0o644)
        self.assertEqual(os.stat(self.path('hello', 'assets')).st_mode & 0o777, 0o755)
        self.assertEqual(os.stat(self.path('index.json')).st_mode & 0o777, 0o644)

    def test_names(self):
        self.publish(plugin_files())
        self.publish(plugin_files('acme/other'), pid='acme/other', directory='other')
        self.install('acme/hello')
        self.install('OTHER')
        self.assertTrue(os.path.exists(self.path('other', 'index.js')))
        with self.assertRaises(ext.ExtError):
            self.install('nope')

    def test_ambiguous_name(self):
        self.publish(plugin_files('a/hello'), pid='a/hello', directory='hello-a')
        self.publish(plugin_files('b/hello'), pid='b/hello', directory='hello-b')
        self.assert_refused('ambiguous')

    def test_refuses_wrong_sha256(self):
        self.publish(plugin_files(), sha256='0' * 64)
        self.assert_refused('sha256 mismatch')

    def test_refuses_symlink(self):
        link = tarfile.TarInfo('evil')
        link.type = tarfile.SYMTYPE
        link.linkname = '/etc/passwd'
        self.publish({**plugin_files(), 'evil': link})
        self.assert_refused('unsupported entry')

    def test_refuses_hardlink(self):
        link = tarfile.TarInfo('evil')
        link.type = tarfile.LNKTYPE
        link.linkname = 'manifest.json'
        self.publish({**plugin_files(), 'evil': link})
        self.assert_refused('unsupported entry')

    def test_refuses_paths_outside(self):
        for name in ('../evil.js', 'a/../../evil.js', '/tmp/evil.js', 'a\\..\\evil.js'):
            with self.subTest(name=name):
                self.publish({**plugin_files(), name: b'x'})
                self.assert_refused('unsafe path')
        self.assertFalse(os.path.exists(os.path.join(self.tmp, 'evil.js')))

    def test_refuses_gzip_bomb(self):
        original = ext.MAX_UNPACKED_BYTES
        self.addCleanup(setattr, ext, 'MAX_UNPACKED_BYTES', original)
        ext.MAX_UNPACKED_BYTES = 1024 * 1024
        self.publish({**plugin_files(), 'big.bin': b'\0' * (5 * 1024 * 1024)})
        self.assert_refused('unpacks to more')

    def test_refuses_too_many_entries(self):
        original = ext.MAX_ARCHIVE_ENTRIES
        self.addCleanup(setattr, ext, 'MAX_ARCHIVE_ENTRIES', original)
        ext.MAX_ARCHIVE_ENTRIES = 3
        self.publish({**plugin_files(), 'a': b'', 'b': b''})
        self.assert_refused('more than 3 entries')

    def test_refuses_not_gzip(self):
        entry = self.publish(plugin_files())
        data = b'not a gzip file'
        with open(os.path.join(self.registry, entry['url']), 'wb') as f:
            f.write(data)
        entry['sha256'] = hashlib.sha256(data).hexdigest()
        with open(os.path.join(self.registry, 'registry.json'), 'w', encoding='utf-8') as f:
            json.dump({'schema': 1, 'plugins': self.entries}, f)
        self.assert_refused('not a valid gzip')

    def test_refuses_manifest_mismatch(self):
        self.publish(plugin_files('evil/other'))
        self.assert_refused('does not match registry')
        self.publish(plugin_files(version='9.9.9'))
        self.assert_refused('does not match registry')

    def test_refuses_no_manifest(self):
        self.publish({'index.js': b''})
        self.assert_refused('no valid manifest.json')

    def test_refuses_newer_plugin_api(self):
        major, minor = ext.parse_plugin_api(ext.HOST_PLUGIN_API)
        self.publish(plugin_files(), pluginApi=f'{major}.{minor + 1}')
        self.assert_refused('Update Tessera first')

    def test_refuses_other_major_plugin_api(self):
        major, _ = ext.parse_plugin_api(ext.HOST_PLUGIN_API)
        self.publish(plugin_files(), pluginApi=f'{major + 1}.0')
        self.assert_refused('not compatible')

    def test_refuses_invalid_plugin_api(self):
        for bad in ('0.8.0', 'latest', 2, True, 0.8):
            with self.subTest(pluginApi=bad):
                self.publish(plugin_files(), pluginApi=bad)
                self.assert_refused('Invalid pluginApi')

    def test_installs_legacy_and_current_plugin_api(self):
        for value in (1, None, ext.LEGACY_PLUGIN_API, ext.HOST_PLUGIN_API):
            with self.subTest(pluginApi=value):
                entry = self.publish(plugin_files(), pluginApi=value)
                if value is None:
                    del entry['pluginApi']
                    with open(os.path.join(self.registry, 'registry.json'), 'w', encoding='utf-8') as f:
                        json.dump({'schema': 1, 'plugins': self.entries}, f)
                self.install()
                self.assertIn('acme/hello', ext.scan_installed())
                with self.quiet():
                    ext.cmd_remove('acme/hello', True)

    def test_refuses_bad_dir_in_registry(self):
        for bad in ('../evil', 'a/b', '.hidden', ''):
            with self.subTest(dir=bad):
                self.publish(plugin_files(), directory='hello', dir=bad)
                with self.assertRaises(ext.ExtError):
                    self.install()

    def test_refuses_manual_folder_without_force(self):
        self.put_manual()
        self.publish(plugin_files(version='2.0.0'), version='2.0.0')
        self.assert_refused('installed manually')
        self.assertEqual(self.read('hello', 'index.js'), '// 1.0.0\n')
        self.install(force=True)
        self.assertEqual(self.read('hello', 'index.js'), '// 2.0.0\n')

    def test_refuses_foreign_folder(self):
        self.put_manual(pid='someone/else')
        self.publish(plugin_files())
        self.assert_refused('is not acme/hello', 'acme/hello')

    def test_failed_update_keeps_previous_version(self):
        self.publish(plugin_files())
        self.install()
        self.publish(plugin_files(version='2.0.0'), version='2.0.0', sha256='0' * 64)
        with self.assertRaises(ext.ExtError), self.quiet():
            ext.cmd_update('hello')
        self.assertEqual(self.read('hello', 'index.js'), '// 1.0.0\n')
        self.no_leftovers()

    def test_update_all_and_up_to_date(self):
        self.publish(plugin_files())
        self.install()
        with self.quiet():
            self.assertFalse(ext.cmd_update(None, update_all=True))
        self.publish(plugin_files(version='2.0.0'), version='2.0.0')
        with self.quiet():
            self.assertTrue(ext.cmd_update(None, update_all=True))
        self.assertEqual(self.read('hello', 'index.js'), '// 2.0.0\n')

    def test_update_all_skips_manual(self):
        self.put_manual()
        self.publish(plugin_files(version='2.0.0'), version='2.0.0')
        with self.quiet():
            self.assertFalse(ext.cmd_update(None, update_all=True))
        self.assertEqual(self.read('hello', 'index.js'), '// 1.0.0\n')

    def test_remove(self):
        self.publish(plugin_files())
        self.install()
        with self.quiet():
            ext.cmd_remove('hello')
        self.assertFalse(os.path.exists(self.path('hello')))
        self.assertEqual(json.loads(self.read('index.json')), [])

    def test_remove_works_offline(self):
        self.put_manual()
        os.environ['TESSERA_REGISTRY_URL'] = os.path.join(self.registry, 'missing.json')
        with self.quiet():
            ext.cmd_remove('hello')
        self.assertFalse(os.path.exists(self.path('hello')))

    def test_recovers_interrupted_install(self):
        self.put_manual()
        os.rename(self.path('hello'), self.path('.old-hello'))
        os.makedirs(self.path('.staging-hello-x'))
        with ext.ExtensionsLock():
            pass
        self.assertTrue(os.path.exists(self.path('hello', 'index.js')))
        self.no_leftovers()

    def test_status_rows(self):
        self.publish(plugin_files())
        self.publish(plugin_files('acme/new'), pid='acme/new', directory='new')
        self.install('acme/hello')
        self.put_manual('manual', 'acme/manual')
        self.publish(plugin_files(version='2.0.0'), version='2.0.0')
        rows = {r['id']: r for r in ext.collect_status(self.entries, ext.scan_installed())}
        self.assertEqual(rows['acme/hello']['state'], 'update')
        self.assertEqual(rows['acme/new']['state'], 'available')
        self.assertEqual(rows['acme/manual']['state'], 'local')
        self.assertTrue(rows['acme/hello']['managed'])
        self.assertFalse(rows['acme/manual']['managed'])

    def test_status_reports_plugin_api(self):
        self.publish(plugin_files())
        self.publish(plugin_files('acme/new'), pid='acme/new', directory='new', pluginApi='0.9')
        self.put_manual('manual', 'acme/manual')
        rows = {r['id']: ext.plugin_view(r) for r in ext.collect_status(self.entries, ext.scan_installed())}
        self.assertEqual(rows['acme/hello']['pluginApi'], ext.LEGACY_PLUGIN_API)
        self.assertEqual(rows['acme/new']['pluginApi'], '0.9')
        self.assertIsNone(rows['acme/manual']['pluginApi'])

    def test_plugin_api_matches_the_sdk(self):
        source = (ROOT / 'plugin-sdk' / 'src' / 'api-level.ts').read_text(encoding='utf-8')
        self.assertIn(f"export const PLUGIN_API = '{ext.HOST_PLUGIN_API}';", source)
        self.assertIn(f"export const LEGACY_PLUGIN_API = '{ext.LEGACY_PLUGIN_API}';", source)

    def test_plugin_api_compatibility(self):
        self.assertIsNone(ext.plugin_api_problem('0.7', '0.8'))
        self.assertIsNone(ext.plugin_api_problem('0.8', '0.8'))
        self.assertIsNone(ext.plugin_api_problem(1, '0.8'))
        self.assertIsNone(ext.plugin_api_problem(None, '0.8'))
        self.assertEqual(ext.plugin_api_problem('0.9', '0.8'), 'newer')
        self.assertEqual(ext.plugin_api_problem('1.0', '0.8'), 'major')
        self.assertEqual(ext.plugin_api_problem(True, '0.8'), 'invalid')
        self.assertEqual(ext.plugin_api_problem('08.1', '0.8'), 'invalid')
        self.assertEqual(ext.plugin_api_problem('0.10', '0.9'), 'newer')
        self.assertIsNone(ext.plugin_api_problem('0.9', '0.10'))

    def test_registry_text_cannot_reach_the_terminal(self):
        self.publish(plugin_files(), name='Evil\x1b[2J', description='a\x07b')
        row = ext.collect_status(self.entries, {})[0]
        self.assertEqual(row['name'], 'Evil[2J')
        self.assertEqual(row['description'], 'ab')

    def test_menu_with_piped_input(self):
        self.publish(plugin_files())
        script = os.path.join(HERE.parent, 'tessera-ext.py')
        env = dict(os.environ, TESSERA_EXTENSIONS_DIR=self.extensions, XDG_CONFIG_HOME=self.tmp,
                   PYTHONIOENCODING='utf-8')
        result = subprocess.run(
            [sys.executable, script, 'menu'], input='1\n1\nb\nq\n', env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding='utf-8', timeout=60, check=True,
        )
        self.assertIn('Installation Menu', result.stdout)
        self.assertIn('Happy printing', result.stdout)
        self.assertTrue(os.path.exists(self.path('hello', 'index.js')))


def extension_files(pid, version='1.0.0', points=(), dependencies=None):
    """A plugin whose manifest extends the given extension points."""
    data = {
        'id': pid, 'name': pid, 'version': version, 'entry': 'index.js',
        **({'dependencies': dependencies} if dependencies else {}),
        'extensions': [
            {'point': point, 'kind': 'tab', 'version': 1, 'id': f'x{i}', 'titleKey': 't', 'element': 'x-el'}
            for i, point in enumerate(points)
        ],
    }
    return {'manifest.json': json.dumps(data).encode(), 'index.js': b'// extension\n'}


class DependencyTests(Base):
    def setUp(self):
        super().setUp()
        self.publish(extension_files('acme/owner'), pid='acme/owner', directory='owner')
        self.publish(
            extension_files('acme/addon', points=('acme/owner#tabs', '@core/calibrations#tabs')),
            pid='acme/addon', directory='addon', requires=['acme/owner', '@core/calibrations'],
        )

    def run_quiet(self, fn, *args):
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            fn(*args)
        return err.getvalue()

    def test_installs_dependencies_first(self):
        self.run_quiet(ext.cmd_install, 'addon')
        installed = ext.scan_installed()
        self.assertEqual(sorted(installed), ['acme/addon', 'acme/owner'])
        self.assertEqual(installed['acme/addon']['requires'], ['acme/owner'])

    def test_core_dependencies_are_always_satisfied(self):
        plan = ext.dependency_plan('acme/addon', self.entries, {})
        self.assertEqual(plan, (['acme/owner'], [], []))

    def test_missing_dependency_warns_and_installs(self):
        self.publish(extension_files('acme/lonely', points=('acme/ghost#x',)),
                     pid='acme/lonely', directory='lonely', requires=['acme/ghost'])
        err = self.run_quiet(ext.cmd_install, 'lonely')
        self.assertIn('acme/ghost', err)
        self.assertIn('acme/lonely', ext.scan_installed())

    def test_cycles_are_visited_once(self):
        plugins = [
            {'id': 'a', 'requires': ['b']},
            {'id': 'b', 'requires': ['a']},
        ]
        self.assertEqual(ext.dependency_plan('a', plugins, {}), (['b'], [], []))

    def test_remove_refuses_while_others_depend(self):
        self.run_quiet(ext.cmd_install, 'addon')
        with self.assertRaises(ext.ExtError) as ctx:
            self.run_quiet(ext.cmd_remove, 'owner')
        self.assertIn('acme/addon', str(ctx.exception))
        self.assertIn('acme/owner', ext.scan_installed())

        self.run_quiet(ext.cmd_remove, 'owner', True)
        self.assertNotIn('acme/owner', ext.scan_installed())

    def test_status_reports_requires(self):
        rows = {r['id']: r for r in ext.collect_status(self.entries, {})}
        self.assertEqual(rows['acme/addon']['requires'], ['acme/owner'])
        self.assertEqual(ext.plugin_view(rows['acme/addon'])['requires'], ['acme/owner'])

    def test_registry_rejects_bad_requires(self):
        self.publish(plugin_files(), requires='acme/owner')
        with self.assertRaises(ext.ExtError):
            ext.load_registry()


class DependencyVersionTests(Base):
    """manifest.dependencies / registry `dependencies`: minimal versions of the owners."""

    def setUp(self):
        super().setUp()
        self.publish(extension_files('acme/owner', '2.0.0'), pid='acme/owner', version='2.0.0', directory='owner')
        deps = {'acme/owner': '2.0.0', '@core/calibrations': '3.0.0'}
        self.publish(
            extension_files('acme/addon', points=('acme/owner#tabs', '@core/calibrations#panel-probe'),
                            dependencies=deps),
            pid='acme/addon', directory='addon',
            requires=['acme/owner', '@core/calibrations'], dependencies=deps,
        )

    def write_core(self, versions):
        with open(ext.CORE_PLUGINS_FILE, 'w', encoding='utf-8') as f:
            json.dump(versions, f)

    def install_owner(self, version):
        self.publish(extension_files('acme/owner', version), pid='acme/owner', version=version, directory='owner')
        with self.quiet():
            ext.cmd_install('owner')

    def test_versions(self):
        self.assertTrue(ext.satisfies_min('3.0.0', '3.0.0'))
        self.assertTrue(ext.satisfies_min('3.1.0', '3.0.9'))
        self.assertTrue(ext.satisfies_min('anything', None))
        self.assertFalse(ext.satisfies_min('2.9.9', '3.0.0'))
        self.assertFalse(ext.satisfies_min('3.0.0-rc.1', '3.0.0'))
        self.assertTrue(ext.satisfies_min('3.0.0-rc.2', '3.0.0-rc.1'))
        self.assertTrue(ext.satisfies_min('3.0.0-rc.1', '3.0.0-1'))
        self.assertFalse(ext.satisfies_min('dev', '1.0.0'))
        self.assertTrue(ext.valid_dependencies({'a': '1.2.3'}))
        for bad in ({'a': '1.2'}, {'a': 1}, {'': '1.0.0'}, {'a#b': '1.0.0'}, ['a']):
            self.assertFalse(ext.valid_dependencies(bad), bad)

    def test_manifest_dependencies_merge_points_and_versions(self):
        m = json.loads(extension_files('acme/x', points=('acme/owner#tabs', 'acme/other#p'),
                                       dependencies={'acme/owner': '1.2.0'})['manifest.json'])
        self.assertEqual(ext.manifest_dependencies(m), {'acme/owner': '1.2.0', 'acme/other': None})
        self.assertEqual(ext.manifest_requires(m), ['acme/owner', 'acme/other'])

    def test_updates_an_outdated_owner(self):
        self.install_owner('1.0.0')
        self.publish(extension_files('acme/owner', '2.0.0'), pid='acme/owner', version='2.0.0', directory='owner')
        to_install, missing, outdated = ext.dependency_plan('acme/addon', self.entries, ext.scan_installed())
        self.assertEqual((to_install, missing, outdated), (['acme/owner'], [], []))
        with self.quiet():
            ext.cmd_install('addon')
        self.assertEqual(ext.scan_installed()['acme/owner']['version'], '2.0.0')

    def test_satisfied_owner_is_kept(self):
        self.install_owner('2.0.0')
        self.assertEqual(ext.dependency_plan('acme/addon', self.entries, ext.scan_installed()), ([], [], []))

    def test_refuses_when_the_registry_owner_is_too_old(self):
        self.publish(extension_files('acme/owner', '1.5.0'), pid='acme/owner', version='1.5.0', directory='owner')
        with self.assertRaises(ext.ExtError) as ctx, self.quiet():
            ext.cmd_install('addon')
        self.assertIn('acme/owner 2.0.0', str(ctx.exception))
        self.assertEqual(ext.scan_installed(), {})

    def test_core_version_is_checked(self):
        self.write_core({'@core/calibrations': '2.1.0'})
        with self.assertRaises(ext.ExtError) as ctx, self.quiet():
            ext.cmd_install('addon')
        self.assertIn('Update Tessera', str(ctx.exception))
        self.assertNotIn('acme/addon', ext.scan_installed())

        self.write_core({'@core/calibrations': '3.0.0'})
        with self.quiet():
            ext.cmd_install('addon')
        self.assertIn('acme/addon', ext.scan_installed())

    def test_unknown_core_versions_do_not_block(self):
        # dev checkout without host/dist: nothing to compare with, the host checks on load
        with self.quiet():
            ext.cmd_install('addon')
        self.assertIn('acme/addon', ext.scan_installed())

    def test_status_reports_dependencies(self):
        rows = {r['id']: r for r in ext.collect_status(self.entries, {})}
        view = ext.plugin_view(rows['acme/addon'])
        self.assertEqual(view['requires'], ['acme/owner'])
        self.assertEqual(view['dependencies'], {'acme/owner': '2.0.0', '@core/calibrations': '3.0.0'})

    def test_registry_rejects_bad_dependencies(self):
        self.publish(plugin_files(), dependencies={'acme/owner': 'latest'})
        with self.assertRaises(ext.ExtError):
            ext.load_registry()


class SourceTests(Base):
    def test_only_https_and_local(self):
        for url in ('http://example.com/a', 'ftp://example.com/a'):
            with self.subTest(url=url), self.assertRaises(ext.ExtError):
                ext.fetch_bytes(url)

    def test_https_registry_cannot_point_at_local_files(self):
        with self.assertRaises(ext.ExtError):
            ext.archive_url({'url': 'file:///etc/passwd'}, 'https://example.com/registry.json')

    def test_relative_archive_url(self):
        self.assertEqual(ext.archive_url({'url': 'a.tar.gz'}, 'https://example.com/x/registry.json'),
                         'https://example.com/x/a.tar.gz')

    def test_redirect_to_http_is_refused(self):
        with self.assertRaises(ext.ExtError):
            ext.HttpsOnlyRedirect().redirect_request(None, None, 302, '', {}, 'http://example.com/a')

    def test_service_takes_https_only(self):
        ext.local_sources_allowed = False
        self.assertTrue(ext.registry_source()['url'].startswith('https://raw.githubusercontent.com/'))
        with self.assertRaises(ext.ExtError):
            ext.fetch_bytes(pathlib.Path(__file__).as_uri())

    def test_saved_branch(self):
        os.environ.pop('TESSERA_REGISTRY_URL')
        ext.save_branch('dev')
        self.assertIn('/dev/registry/', ext.registry_source()['url'])
        with self.assertRaises(ext.ExtError):
            ext.set_branch('../evil', [])
        with self.assertRaises(ext.ExtError):
            ext.set_branch('nope', ['main', 'dev'])


class ExtraRegistry:
    """A second registry.json in its own folder, as a third party would publish it."""

    def __init__(self, root, name):
        self.dir = os.path.join(root, name)
        os.makedirs(self.dir)
        self.entries = []
        self.write()

    @property
    def path(self):
        return os.path.join(self.dir, 'registry.json')

    @property
    def url(self):
        # resolve(): the normalizer does too (Windows temp paths are 8.3 names)
        return pathlib.Path(self.path).resolve().as_uri()

    def write(self):
        with open(self.path, 'w', encoding='utf-8') as f:
            json.dump({'schema': 1, 'plugins': self.entries}, f)

    def publish(self, files, pid='acme/hello', version='1.0.0', directory='hello', **extra):
        data = make_tar(files)
        name = f'{directory}-{version}.tar.gz'
        with open(os.path.join(self.dir, name), 'wb') as f:
            f.write(data)
        entry = {
            'id': pid, 'dir': directory, 'name': pid, 'version': version,
            'pluginApi': '0.7', 'url': name, 'sha256': hashlib.sha256(data).hexdigest(),
        }
        entry.update(extra)
        self.entries = [e for e in self.entries if e['id'] != pid] + [entry]
        self.write()


class AdditionalRegistryTests(Base):
    """Registries added with `repo add` next to the built-in one."""

    def setUp(self):
        super().setUp()
        self.extra = ExtraRegistry(self.tmp, 'extra')

    def run_quiet(self, fn, *args, **kw):
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            fn(*args, **kw)
        return err.getvalue()

    def add(self, name='extra'):
        with ext.ExtensionsLock():
            return ext.add_source(self.extra.url, name)

    # -- the list of registries

    def test_add_list_remove(self):
        self.extra.publish(plugin_files('acme/one'), pid='acme/one', directory='one')
        added = self.add()
        self.assertEqual((added['name'], added['plugins']), ('extra', 1))
        self.assertEqual([s['name'] for s in ext.configured_sources()], ['official', 'extra'])
        self.assertTrue(ext.configured_sources()[0]['official'])

        with ext.ExtensionsLock():
            self.assertEqual(ext.remove_source('extra'), [])
        self.assertEqual([s['name'] for s in ext.configured_sources()], ['official'])

    def test_the_list_is_kept_in_extensions(self):
        self.add()
        self.assertEqual(json.loads(self.read(ext.SOURCES_FILE))['sources'][0]['name'], 'extra')
        # a hidden file is not a plugin folder
        self.assertEqual(ext.plugin_dirs(), [])

    def test_name_is_suggested_from_the_address(self):
        name = lambda url, taken=(): ext.suggest_source_name(url, set(taken))
        self.assertEqual(name('https://raw.githubusercontent.com/Acme/Plugins/main/registry.json'), 'acme-plugins')
        self.assertEqual(name('https://acme.github.io/registry.json'), 'acme')
        self.assertEqual(name('https://plugins.example.com/r.json'), 'plugins.example.com')
        self.assertEqual(name('https://acme.github.io/registry.json', ['acme']), 'acme-2')
        self.assertEqual(name('https://official/registry.json'), 'official-2')
        for url in ('https://acme.github.io/r.json', 'file:///tmp/r.json'):
            self.assertTrue(ext.valid_source_name(name(url)))

    def test_refuses_bad_names_and_duplicates(self):
        for bad in ('official', 'Upper', '-x', 'a b', 'a' * 33, ''):
            with self.subTest(name=bad), self.assertRaises(ext.ExtError):
                self.add(bad)
        self.add()
        with self.assertRaises(ext.ExtError) as ctx:
            self.add('other')
        self.assertEqual(ctx.exception.status, 409)
        other = ExtraRegistry(self.tmp, 'other')
        with self.assertRaises(ext.ExtError):
            with ext.ExtensionsLock():
                ext.add_source(other.url, 'extra')
        self.publish(plugin_files())
        with self.assertRaises(ext.ExtError) as dup:
            with ext.ExtensionsLock():
                ext.add_source(pathlib.Path(self.registry, 'registry.json').resolve().as_uri(), 'again')
        self.assertIn('already added', str(dup.exception))

    def test_at_most_ten(self):
        for i in range(ext.MAX_SOURCES):
            registry = ExtraRegistry(self.tmp, f'r{i}')
            with ext.ExtensionsLock():
                ext.add_source(registry.url, f'r{i}')
        with self.assertRaises(ext.ExtError) as ctx:
            self.add()
        self.assertEqual(ctx.exception.status, 409)

    def test_an_unreadable_registry_is_not_saved(self):
        os.remove(self.extra.path)
        with self.assertRaises(ext.ExtError):
            self.add()
        with open(self.extra.path, 'w', encoding='utf-8') as f:
            f.write('{"schema": 2, "plugins": []}')
        with self.assertRaises(ext.ExtError):
            self.add()
        self.assertEqual(ext.read_sources(), [])

    def test_a_broken_list_file_is_empty(self):
        for text in ('{', '[]', '{"sources": "x"}', '{"sources": [{"name": "official", "url": "u"}, 5, {"name": "ok"}]}'):
            with self.subTest(text=text):
                with open(self.path(ext.SOURCES_FILE), 'w', encoding='utf-8') as f:
                    f.write(text)
                self.assertEqual(ext.read_sources(), [])

    def test_service_takes_https_addresses_only(self):
        ext.local_sources_allowed = False
        good = 'https://plugins.example.com/registry.json'
        self.assertEqual(ext.normalize_source_url(good), good)
        bad = (
            'http://plugins.example.com/r.json', 'file:///etc/passwd', '/etc/passwd', 'ftp://example.com/r.json',
            'https://user:pw@example.com/r.json', 'https://localhost/r.json', 'https://foo.localhost/r.json',
            'https://127.0.0.1/r.json', 'https://192.168.1.5/r.json', 'https://10.0.0.1/r.json',
            'https://169.254.1.1/r.json', 'https://[::1]/r.json', 'https://0.0.0.0/r.json',
            'https://example.com/a b', 'https://example.com/\x07', '', '   ', 'https://' + 'a' * 400 + '.com/r.json',
        )
        for url in bad:
            with self.subTest(url=url), self.assertRaises(ext.ExtError):
                ext.normalize_source_url(url)

    def test_cli_also_takes_local_files(self):
        self.assertEqual(ext.normalize_source_url(self.extra.path), self.extra.url)

    # -- plugins from several registries

    def test_lists_plugins_of_every_registry_and_survives_a_failing_one(self):
        self.publish(plugin_files())
        self.extra.publish(plugin_files('acme/one'), pid='acme/one', directory='one')
        self.add()
        registry = ext.load_registries()
        self.assertEqual({(p['id'], p['_source']) for p in registry['plugins']},
                         {('acme/hello', 'official'), ('acme/one', 'extra')})

        os.remove(self.extra.path)
        with self.quiet():
            registry = ext.load_registries()
        self.assertEqual([p['id'] for p in registry['plugins']], ['acme/hello'])
        self.assertIsNone(registry['sources'][0]['error'])
        self.assertTrue(registry['sources'][1]['error'])

    def test_all_registries_failing_is_an_error_for_the_cli_only(self):
        self.publish(plugin_files())
        self.add()
        os.remove(self.extra.path)
        os.remove(os.path.join(self.registry, 'registry.json'))
        with self.assertRaises(ext.ExtError), self.quiet():
            ext.load_registries()
        self.assertEqual(len(ext.load_registries(strict=False)['sources']), 2)

    def test_installs_from_an_additional_registry(self):
        self.extra.publish(plugin_files('acme/one'), pid='acme/one', directory='one')
        self.add()
        self.run_quiet(ext.cmd_install, 'one')
        self.assertEqual(ext.scan_installed()['acme/one']['origin']['registry'], self.extra.url)
        index = json.loads(self.read('index.json'))
        self.assertEqual(index[0]['origin'], 'registry')

    def test_one_id_in_two_registries_must_be_chosen(self):
        self.publish(plugin_files(version='1.0.0'))
        self.extra.publish(plugin_files(version='7.0.0'), version='7.0.0')
        self.add()
        with self.assertRaises(ext.ExtError) as ctx:
            self.run_quiet(ext.cmd_install, 'hello')
        self.assertIn('--source', str(ctx.exception))
        self.assertEqual(ext.scan_installed(), {})

        self.run_quiet(ext.cmd_install, 'hello', source='extra')
        self.assertEqual(ext.scan_installed()['acme/hello']['version'], '7.0.0')

    def test_unknown_source_name_is_an_error(self):
        self.publish(plugin_files())
        with self.assertRaises(ext.ExtError) as ctx:
            self.run_quiet(ext.cmd_install, 'hello', source='nope')
        self.assertIn('No registry named', str(ctx.exception))

    def test_the_other_registry_is_a_conflict_in_status(self):
        self.publish(plugin_files(version='1.0.0'))
        self.extra.publish(plugin_files(version='7.0.0'), version='7.0.0')
        self.add()
        self.run_quiet(ext.cmd_install, 'hello', source='official')

        registry = ext.load_registries()
        rows = {r['source']: r for r in ext.collect_status(registry['plugins'], ext.scan_installed(), registry['sources'])}
        self.assertEqual(rows['official']['state'], 'installed')
        self.assertTrue(rows['official']['managed'])
        self.assertEqual(rows['extra']['state'], 'conflict')
        self.assertFalse(rows['extra']['managed'])
        self.assertEqual(ext.plugin_view(rows['extra'])['source'], 'extra')

        # the install is refused by the installer too, with or without a name
        with self.assertRaises(ext.ExtError) as ctx:
            self.run_quiet(ext.cmd_install, 'hello', source='extra')
        self.assertIn('installed from registry "official"', str(ctx.exception))
        self.assertEqual(ext.scan_installed()['acme/hello']['version'], '1.0.0')

    def test_update_comes_from_the_registry_of_the_install(self):
        self.publish(plugin_files(version='1.0.0'))
        self.extra.publish(plugin_files(version='1.0.0'))
        self.add()
        self.run_quiet(ext.cmd_install, 'hello', source='extra')

        # both registries publish a newer version: only the owner's counts
        self.publish(plugin_files(version='2.0.0'), version='2.0.0')
        self.extra.publish(plugin_files(version='3.0.0'), version='3.0.0')
        self.run_quiet(ext.cmd_update, 'hello')
        self.assertEqual(ext.scan_installed()['acme/hello']['version'], '3.0.0')

    def test_a_removed_registry_leaves_the_plugin_working_but_not_replaceable(self):
        self.publish(plugin_files(version='1.0.0'))
        self.extra.publish(plugin_files(version='1.0.0'))
        self.add()
        self.run_quiet(ext.cmd_install, 'hello', source='extra')
        with ext.ExtensionsLock():
            self.assertEqual(ext.remove_source('extra'), ['acme/hello'])

        self.publish(plugin_files(version='2.0.0'), version='2.0.0')
        err = self.run_quiet(ext.cmd_update, None, update_all=True)
        self.assertIn('skipped', err)
        self.assertEqual(ext.scan_installed()['acme/hello']['version'], '1.0.0')

        # the built-in registry may not take the plugin over by name either
        with self.assertRaises(ext.ExtError) as ctx:
            self.run_quiet(ext.cmd_install, 'hello', source='official')
        self.assertIn('not configured any more', str(ctx.exception))
        registry = ext.load_registries()
        rows = ext.collect_status(registry['plugins'], ext.scan_installed(), registry['sources'])
        self.assertEqual([r['state'] for r in rows if r['id'] == 'acme/hello'], ['conflict', 'local'])

    def test_a_branch_switch_keeps_official_plugins_updatable(self):
        sources = [{'name': 'official', 'url': 'https://example.com/main.json', 'official': True}]
        origin = lambda url: {'origin': {'registry': url}}
        self.assertEqual(ext.installed_source(
            origin('https://raw.githubusercontent.com/idex-eclipse/Tessera-Ext/dev/registry/registry.json'), sources), 'official')
        self.assertEqual(ext.installed_source(origin('https://elsewhere.example/r.json'), sources), '')
        self.assertIsNone(ext.installed_source({'origin': None}, sources))

    def test_dependencies_come_from_the_same_registry_then_the_built_in_one_never_a_third(self):
        self.publish(extension_files('acme/owner', version='1.0.0'), pid='acme/owner', directory='owner')
        self.extra.publish(extension_files('acme/owner', version='9.0.0'), pid='acme/owner', version='9.0.0', directory='owner')
        self.extra.publish(
            extension_files('acme/addon', points=('acme/owner#tabs',)),
            pid='acme/addon', directory='addon', requires=['acme/owner'])
        third = ExtraRegistry(self.tmp, 'third')
        third.publish(extension_files('acme/only-third'), pid='acme/only-third', directory='third-only')
        self.extra.publish(
            extension_files('acme/wants-third', points=('acme/only-third#tabs',)),
            pid='acme/wants-third', directory='wants', requires=['acme/only-third'])
        self.add()
        with ext.ExtensionsLock():
            ext.add_source(third.url, 'third')

        registry = ext.load_registries()
        chosen = {}
        plan = ext.dependency_plan('acme/addon', registry['plugins'], {}, 'extra', chosen)
        self.assertEqual(plan[0], ['acme/owner'])
        self.assertEqual(chosen['acme/owner']['_source'], 'extra')

        # a dependency only a third registry has is reported missing, not pulled in
        plan = ext.dependency_plan('acme/wants-third', registry['plugins'], {}, 'extra', {})
        self.assertEqual(plan, ([], ['acme/only-third'], []))

        self.run_quiet(ext.cmd_install, 'addon')
        self.assertEqual(ext.scan_installed()['acme/owner']['version'], '9.0.0')

    def test_dependency_falls_back_to_the_built_in_registry(self):
        self.publish(extension_files('acme/owner'), pid='acme/owner', directory='owner')
        self.extra.publish(
            extension_files('acme/addon', points=('acme/owner#tabs',)),
            pid='acme/addon', directory='addon', requires=['acme/owner'])
        self.add()
        self.run_quiet(ext.cmd_install, 'addon')
        installed = ext.scan_installed()
        self.assertEqual(installed['acme/owner']['origin']['registry'], pathlib.Path(self.registry, 'registry.json').resolve().as_uri())
        self.assertEqual(installed['acme/addon']['origin']['registry'], self.extra.url)

    def test_core_ids_cannot_come_from_a_registry(self):
        self.extra.publish(plugin_files('@core/console'), pid='@core/console', directory='console')
        self.add()
        with self.assertRaises(ext.ExtError) as ctx:
            self.run_quiet(ext.cmd_install, 'console')
        self.assertIn('part of Tessera', str(ctx.exception))
        self.assertEqual(ext.scan_installed(), {})

    def test_cli_repo_commands(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            ext.cmd_repo(['add', self.extra.path, 'mine'])
            ext.cmd_repo([])
            ext.cmd_repo(['remove', 'mine'])
        text = out.getvalue()
        self.assertIn('Added registry "mine"', text)
        self.assertIn('mine  ' + self.extra.url, text)
        self.assertIn('Removed registry "mine"', text)
        self.assertEqual(ext.read_sources(), [])
        for bad in (['add'], ['remove'], ['bogus'], ['remove', 'nope']):
            with self.subTest(args=bad), self.assertRaises(ext.ExtError):
                ext.cmd_repo(bad)

    def test_source_flag_needs_a_value(self):
        with self.assertRaises(ext.ExtError):
            ext.main(['install', 'hello', '--source'])
        with self.assertRaises(ext.ExtError):
            ext.main(['install', 'hello', '--source', '--force'])


@unittest.skipUnless(shutil.which('node'), 'node is needed for tools/extensions-sync.cjs')
class IndexParityTests(Base):
    def test_same_as_extensions_sync(self):
        self.publish(plugin_files())
        with self.quiet():
            ext.cmd_install('hello')
        self.put_manual('manual', 'acme/manual')
        os.makedirs(self.path('no-manifest'))
        os.makedirs(self.path('.hidden'))
        os.makedirs(self.path('broken'))
        with open(self.path('broken', 'manifest.json'), 'w', encoding='utf-8') as f:
            f.write('{')
        os.makedirs(self.path('full'))
        with open(self.path('full', 'manifest.json'), 'w', encoding='utf-8') as f:
            json.dump({'id': 'a/full', 'version': '1', 'icon': 'i', 'description': 'Описание'}, f, ensure_ascii=False)

        with self.quiet():
            ext.scan_extensions()
        python_output = self.read('index.json')

        subprocess.run(
            ['node', str(ROOT / 'tools' / 'extensions-sync.cjs')],
            env=dict(os.environ, TESSERA_EXTENSIONS_DIR=self.extensions),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
        )
        node_output = self.read('index.json')

        key = lambda e: e['id']  # readdir order is up to the OS
        self.assertEqual(sorted(json.loads(python_output), key=key), sorted(json.loads(node_output), key=key))


class FakeMoonraker(http.server.BaseHTTPRequestHandler):
    status = 200
    seen = []

    def do_GET(self):
        FakeMoonraker.seen.append((self.path, dict(self.headers)))
        self.send_response(FakeMoonraker.status)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def log_message(self, *args):
        pass


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__('localhost', timeout=30)
        self.socket_path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self.socket_path)


@unittest.skipUnless(hasattr(socket, 'AF_UNIX') and os.name != 'nt', 'unix sockets')
class ApiBase(Base):
    """The service on a real unix socket with a fake Moonraker; shared by the API test classes."""

    def setUp(self):
        super().setUp()
        FakeMoonraker.status = 200
        FakeMoonraker.seen = []
        self.moonraker = http.server.HTTPServer(('127.0.0.1', 0), FakeMoonraker)
        threading.Thread(target=self.moonraker.serve_forever, daemon=True).start()
        self.addCleanup(self.moonraker.server_close)
        self.addCleanup(self.moonraker.shutdown)
        original = os.environ.get('TESSERA_MOONRAKER')
        os.environ['TESSERA_MOONRAKER'] = f'127.0.0.1:{self.moonraker.server_port}'
        self.addCleanup(lambda: os.environ.__setitem__('TESSERA_MOONRAKER', original)
                        if original else os.environ.pop('TESSERA_MOONRAKER', None))

        # The service reads the registry over https only: here that URL is a folder.
        real_fetch = ext.fetch_bytes
        registry = self.registry

        self.remote = {}  # https address of an additional registry -> file on disk

        def fake_fetch(url):
            for remote_url, remote_file in self.remote.items():
                # the registry itself and the archives next to it
                base = remote_url.rsplit('/', 1)[0] + '/'
                if url.startswith(base):
                    ext_allowed, ext.local_sources_allowed = ext.local_sources_allowed, True
                    try:
                        return real_fetch(pathlib.Path(os.path.dirname(remote_file), url[len(base):]).as_uri())
                    finally:
                        ext.local_sources_allowed = ext_allowed
            name = url.rsplit('/', 1)[-1]
            ext_allowed, ext.local_sources_allowed = ext.local_sources_allowed, True
            try:
                return real_fetch(pathlib.Path(registry, name).as_uri())
            finally:
                ext.local_sources_allowed = ext_allowed
        self.addCleanup(setattr, ext, 'fetch_bytes', real_fetch)
        ext.fetch_bytes = fake_fetch
        ext.local_sources_allowed = False

        self.socket_path = os.path.join(self.tmp, 's')
        self.server = ext.ApiServer(self.socket_path)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

        stdout = contextlib.redirect_stdout(io.StringIO())
        stderr = contextlib.redirect_stderr(io.StringIO())
        stdout.__enter__()
        stderr.__enter__()
        self.addCleanup(stdout.__exit__, None, None, None)
        self.addCleanup(stderr.__exit__, None, None, None)

        with open(os.path.join(self.registry, 'registry.json'), 'w', encoding='utf-8') as f:
            json.dump({'schema': 1, 'plugins': []}, f)

    def call(self, method, path, body=None, headers=None):
        conn = UnixConnection(self.socket_path)
        all_headers = {'X-Real-IP': '192.168.1.50', 'Host': 'printer:8000'}
        if body is not None:
            all_headers['Content-Type'] = 'application/json'
        all_headers.update(headers or {})
        all_headers = {k: v for k, v in all_headers.items() if v is not None}
        payload = body if isinstance(body, (str, bytes)) or body is None else json.dumps(body)
        conn.request(method, f'/tessera-api/v1/{path}', payload, all_headers)
        res = conn.getresponse()
        data = res.read()
        conn.close()
        return res.status, json.loads(data) if data else None


class ApiTests(ApiBase):
    def test_status(self):
        self.publish(plugin_files())
        self.put_manual('manual', 'acme/manual')
        code, body = self.call('GET', 'status')
        self.assertEqual(code, 200)
        plugins = {p['id']: p for p in body['plugins']}
        self.assertEqual(plugins['acme/hello']['state'], 'available')
        self.assertFalse(plugins['acme/manual']['managed'])
        self.assertIsNone(body['registryError'])

    def test_install_update_remove(self):
        self.publish(plugin_files())
        code, body = self.call('POST', 'install', {'id': 'acme/hello'})
        self.assertEqual((code, body['changed'], body['version']), (200, True, '1.0.0'))
        self.assertEqual(body['manifestUrl'], '/extensions/hello/manifest.json')
        self.assertEqual(json.loads(self.read('index.json'))[0]['origin'], 'registry')

        code, body = self.call('POST', 'install', {'id': 'acme/hello'})
        self.assertEqual((code, body['changed']), (200, False))

        self.publish(plugin_files(version='2.0.0'), version='2.0.0')
        code, body = self.call('POST', 'update', {'id': 'acme/hello'})
        self.assertEqual((code, body['version']), (200, '2.0.0'))
        self.assertEqual(self.read('hello', 'index.js'), '// 2.0.0\n')

        code, _ = self.call('POST', 'remove', {'id': 'acme/hello'})
        self.assertEqual(code, 200)
        self.assertFalse(os.path.exists(self.path('hello')))
        self.assertEqual(json.loads(self.read('index.json')), [])

    def test_auth_headers_reach_moonraker(self):
        self.call('GET', 'status', headers={'Authorization': 'Bearer t', 'X-Api-Key': 'k', 'X-Forwarded-For': '1.2.3.4'})
        path, headers = FakeMoonraker.seen[0]
        headers = {k.lower(): v for k, v in headers.items()}
        self.assertEqual(path, '/access/user')
        self.assertEqual(headers['authorization'], 'Bearer t')
        self.assertEqual(headers['x-api-key'], 'k')
        self.assertEqual(headers['x-real-ip'], '192.168.1.50')
        self.assertEqual(headers['x-forwarded-for'], '1.2.3.4')

    def test_moonraker_refuses(self):
        self.publish(plugin_files())
        FakeMoonraker.status = 401
        for method, path, body in (('GET', 'status', None), ('POST', 'install', {'id': 'acme/hello'})):
            with self.subTest(path=path):
                self.assertEqual(self.call(method, path, body)[0], 401)
        self.assertFalse(os.path.exists(self.path('hello')))

    def test_moonraker_unreachable_is_a_refusal(self):
        self.publish(plugin_files())
        os.environ['TESSERA_MOONRAKER'] = '127.0.0.1:1'
        self.assertEqual(self.call('POST', 'install', {'id': 'acme/hello'})[0], 503)
        self.assertFalse(os.path.exists(self.path('hello')))

    def test_redirect_from_moonraker_is_a_refusal(self):
        FakeMoonraker.status = 302
        self.assertEqual(self.call('GET', 'status')[0], 503)

    def test_requires_x_real_ip(self):
        self.assertEqual(self.call('GET', 'status', headers={'X-Real-IP': None})[0], 403)
        self.assertEqual(FakeMoonraker.seen, [])

    def test_cross_origin_refused(self):
        self.publish(plugin_files())
        for origin in ('http://evil.example', 'null', 'http://printer:9999'):
            with self.subTest(origin=origin):
                code, _ = self.call('POST', 'install', {'id': 'acme/hello'}, {'Origin': origin})
                self.assertEqual(code, 403)
        self.assertEqual(self.call('POST', 'install', {'id': 'acme/hello'}, {'Origin': 'http://printer:8000'})[0], 200)

    def test_needs_json_content_type(self):
        self.publish(plugin_files())
        for content_type in ('text/plain', 'application/x-www-form-urlencoded', None):
            with self.subTest(content_type=content_type):
                code, _ = self.call('POST', 'install', {'id': 'acme/hello'}, {'Content-Type': content_type})
                self.assertEqual(code, 415)
        self.assertFalse(os.path.exists(self.path('hello')))

    def test_body_takes_an_id_and_nothing_else(self):
        self.publish(plugin_files())
        bad = (
            {'id': 'acme/hello', 'force': True},
            {'id': 'acme/hello', 'url': 'https://evil.example/a.tar.gz'},
            {'url': 'https://evil.example/a.tar.gz'},
            {'id': 1},
            {'id': ''},
            {'id': 'a\nb'},
            [],
            'not json',
        )
        for body in bad:
            with self.subTest(body=body):
                self.assertEqual(self.call('POST', 'install', body)[0], 400)
        self.assertFalse(os.path.exists(self.path('hello')))

    def test_body_limit(self):
        self.assertEqual(self.call('POST', 'install', {'id': 'x' * ext.MAX_REQUEST_BODY})[0], 413)

    def test_unknown_plugin(self):
        code, body = self.call('POST', 'install', {'id': 'acme/nope'})
        self.assertEqual(code, 400)
        self.assertIn('not in the registry', body['error'])

    def test_short_names_are_cli_only(self):
        self.publish(plugin_files())
        self.assertEqual(self.call('POST', 'install', {'id': 'hello'})[0], 400)

    def test_manual_folder_is_not_the_apis(self):
        self.put_manual()
        self.publish(plugin_files(version='2.0.0'), version='2.0.0')
        self.assertEqual(self.call('POST', 'update', {'id': 'acme/hello'})[0], 409)
        self.assertEqual(self.call('POST', 'remove', {'id': 'acme/hello'})[0], 409)
        self.assertEqual(self.read('hello', 'index.js'), '// 1.0.0\n')

    def test_update_needs_installed_plugin(self):
        self.publish(plugin_files())
        self.assertEqual(self.call('POST', 'update', {'id': 'acme/hello'})[0], 409)

    def test_bad_archive_is_reported_and_changes_nothing(self):
        self.publish(plugin_files(), sha256='0' * 64)
        code, body = self.call('POST', 'install', {'id': 'acme/hello'})
        self.assertEqual(code, 400)
        self.assertIn('sha256 mismatch', body['error'])
        self.assertFalse(os.path.exists(self.path('hello')))
        self.no_leftovers()

    def test_registry_failure_still_lists_installed(self):
        self.put_manual()
        os.remove(os.path.join(self.registry, 'registry.json'))
        code, body = self.call('GET', 'status')
        self.assertEqual(code, 200)
        self.assertTrue(body['registryError'])
        self.assertEqual(body['plugins'][0]['id'], 'acme/hello')

    def test_unknown_paths(self):
        self.assertEqual(self.call('GET', 'nope')[0], 404)
        self.assertEqual(self.call('POST', 'status', {'id': 'x'})[0], 404)
        self.assertEqual(self.call('POST', '../install', {'id': 'x'})[0], 404)

    # -- additional registries

    def add_remote(self, name='extra', url=None):
        """A second registry reachable at an https address; returns (registry, address)."""
        registry = ExtraRegistry(self.tmp, name)
        url = url or f'https://{name}.example.com/registry.json'
        self.remote[url] = registry.path
        return registry, url

    def test_repo_add_and_remove(self):
        registry, url = self.add_remote()
        registry.publish(plugin_files('acme/one'), pid='acme/one', directory='one')

        code, body = self.call('POST', 'repo-add', {'url': url, 'name': 'mine'})
        self.assertEqual((code, body['name'], body['plugins']), (200, 'mine', 1))
        self.assertEqual(json.loads(self.read(ext.SOURCES_FILE))['sources'], [{'name': 'mine', 'url': url}])

        code, body = self.call('GET', 'status')
        self.assertEqual([(s['name'], s['official'], s['error']) for s in body['sources']],
                         [('official', True, None), ('mine', False, None)])
        plugin = next(p for p in body['plugins'] if p['id'] == 'acme/one')
        self.assertEqual((plugin['source'], plugin['state']), ('mine', 'available'))

        code, body = self.call('POST', 'install', {'id': 'acme/one', 'source': 'mine'})
        self.assertEqual((code, body.get('version'), body.get('error')), (200, '1.0.0', None))

        code, body = self.call('POST', 'repo-remove', {'name': 'mine'})
        self.assertEqual((code, body['orphaned']), (200, ['acme/one']))
        self.assertEqual(self.call('POST', 'update', {'id': 'acme/one'})[0], 400)
        self.assertEqual(self.read('one', 'index.js'), '// 1.0.0\n')
        self.assertEqual(self.call('POST', 'repo-remove', {'name': 'mine'})[0], 404)

    def test_repo_add_name_is_optional(self):
        _, url = self.add_remote('plugins')
        code, body = self.call('POST', 'repo-add', {'url': url})
        self.assertEqual((code, body['name']), (200, 'plugins.example.com'))

    def test_repo_add_refuses_unsafe_addresses(self):
        bad = ('http://plugins.example.com/r.json', 'file:///etc/passwd', 'https://localhost/r.json',
               'https://127.0.0.1/r.json', 'https://192.168.0.2/r.json', 'https://u:p@example.com/r.json')
        for url in bad:
            with self.subTest(url=url):
                self.assertEqual(self.call('POST', 'repo-add', {'url': url})[0], 400)
        self.assertFalse(os.path.exists(self.path(ext.SOURCES_FILE)))

    def test_repo_add_refuses_what_is_not_a_registry(self):
        url = 'https://nothing.example.com/missing.json'
        code, _ = self.call('POST', 'repo-add', {'url': url})
        self.assertGreaterEqual(code, 400)
        self.assertFalse(os.path.exists(self.path(ext.SOURCES_FILE)))

    def test_repo_bodies_are_strict(self):
        _, url = self.add_remote()
        for action, body in (
            ('repo-add', {}),
            ('repo-add', {'url': url, 'force': True}),
            ('repo-add', {'url': 5}),
            ('repo-add', {'url': url, 'name': 'Bad Name'}),
            ('repo-add', {'url': url, 'name': 'official'}),
            ('repo-add', {'name': 'x'}),
            ('repo-remove', {'name': 'official'}),
            ('repo-remove', {'name': 'x', 'url': url}),
            ('repo-remove', {}),
            ('install', {'id': 'acme/hello', 'name': 'x'}),
            ('install', {'id': 'acme/hello', 'source': 'Bad Name'}),
            ('install', {'id': 'acme/hello', 'source': 1}),
            ('remove', {'id': 'acme/hello', 'source': 'extra'}),
        ):
            with self.subTest(action=action, body=body):
                self.assertEqual(self.call('POST', action, body)[0], 400)
        self.assertFalse(os.path.exists(self.path(ext.SOURCES_FILE)))

    def test_repo_add_needs_the_same_protection_as_installs(self):
        _, url = self.add_remote()
        self.assertEqual(self.call('POST', 'repo-add', {'url': url}, {'Origin': 'http://evil.example'})[0], 403)
        self.assertEqual(self.call('POST', 'repo-add', {'url': url}, {'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.call('POST', 'repo-add', {'url': url}, {'X-Real-IP': None})[0], 403)
        FakeMoonraker.status = 401
        self.assertEqual(self.call('POST', 'repo-add', {'url': url})[0], 401)
        self.assertEqual(self.call('POST', 'repo-remove', {'name': 'x'})[0], 401)
        self.assertFalse(os.path.exists(self.path(ext.SOURCES_FILE)))

    def test_install_names_a_registry_never_an_address(self):
        registry, url = self.add_remote()
        registry.publish(plugin_files('acme/one'), pid='acme/one', directory='one')
        self.assertEqual(self.call('POST', 'repo-add', {'url': url, 'name': 'mine'})[0], 200)
        for source in (url, 'nope'):
            with self.subTest(source=source):
                self.assertEqual(self.call('POST', 'install', {'id': 'acme/one', 'source': source})[0], 400)
        self.assertFalse(os.path.exists(self.path('one')))

    def test_same_id_in_two_registries(self):
        self.publish(plugin_files(version='1.0.0'))
        registry, url = self.add_remote()
        registry.publish(plugin_files(version='7.0.0'), version='7.0.0')
        self.assertEqual(self.call('POST', 'repo-add', {'url': url, 'name': 'mine'})[0], 200)

        # the UI always sends the registry; a request without one is refused as ambiguous
        code, body = self.call('POST', 'install', {'id': 'acme/hello'})
        self.assertEqual(code, 400)
        self.assertIn('--source', body['error'])

        self.assertEqual(self.call('POST', 'install', {'id': 'acme/hello', 'source': 'mine'})[1]['version'], '7.0.0')
        code, _ = self.call('POST', 'install', {'id': 'acme/hello', 'source': 'official'})
        self.assertEqual(code, 409)
        self.assertEqual(self.read('hello', 'index.js'), '// 7.0.0\n')

        states = {p['source']: p['state'] for p in self.call('GET', 'status')[1]['plugins'] if p['id'] == 'acme/hello'}
        self.assertEqual(states, {'official': 'conflict', 'mine': 'installed'})

    def test_a_failing_registry_does_not_hide_the_others(self):
        self.publish(plugin_files())
        registry, url = self.add_remote()
        self.assertEqual(self.call('POST', 'repo-add', {'url': url, 'name': 'mine'})[0], 200)
        os.remove(registry.path)
        code, body = self.call('GET', 'status')
        self.assertEqual(code, 200)
        self.assertIsNone(body['registryError'])
        self.assertTrue(body['sources'][1]['error'])
        self.assertEqual([p['id'] for p in body['plugins']], ['acme/hello'])

    def test_idle_exit(self):
        server = ext.ApiServer(os.path.join(self.tmp, 'idle'))
        self.addCleanup(server.server_close)
        self.assertEqual(ext.serve_until_idle(server, 0.05, [], poll_seconds=0.01), 'idle')

    def test_exits_when_the_sources_are_replaced(self):
        # An update from the UI swaps deploy/ under a running service: it must not go on
        # answering with the previous build's code (the stale plugin API bug).
        source = os.path.join(self.tmp, 'source.py')
        with open(source, 'w', encoding='utf-8') as f:
            f.write('# v1\n')
        server = ext.ApiServer(os.path.join(self.tmp, 'stale'))
        self.addCleanup(server.server_close)

        def replace():
            time.sleep(0.1)
            os.replace(self.write_file(source + '.new', '# v2\n'), source)

        thread = threading.Thread(target=replace)
        thread.start()
        self.addCleanup(thread.join)
        self.assertEqual(ext.serve_until_idle(server, 30, [source], poll_seconds=0.01), 'changed')

    def test_exits_when_the_sources_are_deleted(self):
        # tessera-ext has the old deploy/ bind-mounted: the update deletes the files there.
        source = os.path.join(self.tmp, 'gone.py')
        self.write_file(source, '# v1\n')
        server = ext.ApiServer(os.path.join(self.tmp, 'gone'))
        self.addCleanup(server.server_close)
        threading.Timer(0.1, os.remove, [source]).start()
        self.assertEqual(ext.serve_until_idle(server, 30, [source], poll_seconds=0.01), 'changed')

    def test_a_replaced_source_leaves_the_waiting_connection_unanswered(self):
        # The connection must stay queued on the socket for systemd to hand to a fresh process.
        source = os.path.join(self.tmp, 'queued.py')
        self.write_file(source, '# v1\n')
        path = os.path.join(self.tmp, 'queued')
        server = ext.ApiServer(path)
        self.addCleanup(server.server_close)
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(client.close)

        def replace_then_connect():
            # In this order: a connection that was already waiting at the start is served.
            time.sleep(0.1)
            os.remove(source)
            client.connect(path)
            client.sendall(b'GET /tessera-ext/v1/status HTTP/1.0\r\n\r\n')

        thread = threading.Thread(target=replace_then_connect)
        thread.start()
        self.addCleanup(thread.join)
        self.assertEqual(ext.serve_until_idle(server, 30, [source], poll_seconds=0.01), 'changed')
        client.settimeout(0.2)
        with self.assertRaises(socket.timeout):
            client.recv(1)

    @staticmethod
    def write_file(path, text):
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
        return path


# ------------------------------------------------------------------ plugin services (api.services)

SERVICE_DECL = {'name': 'obico', 'authHeader': 'X-Api-Key', 'allowPaths': ['api/v1/', 'media/']}


def put_service_plugin(base, services=(SERVICE_DECL,), pid='acme/svc', directory='svc'):
    """A hand-installed plugin whose manifest declares services."""
    os.makedirs(base.path(directory), exist_ok=True)
    data = {'id': pid, 'name': 'Svc', 'version': '1.0.0', 'entry': 'index.js', 'services': list(services)}
    with open(base.path(directory, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f)


class ServiceTests(Base):
    """The store and the checks, without sockets (they run on Windows too)."""

    def test_manifest_declarations_are_validated(self):
        good = dict(SERVICE_DECL)
        bad = [
            {**good, 'name': 'Bad Name'},
            {**good, 'authHeader': 'Host'},
            {**good, 'authHeader': 'Cookie'},
            {**good, 'authHeader': 'X-Api-Key\r\nX-Evil'},
            {**good, 'authPrefix': 'Bearer\n'},
            {**good, 'allowPaths': []},
            {**good, 'allowPaths': ['/api/']},
            {**good, 'allowPaths': ['api/../admin/']},
            {**good, 'allowPaths': 'api/'},
        ]
        for decl in bad:
            with self.subTest(decl=decl):
                self.assertEqual(ext.manifest_services({'services': [decl]}), {})
        found = ext.manifest_services({'services': [good, {**good, 'authHeader': 'Other'}]})
        self.assertEqual(list(found), ['obico'])  # a repeated name is ignored, not merged
        self.assertEqual(found['obico']['authPrefix'], '')

    def test_set_keeps_the_secret_private_and_the_file_owner_only(self):
        put_service_plugin(self)
        view = ext.set_service('acme/svc', 'obico', 'http://192.168.1.20:3334/', 'tok')
        self.assertEqual(view, {'name': 'obico', 'configured': True, 'url': 'http://192.168.1.20:3334', 'hasSecret': True})
        self.assertNotIn('tok', json.dumps(ext.get_service('acme/svc', 'obico')))
        if os.name != 'nt':
            mode = os.stat(os.path.join(ext.SERVICES_DIR, ext.SERVICES_FILE)).st_mode & 0o777
            self.assertEqual(mode, 0o600)

        # No secret in the request: the saved one stays; '' clears it.
        ext.set_service('acme/svc', 'obico', 'http://obico.local:3334', None)
        self.assertEqual(ext.read_services()['acme/svc']['obico'], {'url': 'http://obico.local:3334', 'secret': 'tok'})
        self.assertFalse(ext.set_service('acme/svc', 'obico', 'http://obico.local:3334', '')['hasSecret'])

        self.assertTrue(ext.remove_service('acme/svc', 'obico')['changed'])
        self.assertEqual(ext.read_services(), {})
        self.assertFalse(ext.get_service('acme/svc', 'obico')['configured'])

    def test_only_declared_services_of_installed_plugins(self):
        put_service_plugin(self)
        for pid, name in (('acme/svc', 'other'), ('acme/nope', 'obico')):
            with self.subTest(pid=pid, name=name):
                with self.assertRaises(ext.ExtError) as e:
                    ext.set_service(pid, name, 'http://x', 's')
                self.assertEqual(e.exception.status, 404)

    def test_addresses_and_secrets_are_checked(self):
        put_service_plugin(self)
        for url in ('ftp://x', 'http://u:p@x', 'http://x/?a=1', 'http://x/#f', 'x', '', 'http://' + 'a' * 400):
            with self.subTest(url=url):
                with self.assertRaises(ext.ExtError):
                    ext.set_service('acme/svc', 'obico', url, 's')
        for secret in ('a\r\nX-Evil: 1', 'тест', 'x' * 5000):
            with self.subTest(secret=secret[:10]):
                with self.assertRaises(ext.ExtError):
                    ext.set_service('acme/svc', 'obico', 'http://x', secret)
        self.assertEqual(ext.read_services(), {})

    def test_proxy_paths(self):
        decl = ext.manifest_services({'services': [SERVICE_DECL]})['obico']
        ext.check_proxy_path('api/v1/printers/', decl)
        ext.check_proxy_path('media/tsd-pics/a%20b.jpg', decl)
        for path, status in (('admin/', 403), ('api/v2/x', 403), ('', 400), ('/api/v1/', 400),
                             ('api/v1/../../admin/', 400), ('api/v1/%2e%2e/%2e%2e/admin/', 400),
                             ('api/v1/a%5c..%5cb', 400), ('api/v1/%0d%0a', 400)):
            with self.subTest(path=path):
                with self.assertRaises(ext.ExtError) as e:
                    ext.check_proxy_path(path, decl)
                self.assertEqual(e.exception.status, status)

    def test_services_paths(self):
        self.assertEqual(ext.parse_services_path('services/acme%2Fsvc/obico'), ('acme/svc', 'obico', None))
        self.assertEqual(ext.parse_services_path('services/acme%2Fsvc/obico/proxy/api/v1/x'), ('acme/svc', 'obico', 'api/v1/x'))
        for path in ('services/acme%2Fsvc', 'services/acme%2Fsvc/obico/proxy', 'services/acme%2Fsvc/obico/other/x',
                     'services/acme%2Fsvc/Bad', 'services/%0a/obico'):
            with self.subTest(path=path):
                with self.assertRaises(ext.ExtError):
                    ext.parse_services_path(path)

    def test_cli(self):
        put_service_plugin(self)
        out = io.StringIO()
        stdin = sys.stdin
        self.addCleanup(setattr, sys, 'stdin', stdin)
        sys.stdin = io.StringIO('tok\n')
        with contextlib.redirect_stdout(out):
            ext.main(['service', 'set', 'svc', 'obico', 'http://obico.local:3334'])
            ext.main(['service', 'list'])
            ext.main(['service', 'show', 'acme/svc', 'obico'])
            ext.main(['service', 'set', 'svc', 'obico', 'http://obico.local:3334', '--clear-secret'])
            ext.main(['service', 'remove', 'svc', 'obico'])
        text = out.getvalue()
        self.assertIn('acme/svc obico  http://obico.local:3334', text)
        self.assertIn('secret set', text)
        self.assertIn('secret not set', text)
        self.assertNotIn('tok', text)
        self.assertEqual(ext.read_services(), {})


class FakeService(http.server.BaseHTTPRequestHandler):
    """The upstream: echoes what reached it, or answers what a test asks for."""
    seen = []
    reply = None  # (status, headers, body) or None for the echo

    def answer(self):
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length) if length else b''
        FakeService.seen.append((self.command, self.path, dict(self.headers), body))
        status, headers, payload = FakeService.reply or (200, {'Content-Type': 'application/json'},
                                                         json.dumps({'path': self.path}).encode())
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = answer

    def log_message(self, *args):
        pass


class ServicesApiTests(ApiBase):
    """The services routes on the real socket, with Moonraker and the upstream faked."""

    def setUp(self):
        super().setUp()
        FakeService.seen = []
        FakeService.reply = None
        self.upstream = http.server.HTTPServer(('127.0.0.1', 0), FakeService)
        threading.Thread(target=self.upstream.serve_forever, daemon=True).start()
        self.addCleanup(self.upstream.server_close)
        self.addCleanup(self.upstream.shutdown)
        self.base = f'http://127.0.0.1:{self.upstream.server_port}/obico'
        put_service_plugin(self)

    def svc(self, method, path, body=None, headers=None, raw=False):
        """A services request; `raw` returns (status, headers, bytes) instead of JSON."""
        conn = UnixConnection(self.socket_path)
        all_headers = {'X-Real-IP': '192.168.1.50', 'Host': 'printer:8000', 'X-Tessera-Plugin': 'acme/svc'}
        if isinstance(body, dict):
            all_headers['Content-Type'] = 'application/json'
            body = json.dumps(body)
        all_headers.update(headers or {})
        all_headers = {k: v for k, v in all_headers.items() if v is not None}
        conn.request(method, f'/tessera-api/v1/services/acme%2Fsvc/{path}', body, all_headers)
        res = conn.getresponse()
        data = res.read()
        conn.close()
        if raw:
            return res.status, res.headers, data
        return res.status, json.loads(data) if data else None

    def configure(self, secret='tok'):
        return self.svc('PUT', 'obico', {'url': self.base, 'secret': secret})

    def test_configure_view_remove(self):
        self.assertEqual(self.svc('GET', 'obico')[1]['configured'], False)
        code, body = self.configure()
        self.assertEqual((code, body['hasSecret'], body['url']), (200, True, self.base))
        code, body = self.svc('GET', 'obico')
        self.assertEqual((code, body['configured']), (200, True))
        self.assertNotIn('tok', json.dumps(body))
        self.assertEqual(self.svc('DELETE', 'obico')[1]['changed'], True)
        self.assertEqual(self.svc('GET', 'obico')[1]['configured'], False)

    def test_proxy_forwards_with_the_secret_and_nothing_of_the_browser(self):
        self.configure()
        code, headers, data = self.svc('GET', 'obico/proxy/api/v1/printers/?with_archived=true', raw=True,
                                       headers={'Authorization': 'Bearer moonraker', 'Cookie': 'a=b',
                                                'X-Api-Key': 'moonraker-key', 'Accept': 'application/json'})
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(data), {'path': '/obico/api/v1/printers/?with_archived=true'})
        self.assertEqual(headers['X-Tessera-Service'], 'upstream')
        self.assertIn('sandbox', headers['Content-Security-Policy'])
        _, _, seen, _ = FakeService.seen[0]
        seen = {k.lower(): v for k, v in seen.items()}
        self.assertEqual(seen['x-api-key'], 'tok')
        self.assertEqual(seen['accept'], 'application/json')
        self.assertNotIn('authorization', seen)
        self.assertNotIn('cookie', seen)
        self.assertNotIn('x-real-ip', seen)

    def test_proxy_forwards_bodies_and_upstream_errors(self):
        self.configure()
        payload = json.dumps({'action_on_failure': 'PAUSE'})
        code, _, _ = self.svc('PATCH', 'obico/proxy/api/v1/printers/3/', payload, raw=True,
                              headers={'Content-Type': 'application/json'})
        self.assertEqual(code, 200)
        method, _, seen, body = FakeService.seen[0]
        self.assertEqual((method, body.decode()), ('PATCH', payload))
        self.assertEqual({k.lower(): v for k, v in seen.items()}['content-type'], 'application/json')

        FakeService.reply = (404, {'Content-Type': 'application/json'}, b'{"detail": "Not found."}')
        code, headers, data = self.svc('GET', 'obico/proxy/api/v1/printers/99/', raw=True)
        self.assertEqual((code, headers['X-Tessera-Service'], data), (404, 'upstream', b'{"detail": "Not found."}'))

    def test_proxy_refusals_are_its_own(self):
        code, headers, _ = self.svc('GET', 'obico/proxy/api/v1/x', raw=True)
        self.assertEqual((code, headers['X-Tessera-Service']), (409, None))  # not set up yet
        self.configure()
        self.assertEqual(self.svc('GET', 'obico/proxy/admin/')[0], 403)
        self.assertEqual(self.svc('GET', 'obico/proxy/api/v1/%2e%2e/%2e%2e/admin/')[0], 400)
        self.assertEqual(FakeService.seen, [])

        FakeService.reply = (302, {'Location': 'http://elsewhere/'}, b'')
        code, body = self.svc('GET', 'obico/proxy/api/v1/x')
        self.assertEqual(code, 502)
        self.assertIn('redirected', body['error'])

        self.upstream.shutdown()
        self.upstream.server_close()
        self.assertEqual(self.svc('GET', 'obico/proxy/api/v1/x')[0], 502)

    def test_protection(self):
        self.configure()
        self.assertEqual(self.svc('GET', 'obico/proxy/api/v1/x', headers={'X-Tessera-Plugin': None})[0], 403)
        self.assertEqual(self.svc('GET', 'obico/proxy/api/v1/x', headers={'X-Tessera-Plugin': 'acme/other'})[0], 403)
        self.assertEqual(self.svc('GET', 'obico', headers={'Origin': 'http://evil.example'})[0], 403)
        self.assertEqual(self.svc('PUT', 'obico', json.dumps({'url': self.base}), headers={'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.svc('PUT', 'obico', {'url': self.base, 'authHeader': 'Host'})[0], 400)
        FakeService.seen = []
        FakeMoonraker.status = 401
        for method, path in (('GET', 'obico'), ('DELETE', 'obico'), ('GET', 'obico/proxy/api/v1/x')):
            with self.subTest(method=method, path=path):
                self.assertEqual(self.svc(method, path)[0], 401)
        self.assertEqual(FakeService.seen, [])

    def test_body_limit(self):
        self.configure()
        # A small limit: a body larger than what the service drains would break the pipe before
        # the answer (behind nginx it never arrives, client_max_body_size stops it first).
        self.addCleanup(setattr, ext, 'MAX_PROXY_BODY', ext.MAX_PROXY_BODY)
        ext.MAX_PROXY_BODY = 1000
        code, _ = self.svc('POST', 'obico/proxy/api/v1/x', 'x' * 1001, headers={'Content-Type': 'text/plain'})
        self.assertEqual(code, 413)
        self.assertEqual(FakeService.seen, [])

    def test_other_methods_and_paths(self):
        self.assertEqual(self.svc('POST', 'obico', {'url': self.base})[0], 404)
        self.assertEqual(self.call('PUT', 'install', {'id': 'x'})[0], 404)
        self.assertEqual(self.call('DELETE', 'status')[0], 404)


if __name__ == '__main__':
    unittest.main()
