"""Seed IFRS 15 contract modification demo scenarios.

Default company_id = ae7301ab (Al Noor). Also pass --company-id emaar-dev
to match the live workspace selector.

Usage (from repo root):
  python scripts/seed_modifications_demo.py
  python scripts/seed_modifications_demo.py --company-id emaar-dev
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "frontend" / ".env")

from backend.app.services.ifrs15_modifications_db import mods_db
from backend.app.services.supabase_client import is_supabase_configured


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def seed(company_id: str) -> None:
    existing = mods_db.list_mods(company_id)
    refs = {str(r.get("modification_ref") or "") for r in existing}

    if "MOD-A-2026-001" not in refs:
        moda = mods_db.insert_mod(
            {
                "company_id": company_id,
                "contract_id": "SPA-OFFPLAN-001",
                "modification_date": "2026-06-30",
                "modification_ref": "MOD-A-2026-001",
                "description": (
                    "Handover delay on off-plan SPA. Developer grants AED 100,000 price concession "
                    "after 12 months of construction progress. Oqood amendment required."
                ),
                "modification_type": "price_change",
                "contract_type": "uae_real_estate",
                "original_transaction_price": "2500000.0000",
                "original_term_months": 24,
                "months_elapsed": 12,
                "original_progress_pct": "50.0000",
                "revenue_recognised_to_date": "1250000.0000",
                "price_change_amount": "-100000.0000",
                "new_transaction_price": "2400000.0000",
                "new_term_months": 24,
                "are_new_services_distinct": False,
                "are_remaining_services_distinct": False,
                "ai_treatment": "C_catchup",
                "ai_classification_reason": (
                    "Price concession after handover delay does not add distinct goods/services. "
                    "Remaining off-plan construction is not distinct from work already transferred "
                    "(single performance obligation). IFRS 15.21(b) cumulative catch-up applies."
                ),
                "ai_confidence": "high",
                "ai_key_judgment": "Single POB for off-plan unit; concession updates transaction price from inception.",
                "ai_risk_flag": "Negative catch-up reduces current-period revenue by AED 50,000.",
                "updated_progress_pct": "50.0000",
                "revenue_should_have_been": "1200000.0000",
                "catch_up_adjustment": "-50000.0000",
                "status": "ai_classified",
                "prepared_by": "seed",
                "updated_at": _now(),
            }
        )
        mods_db.add_audit(moda["id"], "created", actor="seed", new_value={"ref": "MOD-A-2026-001"})
        mods_db.add_audit(
            moda["id"],
            "ai_classified",
            actor="seed",
            new_value={"treatment": "C_catchup", "catch_up_adjustment": -50000},
            note="Expected catch-up AED -50,000 (reduce revenue)",
        )
        print(f"Inserted MOD-A {moda['id']} catch-up=-50000")
    else:
        print("MOD-A-2026-001 already exists — skipped")

    if "MOD-B-2026-001" not in refs:
        modb = mods_db.insert_mod(
            {
                "company_id": company_id,
                "contract_id": "SAAS-PREM-001",
                "modification_date": "2026-06-01",
                "modification_ref": "MOD-B-2026-001",
                "description": (
                    "Month 6 mid-term upgrade from standard to premium SaaS tier. "
                    "New annual price AED 18,000; added premium features are distinct and priced at SSP."
                ),
                "modification_type": "scope_and_price",
                "contract_type": "saas_subscription",
                "original_transaction_price": "12000.0000",
                "original_term_months": 12,
                "months_elapsed": 6,
                "original_progress_pct": "50.0000",
                "revenue_recognised_to_date": "6000.0000",
                "price_change_amount": "6000.0000",
                "new_transaction_price": "18000.0000",
                "new_term_months": 12,
                "new_ssp_of_added_services": "6000.0000",
                "are_new_services_distinct": True,
                "are_remaining_services_distinct": True,
                "ai_treatment": "B_prospective",
                "ai_classification_reason": (
                    "Premium features are distinct remaining services. Account prospectively under "
                    "IFRS 15.21(a): terminate original remaining term and recognise future 6 months "
                    "at AED 1,500/month. No cumulative catch-up."
                ),
                "ai_confidence": "high",
                "ai_key_judgment": "Distinctness of remaining SaaS access vs delivered months.",
                "status": "ai_classified",
                "prepared_by": "seed",
                "updated_at": _now(),
            }
        )
        mods_db.add_audit(modb["id"], "created", actor="seed", new_value={"ref": "MOD-B-2026-001"})
        mods_db.add_audit(
            modb["id"],
            "ai_classified",
            actor="seed",
            new_value={"treatment": "B_prospective"},
            note="Prospective only — no catch-up",
        )
        print(f"Inserted MOD-B {modb['id']} treatment=B_prospective")
    else:
        print("MOD-B-2026-001 already exists — skipped")

    print("Expected:")
    print("  MOD-A UAE RE: TP 2,400,000 × 50% = 1,200,000 − 1,250,000 recognised → catch-up -50,000")
    print("  MOD-B SaaS: Treatment B prospective; remaining 6 months at AED 1,500/month")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-id", default="ae7301ab", help="Firm / company id to seed")
    args = parser.parse_args()
    if not is_supabase_configured():
        print("ERROR: Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
        return 1
    seed(args.company_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
