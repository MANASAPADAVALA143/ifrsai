"""
IFRS 9 orchestrated calculate — wires staging, ECL, macro overlay, provision matrix.
PD at API boundary is percentage; engines receive decimals.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

import pandas as pd

from backend.app.services.ifrs9_helpers import (
    disclosure_to_text,
    lgd_pct_to_decimal,
    normalize_ifrs9_journals,
    pd_pct_to_decimal,
)
from ifrs9_ecl_calculator import (
    IFRS9ClassificationEngine,
    IFRS9ECLCalculator,
    IFRS9MacroOverlayEngine,
    IFRS9ProvisionMatrixEngine,
)
from ifrs9_staging import IFRS9StagingEngine, LoanStage


_STAGE_NUM_TO_LABEL = {1: "Stage 1", 2: "Stage 2", 3: "Stage 3"}


def _loan_row_from_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    ead = float(data.get("ead") or data.get("outstanding_balance") or 0)
    pd_12m_dec = pd_pct_to_decimal(float(data.get("pd_12m", 1)))
    pd_lifetime_dec = pd_pct_to_decimal(float(data.get("pd_lifetime", 5)))
    return {
        "loan_id": str(data.get("loan_id") or data.get("portfolio_id") or "SINGLE"),
        "outstanding_balance": ead,
        "ead": ead,
        "pd_12m": pd_12m_dec,
        "pd_lifetime": pd_lifetime_dec,
        "current_pd": pd_12m_dec,
        "origination_pd": pd_pct_to_decimal(float(data.get("origination_pd", data.get("pd_12m", 1)))),
        "lgd": lgd_pct_to_decimal(float(data.get("lgd", 45))),
        "days_past_due": int(data.get("days_past_due", 0) or 0),
        "current_rating": str(data.get("current_rating") or data.get("credit_rating") or ""),
        "origination_rating": str(data.get("origination_rating") or data.get("credit_rating") or ""),
        "is_forbearance": bool(data.get("is_forbearance", False)),
        "is_default": bool(data.get("is_default", False)),
        "is_bankruptcy": bool(data.get("is_bankruptcy", False)),
        "is_watchlist": bool(data.get("is_watchlist", False)),
        "remaining_term_years": int(data.get("remaining_term_years", 5) or 5),
        "previous_stage": data.get("previous_stage"),
    }


def _resolve_stage(data: Dict[str, Any], loan: Dict[str, Any], staging: IFRS9StagingEngine) -> tuple[int, str]:
    if data.get("stage_override"):
        stage_num = int(data.get("stage", 1))
        return stage_num, _STAGE_NUM_TO_LABEL.get(stage_num, "Stage 1")
    classified = staging.classify_loan(loan)
    stage_map = {LoanStage.STAGE_1: 1, LoanStage.STAGE_2: 2, LoanStage.STAGE_3: 3}
    stage_num = stage_map.get(classified, 1)
    return stage_num, classified.value


def _build_provision_matrix_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    buckets = data.get("ageing_buckets") or []
    bucket_totals = []
    custom_buckets = []
    for b in buckets:
        label = str(b.get("bucket", ""))
        amount = float(b.get("amount", 0) or 0)
        rate = float(b.get("rate", 0) or 0)
        bucket_totals.append(
            {
                "label": label,
                "gross_amount": amount,
                "historical_loss_rate": rate,
            }
        )
    return {
        "portfolio_name": str(data.get("portfolio_name") or "Provision Matrix"),
        "reporting_date": data.get("reporting_date"),
        "receivable_type": data.get("receivable_type", "trade_receivables"),
        "bucket_totals": bucket_totals,
        "receivables": data.get("receivables") or [],
        "historical_data": data.get("historical_data") or [],
        "macro_adjustment_factor": float(data.get("macro_adjustment_factor", 0) or 0),
        "writeoffs_this_period": float(data.get("writeoffs_this_period", 0) or 0),
        "custom_buckets": custom_buckets or None,
        "loss_rates": data.get("loss_rates"),
    }


def _scenario_macro_overlay(
    calculator: IFRS9ECLCalculator,
    data: Dict[str, Any],
    stage_num: int,
    ead: float,
    pd_12m_pct: float,
    pd_lifetime_pct: float,
    lgd_pct: float,
) -> Optional[Dict[str, float]]:
    scenarios = data.get("scenarios") or {}
    if not scenarios:
        return None

    base_macro = scenarios.get("base_macro") or {}
    opt_macro = scenarios.get("optimistic_macro") or {}
    pess_macro = scenarios.get("pessimistic_macro") or {}

    pd_base = pd_pct_to_decimal(pd_12m_pct if stage_num == 1 else pd_lifetime_pct)
    lgd_dec = lgd_pct_to_decimal(lgd_pct)
    discount_rate = float(data.get("discount_rate", 0.08))

    def ecl_for_macro(macro: Dict[str, Any]) -> float:
        pd_adj = calculator.apply_macro_overlay(
            Decimal(str(pd_base)),
            float(macro.get("gdp_growth", 0) or 0),
            float(macro.get("unemployment", macro.get("unemployment_rate", 0)) or 0),
            float(macro.get("interest_rate", 0) or 0),
        )
        horizon = 1 if stage_num == 1 else int(data.get("remaining_term_years", 5) or 5)
        return float(
            calculator.calculate_ecl_single_loan(
                Decimal(str(ead)),
                pd_adj,
                Decimal(str(lgd_dec)),
                Decimal(str(discount_rate)),
                time_horizon_years=horizon,
            )
        )

    base_ecl = float(scenarios.get("base_ecl") or ecl_for_macro(base_macro))
    opt_ecl = float(scenarios.get("optimistic_ecl") or ecl_for_macro(opt_macro))
    pess_ecl = float(scenarios.get("pessimistic_ecl") or ecl_for_macro(pess_macro))
    base_w = float(scenarios.get("base_weight", 50)) / 100
    opt_w = float(scenarios.get("optimistic_weight", 30)) / 100
    pess_w = float(scenarios.get("pessimistic_weight", 20)) / 100
    weighted = base_ecl * base_w + opt_ecl * opt_w + pess_ecl * pess_w
    return {
        "base": base_ecl,
        "optimistic": opt_ecl,
        "pessimistic": pess_ecl,
        "weighted": weighted,
    }


def orchestrate_calculate(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Full IFRS 9 calculate orchestration.
    Returns API response dict (PD in %, journals nested).
    """
    approach = str(data.get("approach", "general")).lower()
    reporting_date = str(data.get("reporting_date") or datetime.now().strftime("%Y-%m-%d"))
    portfolio_name = str(data.get("portfolio_name") or data.get("instrument_name") or "Portfolio")
    previous_ecl = float(data.get("previous_ecl", 0) or 0)
    discount_rate = float(data.get("discount_rate", 0.08))

    classification_result = None
    if data.get("classification"):
        classification_result = IFRS9ClassificationEngine().classify(data["classification"])

    # ── Simplified / provision matrix ──
    if approach == "simplified":
        pm_engine = IFRS9ProvisionMatrixEngine()
        pm_payload = _build_provision_matrix_payload(data)
        if not pm_payload["bucket_totals"] and not pm_payload["receivables"]:
            raise ValueError("Simplified approach requires ageing_buckets or receivables")
        pm_result = pm_engine.calculate(pm_payload)
        applicable_ecl = float(pm_result.get("total_provision") or pm_result.get("total_ecl") or 0)
        total_ead = float(pm_result.get("total_gross") or pm_result.get("total_exposure") or 0)
        coverage = (applicable_ecl / total_ead * 100) if total_ead else 0.0
        calc = IFRS9ECLCalculator()
        journals_raw = calc.generate_journal_entries(
            Decimal(str(applicable_ecl)),
            Decimal(str(previous_ecl)),
        )
        journals = normalize_ifrs9_journals(journals_raw, reporting_date=reporting_date, portfolio_name=portfolio_name)
        bucket_results = pm_result.get("buckets") or []
        return {
            "approach": "simplified",
            "classification_result": classification_result,
            "applicable_ecl": applicable_ecl,
            "ecl_simplified": applicable_ecl,
            "ecl_12m": None,
            "ecl_lifetime": None,
            "ecl_weighted": applicable_ecl,
            "coverage_ratio": round(coverage, 2),
            "ead_used": total_ead,
            "provision_matrix_result": pm_result,
            "bucket_results": bucket_results,
            "journal_entries": journals,
            "disclosure_notes": disclosure_to_text(
                {
                    "reporting_date": reporting_date,
                    "summary": {"total_ecl_provision": applicable_ecl, "total_exposure": total_ead},
                }
            ),
            "scenario_results": None,
            "staging": None,
            "ecl_movement": None,
        }

    calculator = IFRS9ECLCalculator()
    staging_engine = IFRS9StagingEngine()

    # ── Multi-loan portfolio ──
    loans = data.get("loans")
    if isinstance(loans, list) and len(loans) > 0:
        rows = []
        for i, raw in enumerate(loans):
            row = _loan_row_from_payload({**data, **raw, "loan_id": raw.get("loan_id", f"L{i+1}")})
            if not data.get("stage_override"):
                sn, sl = _resolve_stage(data, row, staging_engine)
                row["stage"] = sl
                row["stage_number"] = sn
            else:
                sn = int(raw.get("stage", data.get("stage", 1)))
                row["stage"] = _STAGE_NUM_TO_LABEL.get(sn, "Stage 1")
                row["stage_number"] = sn
            rows.append(row)
        portfolio_df = pd.DataFrame(rows)
        if "stage" not in portfolio_df.columns:
            portfolio_df = staging_engine.classify_portfolio(portfolio_df)

        period_events = data.get("period_events") or {"opening_total_ecl": previous_ecl}
        full = calculator.calculate_full_ifrs9_ecl(
            portfolio_df,
            discount_rate=discount_rate,
            previous_ecl=previous_ecl,
            reporting_date=reporting_date,
        )
        portfolio_detail = full["portfolio_detail"]
        summary = full["summary"]
        applicable_ecl = float(summary["total_ecl_provision"])
        total_ead = float(summary["total_exposure"])
        coverage = float(summary["overall_coverage_ratio_pct"])
        journals = normalize_ifrs9_journals(
            full["journal_entries"],
            reporting_date=reporting_date,
            portfolio_name=portfolio_name,
        )
        scenario_results = _scenario_macro_overlay(
            calculator,
            data,
            1,
            total_ead,
            float(data.get("pd_12m", 1)),
            float(data.get("pd_lifetime", 5)),
            float(data.get("lgd", 45)),
        )
        return {
            "approach": "general",
            "classification_result": classification_result,
            "applicable_ecl": applicable_ecl,
            "ecl_12m": float(summary.get("by_stage", {}).get("Stage 1", {}).get("total_ecl", 0)),
            "ecl_lifetime": applicable_ecl - float(summary.get("by_stage", {}).get("Stage 1", {}).get("total_ecl", 0)),
            "ecl_weighted": scenario_results["weighted"] if scenario_results else applicable_ecl,
            "coverage_ratio": coverage,
            "ead_used": total_ead,
            "summary": summary,
            "staging": staging_engine.generate_staging_report(portfolio_detail),
            "journal_entries": journals,
            "disclosure_notes": disclosure_to_text(full["disclosure_data"]),
            "disclosure_data": full["disclosure_data"],
            "ecl_movement": full.get("ecl_movement"),
            "movement_analysis": full.get("movement_analysis"),
            "scenario_results": scenario_results,
            "portfolio_loans": portfolio_detail.to_dict(orient="records"),
        }

    # ── Single instrument ──
    loan = _loan_row_from_payload(data)
    stage_num, stage_label = _resolve_stage(data, loan, staging_engine)
    loan["stage"] = stage_label
    loan["stage_number"] = stage_num

    scenarios = data.get("scenarios") or {}
    base_macro = scenarios.get("base_macro") or {}
    macro = base_macro if scenarios else None

    pd_12m_pct = float(data.get("pd_12m", 1))
    pd_lifetime_pct = float(data.get("pd_lifetime", 5))
    lgd_pct = float(data.get("lgd", 45))
    ead = float(loan["ead"])

    if stage_num == 1:
        ecl_12m = float(calculator.calculate_stage1_ecl(loan, Decimal(str(discount_rate)), macro))
        ecl_lifetime = float(
            calculator.calculate_stage2_ecl(loan, Decimal(str(discount_rate)), macro)
        )
        applicable_ecl = ecl_12m
    elif stage_num == 2:
        ecl_12m = float(calculator.calculate_stage1_ecl(loan, Decimal(str(discount_rate)), macro))
        ecl_lifetime = float(calculator.calculate_stage2_ecl(loan, Decimal(str(discount_rate)), macro))
        applicable_ecl = ecl_lifetime
    else:
        ecl_12m = float(calculator.calculate_stage1_ecl(loan, Decimal(str(discount_rate)), macro))
        ecl_lifetime = float(calculator.calculate_stage3_ecl(loan, Decimal(str(discount_rate)), macro))
        applicable_ecl = ecl_lifetime

    scenario_results = _scenario_macro_overlay(
        calculator, data, stage_num, ead, pd_12m_pct, pd_lifetime_pct, lgd_pct
    )
    ecl_weighted = scenario_results["weighted"] if scenario_results else applicable_ecl
    coverage = (applicable_ecl / ead * 100) if ead else 0.0

    journals_raw = calculator.generate_journal_entries(
        Decimal(str(applicable_ecl)),
        Decimal(str(previous_ecl)),
    )
    journals = normalize_ifrs9_journals(journals_raw, reporting_date=reporting_date, portfolio_name=portfolio_name)

    single_df = pd.DataFrame([{**loan, "ecl_provision": applicable_ecl}])
    ecl_movement = calculator.generate_stage_ecl_bridge(
        single_df,
        previous_bridge=data.get("previous_bridge"),
        period_events=data.get("period_events") or {"opening_total_ecl": previous_ecl},
    )

    pd_12m_adj = float(
        calculator.apply_macro_overlay(
            Decimal(str(pd_pct_to_decimal(pd_12m_pct))),
            float(base_macro.get("gdp_growth", 0) or 0),
            float(base_macro.get("unemployment", 0) or 0),
            float(base_macro.get("interest_rate", 0) or 0),
        )
    )
    pd_lifetime_adj = float(
        calculator.apply_macro_overlay(
            Decimal(str(pd_pct_to_decimal(pd_lifetime_pct))),
            float(base_macro.get("gdp_growth", 0) or 0),
            float(base_macro.get("unemployment", 0) or 0),
            float(base_macro.get("interest_rate", 0) or 0),
        )
    )

    disclosure_data = calculator.generate_disclosure_data(
        single_df.assign(stage=stage_label),
        {
            "total_exposure": ead,
            "total_ecl_provision": applicable_ecl,
            "overall_coverage_ratio_pct": coverage,
            "by_stage": {},
        },
        reporting_date,
    )

    return {
        "approach": "general",
        "classification_result": classification_result,
        "stage": stage_num,
        "stage_label": stage_label,
        "staging_rationale": f"Classified as {stage_label}" + (" (override)" if data.get("stage_override") else " via IFRS9StagingEngine"),
        "applicable_ecl": applicable_ecl,
        "ecl_12m": ecl_12m,
        "ecl_lifetime": ecl_lifetime,
        "ecl_weighted": ecl_weighted,
        "coverage_ratio": round(coverage, 2),
        "pd_used": pd_12m_adj * 100 if stage_num == 1 else pd_lifetime_adj * 100,
        "pd_12m_pct": pd_12m_pct,
        "pd_lifetime_pct": pd_lifetime_pct,
        "macro_pd_decimal": {"pd_12m": pd_12m_adj, "pd_lifetime": pd_lifetime_adj},
        "lgd_used": lgd_pct,
        "ead_used": ead,
        "journal_entries": journals,
        "disclosure_notes": disclosure_to_text(disclosure_data),
        "disclosure_data": disclosure_data,
        "scenario_results": scenario_results,
        "ecl_movement": ecl_movement,
        "movement_analysis": {
            "opening_ecl": previous_ecl,
            "closing_ecl": applicable_ecl,
            "movement": applicable_ecl - previous_ecl,
        },
    }
