"""Normalize each architecture's bundles before replacing a public release."""
import json
from pathlib import Path
import shutil
import sys

target = sys.argv[1]
platform, arch = {
    'aarch64-apple-darwin': ('macos', 'aarch64'),
    'x86_64-apple-darwin': ('macos', 'x64'),
    'x86_64-pc-windows-msvc': ('windows', 'x64'),
}[target]
version = json.loads(Path('package.json').read_text())['version']
bundle = Path('src-tauri/target') / target / 'release/bundle'
output = Path('release-assets')
output.mkdir(exist_ok=True)
extensions = ['.app.tar.gz', '.app.tar.gz.sig', '.dmg'] if platform == 'macos' else ['.exe', '.exe.sig']
for extension in extensions:
    candidates = [path for path in bundle.rglob('*') if path.is_file() and path.name.endswith(extension)]
    assert len(candidates) == 1, f'{target}: expected one {extension}, got {candidates}'
    source = candidates[0]
    assert source.stat().st_size > 0, f'Empty bundle: {source}'
    destination = output / f'CPaste_{version}_{platform}_{arch}{extension}'
    shutil.copy2(source, destination)
    print(destination)
