"""Prepare a stable release and its GitHub updater manifest (Python 3.11+)."""

import argparse
import base64
import json
import os
import re
import subprocess
import tempfile
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAURI = ROOT / "src-tauri"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, data):
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def stable_version(value):
    number = r"(?:0|[1-9]\d*)"
    if not re.fullmatch(rf"{number}\.{number}\.{number}", value):
        raise ValueError(f"Expected a stable X.Y.Z version, got {value!r}")
    return value


def changelog_section(title):
    log = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    match = re.search(
        rf"^## (?:{re.escape(title)}|\[{re.escape(title.removeprefix('v'))}\](?: — \d{{4}}-\d{{2}}-\d{{2}})?)\n(.*?)(?=^## |\Z)", log, re.MULTILINE | re.DOTALL
    )
    if not match or not match[1].strip():
        raise ValueError(f"Missing release notes under '## {title}' in CHANGELOG.md")
    return match[1].strip()


def check_version(tag):
    version = stable_version(read_json(ROOT / "package.json")["version"])
    crate = tomllib.loads((TAURI / "Cargo.toml").read_text())["package"]
    if tag != f"v{version}" or crate["version"] != version:
        raise ValueError(
            f"Tag, package.json and Cargo versions must match: {tag}, {version}, {crate['version']}"
        )
    locked = tomllib.loads((TAURI / "Cargo.lock").read_text())["package"]
    app_versions = [entry["version"] for entry in locked if entry["name"] == crate["name"]]
    if app_versions != [version]:
        raise ValueError("Cargo.lock must match the desktop version")
    return version


def prepare(version):
    version = stable_version(version)
    package = read_json(ROOT / "package.json")
    previous = check_version("v" + package["version"])
    if tuple(map(int, version.split("."))) <= tuple(map(int, previous.split("."))):
        raise ValueError(f"Version must be newer than {previous}")
    changelog_section("Unreleased")
    cargo_path = TAURI / "Cargo.toml"
    lock_path = TAURI / "Cargo.lock"
    cargo = cargo_path.read_text()
    crate = tomllib.loads(cargo)["package"]["name"]
    locked = lock_path.read_text()
    crate_section = (
        rf'(?ms)(^\[package\]\s*\n(?:(?!^\[).)*?^version = "){re.escape(previous)}(")'
    )
    lock_section = rf'(?m)(^\[\[package\]\]\nname = "{re.escape(crate)}"\nversion = "){re.escape(previous)}(")'
    cargo, n1 = re.subn(crate_section, rf"\g<1>{version}\2", cargo)
    locked, n2 = re.subn(lock_section, rf"\g<1>{version}\2", locked)
    if (n1, n2) != (1, 1):
        raise ValueError(
            "Could not identify the application version in Cargo.toml and Cargo.lock"
        )
    log_path = ROOT / "CHANGELOG.md"
    log = log_path.read_text(encoding="utf-8").replace(
        "## [Unreleased]\n", f"## [Unreleased]\n\n## [{version}]\n", 1
    )
    package["version"] = version
    write_json(ROOT / "package.json", package)
    cargo_path.write_text(cargo)
    lock_path.write_text(locked)
    log_path.write_text(log, encoding="utf-8")
    print(f"Prepared v{version}. Review and commit the changes before tagging.")


def updater_config(tag, destination):
    check_version(tag)
    changelog_section(tag)
    pubkey = os.environ["YAPMOD_UPDATER_PUBLIC_KEY"].strip()
    if not pubkey:
        raise ValueError("Configure the TAURI_UPDATER_PUBLIC_KEY repository variable")
    repo = os.environ["YAPMOD_RELEASE_REPO"]
    write_json(
        destination,
        {
            "bundle": {"createUpdaterArtifacts": True},
            "plugins": {
                "updater": {
                    "pubkey": pubkey,
                    "requireSignedVersion": True,
                    "endpoints": [
                        f"https://github.com/{repo}/releases/latest/download/latest.json"
                    ],
                }
            },
        },
    )


def verify_signature(file, expected_field):
    public_key = os.environ["YAPMOD_UPDATER_PUBLIC_KEY"].strip()
    signature = Path(f"{file}.sig").read_text().strip()
    with tempfile.TemporaryDirectory() as tmp:
        key_path, sig_path = Path(tmp) / "pubkey", Path(tmp) / "signature"
        key_path.write_bytes(base64.b64decode(public_key, validate=True))
        sig_path.write_bytes(base64.b64decode(signature, validate=True))
        trusted = subprocess.check_output(
            [
                "minisign",
                "-Vm",
                str(file),
                "-p",
                str(key_path),
                "-x",
                str(sig_path),
                "-Q",
            ],
            text=True,
        )
    if expected_field not in trusted.strip().split("\t"):
        raise ValueError(f"{file} lacks the expected signed field {expected_field!r}")
    return signature


def manifest(directory, tag):
    version = check_version(tag)
    repo = os.environ["GITHUB_REPOSITORY"]
    notes = changelog_section(tag)
    platforms = {}
    for pattern, targets in [
        ("*.app.tar.gz", ("darwin-aarch64", "darwin-x86_64")),
        ("*.AppImage", ("linux-x86_64", "linux-x86_64-appimage")),
        ("*-setup.exe", ("windows-x86_64",)),
    ]:
        matches = list(directory.glob(pattern))
        if len(matches) != 1:
            raise ValueError(
                f"Expected exactly one {pattern} in {directory}, found {len(matches)}"
            )
        file = matches[0]
        asset = {
            "signature": verify_signature(file, f"version:{version}"),
            "url": f"https://github.com/{repo}/releases/download/{tag}/{file.name}",
        }
        for target in targets:
            platforms[target] = asset
    deb = list(directory.glob("*.deb"))
    if len(deb) != 1:
        raise ValueError(f"Expected one Debian package in {directory}")
    verify_signature(deb[0], f"version:{version}")
    if len(list(directory.glob("*.dmg"))) != 1:
        raise ValueError(f"Expected one macOS disk image in {directory}")
    write_json(
        directory / "latest.json",
        {"version": version, "notes": notes, "platforms": platforms},
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("prepare").add_argument("version")
    commands.add_parser("notes").add_argument("tag")
    commands.add_parser("verify").add_argument("file", type=Path)
    config = commands.add_parser("config")
    config.add_argument("tag")
    config.add_argument("destination", type=Path)
    build = commands.add_parser("manifest")
    build.add_argument("directory", type=Path)
    build.add_argument("tag")
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args.version)
    elif args.command == "notes":
        check_version(args.tag)
        print(changelog_section(args.tag))
    elif args.command == "verify":
        verify_signature(args.file, f"file:{args.file.name}")
    elif args.command == "config":
        updater_config(args.tag, args.destination)
    else:
        manifest(args.directory, args.tag)
