#!/usr/bin/env python3
"""
IFRS 15 standing regression suite — run on every change to calculator, extractor, or IFRS 15 UI.

  python scripts/run_ifrs15_standing_tests.py

Exits non-zero if any test fails.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

STANDING_FILES = [
    "test_ifrs15_multi_pob_regressions.py",
    "test_ifrs15_const_dxb014_fixes.py",
    "test_ifrs15_creek_harbour_fixes.py",
    "test_ifrs15_rpo_bucketing.py",
    "test_ifrs15_gating_shapes.py",
]


def main() -> int:
    paths = [str(ROOT / f) for f in STANDING_FILES]
    missing = [p for p in paths if not Path(p).exists()]
    if missing:
        print("Missing standing test files:", ", ".join(missing), file=sys.stderr)
        return 2

    cmd = [sys.executable, "-m", "pytest", *paths, "-q", "--tb=short"]
    print("IFRS 15 standing suite:", " ".join(STANDING_FILES))
    return subprocess.call(cmd, cwd=str(ROOT))


if __name__ == "__main__":
    raise SystemExit(main())
