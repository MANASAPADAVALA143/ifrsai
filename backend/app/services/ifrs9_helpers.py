"""IFRS 9 shared helpers — PD units, journal normalization, firm tenancy."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Union

from fastapi import Request


def ifrs9_firm_id(
    request: Optional[Request] = None,
    x_firm_id: Optional[str] = None,
) -> str:
    if x_firm_id and str(x_firm_id).strip():
        return str(x_firm_id).strip()
    if request is not None:
        hdr = request.headers.get("x-firm-id") or request.headers.get("X-Firm-Id")
        if hdr and str(hdr).strip():
            return str(hdr).strip()
    return os.getenv("IFRS9_FIRM_ID", os.getenv("IFRS16_FIRM_ID", os.getenv("IFRS15_FIRM_ID", "default")))


def ifrs9_user_id(request: Optional[Request], x_user_id: Optional[str] = None) -> Optional[str]:
    if x_user_id and str(x_user_id).strip():
        return str(x_user_id).strip()
    if request is not None:
        hdr = request.headers.get("x-user-id") or request.headers.get("X-User-Id")
        if hdr and str(hdr).strip():
            return str(hdr).strip()
    return None


def pd_pct_to_decimal(value: float) -> float:
    """API boundary: percentage (1.0 = 1%) → decimal (0.01)."""
    v = float(value or 0)
    if v > 1.0:
        return v / 100.0
    return v


def pd_decimal_to_pct(value: float) -> float:
    """Engine decimal → API percentage."""
    v = float(value or 0)
    if v <= 1.0:
        return v * 100.0
    return v


def lgd_pct_to_decimal(value: float) -> float:
    v = float(value or 0)
    if v > 1.0:
        return v / 100.0
    return v


def normalize_ifrs9_journals(
    raw: Union[Dict[str, Any], List[Any], None],
    *,
    reporting_date: str = "",
    portfolio_name: str = "",
) -> List[Dict[str, Any]]:
    """
    Normalize journal output to nested FinReportAI format
    (finreportai_journal_push.py — entries with account, dr/cr).
    """
    if raw is None:
        return []

    if isinstance(raw, dict) and raw.get("entries"):
        return [raw] if "description" in raw else [{"description": "IFRS 9 ECL", "entries": raw["entries"]}]

    items: List[Any]
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        items = [raw]
    else:
        return []

    nested: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("entries"):
            nested.append(item)
            continue
        dr_label = str(item.get("dr") or item.get("debit_account") or "Impairment Loss (P&L)")
        cr_label = str(item.get("cr") or item.get("credit_account") or "Loss Allowance (BS)")
        amount = float(item.get("amount", 0) or 0)
        if amount == 0:
            dr_amt = float(item.get("debit", item.get("dr_amount", 0)) or 0)
            cr_amt = float(item.get("credit", item.get("cr_amount", 0)) or 0)
            amount = dr_amt or cr_amt
        desc = str(item.get("type") or item.get("description") or "IFRS 9 ECL Recognition")
        nested.append(
            {
                "date": item.get("date") or reporting_date,
                "description": f"{desc} | {portfolio_name}".strip(" |"),
                "entries": [
                    {
                        "account": dr_label,
                        "account_type": "Expense",
                        "debit": amount,
                        "credit": 0,
                        "dr": amount,
                        "cr": 0,
                        "narration": "IFRS 9 ECL provision",
                    },
                    {
                        "account": cr_label,
                        "account_type": "Contra Asset",
                        "debit": 0,
                        "credit": amount,
                        "dr": 0,
                        "cr": amount,
                        "narration": "ECL allowance adjustment",
                    },
                ],
            }
        )
    return nested


def disclosure_to_text(disclosure: Any) -> str:
    if isinstance(disclosure, str):
        return disclosure
    if isinstance(disclosure, dict):
        lines = [f"Note: Expected Credit Losses (IFRS 9)", f"Reporting date: {disclosure.get('reporting_date', '')}"]
        summary = disclosure.get("summary") or {}
        if summary:
            lines.append(
                f"Total ECL: {summary.get('total_ecl_provision', 0):,.2f} | "
                f"Exposure: {summary.get('total_exposure', 0):,.2f}"
            )
        return "\n".join(lines)
    return str(disclosure or "")
