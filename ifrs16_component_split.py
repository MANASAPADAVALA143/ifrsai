"""IFRS 16 §12–15 multi-component lease separation."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List

from ifrs16_calculator import IFRS16Calculator, LeaseInput


def split_and_calculate(payload: Dict[str, Any]) -> Dict[str, Any]:
    total = Decimal(str(payload["total_contract_payment"]))
    components = payload.get("components") or []
    if not components:
        raise ValueError("At least one component required")

    comp_sum = sum(Decimal(str(c["amount"])) for c in components)
    if abs(comp_sum - total) > Decimal("0.02"):
        raise ValueError(
            f"Component amounts ({float(comp_sum)}) must equal total ({float(total)})"
        )

    term = int(payload["term_months"])
    ibr = Decimal(str(payload["ibr"])) / Decimal("100")
    comm = datetime.strptime(str(payload["commencement_date"])[:10], "%Y-%m-%d")
    currency = str(payload.get("currency") or "USD")
    calc = IFRS16Calculator()

    lease_components: List[Dict[str, Any]] = []
    service_components: List[Dict[str, Any]] = []
    total_ll = Decimal("0")
    total_rou = Decimal("0")
    total_service_annual = Decimal("0")

    for i, c in enumerate(components):
        name = str(c.get("name") or f"Component {i + 1}")
        ctype = str(c.get("type", "lease")).lower()
        amount = Decimal(str(c["amount"]))

        if ctype == "service":
            annual = amount * 12
            service_components.append(
                {
                    "name": name,
                    "amount": float(amount),
                    "annual_expense": float(annual),
                    "monthly_expense": float(amount),
                }
            )
            total_service_annual += annual
            continue

        lease = LeaseInput(
            lease_id=f"{payload.get('lease_id', 'SPLIT')}-{i}",
            asset_description=name,
            commencement_date=comm,
            lease_term_months=term,
            monthly_payment=amount,
            annual_discount_rate=ibr,
            currency=currency,
        )
        full = calc.calculate_full_ifrs16(lease)
        ll = Decimal(str(full.get("lease_liability", 0)))
        rou = Decimal(str(full.get("rou_asset", 0)))
        sched = full.get("amortization_schedule")
        if hasattr(sched, "to_dict"):
            sched = sched.to_dict(orient="records")

        lease_components.append(
            {
                "name": name,
                "amount": float(amount),
                "liability": float(ll),
                "rou_asset": float(rou),
                "schedule": sched,
            }
        )
        total_ll += ll
        total_rou += rou

    journal_entries = [
        {
            "description": "Initial recognition — lease components",
            "dr": "Right-of-Use Asset",
            "cr": "Lease Liability",
            "amount": float(total_rou),
        }
    ]

    return {
        "lease_components": lease_components,
        "service_components": service_components,
        "consolidated": {
            "total_lease_liability": float(total_ll),
            "total_rou_asset": float(total_rou),
            "total_service_expense_annual": float(total_service_annual),
        },
        "journal_entries": journal_entries,
    }
