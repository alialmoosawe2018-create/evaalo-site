#!/usr/bin/env python3
"""Apply all question-bank patches in order (wave L3 + catalog bridge)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PATCHES = [
    "patch_wave1a_bank.py",
    "patch_wave1b_bank.py",
    "patch_wave2_bank.py",
    "patch_catalog_resolution.py",
]


def main() -> None:
    for name in PATCHES:
        path = ROOT / name
        print(f"\n▶ {name}")
        subprocess.run([sys.executable, str(path)], check=True)
    print("\n✅ all question bank patches applied")


if __name__ == "__main__":
    main()
