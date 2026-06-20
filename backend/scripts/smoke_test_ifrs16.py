"""
IFRS 16 portfolio DB smoke test.
Run from repo root: python backend/scripts/smoke_test_ifrs16.py
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
    try:
        from backend.app.services.ifrs16_db import ifrs16_db
        from backend.app.services.supabase_client import is_supabase_configured
    except Exception as exc:
        print(f"[FAIL] import: {exc}")
        return 1

    if not is_supabase_configured():
        print("[SKIP] IFRS16 DB checks — Supabase env not configured")
        return 0

    firm_id = "__smoke_test_ifrs16__"
    lease_data = {
        "id": "SMOKE-IFRS16-001",
        "lease_id": "SMOKE-IFRS16-001",
        "title": "Dubai Office - Smoke Test",
        "asset": "Dubai Office - Smoke Test",
        "dates": {
            "commencement": "2024-01-01",
            "end": "2028-12-31",
            "term_months": 60,
        },
        "payments": {"monthly": 150000, "currency": "AED"},
        "monthly_payment": 150000,
        "currency": "AED",
        "discount_rate": 5.5,
        "liability": 7500000,
        "rou": 7500000,
        "results": {"lease_liability": 7500000, "rou_asset": 7500000},
        "status": "Active",
    }

    try:
        row = ifrs16_db.upsert_lease(firm_id, lease_data)
        assert row.get("lease_id") == "SMOKE-IFRS16-001"
        print("[OK] IFRS16 lease upsert")

        fetched = ifrs16_db.get_lease(firm_id, "SMOKE-IFRS16-001")
        assert fetched and fetched.get("lease_name")
        print("[OK] IFRS16 lease read")

        portfolio = ifrs16_db.get_portfolio(firm_id)
        assert any(r.get("lease_id") == "SMOKE-IFRS16-001" for r in portfolio)
        print("[OK] IFRS16 portfolio list")

        summary = ifrs16_db.get_portfolio_summary(firm_id)
        assert summary.get("active_leases", 0) >= 1
        print("[OK] IFRS16 portfolio summary")

        ifrs16_db.delete_lease(firm_id, "SMOKE-IFRS16-001")
        print("[OK] IFRS16 lease delete")

        print("IFRS16 smoke test passed")
        return 0
    except Exception as exc:
        print(f"[FAIL] IFRS16 DB: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
