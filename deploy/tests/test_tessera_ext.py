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
class ApiTests(Base):
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

        def fake_fetch(url):
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

    def test_idle_exit(self):
        server = ext.ApiServer(os.path.join(self.tmp, 'idle'))
        self.addCleanup(server.server_close)
        server.timeout = 0.01
        while not server.idle:
            server.handle_request()
        self.assertTrue(server.idle)


if __name__ == '__main__':
    unittest.main()
