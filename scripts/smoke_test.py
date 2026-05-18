"""Run backend smoke tests from repo root: python scripts/smoke_test.py"""

from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parent.parent / "backend" / "scripts" / "smoke_test.py"))
