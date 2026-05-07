"""
IFRS 15 Revenue Recognition Calculator
5-step revenue recognition model implementation
"""

import pandas as pd
import numpy as np
from datetime import datetime, date, timedelta
from dateutil.relativedelta import relativedelta
from decimal import Decimal, ROUND_HALF_UP
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
import json
import os
import re
import uuid


@dataclass
class PerformanceObligation:
    """Individual performance obligation"""
    obligation_id: str
    description: str
    standalone_selling_price: Decimal
    recognition_method: str  # "over_time" or "point_in_time"
    duration_months: int = 0  # For over-time recognition
    transfer_date: Optional[datetime] = None  # For point-in-time
    completion_percentage: Decimal = Decimal('0')  # For over-time custom %


@dataclass
class IFRS15Input:
    """IFRS 15 contract input"""
    contract_id: str
    customer_name: str
    vendor_name: str = ""
    effective_date: datetime = datetime.now()
    contract_term_months: int = 12
    fixed_consideration: Decimal = Decimal('0')
    variable_consideration: Decimal = Decimal('0')
    # IFRS 15 §56-58 — variable consideration constraint
    variable_consideration_constrained: Decimal = Decimal('0')   # override; 0 = not set, use pct
    constraint_percentage: Decimal = Decimal('100')               # % of VC that is "highly probable" (0–100)
    constraint_method: str = "percentage"                         # "percentage" | "amount"
    discounts: Decimal = Decimal('0')
    rebates: Decimal = Decimal('0')
    financing_adjustment: Decimal = Decimal('0')
    payment_terms: str = ""
    currency: str = "USD"
    performance_obligations: List[PerformanceObligation] = field(default_factory=list)
    contract_type: str = "fixed_price"
    # T&M fields
    hourly_rate: Decimal = Decimal('0')
    hours_worked: Decimal = Decimal('0')
    # Capped T&M fields
    tm_cap: Decimal = Decimal('0')
    cumulative_billed: Decimal = Decimal('0')
    # POC fields (Fixed Price)
    total_estimated_cost: Decimal = Decimal('0')
    actual_cost_to_date: Decimal = Decimal('0')
    prior_revenue_recognised: Decimal = Decimal('0')
    # Maintenance
    maintenance_term_months: int = 0
    # Variable consideration extras
    volume_slabs: List[Dict] = field(default_factory=list)
    estimated_annual_volume: Decimal = Decimal('0')
    can_estimate_volume: bool = True
    sla_items: List[Dict] = field(default_factory=list)


class IFRS15ModificationEngine:
    """Assess and compute IFRS 15 contract modification treatments."""

    def _build_schedule(self, start_date: datetime, periods: int, amount_per_period: float, prefix: str = "MOD") -> List[Dict]:
        schedule: List[Dict] = []
        running = 0.0
        for idx in range(1, max(periods, 0) + 1):
            period_date = start_date + relativedelta(months=idx - 1)
            running += amount_per_period
            schedule.append({
                "period": idx,
                "contract_id": f"{prefix}-{period_date.strftime('%Y%m')}",
                "performance_obligation": "Modified obligations",
                "revenue_amount": round(amount_per_period, 2),
                "recognition_date": period_date.strftime("%Y-%m-%d"),
                "opening_balance": round(max(running - amount_per_period, 0), 2),
                "closing_balance": round(running, 2),
                "status": "Recognised" if amount_per_period > 0 else "Deferred",
            })
        return schedule

    def assess_modification(self, mod_input: Dict) -> Dict:
        modification_date = datetime.strptime(mod_input["modification_date"], "%Y-%m-%d")
        original_price = float(mod_input.get("original_price", 0) or 0)
        price_change = float(mod_input.get("price_change", 0) or 0)
        recognized_to_date = float(mod_input.get("revenue_recognised_to_date", 0) or 0)
        remaining_periods = int(mod_input.get("remaining_periods", 0) or 0)
        has_new_goods = len(mod_input.get("new_goods_services", []) or []) > 0
        new_goods_distinct = bool(mod_input.get("new_goods_are_distinct"))
        price_reflects_ssp = bool(mod_input.get("price_reflects_standalone"))
        remaining_goods_distinct = bool(mod_input.get("remaining_goods_are_distinct"))

        modification_type = "catch_up"
        modification_type_label = "Type 3 — Cumulative Catch-Up"

        if has_new_goods and new_goods_distinct and price_reflects_ssp:
            modification_type = "new_contract"
            modification_type_label = "Type 1 — New Separate Contract"
        # Type 3 before Type 2: catch-up when remaining undelivered scope is not distinct
        # from what was already transferred (IFRS 15.21-style cumulative adjustment).
        elif not remaining_goods_distinct:
            modification_type = "catch_up"
            modification_type_label = "Type 3 — Cumulative Catch-Up"
        elif (has_new_goods and new_goods_distinct and not price_reflects_ssp) or remaining_goods_distinct:
            modification_type = "prospective"
            modification_type_label = "Type 2 — Prospective Modification"
        else:
            modification_type = "prospective"
            modification_type_label = "Type 2 — Prospective Modification"

        old_remaining = max(original_price - recognized_to_date, 0)
        old_per_period = (old_remaining / remaining_periods) if remaining_periods > 0 else 0
        before_schedule = self._build_schedule(modification_date, min(remaining_periods, 3), old_per_period, "BEFORE")

        catch_up_amount = 0.0
        revised_schedule: List[Dict] = []
        journal_entries: List[Dict] = []

        if modification_type == "new_contract":
            new_per_period = (price_change / remaining_periods) if remaining_periods > 0 else price_change
            revised_schedule = self._build_schedule(modification_date, max(remaining_periods, 1), new_per_period, "NEW")
            journal_entries = [
                {"account": "Accounts Receivable / Contract Asset", "dr": round(price_change, 2), "cr": 0.0, "narration": "New contract inception"},
                {"account": "Contract Liability (Deferred Revenue)", "dr": 0.0, "cr": round(price_change, 2), "narration": "New separate contract"},
            ]
            explanation = (
                "This is assessed as a new separate contract because the added goods/services are distinct and the price increase reflects standalone selling prices. "
                "The original contract accounting remains unchanged, and recognition for the new contract starts from the modification date. "
                "The journal entry records a fresh deferred revenue position for the new contract consideration."
            )
        elif modification_type == "prospective":
            remaining_consideration = old_remaining + price_change
            new_per_period = (remaining_consideration / remaining_periods) if remaining_periods > 0 else remaining_consideration
            revised_schedule = self._build_schedule(modification_date, max(remaining_periods, 1), new_per_period, "PROS")
            journal_entries = [
                {"account": "Contract Liability", "dr": round(max(price_change, 0), 2), "cr": 0.0, "narration": "Adjust liability for prospective revision"},
                {"account": "Revenue", "dr": 0.0, "cr": round(max(price_change, 0), 2), "narration": "Prospective adjustment allocation"},
            ]
            explanation = (
                "This is assessed as a prospective modification because distinct remaining/new goods are affected but pricing does not fully reflect standalone selling prices. "
                "Revenue previously recognised is not restated; instead, the remaining consideration is reallocated over remaining periods from the modification date forward. "
                "The journal entry adjusts contract balances to align future recognition with revised economics."
            )
        else:
            revised_total = original_price + price_change
            completion_ratio = (recognized_to_date / original_price) if original_price > 0 else 0
            revenue_should_have_been = revised_total * completion_ratio
            catch_up_amount = revenue_should_have_been - recognized_to_date
            new_per_period = (max(revised_total - revenue_should_have_been, 0) / remaining_periods) if remaining_periods > 0 else 0
            revised_schedule = self._build_schedule(modification_date, max(remaining_periods, 1), new_per_period, "CATCH")
            if catch_up_amount >= 0:
                journal_entries = [
                    {"account": "Contract Liability", "dr": round(catch_up_amount, 2), "cr": 0.0, "narration": "Catch-up contract liability release"},
                    {"account": "Revenue", "dr": 0.0, "cr": round(catch_up_amount, 2), "narration": "Additional catch-up revenue"},
                ]
            else:
                journal_entries = [
                    {"account": "Revenue", "dr": round(abs(catch_up_amount), 2), "cr": 0.0, "narration": "Reverse over-recognised revenue"},
                    {"account": "Contract Liability", "dr": 0.0, "cr": round(abs(catch_up_amount), 2), "narration": "Reinstate deferred revenue"},
                ]
            explanation = (
                "This is assessed as a cumulative catch-up modification because remaining goods/services are not distinct from those already transferred. "
                "Revenue is recalculated as if modified terms existed from inception and the difference is posted immediately as a catch-up. "
                "The journal entry increases or reverses current-period revenue with an equal and opposite contract liability adjustment."
            )

        risk_flag = abs(catch_up_amount) > (0.10 * original_price if original_price > 0 else 0)
        risk_message = (
            "Catch-up adjustment exceeds 10% of total contract value. Recommend controller review."
            if risk_flag
            else ""
        )

        if risk_flag:
            explanation += " Risk flag raised because catch-up exceeds 10% of contract value."

        catch_up_direction = "none"
        if catch_up_amount > 0:
            catch_up_direction = "additional_revenue"
        elif catch_up_amount < 0:
            catch_up_direction = "revenue_reversal"

        return {
            "modification_type": modification_type,
            "modification_type_label": modification_type_label,
            "catch_up_amount": round(catch_up_amount, 2),
            "catch_up_direction": catch_up_direction,
            "revised_schedule": revised_schedule,
            "original_schedule_preview": before_schedule,
            "journal_entries": journal_entries,
            "explanation": explanation,
            "risk_flag": risk_flag,
            "risk_message": risk_message,
        }


VC_FACTOR_LABELS = [
    "High susceptibility to external factors (market prices, weather, counterparty actions)",
    "Long resolution period (uncertainty resolves near or after end of contract)",
    "Limited experience with similar contracts (new product line, new geography, new customer type)",
    "Broad range of possible outcomes (wide spread between lowest and highest scenario)",
    "Contract allows full refund on cancellation",
]


class IFRS15VariableConsiderationEngine:
    """IFRS 15.50–58 variable consideration estimation and constraint (practical model)."""

    def estimate(self, data: Dict[str, Any]) -> Dict[str, Any]:
        method = (data.get("method") or "").strip().lower()
        scenarios: List[Dict[str, Any]] = list(data.get("scenarios") or [])
        factors: List[bool] = list(data.get("constraint_factors") or [])

        if len(factors) != 5:
            raise ValueError("constraint_factors must contain exactly 5 boolean values")
        if not scenarios:
            raise ValueError("At least one scenario is required")

        if method in ("expected_value", "scenario_weighted"):
            total_p = float(sum(float(s.get("probability", 0) or 0) for s in scenarios))
            if abs(total_p - 1.0) > 0.01:
                raise ValueError("Probabilities must sum to 100%")
            expected_amount = float(
                sum(float(s.get("amount", 0) or 0) * float(s.get("probability", 0) or 0) for s in scenarios)
            )
        elif method == "most_likely":
            probs = [float(s.get("probability", 0) or 0) for s in scenarios]
            max_p = max(probs) if probs else 0.0
            if max_p > 0:
                at_max = [s for s in scenarios if abs(float(s.get("probability", 0) or 0) - max_p) < 1e-9]
            else:
                at_max = list(scenarios)
            expected_amount = max(float(s.get("amount", 0) or 0) for s in at_max)
        else:
            raise ValueError("method must be 'expected_value', 'scenario_weighted', or 'most_likely'")

        constraint_score = sum(1 for f in factors if f)
        if constraint_score == 0:
            constrained_amount = expected_amount
            constraint_applied = False
            constraint_level: str = "none"
        elif constraint_score == 1:
            constrained_amount = expected_amount * 0.95
            constraint_applied = True
            constraint_level = "low"
        elif constraint_score == 2:
            constrained_amount = expected_amount * 0.85
            constraint_applied = True
            constraint_level = "moderate"
        else:
            constrained_amount = expected_amount * 0.70
            constraint_applied = True
            constraint_level = "high"

        mult_by_level = {"none": 1.0, "low": 0.95, "moderate": 0.85, "high": 0.70}
        constraint_multiplier = float(mult_by_level.get(constraint_level, 1.0))

        reduction_amount = expected_amount - constrained_amount
        if expected_amount and abs(expected_amount) > 1e-9:
            reduction_pct = (reduction_amount / expected_amount) * 100.0
        else:
            reduction_pct = 0.0

        active = [VC_FACTOR_LABELS[i] for i, v in enumerate(factors) if v and i < len(VC_FACTOR_LABELS)]

        method_label = "scenario weighted (probability-weighted)" if method == "scenario_weighted" else method.replace("_", " ")
        explanation = f"Variable consideration was estimated using the {method_label} method. "
        if constraint_applied:
            explanation += (
                f"IFRS 15.56 constraint factors ({constraint_score} active) reduce the amount that can be included "
                f"in the transaction price to {constrained_amount:,.2f} (from {expected_amount:,.2f} unconstrained). "
            )
        else:
            explanation += (
                f"No material reversal risk factors were flagged, so the full {expected_amount:,.2f} is included. "
            )
        explanation += (
            f"Include {constrained_amount:,.2f} in the transaction price for recognition purposes. "
        )
        if reduction_pct > 30.0 and constraint_applied:
            explanation += (
                "Because the effective constraint exceeds 30%, consider further documentation of estimates and a formal review. "
            )

        risk_flag = reduction_pct > 25.0
        risk_message = (
            f"Constraint reduces variable consideration by {reduction_pct:.1f}%. "
            "Consider whether variable element should be excluded entirely until uncertainty resolves."
            if risk_flag
            else ""
        )

        amounts_list = [float(s.get("amount", 0) or 0) for s in scenarios]
        if scenarios and amounts_list:
            best_case = max(amounts_list)
            worst_case = min(amounts_list)
            best_prob = -1.0
            tie_amts: List[float] = []
            for s in scenarios:
                p = float(s.get("probability", 0) or 0)
                amt = float(s.get("amount", 0) or 0)
                if p > best_prob + 1e-12:
                    best_prob = p
                    tie_amts = [amt]
                elif abs(p - best_prob) <= 1e-12:
                    tie_amts.append(amt)
            most_likely = float(max(tie_amts)) if tie_amts else float(expected_amount)
            variance = float(best_case - worst_case)
        else:
            best_case = float(expected_amount)
            worst_case = float(expected_amount)
            most_likely = float(expected_amount)
            variance = 0.0

        revenue_at_risk = float(expected_amount - constrained_amount)
        tc_raw = data.get("total_contract_value")
        try:
            contract_value = float(tc_raw) if tc_raw is not None else 0.0
        except (TypeError, ValueError):
            contract_value = 0.0
        if contract_value <= 1e-12:
            contract_value = float(expected_amount) if abs(expected_amount) > 1e-12 else 0.0
        if contract_value > 1e-12:
            risk_pct_of_contract = (revenue_at_risk / contract_value) * 100.0
        else:
            risk_pct_of_contract = 0.0
        if risk_pct_of_contract > 20.0:
            risk_level = "HIGH"
        elif risk_pct_of_contract > 10.0:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        risk_scenario = {
            "best_case": round(best_case, 2),
            "worst_case": round(worst_case, 2),
            "most_likely": round(most_likely, 2),
            "variance": round(variance, 2),
        }

        constraint_warning = ""
        if constraint_level == "high":
            inc_pct = (constrained_amount / expected_amount * 100.0) if abs(expected_amount) > 1e-12 else constraint_multiplier * 100.0
            constraint_warning = (
                f"HIGH constraint applied ({inc_pct:.0f}% of expected value included). "
                f"Revenue at risk: ${revenue_at_risk:,.0f}. "
                f"Consider whether variable consideration should be excluded entirely until "
                f"uncertainty resolves (IFRS 15.57)."
            )
        elif constraint_level == "moderate":
            constraint_warning = (
                f"Moderate constraint applied. ${revenue_at_risk:,.0f} excluded "
                f"from transaction price pending resolution of uncertainty."
            )

        return {
            "method": method,
            "scenarios": scenarios,
            "expected_amount": round(expected_amount, 2),
            "constrained_amount": round(constrained_amount, 2),
            "constraint_applied": constraint_applied,
            "constraint_level": constraint_level,
            "constraint_score": int(constraint_score),
            "reduction_amount": round(reduction_amount, 2),
            "reduction_pct": round(reduction_pct, 2),
            "include_in_transaction_price": round(constrained_amount, 2),
            "active_factors": active,
            "explanation": explanation.strip(),
            "risk_flag": bool(risk_flag),
            "risk_message": risk_message,
            "revenue_at_risk": round(revenue_at_risk, 2),
            "risk_pct_of_contract": round(risk_pct_of_contract, 4),
            "risk_level": risk_level,
            "risk_scenario": risk_scenario,
            "constraint_multiplier": constraint_multiplier,
            "constraint_warning": constraint_warning,
        }


class IFRS15RPOEngine:
    """IFRS 15.120–122 remaining performance obligations (RPO) disclosure support."""

    def calculate_rpo(self, data: Dict[str, Any]) -> Dict[str, Any]:
        obligations_in = list(data.get("obligations") or [])
        as_of = date.today()
        as_of_str = as_of.isoformat()
        d1 = as_of + timedelta(days=365)
        d2 = as_of + timedelta(days=730)

        by_obligation: List[Dict[str, Any]] = []
        within_1_year = 0.0
        one_to_two_years = 0.0
        beyond_2_years = 0.0
        total_rpo = 0.0

        for raw in obligations_in:
            name = str(raw.get("obligation_name") or raw.get("obligation") or "Obligation")
            allocated = float(raw.get("allocated_amount", 0) or 0)
            recognised = float(raw.get("recognised_to_date", raw.get("revenue_recognized", 0)) or 0)
            rpo_amount = max(0.0, allocated - recognised)
            end_s = (raw.get("expected_end_date") or "").strip()[:10]
            try:
                end_dt = datetime.strptime(end_s, "%Y-%m-%d").date() if end_s else as_of
            except ValueError:
                end_dt = as_of

            if end_dt <= d1:
                bucket = "within_1_year"
                within_1_year += rpo_amount
            elif end_dt <= d2:
                bucket = "one_to_two_years"
                one_to_two_years += rpo_amount
            else:
                bucket = "beyond_2_years"
                beyond_2_years += rpo_amount

            total_rpo += rpo_amount
            pct_complete = (recognised / allocated * 100.0) if abs(allocated) > 1e-9 else 0.0

            by_obligation.append(
                {
                    "obligation_name": name,
                    "allocated_amount": round(allocated, 2),
                    "recognised_to_date": round(recognised, 2),
                    "rpo_amount": round(rpo_amount, 2),
                    "expected_completion_date": end_s or as_of_str,
                    "bucket": bucket,
                    "pct_complete": round(min(100.0, max(0.0, pct_complete)), 2),
                }
            )

        remaining_rows = [row for row in by_obligation if row["rpo_amount"] > 1e-6]
        if not remaining_rows:
            practical_expedient_available = True
        else:
            expedient_each: List[bool] = []
            for raw, row in zip(obligations_in, by_obligation):
                if row["rpo_amount"] <= 1e-6:
                    continue
                rti = bool(raw.get("is_right_to_invoice") or raw.get("right_to_invoice"))
                od = raw.get("original_expected_duration_months")
                short_orig = False
                if od is not None:
                    try:
                        short_orig = float(od) <= 12.0 + 1e-9
                    except (TypeError, ValueError):
                        short_orig = False
                end_s = (raw.get("expected_end_date") or "").strip()[:10]
                try:
                    end_dt = datetime.strptime(end_s, "%Y-%m-%d").date() if end_s else as_of
                except ValueError:
                    end_dt = as_of
                completes_within_year = (end_dt - as_of).days <= 365
                expedient_each.append(rti or short_orig or (od is None and completes_within_year))
            practical_expedient_available = all(expedient_each) if expedient_each else True

        disclosure_required = not practical_expedient_available
        tp_fmt = f"{total_rpo:,.2f}"
        disc = (
            f"As at {as_of_str}, the aggregate amount of the transaction price allocated to remaining "
            f"performance obligations (IFRS 15.120) is {tp_fmt}. "
            f"Of this amount, amounts expected to be recognised as revenue in not more than one year are "
            f"{within_1_year:,.2f}, in the second year thereafter {one_to_two_years:,.2f}, and thereafter "
            f"{beyond_2_years:,.2f}. "
        )
        if practical_expedient_available:
            disc += (
                "The practical expedient in IFRS 15.121 may be applied, allowing simplified or omitted "
                "disaggregation of remaining performance obligations where the criteria are met."
            )
        else:
            disc += (
                "Management has concluded that the practical expedient in IFRS 15.121 does not apply in full; "
                "accordingly, disaggregated disclosure of remaining performance obligations is provided above."
            )

        return {
            "total_rpo": round(total_rpo, 2),
            "within_1_year": round(within_1_year, 2),
            "one_to_two_years": round(one_to_two_years, 2),
            "beyond_2_years": round(beyond_2_years, 2),
            "by_obligation": by_obligation,
            "practical_expedient_available": bool(practical_expedient_available),
            "disclosure_required": bool(disclosure_required),
            "disclosure_text": disc.strip(),
            "as_of_date": as_of_str,
        }


class IFRS15ContractCostsEngine:
    """IFRS 15.91–94 incremental costs of obtaining a contract (commission asset)."""

    def calculate(self, data: Dict[str, Any]) -> Dict[str, Any]:
        commission = float(data.get("commission_amount", 0) or 0)
        term = int(data.get("contract_term_months", 0) or 0)
        contract_value = float(data.get("contract_total_value", 0) or 0)

        impairment_flag = bool(contract_value > 0 and commission > contract_value * 0.15)
        impairment_note = (
            "Commission exceeds 15% of contract value. Assess recoverability under IFRS 15.101 before capitalising."
            if impairment_flag
            else ""
        )

        if term <= 0:
            term = 0
        if term <= 12:
            explanation = (
                f"Contract term is {term} month(s). The practical expedient allows immediate expensing of "
                f"incremental costs of obtaining the contract (IFRS 15.94). No commission asset is recognised."
            )
            return {
                "capitalise": False,
                "use_practical_expedient": True,
                "commission_amount": round(commission, 2),
                "contract_term_months": term,
                "monthly_amortisation": 0.0,
                "total_asset_recognised": 0.0,
                "amortisation_schedule": [],
                "journal_entries": [
                    {
                        "phase": "immediate_expense",
                        "description": "Expense incremental cost of obtaining contract (practical expedient)",
                        "dr_account": "Sales & Marketing Expense",
                        "cr_account": "Cash / Accruals",
                        "dr": round(commission, 2),
                        "cr": round(commission, 2),
                    }
                ],
                "impairment_flag": impairment_flag,
                "impairment_note": impairment_note,
                "explanation": explanation,
            }

        monthly = commission / term if term > 0 else 0.0
        schedule: List[Dict[str, Any]] = []
        opening = commission
        cumulative = 0.0
        for m in range(1, term + 1):
            if m == term:
                amo = round(opening, 2)
            else:
                amo = round(monthly, 2)
            closing = round(opening - amo, 2)
            cumulative = round(cumulative + amo, 2)
            schedule.append(
                {
                    "month": m,
                    "opening_balance": round(opening, 2),
                    "amortisation": amo,
                    "closing_balance": closing,
                    "cumulative_amortised": cumulative,
                    "journal_dr": "Sales & Marketing Expense",
                    "journal_cr": "Contract Cost Asset",
                }
            )
            opening = closing

        journal_entries: List[Dict[str, Any]] = [
            {
                "phase": "inception",
                "description": "Capitalise incremental cost of obtaining contract",
                "dr_account": "Contract Cost Asset",
                "cr_account": "Cash / Accruals",
                "dr": round(commission, 2),
                "cr": round(commission, 2),
            },
            {
                "phase": "monthly_template",
                "description": f"Amortise contract cost asset over {term} month contract term (repeat monthly)",
                "dr_account": "Sales & Marketing Expense",
                "cr_account": "Contract Cost Asset",
                "dr": round(monthly, 2),
                "cr": round(monthly, 2),
            },
        ]

        explanation = (
            f"Contract term exceeds 12 months ({term} months). Incremental commission of {commission:,.2f} is "
            f"capitalised and amortised on a straight-line basis ({round(monthly, 2):,.2f} per month) over the "
            f"contract term in line with IFRS 15.91–94."
        )

        return {
            "capitalise": True,
            "use_practical_expedient": False,
            "commission_amount": round(commission, 2),
            "contract_term_months": term,
            "monthly_amortisation": round(monthly, 2),
            "total_asset_recognised": round(commission, 2),
            "amortisation_schedule": schedule,
            "journal_entries": journal_entries,
            "impairment_flag": impairment_flag,
            "impairment_note": impairment_note,
            "explanation": explanation,
        }


class IFRS15PrincipalAgentEngine:
    """IFRS 15.B34–B38 principal vs agent (gross vs net) assessment."""

    def assess(self, data: Dict[str, Any]) -> Dict[str, Any]:
        tpi = "obtains_before_transfer"
        spi = "sets_price_independently"
        pri = "primarily_responsible"
        ind1 = bool(data.get(tpi))
        ind2 = bool(data.get(spi))
        ind3 = bool(data.get(pri))
        principal_score = sum(1 for x in (ind1, ind2, ind3) if x)

        gross = float(data.get("transaction_price", 0) or 0)
        cost = float(data.get("cost_paid_to_supplier", 0) or 0)
        net = max(0.0, gross - cost)
        if gross > 1e-9:
            commission_rate = net / gross
        else:
            commission_rate = 0.0

        if principal_score >= 2:
            conclusion = "PRINCIPAL"
            rev_rec = "GROSS"
            desc_step2 = (
                "Recognise full transaction price as revenue. Cost of goods/service shown as expense separately."
            )
        else:
            conclusion = "AGENT"
            rev_rec = "NET"
            desc_step2 = (
                "Recognise only the net commission/fee as revenue. Do not gross up for amounts collected on behalf of the principal."
            )

        borderline = principal_score in (1, 2)
        if borderline:
            bnote = "Assessment is borderline. Apply additional judgment and document rationale thoroughly for audit purposes."
        else:
            bnote = ""

        if conclusion == "PRINCIPAL":
            revenue_to = gross
            expense_to = cost
            gross_margin = net / gross if abs(gross) > 1e-9 else 0.0
        else:
            revenue_to = net
            expense_to = 0.0
            gross_margin = 1.0

        rev_diff = gross - net
        if abs(gross) > 1e-9:
            commission_rate_pct = commission_rate * 100.0
        else:
            commission_rate_pct = 0.0

        if conclusion == "PRINCIPAL":
            journal_entries: List[Dict[str, Any]] = [
                {
                    "phase": "on_sale",
                    "description": "On sale: recognise revenue at gross transaction price",
                    "dr_account": "Accounts Receivable",
                    "cr_account": "Revenue",
                    "dr": round(gross, 2),
                    "cr": round(gross, 2),
                },
                {
                    "phase": "on_cost",
                    "description": "On cost: recognise cost of sales",
                    "dr_account": "Cost of Sales",
                    "cr_account": "Cash / Payable",
                    "dr": round(cost, 2),
                    "cr": round(cost, 2),
                },
            ]
        else:
            journal_entries = [
                {
                    "phase": "gross_receipt",
                    "description": "On receipt: gross inflow; net fee to revenue, balance to principal",
                    "compound": True,
                    "lines": [
                        {"side": "Dr", "account": "Cash / AR", "amount": round(gross, 2)},
                        {"side": "Cr", "account": "Revenue (net fee)", "amount": round(net, 2)},
                        {"side": "Cr", "account": "Payable to Principal", "amount": round(cost, 2)},
                    ],
                },
                {
                    "phase": "remit_to_principal",
                    "description": "Remit amount owed to principal",
                    "dr_account": "Payable to Principal",
                    "cr_account": "Cash",
                    "dr": round(cost, 2),
                    "cr": round(cost, 2),
                },
            ]

        explained = [
            f"IFRS 15.B34–B38 indicators: obtains before transfer = {ind1}, sets price independently = {ind2}, primarily responsible = {ind3} (score {principal_score} of 3). "
        ]
        if conclusion == "PRINCIPAL":
            explained.append(
                f"With at least two indicators, the entity is a principal and recognises revenue on a {rev_rec.lower()} basis at the full {gross:,.2f} transaction price. "
            )
        else:
            explained.append(
                f"With at most one principal indicator, the entity is an agent and recognises revenue on a {rev_rec.lower()} basis, limited to the {net:,.2f} net fee. "
            )
        explained.append(desc_step2)
        explained.append(
            f" The difference between gross and net of supplier cost is {rev_diff:,.2f}. "
        )
        if borderline:
            explained.append(bnote)
        else:
            explained.append(" Conclusion is not at the margin; continue to support with contract evidence. ")

        return {
            "conclusion": conclusion,
            "revenue_recognition": rev_rec,
            "principal_score": int(principal_score),
            "borderline": bool(borderline),
            "borderline_note": bnote,
            "indicator_results": {tpi: ind1, spi: ind2, pri: ind3},
            "gross_revenue": round(gross, 2),
            "net_revenue": round(net, 2),
            "cost_paid_to_supplier": round(cost, 2),
            "revenue_to_recognise": round(revenue_to, 2),
            "expense_to_recognise": round(expense_to, 2),
            "gross_margin_pct": round(gross_margin * 100.0, 2),
            "revenue_difference": round(rev_diff, 2),
            "commission_rate_pct": round(commission_rate_pct, 2),
            "journal_entries": journal_entries,
            "explanation": "".join(explained).strip(),
        }


class IFRS15LicenseEngine:
    """IFRS 15.B52–B63 licences of intellectual property (right to access vs right to use)."""

    def classify(self, data: Dict[str, Any]) -> Dict[str, Any]:
        a = bool(data.get("significantly_affects_ip"))
        b = bool(data.get("customer_exposed_as_occurs"))
        c = bool(data.get("activities_not_separate_good"))
        right_to_access = a and b and c
        right_to_use = not right_to_access

        price = float(data.get("transaction_price", 0) or 0)
        term = int(data.get("licence_term_months", 0) or 0)
        start_s = (data.get("licence_start_date") or data.get("license_start_date") or "")[:10]
        royalties = bool(data.get("includes_usage_royalties"))
        if royalties:
            royalty_exception = True
            royalty_note = (
                "Sales/usage based royalties on licences of IP are recognised only when (or as) the subsequent sale or "
                "usage occurs — even if this is later than general IFRS 15 recognition criteria would suggest. (IFRS 15.B63)"
            )
        else:
            royalty_exception = False
            royalty_note = ""

        if right_to_access:
            lic_type = "RIGHT_TO_ACCESS"
            pattern = "OVER_TIME"
            if term > 0:
                rpp = price / term
            else:
                rpp = 0.0
            rec_basis = "Straight-line over licence period"
            recognition_date = start_s
            sched: List[Dict[str, Any]] = []
            if term > 0 and price >= 0:
                per = round(rpp, 2)
                cum = 0.0
                for m in range(1, term + 1):
                    if m == term:
                        amo = round(price - cum, 2)
                    else:
                        amo = per
                    cum = round(cum + amo, 2)
                    sched.append(
                        {
                            "month": m,
                            "revenue": amo,
                            "cumulative": cum,
                            "period": f"Month {m}",
                        }
                    )
            jnl: List[Dict[str, Any]] = [
                {
                    "phase": "inception_cash",
                    "description": "At start: record contract liability for licence fees received",
                    "dr_account": "Cash / AR",
                    "cr_account": "Contract Liability",
                    "dr": round(price, 2),
                    "cr": round(price, 2),
                },
                {
                    "phase": "monthly",
                    "description": "Monthly: release liability to revenue over licence term",
                    "dr_account": "Contract Liability",
                    "cr_account": "Licence Revenue",
                    "dr": round(rpp, 2) if term else 0.0,
                    "cr": round(rpp, 2) if term else 0.0,
                },
            ]
        else:
            lic_type = "RIGHT_TO_USE"
            pattern = "POINT_IN_TIME"
            rpp = 0.0
            rec_basis = "At the point the customer can use and benefit from the IP"
            recognition_date = start_s
            sched = [
                {
                    "month": 1,
                    "revenue": round(price, 2),
                    "cumulative": round(price, 2),
                    "period": f"On {start_s or 'inception'}",
                }
            ]
            jnl = [
                {
                    "phase": "on_start",
                    "description": "At licence start: recognise full fee as revenue (no separate deferral of distinct licence)",
                    "dr_account": "Cash / AR",
                    "cr_account": "Licence Revenue",
                    "dr": round(price, 2),
                    "cr": round(price, 2),
                }
            ]

        exp_parts: List[str] = []
        if right_to_access:
            exp_parts.append(
                f"The licence is classified as a right to access the entity's IP (satisfaction over time) because the entity's "
                f"ongoing activities significantly affect the IP ({a}), the customer is exposed to those effects as they occur "
                f"({b}), and the activities are not a separate good or service ({c}). "
                f"Revenue of {rpp:,.2f} per month is recognised over {term} month(s)."
            )
        else:
            if not a:
                exp_parts.append("The entity's activities are not considered to significantly affect the IP, or (together with the other conditions) a right to use is more appropriate. ")
            if not b:
                exp_parts.append("The customer may not be exposed to the effects of ongoing activities as they occur. ")
            if not c:
                exp_parts.append("Updates or activities may be separate performance obligations. ")
            exp_parts.append(
                f"The licence is a right to use IP; revenue of {price:,.2f} is recognised at the point in time the customer can begin to use the IP (typically {start_s or 'inception'})."
            )
        if royalty_exception:
            exp_parts.append(royalty_note)

        return {
            "license_type": lic_type,
            "pattern": pattern,
            "recognition_basis": rec_basis,
            "conditions_met": {
                "significantly_affects_ip": a,
                "customer_exposed_as_occurs": b,
                "activities_not_separate_good": c,
            },
            "revenue_per_period": round(rpp, 2) if right_to_access else 0.0,
            "recognition_date": recognition_date or start_s,
            "licence_term_months": term,
            "transaction_price": round(price, 2),
            "royalty_exception": royalty_exception,
            "royalty_note": royalty_note,
            "recognition_schedule": sched,
            "journal_entries": jnl,
            "explanation": " ".join(exp_parts).strip(),
        }


class IFRS15MasterSummaryEngine:
    """Aggregates IFRS 15 core calculation and optional module outputs into one master report."""

    def generate(self, data: Dict[str, Any]) -> Dict[str, Any]:
        core = data.get("core_results") or {}
        contract_id = str(data.get("contract_id") or "")
        customer_name = str(data.get("customer_name") or "")
        disc = core.get("disclosure_data") or {}
        cdetails = disc.get("contract_details") or {}
        if not contract_id:
            contract_id = str(cdetails.get("contract_id") or "")
        if not customer_name:
            customer_name = str(cdetails.get("customer") or cdetails.get("customer_name") or "")

        perf_obs = disc.get("performance_obligations") or []
        if not isinstance(perf_obs, list):
            perf_obs = []
        n_obs = len(perf_obs)
        methods = [str((o or {}).get("recognition_method", "")).lower() for o in perf_obs]
        has_ot = any("over" in m for m in methods)
        has_pit = any("point" in m for m in methods)
        if has_ot and has_pit:
            rec_pat = "Mixed"
        elif has_pit:
            rec_pat = "Point in Time"
        elif has_ot:
            rec_pat = "Over Time"
        else:
            rec_pat = "Mixed" if n_obs else "Over Time"

        term_m = int(cdetails.get("term_months") or data.get("contract_term_months") or 0)
        currency = str(cdetails.get("currency") or "USD")
        tp = float(core.get("transaction_price", 0) or 0)
        balances = core.get("contract_balances") or {}
        rec_to_date = float(balances.get("revenue_recognized_to_date", 0) or 0)
        def_rev = float(balances.get("contract_liability_amount", 0) or 0)
        c_assets = float(balances.get("contract_asset_amount", 0) or 0)
        allocs = core.get("allocations") or {}
        if isinstance(allocs, dict) and not isinstance(allocs, list):
            n_alloc = len(allocs)
        else:
            n_alloc = 0

        sched = core.get("revenue_schedule") or core.get("recognition_schedule")
        has_sched = bool(sched) and (len(sched) if isinstance(sched, list) else 0) > 0
        jn = core.get("journal_entries") or {}

        mod = data.get("modification_result") or {}
        vc = data.get("variable_consideration_result") or {}
        rpo = data.get("rpo_result") or {}
        cc = data.get("contract_costs_result") or {}
        pa = data.get("principal_agent_result") or {}
        lic = data.get("license_result") or {}

        mod_assessed = bool(mod and mod.get("modification_type"))
        vc_assessed = bool(vc and (vc.get("expected_amount") is not None or vc.get("constrained_amount") is not None))
        rpo_assessed = bool(rpo and rpo.get("total_rpo") is not None)
        cc_assessed = bool(cc and (cc.get("commission_amount") is not None or cc.get("use_practical_expedient") is not None))
        pa_assessed = bool(pa and pa.get("conclusion"))
        lic_assessed = bool(lic and lic.get("license_type"))

        if pa_assessed:
            if str(pa.get("conclusion")) == "AGENT":
                rev_basis_fs = "Net"
                gross_r = float(pa.get("gross_revenue", tp) or tp)
                net_r = float(pa.get("net_revenue", 0) or 0)
            else:
                rev_basis_fs = "Gross"
                gross_r = float(pa.get("gross_revenue", tp) or tp)
                net_r = float(pa.get("net_revenue", gross_r - float(pa.get("cost_paid_to_supplier", 0) or 0)))
        else:
            rev_basis_fs = "Not assessed"
            gross_r = tp
            net_r = tp

        vc_inc = float(vc.get("constrained_amount", 0) or vc.get("include_in_transaction_price", 0) or 0) if vc_assessed else 0.0
        vc_constr_amt = float(vc.get("reduction_amount", 0) or 0) if vc_assessed else 0.0

        comm_asset = float(cc.get("total_asset_recognised", 0) or 0) if cc_assessed else 0.0
        comm_mo = float(cc.get("monthly_amortisation", 0) or 0) if cc_assessed else 0.0

        total_rpo_val = float(rpo.get("total_rpo", 0) or 0) if rpo_assessed else 0.0

        step1 = bool(core) and bool(contract_id or customer_name)
        step2 = n_obs
        step3_tp = tp
        step3_vc_inc = vc_assessed and vc_inc > 0
        step4 = n_alloc > 0 or n_obs > 0
        step5_rec = rec_to_date
        step5_def = def_rev
        all_steps = bool(
            step1
            and step2 > 0
            and step4
            and has_sched
            and mod_assessed
            and vc_assessed
            and rpo_assessed
            and cc_assessed
            and pa_assessed
            and lic_assessed
        )

        mods_types: List[str] = []
        catch_total = 0.0
        if mod_assessed:
            mt = str(mod.get("modification_type", ""))
            if mt:
                mods_types.append(mt)
            catch_total = float(mod.get("catch_up_amount", 0) or 0)

        assessments = {
            "modifications": {
                "assessed": mod_assessed,
                "count": 1 if mod_assessed else 0,
                "types_used": mods_types,
                "total_catch_up_amount": round(catch_total, 2),
                "risk_flag": bool(mod.get("risk_flag")) if mod_assessed else False,
            },
            "variable_consideration": {
                "assessed": vc_assessed,
                "method": str(vc.get("method", "")) if vc_assessed else "",
                "unconstrained": float(vc.get("expected_amount", 0) or 0) if vc_assessed else 0.0,
                "constrained": float(vc.get("constrained_amount", 0) or 0) if vc_assessed else 0.0,
                "constraint_level": str(vc.get("constraint_level", "")) if vc_assessed else "",
                "risk_flag": bool(vc.get("risk_flag")) if vc_assessed else False,
            },
            "rpo": {
                "assessed": rpo_assessed,
                "total_rpo": round(float(rpo.get("total_rpo", 0) or 0), 2) if rpo_assessed else 0.0,
                "within_1_year": round(float(rpo.get("within_1_year", 0) or 0), 2) if rpo_assessed else 0.0,
                "one_to_two_years": round(float(rpo.get("one_to_two_years", 0) or 0), 2) if rpo_assessed else 0.0,
                "beyond_2_years": round(float(rpo.get("beyond_2_years", 0) or 0), 2) if rpo_assessed else 0.0,
                "disclosure_required": bool(rpo.get("disclosure_required")) if rpo_assessed else False,
            },
            "contract_costs": {
                "assessed": cc_assessed,
                "capitalised": bool(cc.get("capitalise")) if cc_assessed else False,
                "asset_amount": round(float(cc.get("total_asset_recognised", 0) or 0), 2) if cc_assessed else 0.0,
                "monthly_amortisation": round(float(cc.get("monthly_amortisation", 0) or 0), 2) if cc_assessed else 0.0,
                "impairment_flag": bool(cc.get("impairment_flag")) if cc_assessed else False,
            },
            "principal_agent": {
                "assessed": pa_assessed,
                "conclusion": str(pa.get("conclusion", "Not assessed")) if pa_assessed else "Not assessed",
                "revenue_basis": "Gross" if pa_assessed and str(pa.get("conclusion")) == "PRINCIPAL" else ("Net" if pa_assessed and str(pa.get("conclusion")) == "AGENT" else "Not assessed"),
                "borderline": bool(pa.get("borderline")) if pa_assessed else False,
            },
            "license": {
                "assessed": lic_assessed,
                "license_type": str(lic.get("license_type", "Not assessed")) if lic_assessed else "Not assessed",
                "pattern": str(lic.get("pattern", "Not assessed")) if lic_assessed else "Not assessed",
                "royalty_exception": bool(lic.get("royalty_exception")) if lic_assessed else False,
            },
        }

        risk_flags: List[Dict[str, str]] = []
        if vc_assessed and bool(vc.get("risk_flag")):
            risk_flags.append(
                {
                    "severity": "HIGH",
                    "module": "Variable consideration",
                    "message": "Variable consideration constraint reduces recognised amount by more than 25%.",
                    "action_required": "Review estimates, documentation, and whether to exclude variable amounts until uncertainty resolves.",
                }
            )
        if cc_assessed and bool(cc.get("impairment_flag")):
            risk_flags.append(
                {
                    "severity": "MEDIUM",
                    "module": "Contract costs",
                    "message": str(cc.get("impairment_note", "Commission exceeds 15% of contract value.")),
                    "action_required": "Assess recoverability under IFRS 15.101 before capitalising.",
                }
            )
        if pa_assessed and bool(pa.get("borderline")):
            risk_flags.append(
                {
                    "severity": "MEDIUM",
                    "module": "Principal vs agent",
                    "message": "Principal/agent assessment is borderline (one or two control indicators only).",
                    "action_required": "Document judgement and evidence for audit file.",
                }
            )
        if mod_assessed and bool(mod.get("risk_flag")):
            risk_flags.append(
                {
                    "severity": "HIGH",
                    "module": "Contract modifications",
                    "message": "Catch-up or modification outcome flagged as material relative to contract value.",
                    "action_required": "Controller review of modification accounting and disclosures.",
                }
            )
        if lic_assessed and bool(lic.get("royalty_exception")):
            risk_flags.append(
                {
                    "severity": "LOW",
                    "module": "Licence of IP",
                    "message": "Sales or usage-based royalties on IP may follow IFRS 15.B63 recognition timing.",
                    "action_required": "Ensure royalty revenue is recognised when or as subsequent sales or usage occur.",
                }
            )
        if rpo_assessed and bool(rpo.get("disclosure_required")):
            risk_flags.append(
                {
                    "severity": "MEDIUM",
                    "module": "RPO disclosure",
                    "message": "Remaining performance obligation disclosure is required (practical expedient not fully available).",
                    "action_required": "Prepare IFRS 15.120–122 disaggregation in financial statements.",
                }
            )

        def _item(note: str, ok: bool, na: bool = False) -> Dict[str, str]:
            if na:
                st = "not_applicable"
            elif ok:
                st = "complete"
            else:
                st = "incomplete"
            return {"item": note, "status": st, "note": ""}

        checklist = [
            _item("Contract identified and documented", step1),
            _item("All performance obligations identified", n_obs > 0),
            _item("Transaction price determined", bool(core)),
            _item("Variable consideration constrained", vc_assessed),
            _item("SSP allocation completed", n_alloc > 0 or n_obs > 0),
            _item("Revenue recognition schedule built", has_sched),
            _item("Journal entries generated", bool(jn)),
            _item("Contract modifications assessed", mod_assessed),
            _item("Principal/agent determination made", pa_assessed),
            _item("Licence type classified", lic_assessed),
            _item("RPO disclosure prepared", rpo_assessed),
            _item("Contract costs assessed", cc_assessed),
            _item("IFRS 15 disclosure notes drafted", bool(disc)),
            _item("Excel audit pack generated", bool(core)),
        ]

        applicable = sum(1 for c in checklist if c["status"] != "not_applicable")
        complete = sum(1 for c in checklist if c["status"] == "complete")
        if applicable <= 0:
            score = 0
        else:
            score = int(round(100.0 * complete / applicable))
        if score >= 85:
            level = "Ready"
        elif score >= 60:
            level = "Needs Review"
        else:
            level = "Incomplete"

        return {
            "report_id": str(uuid.uuid4()),
            "generated_at": datetime.now().isoformat(),
            "contract_id": contract_id,
            "customer_name": customer_name,
            "contract_overview": {
                "total_contract_value": round(tp, 2),
                "contract_term_months": term_m,
                "number_of_obligations": n_obs,
                "recognition_pattern": rec_pat,
                "currency": currency,
            },
            "five_step_status": {
                "step1_contract_identified": step1,
                "step2_obligations_identified": n_obs,
                "step3_transaction_price": round(tp, 2),
                "step3_variable_consideration_included": bool(vc_inc > 0 or (vc_assessed and str(vc.get("method", "")))),
                "step4_allocation_method": "SSP",
                "step5_revenue_recognised": round(rec_to_date, 2),
                "step5_deferred": round(def_rev, 2),
                "all_steps_complete": all_steps,
            },
            "financial_summary": {
                "gross_revenue": round(gross_r, 2),
                "net_revenue": round(net_r, 2),
                "revenue_basis": rev_basis_fs,
                "deferred_revenue": round(def_rev, 2),
                "contract_assets": round(c_assets, 2),
                "variable_consideration_included": round(vc_inc, 2),
                "variable_consideration_constrained": round(vc_constr_amt, 2),
                "commission_asset_recognised": round(comm_asset, 2),
                "commission_monthly_amortisation": round(comm_mo, 2),
                "total_rpo": round(total_rpo_val, 2),
            },
            "assessments": assessments,
            "risk_flags": risk_flags,
            "audit_readiness": {
                "score": score,
                "level": level,
                "checklist": checklist,
            },
            "ai_narrative": "",
        }


class IFRS15ReversalRiskEngine:
    """Heuristic revenue reversal risk score linked to VC constraint and contract profile."""

    _FACTOR_DISPLAY = {
        "constraint_level": "VC Constraint Level",
        "contract_term": "Contract Duration",
        "customer_type": "Customer Risk Profile",
        "variable_pct": "Variable Component %",
        "refund_right": "Refund / Return Rights",
        "recognition_timing": "Recognition Timeline",
        "historical_attainment": "Historical Attainment",
        "external_dependency": "External Dependencies",
    }

    def score(self, body: Dict[str, Any]) -> Dict[str, Any]:
        constraint = str(body.get("constraint_level") or "none").strip().lower()
        if constraint == "none":
            s1 = 0
        elif constraint == "low":
            s1 = 1
        elif constraint == "moderate":
            s1 = 2
        elif constraint == "high":
            s1 = 3
        else:
            s1 = 1

        term = int(body.get("contract_term_months") or 0)
        if term <= 12:
            s2 = 0
        elif term <= 24:
            s2 = 1
        elif term <= 36:
            s2 = 2
        else:
            s2 = 3

        ct = str(body.get("customer_type") or "").strip().lower().replace(" ", "_").replace("-", "_")
        if ct in ("government", "large_corp"):
            s3 = 0
        elif ct == "mid_market":
            s3 = 1
        elif ct == "sme":
            s3 = 2
        elif ct in ("startup", "new_customer"):
            s3 = 3
        elif not ct:
            s3 = 1
        else:
            s3 = 1

        vc_amt = float(body.get("variable_consideration") or 0)
        total_val = float(body.get("total_contract_value") or 0)
        if total_val > 1e-12:
            vp = abs(vc_amt) / total_val
        else:
            vp = 1.0 if abs(vc_amt) > 1e-9 else 0.0
        if vp < 0.05:
            s4 = 0
        elif vp < 0.15:
            s4 = 1
        elif vp < 0.30:
            s4 = 2
        else:
            s4 = 3

        refund = str(body.get("refund_type") or "none").strip().lower()
        if refund == "full":
            s5 = 3
        elif refund == "partial":
            s5 = 1
        else:
            s5 = 0

        recog = str(body.get("recognition_type") or "over_time").strip().lower()
        if recog == "point_in_time":
            s6 = 0
        elif "over" in recog or recog == "over_time":
            if term <= 12:
                s6 = 1
            elif term <= 24:
                s6 = 2
            else:
                s6 = 3
        else:
            s6 = 1

        hist = body.get("historical_attainment_pct")
        if hist is None or hist == "":
            s7 = 3
        else:
            try:
                h = float(hist)
            except (TypeError, ValueError):
                s7 = 3
            if h < 50.0:
                s7 = 3
            elif h <= 75.0:
                s7 = 2
            elif h <= 90.0:
                s7 = 1
            else:
                s7 = 0

        ext = bool(body.get("has_external_dependency"))
        dep = str(body.get("dependency_level") or "low").strip().lower()
        if not ext:
            s8 = 0
        elif dep == "high":
            s8 = 3
        elif dep == "medium":
            s8 = 2
        else:
            s8 = 1

        factor_scores = {
            "constraint_level": s1,
            "contract_term": s2,
            "customer_type": s3,
            "variable_pct": s4,
            "refund_right": s5,
            "recognition_timing": s6,
            "historical_attainment": s7,
            "external_dependency": s8,
        }

        risk_score = int(sum(factor_scores.values()))
        max_score = 24
        risk_pct = round((risk_score / max_score) * 100.0, 2) if max_score else 0.0

        if risk_pct <= 25.0:
            risk_level = "LOW"
        elif risk_pct <= 50.0:
            risk_level = "MEDIUM"
        elif risk_pct <= 75.0:
            risk_level = "HIGH"
        else:
            risk_level = "CRITICAL"

        reversal_watch = risk_pct > 50.0
        estimated_reversal_amount = round(float(vc_amt) * (risk_pct / 100.0) * 0.5, 2)

        ordered = sorted(factor_scores.items(), key=lambda kv: (-kv[1], kv[0]))
        highest_risk_factors = [
            self._FACTOR_DISPLAY.get(k, k) for k, v in ordered if v == 3
        ]

        actions: List[str] = []
        if s1 >= 3:
            actions.append(
                "Consider excluding variable consideration entirely until uncertainty resolves (IFRS 15.57)"
            )
        if body.get("historical_attainment_pct") is None or body.get("historical_attainment_pct") == "":
            actions.append(
                "Document basis for variable consideration estimate given limited track record"
            )
        if refund == "full":
            actions.append(
                "Assess whether refund right creates a return obligation under IFRS 15.B20"
            )
        if term > 36:
            actions.append(
                "Monitor variable consideration constraint quarterly — long contracts have higher reversal exposure"
            )
        if ext and dep == "high":
            actions.append(
                "Stress test revenue forecast against adverse external factor scenarios"
            )

        if not actions:
            actions.append("Continue to monitor estimates and update when facts change.")

        hi_sentence = ", ".join(highest_risk_factors) if highest_risk_factors else "none scoring the maximum 3 points"
        explanation = (
            f"This contract scores {risk_score}/24 ({risk_pct}%) on the reversal risk model, classified as {risk_level}. "
            f"The highest risk factors are {hi_sentence}. "
            f"For the variable consideration included in the transaction price, this profile suggests "
            f"{'material' if risk_pct > 50 else 'limited'} exposure to revenue reversals if estimates or outcomes shift."
        )

        return {
            "risk_score": risk_score,
            "risk_pct": risk_pct,
            "risk_level": risk_level,
            "reversal_watch": reversal_watch,
            "estimated_reversal_amount": estimated_reversal_amount,
            "factor_scores": factor_scores,
            "highest_risk_factors": highest_risk_factors,
            "recommended_actions": actions,
            "explanation": explanation,
        }


_CRITERION_DISPLAY = {
    "accounting_policy": "Accounting Policy",
    "disaggregation": "Disaggregation of Revenue",
    "contract_balances": "Contract Balances",
    "performance_obligations": "Performance Obligations",
    "rpo_disclosure": "RPO Disclosure",
    "significant_judgements": "Significant Judgements",
    "contract_modifications": "Contract Modifications",
}


class IFRS15DisclosureScorer:
    """Keyword + boilerplate IFRS 15 disclosure quality score (max 98); optional Claude improvements."""

    _BOILERPLATE_PHRASES = [
        "as required by the standard",
        "in accordance with the requirements",
        "consistent with prior year",
        "not considered material",
        "not material to the financial statements",
        "refer to accounting policy",
        "as disclosed previously",
        "no significant changes",
    ]

    @staticmethod
    def _has_any(t: str, phrases: List[str]) -> bool:
        return any(p in t for p in phrases)

    def _score_accounting_policy(self, t: str) -> tuple:
        s = 0
        flags = {
            "standard_ref": self._has_any(t, ["ifrs 15", "aasb 15", "revenue from contracts"]),
            "model": self._has_any(t, ["five-step", "5-step", "performance obligation", "transaction price"]),
            "judgement_policy": self._has_any(t, ["significant judgement", "key judgement", "management judgement"]),
            "expedient": self._has_any(t, ["practical expedient", "portfolio approach"]),
        }
        if flags["standard_ref"]:
            s += 2
        if flags["model"]:
            s += 2
        if flags["judgement_policy"]:
            s += 2
        if flags["expedient"]:
            s += 1
        s = min(7, s)
        issues: List[str] = []
        if not flags["standard_ref"]:
            issues.append("Reference to IFRS 15 / AASB 15 or revenue-from-contracts policy not stated")
        if not flags["model"]:
            issues.append("Five-step model, performance obligations, or transaction price not described")
        if not flags["judgement_policy"]:
            issues.append("Significant judgements in applying the revenue policy not mentioned")
        if not flags["expedient"]:
            issues.append("Practical expedients or portfolio approach not mentioned (if applicable)")
        return s, issues

    def _score_disaggregation(self, t: str) -> tuple:
        # IFRS 15.114–116 style categories (RPO timing phrases belong in RPO criterion, not here)
        groups: List[Tuple[str, List[str]]] = [
            ("geography", ["geography", "geographic", "region"]),
            ("product", ["product", "product line", "service line"]),
            ("segment", ["market segment", "customer segment"]),
            ("contract", ["contract type", "contract duration"]),
            ("timing", ["recognition timing", "point in time", "over time"]),
            ("channel", ["channel", "distribution"]),
        ]
        found_labels: List[str] = []
        for label, kws in groups:
            if self._has_any(t, kws):
                found_labels.append(label)
        n = len(found_labels)
        categories_found = n
        if n <= 1:
            s = 0
        elif n == 2:
            s = 2
        elif n == 3:
            s = 4
        else:
            s = 7
        issues: List[str] = []
        if n < 4:
            issues.append("Insufficient revenue disaggregation dimensions (IFRS 15.114–116)")
        if n < 2:
            issues.append("Fewer than two disaggregation categories identified")
        return s, issues, categories_found

    def _score_contract_balances(self, t: str) -> tuple:
        flags = {
            "asset": self._has_any(t, ["contract asset", "unbilled revenue"]),
            "liab": self._has_any(t, ["contract liability", "deferred revenue"]),
            "move": self._has_any(t, ["opening balance", "closing balance", "movement"]),
            "imp": self._has_any(t, ["impairment", "credit loss", "expected credit"]),
        }
        s = 0
        if flags["asset"]:
            s += 2
        if flags["liab"]:
            s += 2
        if flags["move"]:
            s += 2
        if flags["imp"]:
            s += 1
        s = min(7, s)
        issues: List[str] = []
        if not flags["asset"]:
            issues.append("Contract assets / unbilled revenue not addressed")
        if not flags["liab"]:
            issues.append("Contract liabilities / deferred revenue not addressed")
        if not flags["move"]:
            issues.append("Opening/closing balances or movements not explained")
        if not flags["imp"]:
            issues.append("Impairment / ECL on receivables or contract assets not mentioned")
        return s, issues

    def _score_performance_obligations(self, disclosure_text: str, t: str) -> tuple:
        _ = disclosure_text
        flags = {
            "nature": self._has_any(t, ["nature of", "description of", "performance obligation"]),
            "sat": self._has_any(t, ["when satisfied", "satisfaction", "transfer of control"]),
            "pay": self._has_any(t, ["payment terms", "billing", "invoice"]),
            "var": self._has_any(t, ["variable consideration", "variable element", "bonus", "rebate", "discount"]),
        }
        s = sum(
            [
                2 if flags["nature"] else 0,
                2 if flags["sat"] else 0,
                2 if flags["pay"] else 0,
                1 if flags["var"] else 0,
            ]
        )
        s = min(7, s)
        issues: List[str] = []
        if not flags["nature"]:
            issues.append("Nature or description of performance obligations not clear")
        if not flags["sat"]:
            issues.append("Timing of satisfaction / transfer of control not explained")
        if not flags["pay"]:
            issues.append("Payment terms, billing, or invoicing not linked to obligations")
        if not flags["var"]:
            issues.append("Variable consideration, discounts, rebates, or bonuses not addressed")
        return s, issues

    def _score_rpo(self, t: str) -> tuple:
        flags = {
            "rpo": self._has_any(
                t,
                [
                    "remaining performance",
                    "unsatisfied",
                    "partially unsatisfied",
                    "transaction price allocated to",
                ],
            ),
            "buckets": self._has_any(
                t,
                [
                    "within one year",
                    "within 12 months",
                    "one to two years",
                    "beyond two years",
                    "more than two years",
                ],
            ),
            "exp": self._has_any(t, ["practical expedient", "right to invoice", "one year or less"]),
        }
        s = 0
        if flags["rpo"]:
            s += 3
        if flags["buckets"]:
            s += 2
        if flags["exp"]:
            s += 2
        s = min(7, s)
        issues: List[str] = []
        if s < 3:
            issues.append("RPO total amount not stated")
        if s < 5:
            issues.append("Timing buckets not disclosed")
        if not flags["exp"]:
            issues.append("Practical expedient / right to invoice / short-term RPO not discussed where relevant")
        return s, issues

    def _score_significant_judgements(self, t: str) -> tuple:
        flags = {
            "ssp": self._has_any(t, ["standalone selling price", "ssp", "observable price"]),
            "timing": self._has_any(
                t,
                [
                    "over time",
                    "point in time",
                    "transfer of control",
                    "right of access",
                    "significant judgement",
                    "significant judgment",
                    "significant judgements",
                    "significant judgments",
                    "remaining goods",
                ],
            ),
            "constr": self._has_any(t, ["constraint", "highly probable", "significant reversal"]),
            "pa": self._has_any(t, ["principal", "agent", "gross", "net basis"]),
        }
        s = sum([2 if flags["ssp"] else 0, 2 if flags["timing"] else 0, 2 if flags["constr"] else 0, 1 if flags["pa"] else 0])
        s = min(7, s)
        issues: List[str] = []
        if not flags["ssp"]:
            issues.append("Standalone selling prices or observable inputs not discussed")
        if not flags["timing"]:
            issues.append("Over time vs point in time / transfer of control judgements not explained")
        if not flags["constr"]:
            issues.append("Variable consideration constraint (highly probable / reversal) not covered")
        if not flags["pa"]:
            issues.append("Principal vs agent (gross vs net) assessment not mentioned if relevant")
        return s, issues

    def _score_modifications(self, t: str) -> tuple:
        mod = self._has_any(t, ["modification", "contract change", "amendment", "variation"])
        treat = self._has_any(t, ["prospective", "cumulative", "catch-up", "retrospective"])
        s = 0
        if mod:
            s += 4
        if treat:
            s += 3
        s = min(7, s)
        issues: List[str] = []
        if not mod:
            issues.append("Contract modifications or amendments not described (IFRS 15.20–21)")
        if not treat:
            issues.append("Prospective vs cumulative catch-up treatment not explained")
        return s, issues

    def _detect_boilerplate(self, disclosure_text: str) -> List[str]:
        low = disclosure_text.lower()
        found: List[str] = []
        for phrase in self._BOILERPLATE_PHRASES:
            if phrase in low:
                found.append(phrase)
        return found

    def _parse_claude_improvements(self, text: str) -> Optional[List[Dict[str, Any]]]:
        if not text or not text.strip():
            return None
        blocks = re.split(r"(?=IMPROVEMENT\s*\[?\d+\]?\s*:)", text, flags=re.IGNORECASE)
        out: List[Dict[str, Any]] = []
        for block in blocks:
            block = block.strip()
            if not block.upper().startswith("IMPROVEMENT"):
                continue
            m_area = re.search(r"AREA:\s*(.+?)(?=ISSUE:|$)", block, re.IGNORECASE | re.DOTALL)
            m_issue = re.search(r"ISSUE:\s*(.+?)(?=EXAMPLE:|$)", block, re.IGNORECASE | re.DOTALL)
            m_ex = re.search(r"EXAMPLE:\s*(.+)$", block, re.IGNORECASE | re.DOTALL)
            if not (m_area and m_issue and m_ex):
                continue
            area = re.sub(r"\s+", " ", m_area.group(1).strip())
            issue = re.sub(r"\s+", " ", m_issue.group(1).strip())
            example = m_ex.group(1).strip()
            out.append(
                {
                    "number": len(out) + 1,
                    "area": area[:500],
                    "issue": issue[:2000],
                    "example_wording": example[:4000],
                }
            )
            if len(out) >= 5:
                break
        if len(out) < 5:
            return None
        for i, item in enumerate(out, start=1):
            item["number"] = i
        return out

    def _generic_improvements(self, lowest_keys: List[str]) -> List[Dict[str, Any]]:
        templates: Dict[str, Tuple[str, str, str]] = {
            "accounting_policy": (
                "Accounting policy (IFRS 15.113)",
                "The note does not clearly describe the entity's revenue recognition policy under IFRS 15.",
                "Expand the accounting policy to reference IFRS 15 Revenue from Contracts with Customers, summarise the five-step model, and state where significant judgements arise.",
            ),
            "disaggregation": (
                "Disaggregation of revenue (IFRS 15.114–116)",
                "Revenue disaggregation by type, geography, customer, or timing is insufficient for users.",
                "Disclose revenue in categories that depict how nature, amount, timing, and uncertainty of cash flows are affected, aligned with information reported to the chief operating decision maker.",
            ),
            "contract_balances": (
                "Contract balances (IFRS 15.116–118)",
                "Contract assets, liabilities, and period movements are not adequately explained.",
                "Present opening and closing balances for contract assets and liabilities, explain significant changes, and describe how balances relate to performance and billing.",
            ),
            "performance_obligations": (
                "Performance obligations (IFRS 15.119)",
                "The nature and satisfaction of performance obligations is unclear.",
                "For each significant class, describe the goods or services, when control transfers, payment terms, and how variable consideration is reflected.",
            ),
            "rpo_disclosure": (
                "Remaining performance obligations (IFRS 15.120–122)",
                "Remaining performance obligations and timing of recognition are not transparent.",
                "Disclose the aggregate transaction price allocated to unsatisfied obligations and explain amounts expected within one year, one to two years, and beyond, or apply the practical expedient where criteria are met.",
            ),
            "significant_judgements": (
                "Significant judgements (IFRS 15.123–126)",
                "Key judgements in applying IFRS 15 are not documented.",
                "Explain judgements on timing of recognition, estimation of standalone selling prices, variable consideration constraints, and principal versus agent conclusions with reference to IFRS 15 paragraphs.",
            ),
            "contract_modifications": (
                "Contract modifications (IFRS 15.20–21)",
                "How contract changes are accounted for is not described.",
                "Describe whether modifications are accounted for as separate contracts, prospectively, or through cumulative catch-up, with reference to the nature of added or changed goods and services.",
            ),
        }
        ordered = list(lowest_keys) + [k for k in templates if k not in lowest_keys]
        seen: set = set()
        out: List[Dict[str, Any]] = []
        for key in ordered:
            if key in seen or key not in templates:
                continue
            seen.add(key)
            area, issue, ex = templates[key]
            out.append({"number": len(out) + 1, "area": area, "issue": issue, "example_wording": ex})
            if len(out) >= 5:
                break
        while len(out) < 5:
            out.append(
                {
                    "number": len(out) + 1,
                    "area": "General disclosure quality",
                    "issue": "Several IFRS 15 disclosure objectives are only partially met.",
                    "example_wording": "Strengthen the note with contract-specific amounts, reconciliation of contract balances, and cross-references to accounting policies and significant estimates sections.",
                }
            )
        for i, item in enumerate(out[:5], start=1):
            item["number"] = i
        return out[:5]

    def _call_claude_improvements(
        self,
        disclosure_text: str,
        total_score: int,
        quality_pct: float,
        quality_level: str,
        lowest_display: List[str],
        boilerplate_flags: List[str],
        max_points: int = 49,
    ) -> Optional[List[Dict[str, Any]]]:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            return None
        try:
            import anthropic

            system = (
                "You are an IFRS 15 disclosure quality expert. "
                "You review financial statement disclosures for listed companies and assess them against "
                "regulator and auditor expectations."
            )
            user = f"""
Review this IFRS 15 disclosure and identify the 5 most important improvements needed.

Disclosure text:
{disclosure_text[:4000]}

Overall score: {total_score}/{max_points} ({quality_pct}%)
Quality level: {quality_level}
Lowest scoring areas: {lowest_display}
Boilerplate phrases detected: {boilerplate_flags}

For each of the 5 improvements provide:
1. Area: which disclosure requirement is weak
2. Issue: what is missing or insufficient
3. Example: 2-3 sentences of improved wording

Format each improvement as:
IMPROVEMENT [N]:
AREA: [area name]
ISSUE: [description]
EXAMPLE: [sample wording]

Be specific. Reference IFRS 15 paragraph numbers.
Use actual numbers from the disclosure if present.
"""
            client = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2500,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            raw = (response.content[0].text if response.content else "") or ""
            parsed = self._parse_claude_improvements(raw)
            return parsed
        except Exception:
            return None

    def score(self, disclosure_text: str, results: dict) -> dict:
        _ = results  # reserved for future use (e.g. inject amounts from calculation)
        t = (disclosure_text or "").lower()

        s1, iss1 = self._score_accounting_policy(t)
        s2, iss2, categories_found = self._score_disaggregation(t)
        s3, iss3 = self._score_contract_balances(t)
        s4, iss4 = self._score_performance_obligations(disclosure_text or "", t)
        s5, iss5 = self._score_rpo(t)
        s6, iss6 = self._score_significant_judgements(t)
        s7, iss7 = self._score_modifications(t)

        # Each criterion is 0–7; sum is 0–49. Prompt E uses /98 and quality_pct vs 98 — scale ×2.
        criteria_sum = s1 + s2 + s3 + s4 + s5 + s6 + s7
        raw_score = criteria_sum * 2
        boilerplate_flags = self._detect_boilerplate(disclosure_text or "")
        penalty = len(boilerplate_flags)
        total_score = max(0, raw_score - penalty)
        max_points = 98
        quality_pct = round(total_score / float(max_points) * 100.0, 1)

        if quality_pct >= 80:
            quality_level = "Excellent"
        elif quality_pct >= 60:
            quality_level = "Good"
        elif quality_pct >= 40:
            quality_level = "Adequate"
        else:
            quality_level = "Below Standard"

        def crit(score: int, issues: List[str]) -> Dict[str, Any]:
            return {
                "score": score,
                "max": 7,
                "pct": round(score / 7.0 * 100.0, 0),
                "issues": issues,
            }

        criteria_scores = {
            "accounting_policy": crit(s1, iss1),
            "disaggregation": crit(s2, iss2),
            "contract_balances": crit(s3, iss3),
            "performance_obligations": crit(s4, iss4),
            "rpo_disclosure": crit(s5, iss5),
            "significant_judgements": crit(s6, iss6),
            "contract_modifications": crit(s7, iss7),
        }

        key_scores = [
            ("accounting_policy", s1),
            ("disaggregation", s2),
            ("contract_balances", s3),
            ("performance_obligations", s4),
            ("rpo_disclosure", s5),
            ("significant_judgements", s6),
            ("contract_modifications", s7),
        ]
        key_scores.sort(key=lambda x: (x[1], x[0]))
        lowest_keys = [k for k, _ in key_scores[:3]]
        lowest_criteria = [_CRITERION_DISPLAY[k] for k in lowest_keys]
        lowest_display = lowest_criteria

        claude_list = self._call_claude_improvements(
            disclosure_text or "",
            int(total_score),
            float(quality_pct),
            quality_level,
            lowest_display,
            boilerplate_flags,
            max_points,
        )
        if claude_list:
            improvement_suggestions = claude_list
        else:
            improvement_suggestions = self._generic_improvements(lowest_keys)

        if quality_pct >= 80:
            benchmark_text = (
                "This disclosure is in the top quartile of IFRS 15 disclosures for listed companies. "
                "Audit challenge risk is low."
            )
        elif quality_pct >= 60:
            benchmark_text = (
                "This disclosure meets minimum requirements but falls below best practice for listed companies "
                "in the same sector. Regulators may request additional detail."
            )
        elif quality_pct >= 40:
            benchmark_text = (
                "This disclosure is below average for listed companies. SEC and ASIC comment letters frequently "
                "target disclosures at this quality level."
            )
        else:
            benchmark_text = (
                "This disclosure is significantly below the standard expected of listed companies. "
                "High risk of regulator comment or audit qualification request."
            )

        return {
            "total_score": total_score,
            "raw_score": raw_score,
            "score_max": max_points,
            "penalty": penalty,
            "quality_pct": quality_pct,
            "quality_level": quality_level,
            "criteria_scores": criteria_scores,
            "boilerplate_flags": boilerplate_flags,
            "lowest_criteria": lowest_criteria,
            "improvement_suggestions": improvement_suggestions,
            "benchmark_comparison": benchmark_text,
            "categories_found": int(categories_found),
        }


_ADVANCE_PAYMENT_KEYWORDS = [
    "in advance",
    "upfront",
    "up front",
    "prepaid",
    "prepay",
    "annual in advance",
    "quarterly in advance",
    "paid in advance",
    "beginning of",
    "start of period",
]
_ARREARS_PAYMENT_KEYWORDS = [
    "in arrears",
    "on delivery",
    "on completion",
    "after delivery",
    "net 30",
    "net 60",
    "net 90",
    "upon acceptance",
    "milestone",
]


class IFRS15Calculator:
    """IFRS 15 5-step revenue recognition calculator"""
    
    def __init__(self):
        self.precision = Decimal('0.01')

    @staticmethod
    def _status_is_recognised(val: Any) -> bool:
        s = str(val or "").strip().lower()
        return s in ("recognised", "recognized")

    @staticmethod
    def _parse_schedule_row_date(date_cell: Any, month_cell: Any) -> Optional[date]:
        """Parse a schedule row period end / activity date; try YYYY-MM-DD, YYYY-%m, Mon YYYY."""
        s = str(date_cell or "").strip()
        if s:
            for fmt, ln in (("%Y-%m-%d", 10), ("%Y-%m", 7)):
                try:
                    chunk = s[:ln]
                    if fmt == "%Y-%m-%d" and len(chunk) < 10:
                        continue
                    if fmt == "%Y-%m" and len(chunk) < 7:
                        continue
                    return datetime.strptime(chunk, fmt).date()
                except ValueError:
                    continue
        sm = str(month_cell or "").strip()
        if sm:
            for fmt in ("%b %Y", "%B %Y"):
                try:
                    return datetime.strptime(sm, fmt).date()
                except ValueError:
                    continue
        return None

    def _finalize_schedule_recognition(self, df: pd.DataFrame) -> pd.DataFrame:
        """Recompute Revenue and Status from period date vs today (authoritative for API/UI)."""
        if df is None or df.empty:
            return df
        out = df.copy()
        today = date.today()
        sched_col = "Scheduled_Revenue" if "Scheduled_Revenue" in out.columns else None
        for idx in out.index:
            row = out.loc[idx]
            dt = self._parse_schedule_row_date(row.get("Date"), row.get("Month"))
            if dt is None:
                dt = today
            if sched_col:
                planned = Decimal(str(row.get(sched_col, 0) or 0))
            else:
                planned = Decimal(str(row.get("Revenue", 0) or 0))
            if dt <= today:
                out.at[idx, "Revenue"] = float(planned)
                out.at[idx, "Status"] = "Recognised"
            else:
                out.at[idx, "Revenue"] = 0.0
                out.at[idx, "Status"] = "Deferred"
        return out

    @staticmethod
    def classify_payment_terms(payment_terms: str) -> tuple:
        """
        Returns (mode, contract_asset_note) where mode is 'advance' | 'arrears' | 'ambiguous'.
        """
        pt = str(payment_terms or "").lower().strip()
        is_adv = any(kw in pt for kw in _ADVANCE_PAYMENT_KEYWORDS)
        is_arr = any(kw in pt for kw in _ARREARS_PAYMENT_KEYWORDS)
        if is_adv and is_arr:
            return (
                "ambiguous",
                "Payment terms contain both advance and arrears wording — defaulting to nil contract asset. Review payment terms input.",
            )
        if is_adv:
            return (
                "advance",
                "Payment received in advance — "
                "contract liability applies. "
                "No contract asset recognised.",
            )
        if is_arr:
            return (
                "arrears",
                "Revenue earned before billing — "
                "contract asset recognised.",
            )
        return (
            "ambiguous",
            "Payment terms not determined — "
            "defaulting to nil contract asset. "
            "Review payment terms input.",
        )

    def build_ifrs15_journal_entries(
        self,
        monthly_revenue: Decimal,
        cash_received: Decimal,
        payment_mode: str,
        _currency: str,
        total_allocated: Decimal,
    ) -> Dict[str, Any]:
        """Journal templates for advance (deferred revenue) vs arrears (contract asset) vs ambiguous (CL path)."""
        mr = max(monthly_revenue, Decimal("0"))
        cash = max(cash_received, Decimal("0"))
        ta = max(total_allocated, Decimal("0"))
        entries: Dict[str, Any] = {}

        if payment_mode == "arrears":
            if mr > 0:
                entries["revenue_recognition"] = {
                    "description": "Revenue earned, not yet billed",
                    "entries": [
                        {
                            "account": "Contract Asset",
                            "account_type": "Current Asset",
                            "dr": float(mr),
                            "cr": 0.0,
                            "narration": "Revenue earned, not yet billed",
                        },
                        {
                            "account": "Revenue",
                            "account_type": "Income (P&L)",
                            "dr": 0.0,
                            "cr": float(mr),
                            "narration": "IFRS 15 revenue recognition",
                        },
                    ],
                }
            if mr > 0:
                entries["billing"] = {
                    "description": "Contract asset converted to receivable on billing",
                    "entries": [
                        {
                            "account": "Accounts Receivable",
                            "account_type": "Current Asset",
                            "dr": float(mr),
                            "cr": 0.0,
                            "narration": "Amount billed to customer",
                        },
                        {
                            "account": "Contract Asset",
                            "account_type": "Current Asset",
                            "dr": 0.0,
                            "cr": float(mr),
                            "narration": "Contract asset converted to receivable on billing",
                        },
                    ],
                }
            return entries

        # advance or ambiguous: cash in advance + release deferred
        cash_line = cash if cash > 0 else (ta if payment_mode == "advance" else Decimal("0"))
        if cash_line > 0:
            entries["cash_received_advance"] = {
                "description": "Cash received in advance of performance",
                "entries": [
                    {
                        "account": "Cash/Bank",
                        "account_type": "Current Asset",
                        "dr": float(cash_line),
                        "cr": 0.0,
                        "narration": "Cash received in advance of performance",
                    },
                    {
                        "account": "Contract Liability",
                        "account_type": "Current Liability",
                        "dr": 0.0,
                        "cr": float(cash_line),
                        "narration": "Deferred revenue — customer prepayment",
                    },
                ],
            }
        if mr > 0:
            entries["monthly_recognition"] = {
                "description": "Revenue recognised as performance obligation satisfied",
                "entries": [
                    {
                        "account": "Contract Liability",
                        "account_type": "Current Liability",
                        "dr": float(mr),
                        "cr": 0.0,
                        "narration": "Reduction of deferred revenue",
                    },
                    {
                        "account": "Revenue",
                        "account_type": "Income (P&L)",
                        "dr": 0.0,
                        "cr": float(mr),
                        "narration": "IFRS 15 revenue recognition",
                    },
                ],
            }
        return entries

    def calculate_revenue_by_type(self, contract: IFRS15Input) -> Dict:
        """
        Route to correct revenue method based on contract_type.
        """
        if contract.contract_type == "time_and_material":
            return self._calc_tm(contract)
        elif contract.contract_type == "fixed_price":
            return self._calc_poc(contract)
        elif contract.contract_type == "capped_tm":
            return self._calc_capped_tm(contract)
        elif contract.contract_type == "maintenance":
            return self._calc_maintenance(contract)
        return self._calc_poc(contract)

    def _calc_tm(self, c: IFRS15Input) -> Dict:
        """T&M: Revenue = Hours × Rate"""
        revenue = c.hours_worked * c.hourly_rate
        return {
            "method": "Time & Material",
            "revenue_this_period": float(revenue),
            "poc_percentage": None,
            "remaining_revenue": None,
        }

    def _calc_poc(self, c: IFRS15Input) -> Dict:
        """
        POC: Revenue = (Actual Cost / Total Cost) × Contract Value − Prior Revenue
        IFRS 15 §39 — input method.
        """
        if c.total_estimated_cost <= 0:
            return {
                "method": "Fixed Price (POC)",
                "revenue_this_period": 0,
                "poc_percentage": 0,
                "error": "Total estimated cost required"
            }

        poc_pct = float(c.actual_cost_to_date / c.total_estimated_cost)
        poc_pct = min(poc_pct, 1.0)

        total_contract = c.fixed_consideration + c.variable_consideration
        cumulative_revenue = Decimal(str(poc_pct)) * total_contract
        period_revenue = max(
            Decimal('0'),
            cumulative_revenue - c.prior_revenue_recognised
        )
        remaining = total_contract - cumulative_revenue
        expected_loss = max(
            Decimal('0'),
            c.total_estimated_cost - total_contract
        )

        return {
            "method": "Fixed Price (POC)",
            "poc_percentage": round(poc_pct * 100, 2),
            "cumulative_revenue": float(cumulative_revenue),
            "revenue_this_period": float(period_revenue),
            "remaining_revenue": float(remaining),
            "onerous_contract": expected_loss > 0,
            "expected_loss": float(expected_loss),
            "formula": (
                f"POC {poc_pct*100:.1f}% × "
                f"${float(total_contract):,.0f} = "
                f"${float(cumulative_revenue):,.0f}"
            ),
        }

    def _calc_capped_tm(self, c: IFRS15Input) -> Dict:
        """
        Capped T&M:
        If cumulative billing < cap → use T&M
        If cumulative billing ≥ cap → switch to POC
        """
        tm_revenue = c.hours_worked * c.hourly_rate
        projected_total = c.cumulative_billed + tm_revenue

        if c.tm_cap <= 0 or projected_total < c.tm_cap:
            return {
                "method": "Capped T&M (T&M mode)",
                "revenue_this_period": float(tm_revenue),
                "cap_utilised_pct": float(projected_total / c.tm_cap * 100) if c.tm_cap > 0 else 0,
                "cap_remaining": float(c.tm_cap - projected_total),
                "switched_to_poc": False,
            }
        poc = self._calc_poc(c)
        poc["method"] = "Capped T&M (POC mode)"
        poc["switched_to_poc"] = True
        poc["cap_exceeded_by"] = float(projected_total - c.tm_cap)
        return poc

    def _calc_maintenance(self, c: IFRS15Input) -> Dict:
        """
        Maintenance: Straight-line unless evidence of different pattern.
        IFRS 15 §39 — output method.
        """
        total = c.fixed_consideration + c.variable_consideration
        months = c.maintenance_term_months or c.contract_term_months
        if months <= 0:
            months = 12
        monthly = total / Decimal(str(months))
        return {
            "method": "Maintenance (Straight-line)",
            "monthly_revenue": float(monthly),
            "term_months": months,
            "total_contract_value": float(total),
            "revenue_this_period": float(monthly),
        }

    def apply_volume_discount(
        self,
        base_revenue: Decimal,
        volume_slabs: list,
        estimated_annual_volume: Decimal,
        can_estimate_volume: bool = True
    ) -> Dict:
        """
        Applies volume-based discount per slab table.
        If cannot estimate → use max discount.
        """
        if not volume_slabs:
            return {
                "discounted_revenue": float(base_revenue),
                "discount_pct": 0,
                "discount_amount": 0
            }

        if not can_estimate_volume:
            max_discount = max(s.get("discount_pct", 0) for s in volume_slabs)
            discount = base_revenue * Decimal(str(max_discount / 100))
            return {
                "discounted_revenue": float(base_revenue - discount),
                "discount_pct": max_discount,
                "discount_amount": float(discount),
                "note": "Max discount applied — volume not estimable"
            }

        applicable_discount = 0
        for slab in sorted(volume_slabs, key=lambda x: x.get("min_volume", 0)):
            if estimated_annual_volume >= Decimal(str(slab.get("min_volume", 0))):
                applicable_discount = slab.get("discount_pct", 0)

        discount = base_revenue * Decimal(str(applicable_discount / 100))
        return {
            "discounted_revenue": float(base_revenue - discount),
            "discount_pct": applicable_discount,
            "discount_amount": float(discount),
        }

    def calculate_sla_penalties(self, sla_items: list) -> Dict:
        """
        Calculates SLA credits/penalties.
        These reduce revenue (negative revenue).
        """
        total_penalty = Decimal('0')
        details = []

        for sla in sla_items:
            target = sla.get("target", 0)
            actual = sla.get("actual", 0)
            monthly_fee = Decimal(str(sla.get("monthly_fee", 0)))
            multiplier = Decimal(str(sla.get("penalty_multiplier", 1)))

            if actual < target:
                breach_pct = Decimal(str(abs(target - actual) / 100))
                penalty = monthly_fee * breach_pct * multiplier
                total_penalty += penalty
                details.append({
                    "sla_name": sla.get("name", ""),
                    "target": target,
                    "actual": actual,
                    "breach": True,
                    "penalty": float(penalty),
                })
            else:
                details.append({
                    "sla_name": sla.get("name", ""),
                    "breach": False,
                    "penalty": 0,
                })

        return {
            "total_penalty": float(total_penalty),
            "net_revenue_impact": float(-total_penalty),
            "sla_details": details,
        }

    def check_onerous(
        self,
        total_contract_value: Decimal,
        total_estimated_cost: Decimal
    ) -> Dict:
        """
        IAS 37: If costs exceed revenue — recognise full loss immediately.
        """
        if total_estimated_cost > total_contract_value:
            loss = total_estimated_cost - total_contract_value
            return {
                "is_onerous": True,
                "expected_loss": float(loss),
                "provision_required": float(loss),
                "journal": {
                    "debit": "Onerous Contract Expense",
                    "credit": "Onerous Contract Provision",
                    "amount": float(loss),
                    "note": "Full loss recognised immediately per IAS 37"
                }
            }
        return {"is_onerous": False, "expected_loss": 0}

    def apply_variable_consideration_constraint(self, contract: IFRS15Input) -> Decimal:
        """
        IFRS 15 §56–58: Include variable consideration only to the extent that
        it is highly probable a significant revenue reversal will not occur.

        Two modes:
        - "amount":     use contract.variable_consideration_constrained directly
        - "percentage": constrained = variable_consideration × (constraint_percentage / 100)

        Returns the constrained variable consideration amount.
        """
        vc = contract.variable_consideration

        if contract.constraint_method == "amount" and contract.variable_consideration_constrained > 0:
            # Caller explicitly provided the constrained amount — cap it at raw VC
            return min(contract.variable_consideration_constrained, vc)

        # Percentage method (default)
        pct = max(Decimal("0"), min(Decimal("100"), contract.constraint_percentage))
        return (vc * pct / Decimal("100")).quantize(Decimal("0.01"))
    
    def calculate_transaction_price(self, contract: IFRS15Input) -> Decimal:
        """
        IFRS 15 Step 3: Determine transaction price.
        Variable consideration is constrained per §56–58 before inclusion.
        """
        constrained_vc = self.apply_variable_consideration_constraint(contract)

        transaction_price = (
            contract.fixed_consideration
            + constrained_vc
            - contract.discounts
            - contract.rebates
            + contract.financing_adjustment
        )
        return max(Decimal("0"), transaction_price)
    
    def allocate_transaction_price(
        self, 
        transaction_price: Decimal, 
        obligations: List[PerformanceObligation]
    ) -> Dict[str, Decimal]:
        """
        Step 4: Allocate transaction price to performance obligations
        
        Uses relative standalone selling price method (IFRS 15.76-80)
        
        Args:
            transaction_price: Total transaction price
            obligations: List of performance obligations
            
        Returns:
            Dictionary mapping obligation_id to allocated amount
        """
        
        if not obligations:
            raise ValueError("No performance obligations provided")
        
        # Calculate total SSP
        total_ssp = sum(ob.standalone_selling_price for ob in obligations)
        
        if total_ssp == 0:
            raise ValueError("Total standalone selling prices cannot be zero")
        
        # Allocate proportionally
        allocations = {}
        allocated_so_far = Decimal('0')
        
        for i, ob in enumerate(obligations):
            if i == len(obligations) - 1:
                # Last obligation gets remaining amount (avoid rounding errors)
                allocated = transaction_price - allocated_so_far
            else:
                allocation_pct = ob.standalone_selling_price / total_ssp
                allocated = (transaction_price * allocation_pct).quantize(
                    self.precision, ROUND_HALF_UP
                )
            
            allocations[ob.obligation_id] = allocated
            allocated_so_far += allocated
        
        return allocations

    def _is_multi_session_training_obligation(self, ob: PerformanceObligation) -> bool:
        """Point-in-time POs for bundled training/sessions: recognise over discrete sessions (IFRS 15.B63-style)."""
        if ob.recognition_method != "point_in_time":
            return False
        d = (ob.description or "").lower()
        oid = (ob.obligation_id or "").lower()
        name_has_training_or_session = (
            "training" in d or "session" in d or "training" in oid or "session" in oid
        )
        if not name_has_training_or_session:
            return False
        if re.search(r"\b\d{1,2}\s*sessions?\b", d):
            return True
        if "multiple" in d and "session" in d:
            return True
        if "training" in d and "services" in d:
            return True
        if "training" in d and "program" in d:
            return True
        if "training" in d and "course" in d:
            return True
        return False

    def _session_count_and_frequency_months(self, ob: PerformanceObligation) -> Tuple[int, int]:
        d = (ob.description or "").lower()
        m = re.search(r"\b(\d{1,2})\s*sessions?\b", d)
        num = int(m.group(1)) if m else 12
        num = max(1, min(60, num))
        mf = re.search(r"every\s+(\d{1,2})\s*months?", d)
        freq = int(mf.group(1)) if mf else 3
        freq = max(1, min(24, freq))
        return num, freq

    def _append_training_session_rows(
        self,
        contract: IFRS15Input,
        ob: PerformanceObligation,
        allocated_amount: Decimal,
        schedule: List[Dict[str, Any]],
    ) -> None:
        num_sessions, freq_months = self._session_count_and_frequency_months(ob)
        start_dt = contract.effective_date
        contract_start = start_dt.date() if isinstance(start_dt, datetime) else start_dt
        running = Decimal("0")
        per = (allocated_amount / Decimal(str(num_sessions))).quantize(self.precision, ROUND_HALF_UP)
        for sn in range(1, num_sessions + 1):
            if sn == num_sessions:
                amt = (allocated_amount - running).quantize(self.precision, ROUND_HALF_UP)
            else:
                amt = per
                running += amt
            session_date = contract_start + relativedelta(months=freq_months * sn)
            session_dt = datetime(session_date.year, session_date.month, session_date.day)
            schedule.append(
                {
                    "Period": 900000 + sn,
                    "Date": session_dt.strftime("%Y-%m-%d"),
                    "Month": session_dt.strftime("%b %Y"),
                    "Obligation_ID": ob.obligation_id,
                    "Obligation": f"{ob.description} — Session {sn}",
                    "Method": "Point In Time (sessions)",
                    "Scheduled_Revenue": float(amt),
                    "Revenue": 0.0,
                    "Status": "Deferred",
                    "Cumulative": 0,
                }
            )
    
    def generate_recognition_schedule(
        self,
        contract: IFRS15Input,
        allocations: Dict[str, Decimal]
    ) -> pd.DataFrame:
        """
        Step 5: Generate revenue recognition schedule
        
        For each obligation:
        - Over time: Linear allocation over duration
        - Point in time: Full recognition on transfer date
        
        Args:
            contract: IFRS15Input
            allocations: Allocated amounts by obligation
            
        Returns:
            DataFrame with monthly revenue recognition
        """
        
        schedule = []
        current_date = contract.effective_date
        today = date.today()
        
        for month in range(1, contract.contract_term_months + 1):
            month_date = current_date + relativedelta(months=month - 1)
            
            for ob in contract.performance_obligations:
                allocated_amount = allocations[ob.obligation_id]
                
                planned_revenue = Decimal('0')
                recognized_revenue = Decimal('0')

                if ob.recognition_method == "over_time":
                    # Linear recognition over duration
                    if ob.duration_months > 0 and month <= ob.duration_months:
                        planned_revenue = (allocated_amount / Decimal(str(ob.duration_months))).quantize(
                            self.precision, ROUND_HALF_UP
                        )
                
                elif ob.recognition_method == "point_in_time":
                    if self._is_multi_session_training_obligation(ob):
                        continue
                    # Full recognition on transfer date
                    if ob.transfer_date and month_date.month == ob.transfer_date.month and month_date.year == ob.transfer_date.year:
                        planned_revenue = allocated_amount
                
                if planned_revenue > 0:
                    period_is_recognized = month_date.date() <= today
                    recognized_revenue = planned_revenue if period_is_recognized else Decimal('0')
                    status = 'Recognised' if period_is_recognized else 'Deferred'
                
                    schedule.append({
                        'Period': month,
                        'Date': month_date.strftime('%Y-%m-%d'),
                        'Month': month_date.strftime('%b %Y'),
                        'Obligation_ID': ob.obligation_id,
                        'Obligation': ob.description,
                        'Method': ob.recognition_method.replace('_', ' ').title(),
                        'Scheduled_Revenue': float(planned_revenue),
                        'Revenue': float(recognized_revenue),
                        'Status': status,
                        'Cumulative': 0  # Will calculate below
                    })
        
        for ob in contract.performance_obligations:
            if self._is_multi_session_training_obligation(ob):
                self._append_training_session_rows(
                    contract, ob, allocations[ob.obligation_id], schedule
                )

        df = pd.DataFrame(schedule)
        df = self._finalize_schedule_recognition(df)

        if not df.empty:
            for col in ("Revenue", "Scheduled_Revenue", "Cumulative"):
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0).astype("float64")

        if not df.empty:
            sort_cols = [c for c in ("Obligation_ID", "Period", "Date") if c in df.columns]
            if sort_cols:
                df = df.sort_values(by=list(sort_cols), kind="mergesort").reset_index(drop=True)

        if not df.empty and "Obligation_ID" in df.columns and "Revenue" in df.columns:
            for ob in contract.performance_obligations:
                ob_mask = df["Obligation_ID"] == ob.obligation_id
                df.loc[ob_mask, "Cumulative"] = df.loc[ob_mask, "Revenue"].cumsum()

        return df
    
    def _months_between(self, start_dt: date, end_dt: date) -> int:
        months = (end_dt.year - start_dt.year) * 12 + (end_dt.month - start_dt.month)
        if end_dt.day < start_dt.day:
            months -= 1
        return months

    def _estimate_billed_to_date(
        self,
        contract: IFRS15Input,
        total_allocated: Decimal,
        today: date,
    ) -> Decimal:
        payment_terms = (getattr(contract, "payment_terms", "") or "").strip().lower()
        if not payment_terms:
            return Decimal('0')
        if any(k in payment_terms for k in ["upfront", "up front"]):
            return total_allocated
        if "advance" not in payment_terms:
            return Decimal('0')

        start = contract.effective_date.date()
        if today < start:
            return Decimal('0')

        term_months = max(1, int(contract.contract_term_months or 1))
        installments = int(np.ceil(term_months / 12))
        amount_per_installment = (total_allocated / Decimal(str(installments))).quantize(self.precision, ROUND_HALF_UP)
        elapsed_months = self._months_between(start, today)
        billed_installments = min(installments, max(0, elapsed_months // 12 + 1))
        return amount_per_installment * Decimal(str(billed_installments))

    def calculate_contract_balances(
        self,
        contract: IFRS15Input,
        allocations: Dict[str, Decimal],
        recognition_schedule: pd.DataFrame,
        cash_received: Decimal = Decimal('0')
    ) -> Dict:
        """
        Calculate contract asset/liability balances
        
        Contract Asset: Revenue recognized > Cash received
        Contract Liability: Cash received > Revenue recognized
        
        Args:
            allocations: Allocated amounts
            recognition_schedule: Revenue schedule
            cash_received: Cash received to date
            
        Returns:
            Dictionary with balance sheet items
        """
        
        total_allocated = sum(allocations.values())
        total_recognized = Decimal(str(recognition_schedule['Revenue'].sum())) if not recognition_schedule.empty else Decimal('0')
        today = date.today()

        effective_cash_received = cash_received
        if effective_cash_received <= 0:
            effective_cash_received = self._estimate_billed_to_date(contract, total_allocated, today)

        contract_balance = total_recognized - effective_cash_received
        
        return {
            'total_transaction_price': float(total_allocated),
            'revenue_recognized_to_date': float(total_recognized),
            'cash_received_to_date': float(effective_cash_received),
            'contract_balance': float(contract_balance),
            'is_contract_asset': contract_balance > 0,  # Recognized > Received
            'is_contract_liability': contract_balance < 0,  # Received > Recognized
            'contract_asset_amount': float(max(contract_balance, Decimal('0'))),
            'contract_liability_amount': float(abs(min(contract_balance, Decimal('0'))))
        }
    
    def generate_journal_entries(
        self,
        monthly_revenue: Decimal,
        cash_received: Decimal,
        is_contract_asset: bool,
        currency: str = "USD"
    ) -> Dict:
        """
        Generate accounting journal entries
        
        Args:
            monthly_revenue: Revenue for the period
            cash_received: Cash received in the period
            is_contract_asset: Whether it's a contract asset or liability
            currency: Currency code
            
        Returns:
            Dictionary of journal entries
        """
        
        currency_symbol = "$" if currency == "USD" else "₹" if currency == "INR" else currency
        
        entries = {}
        
        # Revenue recognition entry
        if monthly_revenue > 0:
            if is_contract_asset:
                entries['revenue_recognition'] = {
                    'description': 'Revenue recognition (Contract Asset)',
                    'entries': [
                        {
                            'account': 'Contract Asset',
                            'account_type': 'Current Asset',
                            'dr': float(monthly_revenue),
                            'cr': 0,
                            'narration': 'Revenue recognized but not yet billed'
                        },
                        {
                            'account': 'Revenue',
                            'account_type': 'Income (P&L)',
                            'dr': 0,
                            'cr': float(monthly_revenue),
                            'narration': 'IFRS 15 revenue recognition'
                        }
                    ]
                }
            else:
                entries['revenue_recognition'] = {
                    'description': 'Revenue recognition (Contract Liability)',
                    'entries': [
                        {
                            'account': 'Contract Liability',
                            'account_type': 'Current Liability',
                            'dr': float(monthly_revenue),
                            'cr': 0,
                            'narration': 'Reduction of deferred revenue'
                        },
                        {
                            'account': 'Revenue',
                            'account_type': 'Income (P&L)',
                            'dr': 0,
                            'cr': float(monthly_revenue),
                            'narration': 'IFRS 15 revenue recognition'
                        }
                    ]
                }
        
        # Cash receipt entry
        if cash_received > 0:
            entries['cash_receipt'] = {
                'description': 'Cash receipt from customer',
                'entries': [
                    {
                        'account': 'Cash/Bank',
                        'account_type': 'Current Asset',
                        'dr': float(cash_received),
                        'cr': 0,
                        'narration': 'Payment received from customer'
                    },
                    {
                        'account': 'Contract Liability' if not is_contract_asset else 'Accounts Receivable',
                        'account_type': 'Current Liability' if not is_contract_asset else 'Current Asset',
                        'dr': 0,
                        'cr': float(cash_received),
                        'narration': 'Customer payment received'
                    }
                ]
            }
        
        return entries

    def flatten_journal_entries(self, journal_entries: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Flatten structured journal dict into list rows for API/UI consumers."""
        flat: List[Dict[str, Any]] = []
        for block in journal_entries.values():
            if not isinstance(block, dict):
                continue
            rows = block.get("entries", []) or []
            block_desc = str(block.get("description", "") or "")
            for row in rows:
                flat.append(
                    {
                        "section": block_desc,
                        "account": row.get("account", ""),
                        "dr": float(row.get("dr", 0) or 0),
                        "cr": float(row.get("cr", 0) or 0),
                        "narration": row.get("narration", ""),
                    }
                )
        return flat
    
    def generate_disclosure_data(
        self,
        contract: IFRS15Input,
        allocations: Dict[str, Decimal],
        recognition_schedule: pd.DataFrame
    ) -> Dict:
        """
        Generate IFRS 15 disclosure data
        
        Args:
            contract: IFRS15Input
            allocations: Allocated amounts
            recognition_schedule: Revenue schedule
            
        Returns:
            Dictionary with disclosure information
        """
        
        # Revenue by obligation
        revenue_by_obligation = []
        for ob in contract.performance_obligations:
            if not recognition_schedule.empty:
                ob_schedule = recognition_schedule[recognition_schedule["Obligation_ID"] == ob.obligation_id]
                recognized = float(ob_schedule["Revenue"].sum()) if not ob_schedule.empty else 0.0
            else:
                recognized = 0.0
            
            allocated = float(allocations[ob.obligation_id])
            pct_complete = round((recognized / allocated) * 100.0, 2) if abs(allocated) > 1e-12 else 0.0

            eps_amt = max(0.01, abs(allocated) * 1e-9)
            if allocated < 1e-9:
                recognition_status = "Deferred"
            elif recognized <= eps_amt:
                recognition_status = "Deferred"
            elif recognized >= allocated - eps_amt:
                recognition_status = "Recognised"
            else:
                recognition_status = "Partially Recognised"

            revenue_by_obligation.append({
                'obligation_id': ob.obligation_id,
                'obligation': ob.description,
                'recognition_method': ob.recognition_method,
                'allocated_amount': allocated,
                'revenue_recognized': recognized,
                'recognised_to_date': recognized,
                'remaining': allocated - recognized,
                'pct_complete': pct_complete,
                'recognition_status': recognition_status,
            })
        
        # Remaining performance obligations
        total_remaining = sum(item['remaining'] for item in revenue_by_obligation)
        
        disclosure = {
            'contract_details': {
                'contract_id': contract.contract_id,
                'customer': contract.customer_name,
                'vendor': contract.vendor_name,
                'effective_date': contract.effective_date.strftime('%Y-%m-%d'),
                'term_months': contract.contract_term_months,
                'currency': contract.currency
            },
            'transaction_price_components': {
                'fixed_consideration': float(contract.fixed_consideration),
                'variable_consideration': float(contract.variable_consideration),
                'discounts': float(contract.discounts),
                'rebates': float(contract.rebates),
                'financing_adjustment': float(contract.financing_adjustment),
                'total': float(self.calculate_transaction_price(contract))
            },
            'performance_obligations': revenue_by_obligation,
            'remaining_performance_obligations': {
                'total_remaining': total_remaining,
                'disclosure_note': f'Revenue of {contract.currency} {total_remaining:,.2f} expected to be recognized over remaining contract term'
            }
        }
        
        return disclosure
    
    def calculate_full_ifrs15(self, contract: IFRS15Input, cash_received: Decimal = Decimal('0')) -> Dict:
        """
        Execute full IFRS 15 5-step model
        
        Args:
            contract: IFRS15Input with all contract details
            cash_received: Cash received to date (optional)
            
        Returns:
            Complete calculation results
        """
        
        if not contract.performance_obligations:
            raise ValueError("No performance obligations defined")
        
        # Contract-type revenue engine and overlays
        revenue_engine_result = self.calculate_revenue_by_type(contract)
        base_period_revenue = Decimal(str(revenue_engine_result.get("revenue_this_period", 0)))
        volume_result = self.apply_volume_discount(
            base_revenue=base_period_revenue,
            volume_slabs=contract.volume_slabs,
            estimated_annual_volume=contract.estimated_annual_volume,
            can_estimate_volume=contract.can_estimate_volume,
        )
        sla_result = self.calculate_sla_penalties(contract.sla_items)
        net_period_revenue = Decimal(str(volume_result.get("discounted_revenue", 0))) - Decimal(
            str(sla_result.get("total_penalty", 0))
        )
        revenue_engine_result["revenue_after_discounts_and_sla"] = float(net_period_revenue)
        onerous_check = self.check_onerous(
            contract.fixed_consideration + contract.variable_consideration,
            contract.total_estimated_cost
        ) if contract.contract_type in ("fixed_price", "capped_tm") else {"is_onerous": False, "expected_loss": 0}

        # Step 1: Identify contract (assumed valid input)
        # Step 2: Identify performance obligations (in input)
        constrained_vc = self.apply_variable_consideration_constraint(contract)
        vc_reversed = contract.variable_consideration - constrained_vc   # amount excluded
        
        # Step 3: Determine transaction price
        transaction_price = self.calculate_transaction_price(contract)
        
        # Step 4: Allocate transaction price
        allocations = self.allocate_transaction_price(
            transaction_price, 
            contract.performance_obligations
        )
        
        # Step 5: Recognize revenue (schedule rows carry today-aware Status / Revenue)
        recognition_schedule = self.generate_recognition_schedule(contract, allocations)

        if not recognition_schedule.empty and "Revenue" in recognition_schedule.columns:
            total_recognised = float(pd.to_numeric(recognition_schedule["Revenue"], errors="coerce").fillna(0).sum())
        else:
            total_recognised = 0.0
        total_deferred_val = max(0.0, float(transaction_price) - total_recognised)

        # Calculate contract balances (cash vs recognised), then align KPI fields
        balances = self.calculate_contract_balances(contract, allocations, recognition_schedule, cash_received)
        payment_mode, contract_asset_note = self.classify_payment_terms(contract.payment_terms)

        balances["revenue_recognized_to_date"] = total_recognised
        balances["contract_liability_amount"] = total_deferred_val
        if payment_mode == "arrears":
            balances["contract_asset_amount"] = total_recognised
        else:
            balances["contract_asset_amount"] = 0.0
        rec_d = Decimal(str(total_recognised))
        cash_d = Decimal(str(balances.get("cash_received_to_date", 0) or 0))
        bal_line = rec_d - cash_d
        balances["contract_balance"] = float(bal_line)
        balances["is_contract_asset"] = payment_mode == "arrears" and total_recognised > 1e-6
        balances["is_contract_liability"] = total_deferred_val > 1e-6 or bal_line < -1e-6

        if not recognition_schedule.empty:
            sched_num = pd.to_numeric(recognition_schedule["Scheduled_Revenue"], errors="coerce").fillna(0)
            pos = recognition_schedule[sched_num > 0]
            if not pos.empty:
                first_month_revenue = Decimal(str(pos.iloc[0]["Scheduled_Revenue"]))
            else:
                first_month_revenue = Decimal(str(recognition_schedule.iloc[0].get("Scheduled_Revenue", 0) or 0))
        else:
            first_month_revenue = Decimal("0")

        journal_entries = self.build_ifrs15_journal_entries(
            first_month_revenue,
            cash_received,
            payment_mode,
            contract.currency,
            sum(allocations.values()),
        )

        # Generate disclosure data
        disclosure = self.generate_disclosure_data(contract, allocations, recognition_schedule)

        performance_obligations = disclosure.get("performance_obligations", [])
        revenue_schedule = recognition_schedule.to_dict(orient="records") if not recognition_schedule.empty else []
        journal_entries_list = self.flatten_journal_entries(journal_entries)

        return {
            'total_contract_value': float(transaction_price),
            'total_recognised': total_recognised,
            'total_deferred': total_deferred_val,
            'total_contract_assets': float(balances.get('contract_asset_amount', 0)),
            'contract_asset_note': contract_asset_note,
            'payment_terms_mode': payment_mode,
            'revenue_schedule': revenue_schedule,
            'performance_obligations': performance_obligations,
            'disclosure_notes': {
                'accounting_policy': 'Revenue is recognised when control of promised goods or services transfers to the customer.',
                'disaggregation_of_revenue': f"Revenue recognised to date: {float(balances.get('revenue_recognized_to_date', 0)):,.2f}.",
                'contract_balances': f"Contract assets: {float(balances.get('contract_asset_amount', 0)):,.2f}; Contract liabilities: {float(balances.get('contract_liability_amount', 0)):,.2f}.",
                'performance_obligations_note': f"{len(performance_obligations)} performance obligations identified.",
                'transaction_price_rpo': f"Unrecognised transaction price: {max(float(transaction_price) - float(balances.get('revenue_recognized_to_date', 0)), 0):,.2f}.",
                'significant_judgements': 'Management judgement is applied for identifying obligations, estimating variable consideration, and timing of recognition.',
            },
            'transaction_price': float(transaction_price),
            'variable_consideration_analysis': {
                'raw_variable_consideration': float(contract.variable_consideration),
                'constraint_method': contract.constraint_method,
                'constraint_percentage': float(contract.constraint_percentage),
                'constrained_variable_consideration': float(constrained_vc),
                'amount_excluded_by_constraint': float(vc_reversed),
                'amount_excluded': float(vc_reversed),
                'constraint_applied': vc_reversed > 0,
            },
            'allocations': {k: float(v) for k, v in allocations.items()},
            'recognition_schedule': recognition_schedule,
            'contract_balances': balances,
            'journal_entries_detail': journal_entries,
            'journal_entries': journal_entries_list,
            'disclosure_data': disclosure,
            'revenue_engine_result': revenue_engine_result,
            'volume_discount_result': volume_result,
            'sla_result': sla_result,
            'onerous_check': onerous_check,
            'validation': {
                'total_allocated': float(sum(allocations.values())),
                'allocation_matches_transaction_price': abs(sum(allocations.values()) - transaction_price) < Decimal('0.01'),
                'obligations_count': len(contract.performance_obligations)
            },
            'calculation_metadata': {
                'calculation_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'standard': 'IFRS 15'
            }
        }
    
    def export_to_json(self, results: Dict, filename: str):
        """Export results to JSON file"""
        results_copy = results.copy()
        if 'recognition_schedule' in results_copy:
            results_copy['recognition_schedule'] = results_copy['recognition_schedule'].to_dict(orient='records')
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(results_copy, f, indent=2, ensure_ascii=False)
        
        print(f"Results exported to: {filename}")


# Example usage
if __name__ == "__main__":
    # Sample software contract (from extracted data)
    contract = IFRS15Input(
        contract_id="CONTRACT-2024-001",
        customer_name="ABC Corporation",
        vendor_name="TechSoft Solutions Ltd.",
        effective_date=datetime(2024, 1, 1),
        contract_term_months=12,
        fixed_consideration=Decimal('750000'),
        variable_consideration=Decimal('20000'),  # Customer satisfaction bonus
        discounts=Decimal('0'),
        rebates=Decimal('0'),
        financing_adjustment=Decimal('0'),
        currency="USD",
        performance_obligations=[
            PerformanceObligation(
                obligation_id="PO-1",
                description="Software License",
                standalone_selling_price=Decimal('500000'),
                recognition_method="point_in_time",
                transfer_date=datetime(2024, 1, 1)
            ),
            PerformanceObligation(
                obligation_id="PO-2",
                description="Implementation Services",
                standalone_selling_price=Decimal('150000'),
                recognition_method="over_time",
                duration_months=6
            ),
            PerformanceObligation(
                obligation_id="PO-3",
                description="Technical Support (Year 1)",
                standalone_selling_price=Decimal('75000'),
                recognition_method="over_time",
                duration_months=12
            ),
            PerformanceObligation(
                obligation_id="PO-4",
                description="Training Services",
                standalone_selling_price=Decimal('25000'),
                recognition_method="point_in_time",
                transfer_date=datetime(2024, 7, 1)
            )
        ]
    )
    
    calc = IFRS15Calculator()
    results = calc.calculate_full_ifrs15(contract, cash_received=Decimal('250000'))
    
    print("="*70)
    print("IFRS 15 REVENUE RECOGNITION CALCULATION")
    print("="*70)
    
    print(f"\n1. TRANSACTION PRICE")
    print(f"   Total: ${results['transaction_price']:,.2f}")
    
    print(f"\n2. ALLOCATION TO PERFORMANCE OBLIGATIONS")
    for ob_id, amount in results['allocations'].items():
        print(f"   {ob_id}: ${amount:,.2f}")
    
    print(f"\n3. REVENUE RECOGNITION SCHEDULE (First 10 entries)")
    if not results['recognition_schedule'].empty:
        print(results['recognition_schedule'].head(10).to_string(index=False))
    
    print(f"\n4. CONTRACT BALANCES")
    print(f"   Total Transaction Price: ${results['contract_balances']['total_transaction_price']:,.2f}")
    print(f"   Revenue Recognized: ${results['contract_balances']['revenue_recognized_to_date']:,.2f}")
    print(f"   Cash Received: ${results['contract_balances']['cash_received_to_date']:,.2f}")
    print(f"   Contract Balance: ${results['contract_balances']['contract_balance']:,.2f}")
    if results['contract_balances']['is_contract_liability']:
        print(f"   → Contract Liability (Deferred Revenue): ${results['contract_balances']['contract_liability_amount']:,.2f}")
    elif results['contract_balances']['is_contract_asset']:
        print(f"   → Contract Asset (Unbilled): ${results['contract_balances']['contract_asset_amount']:,.2f}")
    
    print(f"\n5. DISCLOSURE DATA - REVENUE BY OBLIGATION")
    for item in results['disclosure_data']['performance_obligations']:
        print(f"   {item['obligation']}:")
        print(f"     Method: {item['recognition_method']}")
        print(f"     Allocated: ${item['allocated_amount']:,.2f}")
        print(f"     Recognized: ${item['revenue_recognized']:,.2f}")
        print(f"     Remaining: ${item['remaining']:,.2f}")

