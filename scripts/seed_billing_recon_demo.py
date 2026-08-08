"""Seed billing-to-GL recon demo scenarios.

Default company_id = ae7301ab (Al Noor). Also pass --company-id emaar-dev
to match the live workspace selector.

Usage (from repo root):
  python scripts/seed_billing_recon_demo.py
  python scripts/seed_billing_recon_demo.py --company-id emaar-dev
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "frontend" / ".env")

from backend.app.services.ifrs15_billing_recon_db import billing_recon_db
from backend.app.services.supabase_client import is_supabase_configured


def seed(company_id: str) -> None:
    billing_rows = [
        {
            "company_id": company_id,
            "transaction_ref": "INV-RE-001",
            "transaction_type": "invoice",
            "contract_type": "uae_real_estate",
            "billing_date": "2026-06-15",
            "amount": "750000.0000",
            "currency": "AED",
            "billing_system": "manual",
            "external_ref": "ESCROW-REL-001",
            "milestone_ref": "30_percent",
            "customer_id": "CUST-RE-001",
            "status": "unmatched",
            "period": "2026-06",
        },
        {
            "company_id": company_id,
            "transaction_ref": "INV-RE-002",
            "transaction_type": "invoice",
            "contract_type": "uae_real_estate",
            "billing_date": "2026-06-30",
            "amount": "500000.0000",
            "currency": "AED",
            "billing_system": "rera_escrow",
            "milestone_ref": "50_percent",
            "customer_id": "CUST-RE-001",
            "status": "unmatched",
            "period": "2026-06",
        },
        {
            "company_id": company_id,
            "transaction_ref": "INV-SaaS-001",
            "transaction_type": "invoice",
            "contract_type": "saas_subscription",
            "billing_date": "2026-06-01",
            "amount": "1000.0000",
            "currency": "AED",
            "billing_system": "stripe",
            "external_ref": "ch_stripe_test_001",
            "customer_id": "CUST-002",
            "status": "unmatched",
            "period": "2026-06",
        },
    ]
    gl_rows = [
        {
            "company_id": company_id,
            "posting_date": "2026-06-15",
            "account_code": "4001",
            "account_name": "Revenue — Off-plan 30%",
            "debit": "0",
            "credit": "750000.0000",
            "journal_ref": "JE-RE-30PCT",
            "period": "2026-06",
            "posting_type": "revenue",
            "source": "manual",
        },
        {
            "company_id": company_id,
            "posting_date": "2026-06-01",
            "account_code": "4002",
            "account_name": "Revenue — SaaS",
            "debit": "0",
            "credit": "1000.0000",
            "journal_ref": "JE-SAAS-001",
            "period": "2026-06",
            "posting_type": "revenue",
            "source": "manual",
        },
    ]
    for row in billing_rows:
        billing_recon_db.upsert_billing(row)
    for row in gl_rows:
        billing_recon_db.upsert_gl(row)
    print(f"Seeded billing ({len(billing_rows)}) + GL ({len(gl_rows)}) for company_id={company_id}")
    print("Expected after POST /api/ifrs15/billing-recon/run period=2026-06:")
    print("  UAE RE: billing 1,250,000  GL revenue 750,000  variance 500,000  missing_gl / escrow")
    print("  SaaS:   billing 1,000      GL revenue 1,000    deferred_not_reversed")


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
