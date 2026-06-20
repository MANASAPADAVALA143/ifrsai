"""Verify SPA-DV2-2024-1205 uses completion % not straight-line contract term."""

from __future__ import annotations

import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.services.ifrs15_realestate import (
    apply_offplan_input_method_to_calculate,
    effective_completion_pct,
)
from ifrs15_calculator import IFRS15Calculator, IFRS15Input, PerformanceObligation


def test_linear_completion_jun_2026():
    data = {
        "construction_start": "2024-01-01",
        "expected_handover": "2026-12-31",
        "current_date": "2026-06-19",
    }
    pct = effective_completion_pct(data)
    assert 80 <= pct <= 84, f"Expected ~82% linear completion, got {pct}%"
    print(f"[OK] Linear completion at 2026-06-19: {pct}%")


def test_spa_calculate_not_straight_line():
    contract = IFRS15Input(
        contract_id="SPA-DV2-2024-1205",
        customer_name="Mohammed Al Rashidi",
        vendor_name="Emaar Development LLC",
        effective_date=datetime(2024, 3, 15),
        contract_term_months=33,
        fixed_consideration=Decimal("2450000"),
        currency="AED",
        contract_type="fixed_price",
        performance_obligations=[
            PerformanceObligation(
                obligation_id="PO-SPA-1",
                description="Off-plan unit",
                standalone_selling_price=Decimal("2450000"),
                recognition_method="over_time",
                duration_months=33,
                transfer_date=datetime(2026, 12, 31),
            )
        ],
    )
    calc = IFRS15Calculator()
    base = calc.calculate_full_ifrs15(contract, cash_received=Decimal("245000"))
    straight_line = float(base.get("total_recognised") or 0)

    fixed = apply_offplan_input_method_to_calculate(
        base,
        contract_value=2_450_000,
        construction_start="2024-01-01",
        expected_handover="2026-12-31",
        spa_execution_date="2024-03-15",
        current_date="2026-06-19",
        construction_completion_pct=35,
        currency="AED",
        obligation_description="Off-plan unit",
        progress_measurement="input_costs",
    )
    completion_pct = float(fixed.get("realestate_overlay", {}).get("completion_pct") or 0)
    recognised = float(fixed.get("total_recognised") or 0)
    expected = round(2_450_000 * completion_pct / 100, 2)

    print(f"Straight-line (wrong): AED {straight_line:,.2f}")
    print(f"Completion % method:   AED {recognised:,.2f} at {completion_pct}% completion")

    assert straight_line > recognised + 10_000, "Straight-line should exceed completion-based for this SPA"
    assert abs(recognised - expected) < 1.0, f"Expected {expected}, got {recognised}"
    assert completion_pct < 84, f"Should not be ~85% contract-term straight line, got {completion_pct}%"
    print("[OK] SPA recognition uses construction timeline completion %, not contract-term straight line")


def main():
    test_linear_completion_jun_2026()
    test_spa_calculate_not_straight_line()
    print("\nAll recognition fix tests passed.")


if __name__ == "__main__":
    main()
