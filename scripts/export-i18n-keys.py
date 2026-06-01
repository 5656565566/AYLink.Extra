#!/usr/bin/env python3
"""
AYLink.Extra i18n key exporter.

Scans Web and Agent source for translation calls and keeps the server-side
Language/template.json plus locale files in sync.

Supported patterns:
  t('Settings.Language', '语言')
  i18n.t("Settings.Language", "语言")
  getString("Settings.Language", "语言")
  WriteError(w, status, "CODE", "Errors.Key", "错误文案")
  "messageKey": "Errors.Key", "message": "错误文案"

Usage:
  python scripts/export-i18n-keys.py
  python scripts/export-i18n-keys.py --scan-path ./AYLink.Web/src --scan-path ./AYLink.Agent
"""

import argparse
import json
import re
import sys
from collections import OrderedDict
from pathlib import Path


DEFAULT_SCAN_PATHS = ["./AYLink.Web/src", "./AYLink.Agent"]
DEFAULT_OUTPUT = "./AYLink.Agent/Language/template.json"
SOURCE_EXTENSIONS = {".vue", ".ts", ".tsx", ".js", ".jsx", ".cs", ".go"}

CALL_PATTERN = re.compile(
    r"""(?:\b(?:i18n\.)?t|\bgetString)\(\s*(['"])([A-Za-z0-9_.]+)\1\s*,\s*(['"])((?:\\.|(?!\3).)*)\3""",
    re.MULTILINE,
)
GO_WRITE_ERROR_PATTERN = re.compile(
    r"""WriteError\(\s*[^,]+,\s*[^,]+,\s*(['"])(?:\\.|(?!\1).)*\1\s*,\s*(['"])([A-Za-z0-9_.]+)\2\s*,\s*(['"])((?:\\.|(?!\4).)*)\4""",
    re.MULTILINE,
)
GO_WRITE_ERROR_KEY_PATTERN = re.compile(
    r"""WriteError\(\s*[^,]+,\s*[^,]+,\s*(['"])(?:\\.|(?!\1).)*\1\s*,\s*(['"])([A-Za-z0-9_.]+)\2""",
    re.MULTILINE,
)
GO_AUTH_SERVICE_ERROR_PATTERN = re.compile(
    r"""writeAuthServiceError\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(['"])(?:\\.|(?!\1).)*\1\s*,\s*(['"])([A-Za-z0-9_.]+)\2\s*,\s*(['"])((?:\\.|(?!\4).)*)\4""",
    re.MULTILINE,
)
GO_SIGNAL_ERROR_PATTERN = re.compile(
    r"""writeSignalError\(\s*[^,]+,\s*(['"])(?:\\.|(?!\1).)*\1\s*,\s*(['"])([A-Za-z0-9_.]+)\2\s*,\s*(['"])((?:\\.|(?!\4).)*)\4""",
    re.MULTILINE,
)
GO_MESSAGE_KEY_PATTERN = re.compile(
    r"""["']messageKey["']\s*:\s*(['"])([A-Za-z0-9_.]+)\1\s*,\s*["']message["']\s*:\s*(['"])((?:\\.|(?!\3).)*)\3""",
    re.MULTILINE,
)


def unescape_text(value: str) -> str:
    return (
        value.replace("\\'", "'")
        .replace('\\"', '"')
        .replace("\\n", "\n")
        .replace("\\t", "\t")
    )


def find_source_files(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for scan_path in paths:
        root = Path(scan_path)
        if not root.exists():
            print(f"Warning: scan path does not exist: {scan_path}", file=sys.stderr)
            continue
        for file in root.rglob("*"):
            if file.is_file() and file.suffix in SOURCE_EXTENSIONS:
                files.append(file)
    return files


def extract_keys(content: str) -> dict[str, str]:
    keys: dict[str, str] = {}
    for match in CALL_PATTERN.finditer(content):
        key = match.group(2)
        default_text = unescape_text(match.group(4))
        if key not in keys or (not keys[key] and default_text):
            keys[key] = default_text

    for match in GO_WRITE_ERROR_PATTERN.finditer(content):
        key = match.group(3)
        default_text = unescape_text(match.group(5))
        if key not in keys or (not keys[key] and default_text):
            keys[key] = default_text

    for match in GO_WRITE_ERROR_KEY_PATTERN.finditer(content):
        key = match.group(3)
        keys.setdefault(key, "")

    for match in GO_AUTH_SERVICE_ERROR_PATTERN.finditer(content):
        key = match.group(3)
        default_text = unescape_text(match.group(5))
        if key not in keys or (not keys[key] and default_text):
            keys[key] = default_text

    for match in GO_SIGNAL_ERROR_PATTERN.finditer(content):
        key = match.group(3)
        default_text = unescape_text(match.group(5))
        if key not in keys or (not keys[key] and default_text):
            keys[key] = default_text

    for match in GO_MESSAGE_KEY_PATTERN.finditer(content):
        key = match.group(2)
        default_text = unescape_text(match.group(4))
        if key not in keys or (not keys[key] and default_text):
            keys[key] = default_text

    return keys


def build_nested_dict(flat_keys: dict[str, str]) -> OrderedDict:
    nested = OrderedDict()
    nested["LanguageName"] = ""

    for key in sorted(flat_keys.keys()):
        parts = key.split(".")
        current = nested
        for part in parts[:-1]:
            current = current.setdefault(part, OrderedDict())
        current[parts[-1]] = flat_keys[key]

    return nested


def flatten_nested_dict(data: dict, prefix: str = "") -> dict[str, str]:
    flat: dict[str, str] = {}
    for key, value in data.items():
        if key == "LanguageName":
            continue
        full_key = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            flat.update(flatten_nested_dict(value, full_key))
        elif prefix:
            flat[full_key] = str(value)
    return flat


def merge_language_file(template: OrderedDict, lang_file: Path) -> None:
    try:
        existing = json.loads(lang_file.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Warning: failed to read {lang_file}: {exc}", file=sys.stderr)
        return

    def merge(tmpl, exist):
        result = OrderedDict()
        for key, value in tmpl.items():
            if key in exist:
                if isinstance(value, dict) and isinstance(exist[key], dict):
                    result[key] = merge(value, exist[key])
                else:
                    result[key] = exist[key]
            else:
                result[key] = value

        for key, value in exist.items():
            if key not in result:
                result[key] = value

        return result

    merged = merge(template, existing)
    lang_file.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    template_keys = set(flatten_nested_dict(template))
    merged_keys = set(flatten_nested_dict(merged))
    stale_keys = sorted(merged_keys - template_keys)
    print(f"  Synced: {lang_file.name}")
    if stale_keys:
        print(f"  Warning: {lang_file.name} contains {len(stale_keys)} stale keys")
        for key in stale_keys:
            print(f"    - {key}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export AYLink.Extra i18n keys")
    parser.add_argument("--scan-path", action="append", default=[], help="Source directory to scan")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="template.json output path")
    args = parser.parse_args()

    scan_paths = args.scan_path or DEFAULT_SCAN_PATHS
    output_path = Path(args.output)
    all_keys: dict[str, str] = {}
    source_files = find_source_files(scan_paths)

    for file in source_files:
        try:
            keys = extract_keys(file.read_text(encoding="utf-8"))
        except UnicodeDecodeError:
            continue
        for key, default_text in keys.items():
            if key not in all_keys or (not all_keys[key] and default_text):
                all_keys[key] = default_text

    if not all_keys:
        print("No i18n keys found.")
        return 1

    template = build_nested_dict(all_keys)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(template, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Scanned {len(source_files)} files")
    print(f"Found {len(all_keys)} keys")
    print(f"Exported: {output_path}")

    for lang_file in sorted(output_path.parent.glob("*.json")):
        if lang_file.name == output_path.name:
            continue
        merge_language_file(template, lang_file)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
