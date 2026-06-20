"""
IFRS 16 → FinReportAI Journal Push Service
Converts IFRS 16 journal entries to FinReportAI format
and posts them via POST /api/r2r/journal-entry/analyze
"""

from __future__ import annotations

import csv
import io
import os
from typing import Any

import httpx

FINREPORTAI_BASE = "http://localhost:8000"


def get_finreportai_base() -> str:
    return os.environ.get("FINREPORTAI_BASE_URL", FINREPORTAI_BASE)


ACCOUNT_MAP = {
    "Right-of-Use Asset": "1600",
    "ROU Asset (leaseback)": "1601",
    "Right-of-use asset": "1600",
    "Accumulated Depreciation — ROU Asset": "1610",
    "Lease Liability (Current)": "2300",
    "Lease Liability (Non-Current)": "2310",
    "Lease Liability": "2300",
    "Lease liability": "2300",
    "Finance Lease Liability": "2300",
    "Financial Liability (lease proceeds)": "2320",
    "Financial Liability (IFRS 15 §B68)": "2320",
    "Interest Expense (P&L)": "7100",
    "Depreciation Expense — ROU Asset (P&L)": "7200",
    "Depreciation Expense (P&L)": "7200",
    "Cash / Bank": "1000",
    "Cash": "1000",
    "Net Investment in Lease (Asset)": "1700",
    "Net Investment in Lease": "1700",
    "Unearned Finance Income": "2400",
    "Finance Income (P&L)": "4200",
    "Lease Income (P&L)": "4100",
    "Deferred Lease Income (if payment > SL)": "2410",
    "Accrued Lease Income (if payment < SL)": "1310",
    "Underlying Asset (carrying amount)": "1500",
    "Property, Plant & Equipment": "1500",
    "Asset (derecognised)": "1500",
    "Accumulated Depreciation": "1510",
    "Underlying Asset (derecognised)": "1500",
    "Gain on disposal (P&L)": "4300",
    "Gain on sale": "4300",
    "Loss on disposal (P&L)": "7300",
    "Loss on sale": "7300",
    "Deferred Gain (liability — amortised over lease term)": "2420",
    "Deferred Gain (liability)": "2420",
    "Deferred gain on sale": "2420",
    "Deferred Loss (asset — amortised over lease term)": "1620",
    "Deferred Loss (asset)": "1620",
    "Deferred loss on sale": "1620",
    "Gain on Disposal (P&L) — amortised portion": "4300",
    "Loss on Disposal (P&L) — amortised portion": "7300",
    "Prepaid Lease Payment (below-market rent adjustment)": "1630",
    "Prepaid rent (below-market adjustment)": "1630",
    "Additional Financing from Buyer (above-market rent)": "2330",
    "Additional financing (above-market rent)": "2330",
    "Revenue (P&L)": "4000",
    "Cost of Sales (P&L)": "5000",
    "Lease Liability (remeasured)": "2300",
    "ROU Asset (remeasured)": "1600",
}

MODULE_LABELS = {
    "lessee": "IFRS16-Lessee",
    "lessor_finance": "IFRS16-Lessor-Finance",
    "lessor_operating": "IFRS16-Lessor-Operating",
    "sale_leaseback": "IFRS16-SaleLeaseback",
    "modification": "IFRS16-Modification",
    "termination": "IFRS16-Termination",
    "cpi_remeasure": "IFRS16-CPI",
}


def _normalize_line(entry: dict[str, Any]) -> dict[str, float | str]:
    return {
        "account": str(entry.get("account", "")),
        "debit": float(entry.get("debit", entry.get("dr", 0)) or 0),
        "credit": float(entry.get("credit", entry.get("cr", 0)) or 0),
    }


def normalize_journal_entries(journal_entries: Any) -> list[dict[str, Any]]:
    """Accept array, nested dict (lessee calc), or lines-based entries (SLB)."""
    if not journal_entries:
        return []
    if isinstance(journal_entries, dict):
        blocks: list[dict[str, Any]] = []
        for key, block in journal_entries.items():
            if not isinstance(block, dict):
                continue
            raw = block.get("entries") or block.get("lines") or []
            if not isinstance(raw, list):
                continue
            blocks.append(
                {
                    "date": str(block.get("date", key)),
                    "description": str(block.get("description", key)),
                    "entries": [_normalize_line(e) for e in raw if isinstance(e, dict)],
                }
            )
        return blocks
    if isinstance(journal_entries, list):
        blocks = []
        for block in journal_entries:
            if not isinstance(block, dict):
                continue
            raw = block.get("entries") or block.get("lines") or []
            if not isinstance(raw, list):
                continue
            blocks.append(
                {
                    "date": str(block.get("date", "")),
                    "description": str(block.get("description", "")),
                    "entries": [_normalize_line(e) for e in raw if isinstance(e, dict)],
                }
            )
        return blocks
    return []


def ifrs16_journals_to_csv(
    journal_entries: Any,
    module: str = "lessee",
    lease_name: str = "",
    company: str = "",
) -> str:
    normalized = normalize_journal_entries(journal_entries)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["date", "description", "debit", "credit", "account_code", "account_name", "module", "lease_ref", "company"]
    )
    module_label = MODULE_LABELS.get(module, "IFRS16")
    safe_lease = lease_name or "lease"

    for je in normalized:
        je_date = je.get("date", "")
        je_desc = je.get("description", "")
        for entry in je.get("entries", []):
            acct_name = str(entry.get("account", ""))
            dr = float(entry.get("debit", 0) or 0)
            cr = float(entry.get("credit", 0) or 0)
            if dr == 0 and cr == 0:
                continue
            acct_code = ACCOUNT_MAP.get(acct_name, "9999")
            full_desc = f"{module_label} | {je_desc}"
            if lease_name:
                full_desc += f" | {lease_name}"
            writer.writerow(
                [
                    je_date,
                    full_desc,
                    dr if dr > 0 else "",
                    cr if cr > 0 else "",
                    acct_code,
                    acct_name,
                    module_label,
                    safe_lease,
                    company,
                ]
            )

    return output.getvalue()


async def push_journals_to_finreportai(
    journal_entries: Any,
    module: str = "lessee",
    lease_name: str = "",
    company: str = "",
    run_anomaly_detection: bool = True,
) -> dict:
    csv_content = ifrs16_journals_to_csv(journal_entries, module, lease_name, company)
    base_url = get_finreportai_base()
    safe_name = (lease_name or "lease").replace(" ", "_")

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{base_url}/api/r2r/journal-entry/analyze",
            files={"file": (f"ifrs16_{module}_{safe_name}.csv", csv_content.encode("utf-8"), "text/csv")},
            data={
                "source": f"IFRS16-{module}",
                "company": company,
                "lease_ref": lease_name,
                "run_anomaly": str(run_anomaly_detection).lower(),
            },
        )
        response.raise_for_status()
        return response.json()


async def push_and_post_to_gl(
    journal_entries: Any,
    module: str,
    lease_name: str,
    company: str,
    period: str,
    firm_id: str = "default",
    force_post: bool = False,
) -> dict:
    base_url = get_finreportai_base()
    anomaly_result = await push_journals_to_finreportai(journal_entries, module, lease_name, company)

    high_risk = [
        e for e in anomaly_result.get("entries", [])
        if float(e.get("risk_score", 0)) >= 70
    ]

    result: dict[str, Any] = {
        "anomaly_check": anomaly_result,
        "high_risk_count": len(high_risk),
        "high_risk_entries": high_risk,
        "gl_posted": False,
        "gl_post_result": None,
        "auto_approved": len(high_risk) == 0,
    }

    if len(high_risk) == 0 or force_post:
        csv_content = ifrs16_journals_to_csv(journal_entries, module, lease_name, company)
        safe_name = (lease_name or "lease").replace(" ", "_")
        async with httpx.AsyncClient(timeout=60) as client:
            try:
                gl_response = await client.post(
                    f"{base_url}/api/r2r/journal-entry/post",
                    files={
                        "file": (
                            f"ifrs16_{module}_{safe_name}_gl.csv",
                            csv_content.encode("utf-8"),
                            "text/csv",
                        )
                    },
                    data={
                        "period": period,
                        "company": company,
                        "source": f"IFRS16-{module}",
                        "firm_id": firm_id,
                        "auto_post": "true",
                        "force_post": str(force_post).lower(),
                    },
                )
                if gl_response.status_code == 200:
                    result["gl_posted"] = True
                    result["gl_post_result"] = gl_response.json()
            except Exception as e:
                result["gl_post_error"] = str(e)

    return result


def format_risk_summary(anomaly_result: dict) -> dict:
    entries = anomaly_result.get("entries", [])
    summary = anomaly_result.get("summary", {})
    risk_counts = {"high": 0, "medium": 0, "low": 0}
    flags: list[dict[str, Any]] = []

    for e in entries:
        score = float(e.get("risk_score", 0))
        if score >= 70:
            risk_counts["high"] += 1
            flags.append({
                "account": e.get("account_name", ""),
                "amount": e.get("debit") or e.get("credit"),
                "risk_score": score,
                "flags": e.get("anomaly_flags", []),
                "level": "high",
            })
        elif score >= 40:
            risk_counts["medium"] += 1
            flags.append({
                "account": e.get("account_name", ""),
                "amount": e.get("debit") or e.get("credit"),
                "risk_score": score,
                "flags": e.get("anomaly_flags", []),
                "level": "medium",
            })
        else:
            risk_counts["low"] += 1

    return {
        "total_entries": len(entries),
        "risk_counts": risk_counts,
        "flags": flags,
        "overall_risk": (
            "high" if risk_counts["high"] > 0
            else "medium" if risk_counts["medium"] > 0
            else "low"
        ),
        "ready_to_post": risk_counts["high"] == 0,
        "total_flagged": summary.get("total_flagged", risk_counts["high"] + risk_counts["medium"]),
    }
