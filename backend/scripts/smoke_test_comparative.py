"""
IFRS 16 comparative reporting smoke test (service layer + optional live API).
Run from repo root: python backend/scripts/smoke_test_comparative.py
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "frontend" / ".env.local")


def test_date_helpers() -> None:
    from backend.app.services.ifrs16_period_snapshot_service import (
        get_fy_label,
        get_fy_period_end,
        get_period_start,
    )

    end = get_fy_period_end(2024, "12-31")
    assert end == date(2024, 12, 31)
    assert get_fy_label(end, "12-31") == "FY2024"
    assert get_period_start(end, "12-31") == date(2024, 1, 1)

    end2 = get_fy_period_end(2025, "03-31")
    assert end2 == date(2025, 3, 31)
    assert get_fy_label(end2, "03-31") == "FY2024-25"
    print("[OK] FY date helpers")


def test_snapshot_calculation() -> None:
    from backend.app.services.ifrs16_period_snapshot_service import calculate_snapshot_from_leases

    leases = [
        {
            "id": "LEASE-001",
            "lease_data": {
                "status": "active",
                "commencement_date": "2024-01-01",
                "lease_end_date": "2028-12-31",
                "payment_amount": 10000,
                "results": {"lease_liability": 500000, "rou_asset": 500000},
                "amortization_schedule": [
                    {
                        "date": "2024-01-31",
                        "payment": 10000,
                        "interest": 2292,
                        "principal": 7708,
                        "depreciation": 10417,
                        "closing_balance": 492292,
                        "rou_closing": 489583,
                    },
                    {
                        "date": "2024-12-31",
                        "payment": 10000,
                        "interest": 2100,
                        "principal": 7900,
                        "depreciation": 10417,
                        "closing_balance": 420000,
                        "rou_closing": 375000,
                    },
                ],
            },
        }
    ]
    snap = calculate_snapshot_from_leases(leases, date(2024, 1, 1), date(2024, 12, 31))
    assert snap["lease_count_active"] >= 1
    assert snap["ll_closing"] > 0
    assert snap["rou_closing"] > 0
    print("[OK] snapshot calculation from schedule")


def test_router_import() -> None:
    from backend.app.routers.ifrs16_comparative import router

    assert router.prefix == "/api/ifrs16/comparative"
    assert len(router.routes) >= 9
    print(f"[OK] comparative router ({len(router.routes)} routes)")


def test_live_settings() -> None:
    from backend.app.services.supabase_client import is_supabase_configured

    if not is_supabase_configured():
        print("[SKIP] live settings — Supabase not configured")
        return

    from backend.app.services.ifrs16_period_snapshot_service import get_firm_settings

    try:
        settings = get_firm_settings("__smoke_comparative__")
    except Exception as exc:
        print(f"[SKIP] live settings — Supabase unreachable ({exc})")
        return
    assert settings.get("fiscal_year_end") == "12-31"
    print("[OK] live firm settings (Supabase)")


def main() -> int:
    try:
        test_date_helpers()
        test_snapshot_calculation()
        test_router_import()
        test_live_settings()
        print("Comparative smoke test passed")
        return 0
    except Exception as exc:
        print(f"[FAIL] {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
