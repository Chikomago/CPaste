"""Package the Windows release binary as a no-install (portable) zip asset."""
import json
from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile

target = sys.argv[1]
arch = {'x86_64-pc-windows-msvc': 'x64'}[target]
version = json.loads(Path('package.json').read_text())['version']
exe = Path('src-tauri/target') / target / 'release' / 'CPaste.exe'
license_path = Path('LICENSE')
licenses_dir = Path('licenses')
assert exe.is_file() and exe.stat().st_size > 0, f'Missing release binary: {exe}'
assert license_path.is_file(), f'Missing license: {license_path}'
assert licenses_dir.is_dir(), f'Missing licenses directory: {licenses_dir}'

root = f'CPaste_{version}_windows_{arch}_portable'
output = Path('release-assets')
output.mkdir(exist_ok=True)
zip_path = output / f'{root}.zip'

notice = f"""CPaste {version} - Windows portable edition / Windows 绿色版
================================================================

[Run / 运行]
  1. Extract this folder anywhere, then double-click CPaste.exe. No installer needed.
     解压到任意文件夹，双击 CPaste.exe 即可使用，无需安装。
  2. Requires the Microsoft Edge WebView2 Runtime (built into Windows 11 and most
     Windows 10 systems). 需要 Microsoft Edge WebView2 Runtime
     （Windows 11 及多数 Windows 10 已内置）。
  3. If SmartScreen warns, choose "More info" -> "Run anyway".
     若 SmartScreen 拦截，选择「更多信息」→「仍要运行」。

[Data / 数据]
  Clipboard history, preferences, rules and dictionaries are still stored in
  the Tauri app data directory: %APPDATA%\\app.cpaste.desktop\\
  剪贴板历史、偏好设置、规则与词典仍保存在系统用户目录
  %APPDATA%\\app.cpaste.desktop\\（Tauri 的 app_data_dir）。
  Deleting this folder does NOT remove your data; delete that directory too
  if you want a clean removal. 删除解压目录不会清除历史记录；
  如需彻底清理，请一并删除上述系统目录。

[Updates / 更新]
  This portable zip is NOT part of the updater manifest (latest.json).
  本绿色版压缩包不参与自动更新清单（latest.json）。
  Clicking "Check for updates" in the app downloads and silently installs the
  regular NSIS installer, which may replace this portable copy.
  在应用内点击「检查更新」会下载并静默安装官方安装包，可能覆盖为安装版。
  Prefer disabling "auto check for updates" in Settings and downloading new
  portable zips manually. 建议关闭「自动检查更新」，手动下载新版压缩包。

[License / 许可]
  GPL-3.0-only. See LICENSE and the licenses/ folder for third-party notices.
  GPL-3.0-only，详见 LICENSE；第三方组件许可见 licenses/。

Project / 项目主页: https://github.com/Chikomago/CPaste
""".replace('\n', '\r\n')

with ZipFile(zip_path, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    archive.write(exe, f'{root}/CPaste.exe')
    archive.write(license_path, f'{root}/LICENSE')
    for path in sorted(licenses_dir.iterdir()):
        if path.is_file():
            archive.write(path, f'{root}/licenses/{path.name}')
    archive.writestr(f'{root}/README-PORTABLE.txt', notice)
print(zip_path)
