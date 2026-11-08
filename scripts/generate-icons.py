"""Build desktop icons from the editable branding SVGs (requires Pillow)."""
from pathlib import Path
import shutil
import subprocess
import tempfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="cpaste-icons-") as temporary:
    output = Path(temporary)
    app = output / "app"
    tray = output / "tray"
    subprocess.run(["pnpm", "exec", "tauri", "icon", "assets/branding/logo.svg", "--output", str(app)], cwd=ROOT, check=True)
    subprocess.run(["pnpm", "exec", "tauri", "icon", "assets/branding/tray.svg", "--output", str(tray), "--png", "64"], cwd=ROOT, check=True)
    icons = ROOT / "src-tauri/icons"
    for name in ("icon.png", "icon.icns", "icon.ico"):
        shutil.copy2(app / name, icons / name)
    mask = Image.open(tray / "64x64.png").convert("RGBA").getchannel("A")
    white = Image.new("RGBA", mask.size, (255, 255, 255, 0))
    white.putalpha(mask)
    white.save(icons / "tray-white.png")
    (icons / "tray-white.rgba").write_bytes(white.tobytes())
    shutil.copy2(app / "128x128@2x.png", ROOT / "assets/branding/logo-preview.png")
    public = ROOT / "public"
    public.mkdir(exist_ok=True)
    shutil.copy2(ROOT / "assets/branding/logo.svg", public / "logo.svg")
