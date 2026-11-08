# CPaste 图标

白底黑色标志，字母 C 构成剪贴板轮廓，内部以三条线表示内容。菜单栏／托盘使用同一图形的纯白轮廓版。

- `logo.svg`：应用图标源文件。
- `tray.svg`：菜单栏／托盘源文件。
- `logo-preview.png`：256 px 预览。

修改 SVG 后，在项目根目录运行 `python3 scripts/generate-icons.py`。需要 pnpm、项目依赖和 Python Pillow。脚本更新 macOS ICNS、Windows ICO、PNG、托盘 RGBA 和网页图标。
