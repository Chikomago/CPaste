"""Build a complete manifest only after all architecture uploads finish."""
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import quote

tag = sys.argv[1]
release = json.loads(subprocess.check_output([
    'gh', 'release', 'view', tag, '--json', 'assets,body,url,isDraft'
], text=True))
assert release['isDraft'], 'Only a draft release can be finalized'
assets = {asset['name']: asset for asset in release['assets']}
platforms = {}
with tempfile.TemporaryDirectory() as temporary:
    for platform, os_name, architectures, extension in [
        ('darwin-aarch64', 'macos', ('aarch64', 'arm64'), '.app.tar.gz'),
        ('darwin-x86_64', 'macos', ('x64', 'x86_64'), '.app.tar.gz'),
        ('windows-x86_64', 'windows', ('x64', 'x86_64'), '.exe'),
    ]:
        candidates = [name for name in assets if name.endswith(extension)
                      and any(f'_{os_name}_{arch}' in name for arch in architectures)]
        assert len(candidates) == 1, f'{platform}: expected one update package, found {candidates}'
        name = candidates[0]
        assert assets[name]['size'] > 0, f'Empty update package: {name}'
        signature_name = name + '.sig'
        assert signature_name in assets, f'Missing signature: {signature_name}'
        subprocess.run(['gh', 'release', 'download', tag, '--pattern', signature_name,
                        '--dir', temporary], check=True)
        signature = (Path(temporary) / signature_name).read_text().strip()
        assert signature, f'Empty signature: {signature_name}'
        platforms[platform] = {
            'signature': signature,
            'url': release['url'].replace('/tag/', '/download/') + '/' + quote(name),
        }
manifest = {
    'version': tag.removeprefix('v'),
    'notes': release['body'],
    'pub_date': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
    'platforms': platforms,
}
Path('latest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print('Verified signed packages for ' + ', '.join(platforms))
