"""IFRS 9 ECL reconciliation — movement bridge from calculation runs + journal tie-out."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import pandas as pd

from ifrs9_ecl_calculator import IFRS9ECLCalculator


def _run_ecl(run: Dict[str, Any]) -> float:
    results = run.get("ecl_results") or {}
    return float(
        run.get("applicable_ecl")
        or results.get("applicable_ecl")
        or 0
    )


def _run_bridge(run: Dict[str, Any]) -> Dict[str, Any]:
    if run.get("ecl_movement"):
        return run["ecl_movement"]
    results = run.get("ecl_results") or {}
    return results.get("ecl_movement") or {}


def _run_journals(run: Dict[str, Any]) -> Any:
    if run.get("journal_outputs"):
        return run["journal_outputs"]
    results = run.get("ecl_results") or {}
    return results.get("journal_entries") or []


def build_reconciliation_from_runs(
    prior_run: Optional[Dict[str, Any]],
    current_run: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Build period reconciliation from the last two calculation runs.
    Opening per stage = prior run closing; current run supplies closing.
    """
    calculator = IFRS9ECLCalculator()
    current_results = current_run.get("ecl_results") or {}
    prior_ecl = _run_ecl(prior_run) if prior_run else 0.0
    current_ecl = _run_ecl(current_run)

    prior_bridge = _run_bridge(prior_run) if prior_run else {}
    stored_bridge = _run_bridge(current_run)

    opening_by_stage: Dict[str, float] = {}
    for key in ("stage1", "stage2", "stage3"):
        opening_by_stage[key] = float((prior_bridge.get(key) or {}).get("closing_ecl", 0))

    portfolio_loans = current_results.get("portfolio_loans")
    if isinstance(portfolio_loans, list) and len(portfolio_loans) > 0:
        df = pd.DataFrame(portfolio_loans)
        if prior_run and "stage" in df.columns:
            prior_loans = (prior_run.get("ecl_results") or {}).get("portfolio_loans")
            if isinstance(prior_loans, list):
                prior_map = {
                    str(r.get("loan_id")): r.get("stage")
                    for r in prior_loans
                    if r.get("loan_id") is not None
                }
                df["previous_stage"] = df["loan_id"].astype(str).map(prior_map)
        bridge = calculator.generate_stage_ecl_bridge(
            df,
            previous_bridge=prior_bridge if prior_bridge else None,
            period_events={
                "opening_ecl": opening_by_stage,
                "opening_total_ecl": prior_ecl,
            },
        )
    elif stored_bridge and any(k in stored_bridge for k in ("stage1", "stage2", "stage3")):
        bridge = dict(stored_bridge)
        for key in ("stage1", "stage2", "stage3"):
            row = dict(bridge.get(key) or {})
            if opening_by_stage.get(key, 0) > 0 and float(row.get("opening_ecl", 0)) == 0:
                row["opening_ecl"] = opening_by_stage[key]
                closing = float(row.get("closing_ecl", 0))
                row["remeasurement"] = round(
                    closing
                    - row["opening_ecl"]
                    - float(row.get("new_additions", 0))
                    - float(row.get("transfers_in", 0))
                    + float(row.get("transfers_out", 0))
                    + float(row.get("write_offs", 0)),
                    2,
                )
                bridge[key] = row
        bridge["totals"] = {
            fld: round(
                sum(float((bridge.get(sk) or {}).get(fld, 0)) for sk in ("stage1", "stage2", "stage3")),
                2,
            )
            for fld in (
                "opening_ecl",
                "new_additions",
                "transfers_in",
                "transfers_out",
                "write_offs",
                "remeasurement",
                "closing_ecl",
            )
        }
        bridge["_reconciliation"] = calculator.validate_bridge_reconciliation(bridge)
    else:
        bridge = calculator.generate_stage_ecl_bridge(
            pd.DataFrame([{"stage": "Stage 1", "ecl_provision": current_ecl}]),
            previous_bridge=prior_bridge if prior_bridge else None,
            period_events={"opening_total_ecl": prior_ecl},
        )

    journals = _run_journals(current_run)
    tie_out = calculator.journal_tie_out_check(bridge, journals, prior_ecl, current_ecl)

    return {
        "portfolio_id": current_run.get("portfolio_id"),
        "prior_run_id": prior_run.get("id") if prior_run else None,
        "current_run_id": current_run.get("id"),
        "prior_applicable_ecl": prior_ecl,
        "current_applicable_ecl": current_ecl,
        "ecl_delta": round(current_ecl - prior_ecl, 2),
        "ecl_movement": bridge,
        "journal_tie_out": tie_out,
        "audit_trail": {
            "prior_run_at": prior_run.get("created_at") if prior_run else None,
            "current_run_at": current_run.get("created_at"),
            "prior_approach": prior_run.get("approach") if prior_run else None,
            "current_approach": current_run.get("approach"),
            "input_snapshot_current": current_run.get("input_snapshot"),
        },
    }


def build_reconciliation_from_run_list(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Use the two most recent runs (runs ordered desc by created_at)."""
    if not runs:
        raise ValueError("No calculation runs available")
    current = runs[0]
    prior = runs[1] if len(runs) > 1 else None
    return build_reconciliation_from_runs(prior, current)
