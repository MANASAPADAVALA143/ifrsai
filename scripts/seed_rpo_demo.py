"""Seed IFRS 15 §120 RPO dashboard demo (3 periods + 4 contracts).

Default company_id = ae7301ab (Al Noor). Also pass --company-id emaar-dev.

Usage (from repo root):
  python scripts/seed_rpo_demo.py
  python scripts/seed_rpo_demo.py --company-id emaar-dev
"""

from __future__ import annotations

import argparse
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "frontend" / ".env")

from backend.app.services.ifrs15_rpo_dashboard_db import rpo_dash_db
from backend.app.services.supabase_client import is_supabase_configured

LTM = Decimal("2100000")
MONEY_Q = Decimal("0.0001")


def ms(v: Decimal) -> str:
    return str(v.quantize(MONEY_Q, rounding=ROUND_HALF_UP))


CONTRACTS = [
    {
        "contract_ref": "SPA-2025-001",
        "contract_type": "uae_real_estate",
        "customer_name": "Al Noor Villa Project",
        "transaction_price": Decimal("2500000"),
        "start_date": "2025-07-01",
        "end_date": "2027-06-30",
        "original_term_months": 24,
        "progress": {"2026-04": Decimal("0.40"), "2026-05": Decimal("0.45"), "2026-06": Decimal("0.50")},
        "months_remaining": {"2026-04": Decimal("14"), "2026-05": Decimal("13"), "2026-06": Decimal("12")},
        "bucket": "1_2yr",
        "expedient": False,
        "status": {"2026-04": "active", "2026-05": "active", "2026-06": "active"},
    },
    {
        "contract_ref": "SPA-2026-001",
        "contract_type": "uae_real_estate",
        "customer_name": "Marina Heights Unit 4B",
        "transaction_price": Decimal("1800000"),
        "start_date": "2026-01-01",
        "end_date": "2027-06-30",
        "original_term_months": 18,
        "progress": {
            "2026-04": Decimal("120000") / Decimal("1800000"),
            "2026-05": Decimal("210000") / Decimal("1800000"),
            "2026-06": Decimal("300000") / Decimal("1800000"),
        },
        "months_remaining": {"2026-04": Decimal("14"), "2026-05": Decimal("13"), "2026-06": Decimal("12")},
        "bucket": "1_2yr",
        "expedient": False,
        "status": {"2026-04": "active", "2026-05": "active", "2026-06": "active"},
    },
    {
        "contract_ref": "SAAS-2026-001",
        "contract_type": "saas_subscription",
        "customer_name": "Demo Corp",
        "transaction_price": Decimal("12000"),
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "original_term_months": 12,
        "progress": {
            "2026-04": Decimal("0.3333"),
            "2026-05": Decimal("0.4167"),
            "2026-06": Decimal("0.50"),
        },
        "months_remaining": {"2026-04": Decimal("8"), "2026-05": Decimal("7"), "2026-06": Decimal("6")},
        "bucket": "lt_1yr",
        "expedient": True,
        "status": {"2026-04": "active", "2026-05": "active", "2026-06": "active"},
    },
    {
        "contract_ref": "PS-2026-001",
        "contract_type": "professional_services",
        "customer_name": "Gulf Consulting Ltd",
        "transaction_price": Decimal("450000"),
        "start_date": "2026-03-01",
        "end_date": "2026-10-31",
        "original_term_months": 8,
        "progress": {
            "2026-04": Decimal("0.375"),
            "2026-05": Decimal("0.5625"),
            "2026-06": Decimal("0.75"),
        },
        "months_remaining": {"2026-04": Decimal("6"), "2026-05": Decimal("5"), "2026-06": Decimal("4")},
        "bucket": "lt_1yr",
        # Included in §120 totals for the demo (near-complete PS converting this year).
        "expedient": False,
        "status": {"2026-04": "active", "2026-05": "active", "2026-06": "near_complete"},
    },
]

PERIODS = [
    ("2026-04", "2026-04-30"),
    ("2026-05", "2026-05-31"),
    ("2026-06", "2026-06-30"),
]


def _agg(period: str) -> dict:
    buckets = {k: Decimal("0") for k in ("lt_1yr", "1_2yr", "2_5yr", "gt_5yr")}
    types = {k: Decimal("0") for k in ("uae_real_estate", "saas_subscription", "professional_services", "other")}
    total = Decimal("0")
    at_risk = Decimal("0")
    w_num = Decimal("0")
    details = []
    active = 0
    for c in CONTRACTS:
        tp = c["transaction_price"]
        prog = c["progress"][period]
        rec = (tp * prog).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
        rpo = (tp - rec).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
        months = c["months_remaining"][period]
        status = c["status"][period]
        expedient = bool(c["expedient"])
        if status != "overdue":
            active += 1
        if not expedient:
            total += rpo
            buckets[c["bucket"]] += rpo
            types[str(c["contract_type"])] += rpo
            if status in {"at_risk", "near_complete"}:
                at_risk += rpo
            w_num += rpo * months
        details.append(
            {
                "ref": c["contract_ref"],
                "type": c["contract_type"],
                "customer": c["customer_name"],
                "tp": tp,
                "rec": rec,
                "rpo": rpo,
                "prog": prog,
                "months": months,
                "bucket": c["bucket"],
                "expedient": expedient,
                "status": status,
                "start": c["start_date"],
                "end": c["end_date"],
            }
        )
    coverage = (total / LTM) if LTM > 0 else None
    wavg = (w_num / total) if total > 0 else Decimal("0")
    return {
        "total": total,
        "buckets": buckets,
        "types": types,
        "at_risk": at_risk,
        "coverage": coverage,
        "wavg": wavg,
        "details": details,
        "active": active,
    }


def _disclosure(period: str, snap_date: str, a: dict) -> tuple[str, str]:
    total = a["total"]
    narrative = (
        f"As at {snap_date}, Al Noor’s remaining performance obligations are AED {total:,.0f} "
        f"across {a['active']} contracts. Off-plan real estate dominates the backlog "
        f"(AED {a['types']['uae_real_estate']:,.0f} in the 1–2 year band), giving solid medium-term revenue visibility. "
        f"Coverage is {float(a['coverage']):.2f}x last-twelve-months revenue — healthy but watch concentration. "
        f"Near-complete professional services RPO of AED {a['types']['professional_services']:,.0f} should convert shortly; "
        f"the 12-month SaaS contract is excluded under the IFRS 15 §121 practical expedient."
    )
    disclosure = (
        f"IFRS 15 §120 — Remaining performance obligations\n\n"
        f"The Group discloses the aggregate amount of the transaction price allocated to unsatisfied "
        f"(or partially unsatisfied) performance obligations as at {snap_date}, and an explanation of when "
        f"it expects to recognise that amount as revenue, in accordance with IFRS 15 §120.\n\n"
        f"Aggregate RPO: AED {total:,.0f}\n\n"
        f"Expected timing of recognition:\n"
        f"  Within 1 year:     AED {a['buckets']['lt_1yr']:,.0f}\n"
        f"  1–2 years:         AED {a['buckets']['1_2yr']:,.0f}\n"
        f"  2–5 years:         AED {a['buckets']['2_5yr']:,.0f}\n"
        f"  More than 5 years: AED {a['buckets']['gt_5yr']:,.0f}\n\n"
        f"Practical expedients (IFRS 15 §121): the Group does not disclose RPO for contracts with an original "
        f"expected duration of one year or less (SaaS subscription SAAS-2026-001). Revenue on those contracts "
        f"is recognised as the entity has a right to invoice.\n\n"
        f"Qualitative: UAE off-plan SPAs are recognised over time as construction progresses; professional "
        f"services are expected to complete within the current financial year."
    )
    return narrative, disclosure


def seed(company_id: str) -> None:
    for c in CONTRACTS:
        june_prog = c["progress"]["2026-06"]
        rec = (c["transaction_price"] * june_prog).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
        rpo_dash_db.upsert_source_contract(
            {
                "company_id": company_id,
                "contract_ref": c["contract_ref"],
                "contract_type": c["contract_type"],
                "customer_name": c["customer_name"],
                "transaction_price": ms(c["transaction_price"]),
                "revenue_recognised": ms(rec),
                "start_date": c["start_date"],
                "end_date": c["end_date"],
                "original_term_months": c["original_term_months"],
                "currency": "AED",
                "status": "active",
            }
        )
        print(f"Upserted contract {c['contract_ref']}")

    for period, snap_date in PERIODS:
        existing = rpo_dash_db.get_snapshot_by_period(company_id, period)
        if existing:
            rpo_dash_db.delete_snapshot(str(existing["id"]))
        a = _agg(period)
        narrative, disclosure = _disclosure(period, snap_date, a)
        snap = rpo_dash_db.insert_snapshot(
            {
                "company_id": company_id,
                "snapshot_date": snap_date,
                "period": period,
                "total_rpo": ms(a["total"]),
                "total_contracts": len(CONTRACTS),
                "active_contracts": a["active"],
                "currency": "AED",
                "ltm_revenue": ms(LTM),
                "bucket_lt_1yr": ms(a["buckets"]["lt_1yr"]),
                "bucket_1_2yr": ms(a["buckets"]["1_2yr"]),
                "bucket_2_5yr": ms(a["buckets"]["2_5yr"]),
                "bucket_gt_5yr": ms(a["buckets"]["gt_5yr"]),
                "rpo_uae_real_estate": ms(a["types"]["uae_real_estate"]),
                "rpo_saas_subscription": ms(a["types"]["saas_subscription"]),
                "rpo_professional_services": ms(a["types"]["professional_services"]),
                "rpo_other": ms(Decimal("0")),
                "rpo_coverage_ratio": str(a["coverage"].quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
                "weighted_avg_remaining_months": str(a["wavg"].quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
                "at_risk_rpo": ms(a["at_risk"]),
                "new_bookings_qtd": ms(Decimal("0")),
                "ai_narrative": narrative,
                "ai_disclosure_draft": disclosure,
            }
        )
        rows = []
        for d in a["details"]:
            rows.append(
                {
                    "snapshot_id": snap["id"],
                    "company_id": company_id,
                    "contract_id": d["ref"],
                    "contract_ref": d["ref"],
                    "contract_type": d["type"],
                    "customer_name": d["customer"],
                    "transaction_price": ms(d["tp"]),
                    "revenue_recognised": ms(d["rec"]),
                    "rpo": ms(d["rpo"]),
                    "rpo_pct": float((d["rpo"] / d["tp"] * Decimal("100")).quantize(Decimal("0.0001"))),
                    "progress_pct": float((d["prog"] * Decimal("100")).quantize(Decimal("0.0001"))),
                    "start_date": d["start"],
                    "end_date": d["end"],
                    "months_remaining": float(d["months"]),
                    "time_bucket": d["bucket"],
                    "practical_expedient_applies": d["expedient"],
                    "status": d["status"],
                }
            )
        rpo_dash_db.insert_details(rows)
        print(
            f"Snapshot {period}: total_rpo={a['total']:,.0f} coverage={float(a['coverage']):.2f}x "
            f"lt_1yr={a['buckets']['lt_1yr']:,.0f} 1_2yr={a['buckets']['1_2yr']:,.0f}"
        )

    june = _agg("2026-06")
    print("Expected 2026-06:")
    print(f"  total_rpo AED {june['total']:,.0f} (excl SaaS expedient)")
    print(f"  bucket_lt_1yr AED {june['buckets']['lt_1yr']:,.0f}")
    print(f"  bucket_1_2yr AED {june['buckets']['1_2yr']:,.0f}")
    print(f"  coverage {float(june['coverage']):.2f}x vs LTM AED {LTM:,.0f}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-id", default="ae7301ab")
    args = parser.parse_args()
    if not is_supabase_configured():
        print("ERROR: Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
        return 1
    seed(args.company_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
