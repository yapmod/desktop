# /// script
# requires-python = ">=3.11"
# dependencies = ["dmgbuild==2.0.0"]
# ///
"""Build the configured Finder layout without a graphical session."""

import argparse
import json
import subprocess
from pathlib import Path

from dmgbuild import build_dmg

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("app", type=Path, help="Tauri .app directory")
parser.add_argument("output", type=Path, help="Destination .dmg")
args = parser.parse_args()
app = args.app.resolve(strict=True)
if app.suffix != ".app" or not (app / "Contents/Info.plist").is_file():
    parser.error("expected a macOS application bundle")

tauri = Path(__file__).resolve().parents[1] / "src-tauri"
config = json.loads((tauri / "tauri.conf.json").read_text())
platform = tauri / "tauri.macos.conf.json"
overrides = json.loads(platform.read_text()) if platform.exists() else {}
layout = {}
for data in (config, overrides):
    layout.update(data.get("bundle", {}).get("macOS", {}).get("dmg", {}))

background = (tauri / layout["background"]).resolve(strict=True)
size = layout["windowSize"]
position = layout.get("windowPosition", {"x": 150, "y": 150})
icons = {
    app.name: layout["appPosition"],
    "Applications": layout["applicationFolderPosition"],
}
args.output.parent.mkdir(parents=True, exist_ok=True)
# Keep Finder layout in .DS_Store. Setting hide_extensions on the .app adds
# FinderInfo to the signed bundle and fails codesign --strict after mounting.
build_dmg(
    str(args.output),
    config["productName"],
    settings={
        "format": "UDZO",
        "files": [str(app)],
        "symlinks": {"Applications": "/Applications"},
        "background": str(background),
        "icon": str((tauri / "icons/icon.icns").resolve(strict=True)),
        "icon_locations": {
            name: (point["x"], point["y"]) for name, point in icons.items()
        },
        "icon_size": 80,
        "text_size": 14,
        "window_rect": (
            (position["x"], position["y"]),
            (size["width"], size["height"]),
        ),
    },
)
subprocess.run(["hdiutil", "verify", str(args.output)], check=True)
