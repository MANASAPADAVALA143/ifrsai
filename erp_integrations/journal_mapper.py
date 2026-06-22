"""
Maps IFRS 16 calculator output to ERP-agnostic journal line items format.
"""
from typing import Any


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def map_initial_recognition(lease_id: str, results: dict, account_mapping: dict) -> dict:
    """Map the initial recognition journal entry."""
    rou = _f(results.get("rou_asset"))
    liability = _f(results.get("lease_liability"))
    return {
        "reference": f"IFRS16-{lease_id}-INIT",
        "date": (results.get("commencement_date") or results.get("start_date") or ""),
        "notes": f"IFRS 16 initial recognition — {results.get('asset_description', lease_id)}",
        "lines": [
            {
                "account": account_mapping.get("rou_asset", ""),
                "side": "debit",
                "amount": rou,
                "description": "Right-of-Use Asset — initial recognition",
            },
            {
                "account": account_mapping.get("lease_liability", ""),
                "side": "credit",
                "amount": liability,
                "description": "Lease Liability — initial recognition",
            },
        ],
    }


def map_monthly_entry(lease_id: str, period_row: dict, account_mapping: dict) -> dict:
    """Map one month's recurring journal (depreciation + interest + payment)."""
    period = str(period_row.get("period", ""))
    date = str(period_row.get("date", ""))
    interest = _f(period_row.get("interest"))
    depreciation = _f(period_row.get("depreciation"))
    payment = _f(period_row.get("payment"))
    principal = _f(period_row.get("principal"))

    lines = []

    # Interest expense: Dr Interest Expense / Cr Lease Liability
    if interest > 0:
        lines.append({
            "account": account_mapping.get("interest_expense", ""),
            "side": "debit",
            "amount": interest,
            "description": f"Interest expense on lease liability — {period}",
        })
        lines.append({
            "account": account_mapping.get("lease_liability", ""),
            "side": "credit",
            "amount": interest,
            "description": f"Interest accrual on lease liability — {period}",
        })

    # Lease payment: Dr Lease Liability (principal) / Cr Cash
    if payment > 0 and principal > 0:
        lines.append({
            "account": account_mapping.get("lease_liability", ""),
            "side": "debit",
            "amount": principal,
            "description": f"Lease liability repayment (principal) — {period}",
        })
        lines.append({
            "account": account_mapping.get("cash", ""),
            "side": "credit",
            "amount": payment,
            "description": f"Cash payment for lease — {period}",
        })

    # Depreciation: Dr Depreciation / Cr Accumulated Depreciation
    if depreciation > 0:
        lines.append({
            "account": account_mapping.get("depreciation", ""),
            "side": "debit",
            "amount": depreciation,
            "description": f"ROU asset depreciation — {period}",
        })
        lines.append({
            "account": account_mapping.get("acc_dep_rou", ""),
            "side": "credit",
            "amount": depreciation,
            "description": f"Accumulated depreciation — ROU asset — {period}",
        })

    return {
        "reference": f"IFRS16-{lease_id}-{period}",
        "date": date,
        "notes": f"IFRS 16 monthly journal — lease {lease_id} — {period}",
        "lines": lines,
    }


def map_to_zoho_line_items(mapped_lines: list, zoho_account_ids: dict) -> list:
    """
    Convert mapped lines to Zoho Books API line_items format.
    mapped_lines: list of {account, side, amount, description}
    zoho_account_ids: maps abstract account key (e.g. 'rou_asset') to Zoho account_id.
    The 'account' field in mapped_lines already holds either the Zoho account_id directly
    (when account_mapping was built from Zoho IDs) or an abstract key to look up.
    """
    result = []
    for line in mapped_lines:
        account_id = line.get("account", "")
        # If it looks like an abstract key rather than a numeric/UUID Zoho ID, resolve it.
        if account_id in zoho_account_ids:
            account_id = zoho_account_ids[account_id]
        result.append({
            "account_id": account_id,
            "debit_or_credit": "debit" if line.get("side") == "debit" else "credit",
            "amount": round(_f(line.get("amount")), 2),
            "description": line.get("description", ""),
        })
    return result
