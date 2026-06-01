"""IFRS 16 §42 CPI / index remeasurement."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List


def remeasure_cpi(payload: Dict[str, Any]) -> Dict[str, Any]:
    orig_pay = Decimal(str(payload["original_monthly_payment"]))
    orig_ibr = Decimal(str(payload["original_ibr"])) / Decimal("100")
    orig_cpi = Decimal(str(payload["original_cpi"]))
    new_cpi = Decimal(str(payload["new_cpi"]))
    remaining = int(payload["remaining_term_months"])
    curr_ll = Decimal(str(payload["current_liability_balance"]))
    curr_rou = Decimal(str(payload["current_rou_balance"]))

    if orig_cpi <= 0:
        raise ValueError("Original CPI must be greater than zero")
    if remaining <= 0:
        raise ValueError("Remaining term months must be positive")

    uplift_ratio = new_cpi / orig_cpi
    new_pay = (orig_pay * uplift_ratio).quantize(Decimal("0.01"))
    cpi_uplift_pct = float((uplift_ratio - 1) * 100)

    monthly_rate = orig_ibr / Decimal("12")
    if monthly_rate == 0:
        remeasured_ll = new_pay * Decimal(remaining)
    else:
        df = (Decimal("1") - (Decimal("1") + monthly_rate) ** -remaining) / monthly_rate
        remeasured_ll = (new_pay * df).quantize(Decimal("0.01"))

    adjustment = (remeasured_ll - curr_ll).quantize(Decimal("0.01"))
    new_rou = (curr_rou + adjustment).quantize(Decimal("0.01"))

    dr_rou = float(max(adjustment, Decimal("0")))
    cr_ll = float(max(adjustment, Decimal("0")))
    dr_ll = float(max(-adjustment, Decimal("0")))
    cr_rou = float(max(-adjustment, Decimal("0")))

    entries: List[Dict[str, Any]] = []
    if adjustment >= 0:
        entries = [
            {"account": "Right-of-Use Asset", "dr": dr_rou, "cr": 0},
            {"account": "Lease Liability", "dr": 0, "cr": cr_ll},
        ]
    else:
        entries = [
            {"account": "Lease Liability", "dr": dr_ll, "cr": 0},
            {"account": "Right-of-Use Asset", "dr": 0, "cr": cr_rou},
        ]

    schedule: List[Dict[str, Any]] = []
    balance = remeasured_ll
    for m in range(1, remaining + 1):
        interest = (balance * monthly_rate).quantize(Decimal("0.01")) if monthly_rate > 0 else Decimal("0")
        principal = (new_pay - interest).quantize(Decimal("0.01"))
        closing = (balance - principal).quantize(Decimal("0.01"))
        if m == remaining:
            closing = Decimal("0")
            principal = balance
        schedule.append(
            {
                "month": m,
                "opening_liability": float(balance),
                "payment": float(new_pay),
                "interest": float(interest),
                "principal": float(principal),
                "closing_liability": float(closing),
            }
        )
        balance = closing

    return {
        "original_monthly_payment": float(orig_pay),
        "new_monthly_payment": float(new_pay),
        "cpi_uplift_pct": round(cpi_uplift_pct, 2),
        "remeasured_liability": float(remeasured_ll),
        "liability_adjustment": float(adjustment),
        "rou_adjustment": float(adjustment),
        "new_rou_balance": float(new_rou),
        "remeasurement_journal": {
            "date": payload.get("remeasurement_date", ""),
            "entries": entries,
        },
        "updated_amortization_schedule": schedule,
    }
