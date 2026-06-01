"""IFRS 15 transaction price adjustments — cumulative catch-up vs prospective."""

from __future__ import annotations

from typing import Any, Dict


def calculate_tp_adjustment(payload: Dict[str, Any]) -> Dict[str, Any]:
    original_tp = float(payload["original_transaction_price"])
    new_tp = float(payload["new_transaction_price"])
    recognised = float(payload.get("revenue_recognised_to_date") or 0)
    remaining_pos = max(int(payload.get("remaining_performance_obligations") or 1), 1)
    method = str(payload.get("adjustment_method") or "cumulative_catchup").lower()
    reason = str(payload.get("adjustment_reason") or "variable_consideration")

    adjustment_amount = round(new_tp - original_tp, 2)

    if "prospect" in method:
        per_period = round(adjustment_amount / remaining_pos, 2)
        current_impact = per_period
        future_impact = round(adjustment_amount - per_period, 2)
        method_used = "prospective"
        disclosure = (
            f"Transaction price changed by {adjustment_amount:,.2f}. "
            f"Prospective allocation: {per_period:,.2f} per remaining performance obligation "
            f"({remaining_pos} remaining)."
        )
    else:
        current_impact = round(adjustment_amount, 2)
        future_impact = 0.0
        method_used = "cumulative_catchup"
        disclosure = (
            f"Cumulative catch-up: recognise full adjustment of {adjustment_amount:,.2f} "
            f"in the current period (revenue recognised to date was {recognised:,.2f})."
        )

    entries = [
        {
            "event": "TP adjustment",
            "dr": "Contract Asset / Receivable" if current_impact > 0 else "Revenue",
            "cr": "Revenue" if current_impact > 0 else "Contract Liability",
            "amount": abs(current_impact),
        }
    ]

    audit_justification = (
        f"Adjustment due to {reason.replace('_', ' ')}. Method: {method_used}. "
        f"IFRS 15 requires remeasurement of transaction price when facts change; "
        f"{'use cumulative catch-up when modifying an existing contract' if method_used == 'cumulative_catchup' else 'use prospective when adding distinct goods/services'}."
    )

    return {
        "adjustment_amount": adjustment_amount,
        "method_used": method_used,
        "current_period_impact": current_impact,
        "future_period_impact": future_impact,
        "journal_entries": entries,
        "disclosure_note": disclosure,
        "audit_justification": audit_justification,
    }
