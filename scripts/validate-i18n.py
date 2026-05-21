#!/usr/bin/env python3
"""
Validate AYLink.Extra language files against Language/template.json.
"""

import argparse
import json
from pathlib import Path


DEFAULT_LANGUAGE_DIR = "./AYLink.Agent/Language"


def flatten(data: dict, prefix: str = "") -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in data.items():
        if key == "LanguageName":
            continue
        full_key = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            result.update(flatten(value, full_key))
        elif prefix:
            result[full_key] = str(value)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate AYLink.Extra i18n files")
    parser.add_argument("--language-dir", default=DEFAULT_LANGUAGE_DIR)
    args = parser.parse_args()

    language_dir = Path(args.language_dir)
    template_path = language_dir / "template.json"
    template = json.loads(template_path.read_text(encoding="utf-8"))
    template_keys = set(flatten(template))
    failed = False

    for lang_file in sorted(language_dir.glob("*.json")):
        if lang_file.name == "template.json":
            continue

        data = json.loads(lang_file.read_text(encoding="utf-8"))
        keys = set(flatten(data))
        missing = sorted(template_keys - keys)
        stale = sorted(keys - template_keys)

        if missing:
            failed = True
            print(f"{lang_file.name}: missing {len(missing)} keys")
            for key in missing:
                print(f"  - {key}")
        if stale:
            print(f"{lang_file.name}: stale {len(stale)} keys")
            for key in stale:
                print(f"  - {key}")
        if not missing and not stale:
            print(f"{lang_file.name}: ok")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
