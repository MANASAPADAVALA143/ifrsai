"""
IFRSAI backend smoke checks.
Run from repo root: python backend/scripts/smoke_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "frontend" / ".env")


def main() -> int:
    errors: list[str] = []

    try:
        import py_compile

        py_compile.compile(str(ROOT / "app.py"), doraise=True)
        print("[OK] app.py syntax")
    except Exception as exc:
        errors.append(f"app.py compile: {exc}")

    try:
        from backend.app.services.ifrs15_db import ifrs15_db
        from backend.app.services.supabase_client import is_supabase_configured

        if not is_supabase_configured():
            print("[SKIP] IFRS15 DB checks — Supabase env not configured")
            return 0 if not errors else 1

        test_contract = ifrs15_db.add_contract(
            firm_id="__smoke_test__",
            contract_name="Smoke Test Contract",
            contract_data={"contract_id": "SMOKE-001", "value": 100000, "currency": "USD"},
            summary_data={"risk": "LOW", "disclosure_score": 85},
        )
        assert test_contract.get("id"), "No ID returned"

        fetched = ifrs15_db.get_contract("__smoke_test__", test_contract["id"])
        assert fetched and fetched.get("contract_name") == "Smoke Test Contract"

        ifrs15_db.delete_contract("__smoke_test__", test_contract["id"])
        print("[OK] IFRS15 PORTFOLIO DB: write/read/delete")

        log_entry = ifrs15_db.log_action(
            firm_id="__smoke_test__",
            action="smoke-test",
            details={"note": "automated test", "entry_id": "SMOKE"},
        )
        assert log_entry.get("id")
        print("[OK] IFRS15 AUDIT LOG DB: write")
    except Exception as exc:
        errors.append(f"IFRS15 DB: {exc}")

    if errors:
        for err in errors:
            print(f"[FAIL] {err}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
