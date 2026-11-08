"""Reject mismatched versions before publishing a release."""
import json
from pathlib import Path
import sys
import re

tag = sys.argv[1]
package = json.loads(Path('package.json').read_text())
config = json.loads(Path('src-tauri/tauri.conf.json').read_text())
cargo = Path('src-tauri/Cargo.toml').read_text().split('[lib]')[0]
cargo_version = re.search(r'^version = "([^"]+)"', cargo, re.MULTILINE).group(1)
cargo_license = re.search(r'^license = "([^"]+)"', cargo, re.MULTILINE).group(1)
version = package['version']
assert tag == f'v{version}', f'Tag {tag} does not match package version {version}'
assert version == config['version'] == cargo_version, 'Version files differ'
assert package['license'] == config['bundle']['license'] == cargo_license == 'GPL-3.0-only'
assert config['plugins']['updater']['pubkey'], 'Missing update verification key'
print(f'Release {tag} configuration verified')
