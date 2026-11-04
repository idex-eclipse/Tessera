"""Tests of deploy/tessera-update-manager.py: python -m unittest discover -s deploy/tests

The network is replaced by a fake that serves build-info and the archive, the
installation is a temp folder. No sockets, no GitHub.
"""

import hashlib
import importlib.util
import io
import os
import pathlib
import shutil
import tarfile
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent

spec = importlib.util.spec_from_file_location('tessera_update_manager', HERE.parent / 'tessera-update-manager.py')
um = importlib.util.module_from_spec(spec)
spec.loader.exec_module(um)

OLD = 'a' * 40
NEW = 'b' * 40


def build_archive(commit, extra=None, skip=None):
    """A .tar.gz with the layout tools/pack-release.sh produces."""
    files = {
        'host/dist/index.html': b'<html>' + commit.encode() + b'</html>',
        'deploy/install.sh': b'#!/bin/bash\n',
        'deploy/install-ext.sh': b'#!/bin/bash\n',
        'deploy/tessera-ext.py': b'# ext\n',
        'deploy/tessera-update-manager.py': b'# manager\n',
        'build-info': f'COMMIT={commit}\nBRANCH=main\nDATE=2026-01-01\nVERSION=1.2.3\n'.encode(),
    }
    files.update(extra or {})
    for name in skip or ():
        del files[name]
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tar:
        for name, content in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            info.mode = 0o755 if name.endswith('.sh') else 0o644
            tar.addfile(info, io.BytesIO(content))
    return buf.getvalue()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dir = os.path.join(self.tmp, 'tessera')
        os.makedirs(os.path.join(self.dir, 'host', 'dist'))
        os.makedirs(os.path.join(self.dir, 'deploy'))
        os.makedirs(os.path.join(self.dir, 'extensions', 'mine'))
        self.write('host/dist/index.html', '<html>old</html>')
        self.write('build-info', f'COMMIT={OLD}\nBRANCH=main\nDATE=2025-12-01\n')
        self.write('extensions/mine/manifest.json', '{}')

        self.conf = os.path.join(self.tmp, 'install.conf')
        with open(self.conf, 'w', encoding='utf-8') as f:
            f.write('BRANCH=main\nREPO_URL=https://github.com/acme/tessera.git\n')

        self.saved = (um.INSTALL_DIR, um.CONF_FILE, um.open_https)
        um.INSTALL_DIR, um.CONF_FILE = self.dir, self.conf
        um._status_cache.update(at=float('-inf'), remote=None, error=None)
        self.addCleanup(self.restore)

        self.remote = {}
        um.open_https = self.fake_open

    def restore(self):
        um.INSTALL_DIR, um.CONF_FILE, um.open_https = self.saved

    def write(self, rel, text):
        path = os.path.join(self.dir, *rel.split('/'))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)

    def read(self, rel):
        with open(os.path.join(self.dir, *rel.split('/')), encoding='utf-8') as f:
            return f.read()

    def publish(self, commit=NEW, archive=None, sha=None, branch='main'):
        """Makes the fake release serve a build (more branches can be added by calling it again)."""
        archive = archive if archive is not None else build_archive(commit)
        name = f'tessera-{commit[:7]}.tar.gz'
        sha = sha or hashlib.sha256(archive).hexdigest()
        base = f'https://github.com/acme/tessera/releases/download/build-{branch}'
        self.remote[f'{base}/build-info'] = (
            f'COMMIT={commit}\nBRANCH={branch}\nVERSION=1.2.3\nARCHIVE={name}\nSHA256={sha}\n'
        ).encode()
        self.remote[f'{base}/{name}'] = archive

    def fake_open(self, url):
        if url not in self.remote:
            raise um.urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
        return io.BytesIO(self.remote[url])


class StatusTests(Base):
    def test_update_available(self):
        self.publish()
        status = um.api_status()
        self.assertTrue(status['updateAvailable'])
        self.assertTrue(status['canUpdate'])
        self.assertEqual(status['installed']['commit'], OLD[:7])
        self.assertEqual(status['remote']['commit'], NEW[:7])
        self.assertEqual(status['remote']['version'], '1.2.3')

    def test_up_to_date(self):
        self.publish(commit=OLD)
        self.assertFalse(um.api_status()['updateAvailable'])

    def test_unreachable_remote_is_reported_not_raised(self):
        status = um.api_status()
        self.assertFalse(status['updateAvailable'])
        self.assertIn('HTTP 404', status['remoteError'])

    def test_source_checkout_cannot_self_update(self):
        os.makedirs(os.path.join(self.dir, '.git'))
        self.publish()
        status = um.api_status()
        self.assertFalse(status['canUpdate'])
        self.assertFalse(status['updateAvailable'])
        with self.assertRaises(um.ExtError):
            um.api_update()

    def test_non_github_repository_is_refused(self):
        with open(self.conf, 'w', encoding='utf-8') as f:
            f.write('BRANCH=main\nREPO_URL=https://example.com/x/y.git\n')
        self.assertIn('not a GitHub repository', um.api_status()['remoteError'])

    def test_repo_slug(self):
        self.assertEqual(um.repo_slug('https://github.com/a/b.git'), 'a/b')
        self.assertEqual(um.repo_slug('git@github.com:a/b'), 'a/b')
        self.assertIsNone(um.repo_slug('https://gitlab.com/a/b'))
        self.assertIsNone(um.repo_slug('https://github.com/a/b/../c'))


class UpdateTests(Base):
    def test_swaps_the_build_and_keeps_extensions(self):
        self.publish()
        result = um.api_update()
        self.assertEqual(result, {'changed': True, 'from': OLD[:7], 'to': NEW[:7]})
        self.assertIn(NEW, self.read('host/dist/index.html'))
        self.assertIn(NEW, self.read('build-info'))
        self.assertTrue(os.path.isfile(os.path.join(self.dir, 'deploy', 'tessera-update-manager.py')))
        self.assertEqual(self.read('extensions/mine/manifest.json'), '{}')
        leftovers = [n for n in os.listdir(self.dir) if n.startswith('.') and n != um.LOCK_FILE]
        self.assertEqual(leftovers, [])

    def test_nothing_to_do_when_current(self):
        self.publish(commit=OLD)
        self.assertFalse(um.api_update()['changed'])
        self.assertIn('old', self.read('host/dist/index.html'))

    def test_sha256_mismatch_keeps_the_old_build(self):
        self.publish(sha='0' * 64)
        with self.assertRaisesRegex(um.ExtError, 'sha256'):
            um.api_update()
        self.assertIn('old', self.read('host/dist/index.html'))
        self.assertEqual([n for n in os.listdir(self.dir) if n.startswith('.staging-')], [])

    def test_incomplete_archive_keeps_the_old_build(self):
        archive = build_archive(NEW, skip=['deploy/tessera-update-manager.py'])
        self.publish(archive=archive)
        with self.assertRaisesRegex(um.ExtError, 'no deploy/tessera-update-manager.py'):
            um.api_update()
        self.assertIn('old', self.read('host/dist/index.html'))

    def test_unsafe_paths_are_refused(self):
        for name in ('../evil', '/etc/evil', 'host/../../evil'):
            with self.subTest(name=name):
                self.publish(archive=build_archive(NEW, extra={name: b'x'}))
                with self.assertRaises(um.ExtError):
                    um.api_update()
                self.assertFalse(os.path.exists(os.path.join(self.tmp, 'evil')))
                self.assertIn('old', self.read('host/dist/index.html'))

    def test_links_are_refused(self):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w:gz') as tar:
            link = tarfile.TarInfo('host/link')
            link.type = tarfile.SYMTYPE
            link.linkname = '/etc/passwd'
            tar.addfile(link)
        self.publish(archive=buf.getvalue())
        with self.assertRaisesRegex(um.ExtError, 'unsupported entry'):
            um.api_update()

    def test_invalid_build_info_is_refused(self):
        self.publish()
        base = 'https://github.com/acme/tessera/releases/download/build-main'
        self.remote[f'{base}/build-info'] = b'COMMIT=zzz\nARCHIVE=../x\nSHA256=1\n'
        with self.assertRaisesRegex(um.ExtError, 'invalid'):
            um.api_update()

    def test_interrupted_swap_is_rolled_back_first(self):
        # A killed update left the previous host in .old/ and a half-built new one in place.
        old = os.path.join(self.dir, '.old')
        os.makedirs(os.path.join(old, 'host'))
        with open(os.path.join(old, 'host', 'marker'), 'w', encoding='utf-8') as f:
            f.write('previous')
        shutil.rmtree(os.path.join(self.dir, 'host'))
        os.makedirs(os.path.join(self.dir, 'host'))
        um.recover_swap()
        self.assertEqual(self.read('host/marker'), 'previous')
        self.assertFalse(os.path.exists(old))

    def test_download_limit(self):
        self.publish()
        saved = um.MAX_ARCHIVE_BYTES
        um.MAX_ARCHIVE_BYTES = 10
        self.addCleanup(setattr, um, 'MAX_ARCHIVE_BYTES', saved)
        with self.assertRaisesRegex(um.ExtError, 'larger than'):
            um.api_update()

    def test_switch_branch_installs_it_and_saves_the_choice(self):
        self.publish(commit=OLD, branch='dev')  # same commit: the branch still has to be switched
        result = um.api_update('dev')
        self.assertTrue(result['changed'])
        with open(self.conf, encoding='utf-8') as f:
            conf = f.read()
        self.assertIn('BRANCH=dev\n', conf)
        self.assertIn('REPO_URL=https://github.com/acme/tessera.git', conf)  # other settings kept
        self.assertEqual(um.current_branch(), 'dev')

    def test_switch_to_unpublished_branch_changes_nothing(self):
        self.publish()
        with self.assertRaisesRegex(um.ExtError, 'HTTP 404'):
            um.api_update('nope')
        self.assertEqual(um.current_branch(), 'main')
        self.assertIn('old', self.read('host/dist/index.html'))

    def test_failed_switch_restores_the_setting(self):
        self.publish(branch='dev', sha='0' * 64)
        with self.assertRaisesRegex(um.ExtError, 'sha256'):
            um.api_update('dev')
        self.assertEqual(um.current_branch(), 'main')

    def test_failed_swap_restores_the_setting(self):
        self.publish(branch='dev')
        saved = um.swap_in
        um.swap_in = lambda tree: (_ for _ in ()).throw(um.ExtError('boom'))
        self.addCleanup(setattr, um, 'swap_in', saved)
        with self.assertRaisesRegex(um.ExtError, 'boom'):
            um.api_update('dev')
        self.assertEqual(um.current_branch(), 'main')

    def test_invalid_branch_names_are_refused(self):
        for name in ('../x', 'a b', '', 'x;rm', 5):
            with self.subTest(name=name):
                with self.assertRaises(um.ExtError):
                    um.api_update(name)

    def test_branches_come_from_release_tags(self):
        um._branches_cache.update(at=float('-inf'), branches=None, error=None)
        url = 'https://api.github.com/repos/acme/tessera/releases?per_page=100'
        self.remote[url] = (
            b'[{"tag_name":"build-main"},{"tag_name":"build-dev"},{"tag_name":"v1"},{"tag_name":"build-a..b"}]'
        )
        result = um.api_branches(force=True)
        self.assertEqual(result['branches'], ['dev', 'main'])
        self.assertEqual(result['current'], 'main')

    def test_https_only(self):
        um.open_https = self.saved[2]
        with self.assertRaises(um.ExtError):
            um.open_https('http://example.com/build-info')


if __name__ == '__main__':
    unittest.main()
