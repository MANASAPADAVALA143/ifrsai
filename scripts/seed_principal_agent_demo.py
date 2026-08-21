"""Seed IFRS 15 principal vs agent demo assessments.

Usage (from repo root):
  python scripts/seed_principal_agent_demo.py
  python scripts/seed_principal_agent_demo.py --company-id ae7301ab
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

from backend.app.services.ifrs15_principal_agent_db import pa_db
from backend.app.services.supabase_client import is_supabase_configured


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def seed(company_id: str) -> None:
    existing = pa_db.list(company_id)
    refs = {str(r.get("assessment_ref") or "") for r in existing}

    rows = [
        {
            "assessment_ref": "PA-AE7301-001",
            "assessment_date": "2026-06-15",
            "contract_ref": "SPA-MH-4B",
            "contract_type": "developer",
            "customer_name": "Buyer — Unit 4B",
            "counterparty_name": "N/A — direct sale to end buyer",
            "transaction_description": "Off-plan apartment sale — Unit 4B Marina Heights",
            "gross_amount": "1800000.0000",
            "commission_rate": None,
            "indicator_1_responsibility": "strong_principal",
            "indicator_1_notes": "Customer holds the developer responsible for construction and handover.",
            "indicator_2_inventory": "strong_principal",
            "indicator_2_notes": "Developer controls the unit before handover (RERA escrow / off-plan).",
            "indicator_3_pricing": "strong_principal",
            "indicator_3_notes": "Developer sets SPA price independently.",
            "has_inventory_risk": True,
            "sets_price_independently": True,
            "primary_obligor": True,
            "can_redirect_good": True,
            "indicator_1_score": 2,
            "indicator_2_score": 2,
            "indicator_3_score": 2,
            "total_score": 6,
            "ai_determination": "principal",
            "ai_confidence": "high",
            "ai_reasoning": (
                "Under IFRS 15.B34–B38 the developer controls the specified unit before transfer. "
                "Primary responsibility (+2), inventory risk (+2) and pricing discretion (+2) total +6/+6. "
                "UAE off-plan sale is recognised GROSS as principal."
            ),
            "ai_risk_flag": None,
            "ai_revenue_impact": (
                "If principal, revenue = AED 1,800,000 gross. Agent presentation would understate revenue "
                "by the full contract price. Difference vs net (nil commission) = AED 1,800,000."
            ),
            "ai_key_judgment": "Control of the unit before handover — primary obligor and inventory risk.",
            "final_determination": "principal",
            "gross_revenue": "1800000.0000",
            "net_revenue": "0.0000",
            "revenue_difference": "1800000.0000",
            "status": "ai_assessed",
        },
        {
            "assessment_ref": "PA-AE7301-002",
            "assessment_date": "2026-06-20",
            "contract_ref": "BRK-JUM-001",
            "contract_type": "broker",
            "customer_name": "Villa buyer — Jumeirah",
            "counterparty_name": "Al Noor Developer LLC",
            "transaction_description": "Brokerage commission on Villa sale — Jumeirah",
            "gross_amount": "3500000.0000",
            "commission_rate": "0.0200",
            "indicator_1_responsibility": "strong_agent",
            "indicator_1_notes": "Buyer knows the developer is the seller; broker arranges introduction only.",
            "indicator_2_inventory": "strong_agent",
            "indicator_2_notes": "Broker never owns or controls the property.",
            "indicator_3_pricing": "strong_agent",
            "indicator_3_notes": "Commission rate (2%) is set by the developer.",
            "has_inventory_risk": False,
            "sets_price_independently": False,
            "primary_obligor": False,
            "can_redirect_good": False,
            "indicator_1_score": -2,
            "indicator_2_score": -2,
            "indicator_3_score": -2,
            "total_score": -6,
            "ai_determination": "agent",
            "ai_confidence": "high",
            "ai_reasoning": (
                "IFRS 15.B34–B38 indicators are uniformly agent: no inventory risk, no pricing discretion, "
                "and the customer looks to the developer to fulfil the sale. Recognise NET commission only."
            ),
            "ai_risk_flag": None,
            "ai_revenue_impact": (
                "If agent, revenue = AED 70,000 commission only. Gross property price AED 3,500,000 is not "
                "revenue. Difference = AED 3,430,000 — highly material if misclassified as principal."
            ),
            "ai_key_judgment": "No inventory risk and limited pricing discretion.",
            "final_determination": "agent",
            "gross_revenue": "3500000.0000",
            "net_revenue": "70000.0000",
            "revenue_difference": "3430000.0000",
            "status": "ai_assessed",
        },
        {
            "assessment_ref": "PA-AE7301-003",
            "assessment_date": "2026-06-28",
            "contract_ref": "SAAS-RS-001",
            "contract_type": "reseller",
            "customer_name": "Enterprise customer",
            "counterparty_name": "AWS / Cloud Provider",
            "transaction_description": "Reselling cloud storage — customer pays entity directly",
            "gross_amount": "60000.0000",
            "commission_rate": "0.2500",
            "indicator_1_responsibility": "partial_principal",
            "indicator_1_notes": "Customer contracts with the entity and expects first-line support from it.",
            "indicator_2_inventory": "neutral",
            "indicator_2_notes": "No physical inventory; cloud capacity is provisioned by AWS on demand.",
            "indicator_3_pricing": "partial_agent",
            "indicator_3_notes": "List price largely follows supplier; entity has limited discounting room.",
            "has_inventory_risk": False,
            "sets_price_independently": False,
            "primary_obligor": True,
            "can_redirect_good": False,
            "indicator_1_score": 1,
            "indicator_2_score": 0,
            "indicator_3_score": -1,
            "total_score": 0,
            "ai_determination": "judgment_required",
            "ai_confidence": "low",
            "ai_reasoning": (
                "Total score 0 falls in the IFRS 15.B37 judgment zone (−2 to +2). Responsibility leans "
                "principal (+1) while pricing leans agent (−1) and inventory is neutral. Human review "
                "is mandatory before approving gross vs net."
            ),
            "ai_risk_flag": "Judgment zone — finance review required.",
            "ai_revenue_impact": (
                "Gross amount AED 60,000; possible net/commission AED 15,000; difference AED 45,000. "
                "Presentation choice is material until determination is locked."
            ),
            "ai_key_judgment": "Mixed B37 indicators — document which factor is decisive.",
            "final_determination": "judgment_required",
            "gross_revenue": "60000.0000",
            "net_revenue": "15000.0000",
            "revenue_difference": "45000.0000",
            "status": "ai_assessed",
        },
    ]

    inserted = 0
    for payload in rows:
        ref = str(payload["assessment_ref"])
        if ref in refs:
            print(f"Skip existing {ref}")
            continue
        row = pa_db.insert(
            {
                "company_id": company_id,
                "third_party_involved": True,
                "prepared_by": "seed",
                "updated_at": _now(),
                **payload,
            }
        )
        pa_db.add_audit(
            row["id"],
            "ai_assessed",
            actor="seed",
            new_value={
                "assessment_ref": ref,
                "total_score": payload["total_score"],
                "determination": payload["ai_determination"],
            },
        )
        print(f"Inserted {ref} score={payload['total_score']} det={payload['ai_determination']}")
        inserted += 1

    print(f"Seeded {inserted} principal-agent assessments for company_id={company_id}")
    print("Expected:")
    print("  PA-AE7301-001 developer  +6  PRINCIPAL  gross AED 1,800,000")
    print("  PA-AE7301-002 broker     -6  AGENT      net AED 70,000  diff AED 3,430,000")
    print("  PA-AE7301-003 reseller    0  JUDGMENT   human override required before approve")
    print("Open /dashboard/ifrs15/principal-agent")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-id", default="ae7301ab", help="Firm / company id to seed")
    args = parser.parse_args()
    if not is_supabase_configured():
        print("ERROR: Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
        return 1
    try:
        seed(args.company_id)
    except Exception as exc:
        text = str(exc)
        if "PGRST205" in text or "schema cache" in text:
            print(
                "ERROR: ifrs15_principal_agent is not in the PostgREST cache.\n"
                "Run supabase/migrations/068_principal_agent.sql on project udjqtsaggtwwwdfhcnao "
                "(not FinReport AI), then retry this seed."
            )
            return 1
        raise
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
