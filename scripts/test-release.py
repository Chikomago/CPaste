import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('publish-update-manifest.py')


class ReleaseManifestTests(unittest.TestCase):
    def release(self):
        names = ['CPaste_0.1.0_macos_aarch64.app.tar.gz',
                 'CPaste_0.1.0_macos_x64.app.tar.gz',
                 'CPaste_0.1.0_windows_x64.exe']
        return {'assets': [{'name': name + suffix, 'size': 123}
                           for name in names for suffix in ['', '.sig']],
                'body': 'Release notes', 'url': 'https://github.com/Chikomago/CPaste/releases/tag/v0.1.0',
                'isDraft': True}

    def generate(self, release):
        def download(args, **_):
            folder = Path(args[args.index('--dir') + 1])
            name = args[args.index('--pattern') + 1]
            (folder / name).write_text('fixture-signature')

        with tempfile.TemporaryDirectory() as temporary:
            previous = Path.cwd()
            try:
                os.chdir(temporary)
                with patch('sys.argv', [str(SCRIPT), 'v0.1.0']), \
                     patch('subprocess.check_output', return_value=json.dumps(release)), \
                     patch('subprocess.run', side_effect=download):
                    runpy.run_path(str(SCRIPT), run_name='__main__')
                return json.loads(Path('latest.json').read_text())
            finally:
                os.chdir(previous)

    def test_complete_manifest_has_correct_architectures_and_tag_urls(self):
        manifest = self.generate(self.release())
        self.assertEqual(set(manifest['platforms']), {'darwin-aarch64', 'darwin-x86_64', 'windows-x86_64'})
        self.assertEqual(manifest['version'], '0.1.0')
        self.assertIn('/releases/download/v0.1.0/', manifest['platforms']['windows-x86_64']['url'])
        self.assertTrue(manifest['platforms']['darwin-aarch64']['url'].endswith('aarch64.app.tar.gz'))

    def test_missing_signature_blocks_publication(self):
        release = self.release()
        release['assets'] = release['assets'][:-1]
        with self.assertRaisesRegex(AssertionError, 'Missing signature'):
            self.generate(release)

    def test_missing_architecture_blocks_publication(self):
        release = self.release()
        release['assets'] = [asset for asset in release['assets'] if 'aarch64' not in asset['name']]
        with self.assertRaisesRegex(AssertionError, 'darwin-aarch64'):
            self.generate(release)


if __name__ == '__main__':
    unittest.main()
