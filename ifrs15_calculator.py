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
    transfer_date: Optional[datetime] = None  # For point-in-time (legacy alias)
    recognition_date: Optional[datetime] = None  # PIT single source of truth (IFRS 15 transfer)
    obligation_start_date: Optional[datetime] = None  # PO-specific start (e.g. go-live)
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
    # IFRS 15.56–58 factor-based constraint (used with apply_vc_constraint in calculate_transaction_price)
    vc_constraint_factors: Dict[str, bool] = field(default_factory=dict)


@dataclass
class ContractModification:
    original_contract_id: str
    modification_date: str  # "YYYY-MM-DD"
    modification_description: str
    new_goods_services: List[str]  # [] if none added
    price_change: float  # positive = increase
    remaining_transaction_price: float
    remaining_performance_obligations: List[str]
    original_ssps: Dict[str, float]


@dataclass
class DeferredRevenueInput:
    period: str  # "2025-Q1" or "2025-03"
    opening_balance: float
    new_bookings: float
    revenue_released: float
    cancellations: float
    modifications_impact: float
    fx_impact: float
    gl_closing_balance: float
    currency: str = "USD"


@dataclass
class RPOContract:
    """IFRS 15.120–122 — remaining performance obligations input (per contract)."""

    contract_id: str
    customer_name: str
    contract_start: str  # "YYYY-MM-DD"
    contract_end: str  # "YYYY-MM-DD"
    total_transaction_price: float
    revenue_recognised_to_date: float
    performance_obligations: List[Dict[str, Any]]
    practical_expedient_applied: bool = False


@dataclass
class PrincipalAgentInput:
    """IFRS 15.B34–B38 — principal vs agent assessment input."""

    arrangement_id: str
    description: str
    third_party_involved: bool
    gross_contract_value: float
    third_party_cost: float
    controls_before_transfer: bool
    primary_obligor: bool
    inventory_risk: bool
    pricing_discretion: bool
    credit_risk: bool


@dataclass
class ContractCostInput:
    """IFRS 15.91–94 / 15.95–98 — costs to obtain or fulfil a contract."""

    cost_id: str
    contract_id: str
    description: str
    cost_type: str  # incremental_obtaining | fulfillment_cost | other
    cost_amount: float
    incurred_date: str  # YYYY-MM-DD
    contract_start: str
    contract_end: str
    expected_renewal: bool
    expected_renewal_months: int = 0
    currency: str = "USD"


@dataclass
class LicenseIPInput:
    """IFRS 15.B52–B63 — licence of intellectual property."""

    license_id: str
    product_name: str
    license_description: str
    license_fee: float
    license_start: str
    license_end: str
    is_perpetual: bool
    entity_activities_affect_ip: bool
    customer_exposed_to_effect: bool
    no_separate_functional_utility: bool
    currency: str = "USD"


@dataclass
class CustomerOptionInput:
    """IFRS 15.B40–B43 — customer options / material rights."""

    option_id: str
    contract_id: str
    description: str
    option_type: str  # renewal_discount | volume_discount | free_upgrade | loyalty_points | additional_goods
    original_contract_value: float
    original_ssp: float
    option_price: float
    option_ssp: float
    exercise_probability: float
    points_granted: float = 0.0
    point_value: float = 0.0
    currency: str = "USD"


@dataclass
class WarrantyInput:
    """IFRS 15.B28–B33 — warranty classification (assurance vs service)."""

    warranty_id: str
    contract_id: str
    product_description: str
    warranty_description: str
    warranty_period_months: int
    warranty_value: float
    required_by_law: bool
    covers_specs_only: bool
    customer_can_purchase_separately: bool
    provides_additional_service: bool
    allocated_fee: float = 0
    currency: str = "USD"


@dataclass
class BillAndHoldInput:
    """IFRS 15.B79–B82 — bill-and-hold arrangements."""

    arrangement_id: str
    contract_id: str
    customer_name: str
    product_description: str
    contract_value: float
    expected_delivery_date: str
    billing_date: str
    reason_is_substantive: bool
    product_separately_identified: bool
    product_ready_for_transfer: bool
    entity_cannot_redirect: bool
    currency: str = "USD"


@dataclass
class FinancingComponentInput:
    """IFRS 15.60–65 — significant financing component."""

    contract_id: str
    description: str
    contract_value: float
    payment_date: str
    transfer_date: str
    payment_timing: str  # "advance" | "deferred"
    discount_rate: float
    currency: str = "USD"


@dataclass
class NonCashConsiderationInput:
    """IFRS 15.66–69 — non-cash consideration (per item)."""

    item_id: str
    contract_id: str
    description: str
    consideration_type: str  # goods | services | equity | data | other
    fair_value_determinable: bool
    fair_value: float
    fallback_ssp: float
    currency: str = "USD"


@dataclass
class ConsiderationPayableInput:
    """IFRS 15.70–72 — consideration payable to the customer (per item)."""

    item_id: str
    contract_id: str
    description: str
    payment_type: str  # cash | credit | voucher | waived_fee | other
    amount: float
    distinct_benefit_received: bool
    fair_value_of_benefit: float
    currency: str = "USD"


@dataclass
class AuditEntry:
    """SOX-style audit trail row (serialised as dict for API/storage)."""

    entry_id: str
    timestamp: str
    user: str
    action: str
    contract_id: str
    description: str
    before_value: Dict[str, Any]
    after_value: Dict[str, Any]
    ifrs_reference: str
    sign_off_required: bool
    signed_off_by: str = ""
    signed_off_at: str = ""
    notes: str = ""


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

        perf_obs = disc.get("performance_obligations") or core.get("performance_obligations") or []
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
                model=CLAUDE_MODEL,
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
    def _schedule_df_to_records(df: pd.DataFrame) -> List[Dict[str, Any]]:
        """Convert schedule DataFrame to JSON-safe records (no NaN/inf)."""
        if df is None or df.empty:
            return []
        clean = df.where(pd.notnull(df), None)
        records = clean.to_dict(orient="records")
        safe: List[Dict[str, Any]] = []
        for row in records:
            safe.append(
                {
                    k: (
                        None
                        if isinstance(v, float) and (pd.isna(v) or v in (float("inf"), float("-inf")))
                        else v
                    )
                    for k, v in row.items()
                }
            )
        return safe

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
                "method": "Schedule-based (Performance Obligations)",
                "revenue_this_period": None,
                "poc_percentage": None,
                "remaining_revenue": None,
                "schedule_based": True,
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

    _VC_CONSTRAINT_FACTOR_KEYS: Tuple[str, ...] = (
        "susceptible_to_external",
        "long_resolution_period",
        "wide_range_of_outcomes",
        "limited_experience",
        "broad_price_concession_practice",
    )

    def _normalize_vc_constraint_factors(self, factors: Optional[Dict[str, Any]]) -> Dict[str, bool]:
        out = {k: False for k in self._VC_CONSTRAINT_FACTOR_KEYS}
        if factors:
            for k in self._VC_CONSTRAINT_FACTOR_KEYS:
                if k in factors:
                    out[k] = bool(factors[k])
        return out

    @staticmethod
    def _fmt_contract_money(amount: float, currency: str = "USD") -> str:
        cur = (currency or "USD").strip().upper() or "USD"
        return f"{cur} {float(amount):,.2f}"

    def apply_vc_constraint(
        self,
        estimated_vc: float,
        constraint_factors: Dict[str, Any],
        currency: str = "USD",
    ) -> Dict[str, Any]:
        """
        IFRS 15.56-58 — Constraining variable consideration.

        constraint_factors keys:
        - susceptible_to_external: bool
        - long_resolution_period: bool
        - wide_range_of_outcomes: bool
        - limited_experience: bool
        - broad_price_concession_practice: bool
        """
        cur = (currency or "USD").strip().upper() or "USD"
        norm = self._normalize_vc_constraint_factors(constraint_factors)
        factors_present = [k for k, v in norm.items() if v]
        score = len(factors_present)

        if score <= 1:
            risk = "Low"
            inclusion_rate = 1.0
        elif score == 2:
            risk = "Medium"
            inclusion_rate = 0.75
        elif score == 3:
            risk = "High"
            inclusion_rate = 0.50
        else:
            risk = "Very High"
            inclusion_rate = 0.0

        constrained = round(float(estimated_vc) * inclusion_rate, 2)
        excluded = round(float(estimated_vc) - constrained, 2)

        factor_names = {
            "susceptible_to_external": "highly susceptible to external factors",
            "long_resolution_period": "uncertainty resolves over a long period",
            "wide_range_of_outcomes": "wide range of possible outcomes",
            "limited_experience": "limited experience with this contract type",
            "broad_price_concession_practice": "history of broad price concessions",
        }

        factors_text = (
            "; ".join(factor_names[f] for f in factors_present)
            if factors_present
            else "none identified"
        )

        explanation = (
            f"Constraint risk: {risk} "
            f"({score}/5 constraint factors present: "
            f"{factors_text}). "
            f"Under IFRS 15.57, {inclusion_rate * 100:.0f}% "
            f"of the estimated variable consideration "
            f"({self._fmt_contract_money(float(estimated_vc), cur)}) is included in the "
            f"transaction price. "
            f"Constrained amount included: {self._fmt_contract_money(constrained, cur)}. "
            f"Excluded (risk of significant reversal): "
            f"{self._fmt_contract_money(excluded, cur)}."
        )

        return {
            "constraint_score": score,
            "risk_level": risk,
            "inclusion_rate_pct": inclusion_rate * 100,
            "estimated_vc_before_constraint": float(estimated_vc),
            "constrained_amount": constrained,
            "excluded_amount": excluded,
            "currency": cur,
            "factors_present": factors_present,
            "explanation": explanation,
            "ifrs_reference": "IFRS 15.56-58",
        }

    def assess_modification(self, mod: ContractModification) -> Dict[str, Any]:
        """
        IFRS 15.18-21 — Three modification types (practical assessment model).
        """
        result: Dict[str, Any] = {
            "modification_type": None,
            "modification_type_name": None,
            "explanation": None,
            "catch_up_amount": 0.0,
            "new_transaction_price": 0.0,
            "new_recognition_schedule": [],
            "journal_entries": [],
            "before_modification": {},
            "after_modification": {},
        }

        new_ssp_total = sum(
            float(mod.original_ssps.get(g, 0) or 0)
            for g in (mod.new_goods_services or [])
        )

        if (
            mod.new_goods_services
            and mod.price_change >= new_ssp_total * 0.95
        ):
            result["modification_type"] = "TYPE_1"
            result["modification_type_name"] = "New Separate Contract"
            result["explanation"] = (
                f"This modification adds distinct goods/services "
                f"({', '.join(mod.new_goods_services)}) at a price "
                f"commensurate with their standalone selling price "
                f"(${new_ssp_total:,.0f}). "
                f"Under IFRS 15.18, this is accounted for as a "
                f"separate contract. The original contract recognition "
                f"schedule is unchanged."
            )
            result["new_transaction_price"] = float(mod.price_change)
            result["journal_entries"] = [
                {
                    "date": mod.modification_date,
                    "description": "New separate contract — inception",
                    "debit_account": "Accounts Receivable",
                    "credit_account": "Contract Liability",
                    "amount": float(mod.price_change),
                    "reference": "IFRS 15.18",
                }
            ]

        elif len(mod.remaining_performance_obligations or []) > 1:
            new_tp = float(mod.remaining_transaction_price) + float(mod.price_change)
            result["modification_type"] = "TYPE_2"
            result["modification_type_name"] = "Prospective Modification"
            result["explanation"] = (
                f"The modification changes the remaining "
                f"performance obligations which are distinct. "
                f"Under IFRS 15.20(b), the modification is "
                f"treated prospectively. The new transaction "
                f"price is ${new_tp:,.2f} (remaining "
                f"${float(mod.remaining_transaction_price):,.2f} "
                f"+ change ${float(mod.price_change):,.2f}), "
                f"allocated to the remaining "
                f"{len(mod.remaining_performance_obligations)} "
                f"performance obligations using updated SSPs."
            )
            result["new_transaction_price"] = new_tp

            total_remaining_ssp = sum(
                float(mod.original_ssps.get(po, 0) or 0)
                for po in mod.remaining_performance_obligations
            )
            schedule: List[Dict[str, Any]] = []
            for po in mod.remaining_performance_obligations:
                ssp = float(mod.original_ssps.get(po, 0) or 0)
                allocated = (
                    (ssp / total_remaining_ssp * new_tp)
                    if total_remaining_ssp > 0
                    else 0.0
                )
                schedule.append(
                    {
                        "performance_obligation": po,
                        "allocated_amount": round(allocated, 2),
                        "recognition_from": mod.modification_date,
                    }
                )
            result["new_recognition_schedule"] = schedule

            adj_amount = abs(float(mod.price_change))
            result["journal_entries"] = [
                {
                    "date": mod.modification_date,
                    "description": (
                        "Prospective modification — adjust contract liability"
                    ),
                    "debit_account": (
                        "Contract Liability"
                        if mod.price_change < 0
                        else "Accounts Receivable"
                    ),
                    "credit_account": (
                        "Accounts Receivable"
                        if mod.price_change < 0
                        else "Contract Liability"
                    ),
                    "amount": adj_amount,
                    "reference": "IFRS 15.20(b)",
                }
            ]

        else:
            result["modification_type"] = "TYPE_3"
            result["modification_type_name"] = "Cumulative Catch-Up Adjustment"
            catch_up = float(mod.price_change)
            result["catch_up_amount"] = catch_up
            result["explanation"] = (
                f"The remaining goods/services are not "
                f"distinct from those already transferred. "
                f"Under IFRS 15.21, the modification is "
                f"treated as if it existed from inception. "
                f"A catch-up adjustment of "
                f"${abs(catch_up):,.2f} is recognised "
                f"in the current period "
                f"({'increase' if catch_up > 0 else 'decrease'}"
                f" to revenue)."
            )
            result["journal_entries"] = [
                {
                    "date": mod.modification_date,
                    "description": "Cumulative catch-up adjustment",
                    "debit_account": (
                        "Contract Liability" if catch_up > 0 else "Revenue"
                    ),
                    "credit_account": (
                        "Revenue" if catch_up > 0 else "Contract Liability"
                    ),
                    "amount": abs(catch_up),
                    "reference": "IFRS 15.21",
                }
            ]

        return result

    def deferred_revenue_rollforward(self, data: DeferredRevenueInput) -> Dict[str, Any]:
        """IFRS 15.116 — Contract liabilities roll-forward reconciliation."""
        calculated_closing = (
            float(data.opening_balance)
            + float(data.new_bookings)
            - float(data.revenue_released)
            - float(data.cancellations)
            + float(data.modifications_impact)
            + float(data.fx_impact)
        )

        variance = round(calculated_closing - float(data.gl_closing_balance), 2)
        gl_cb = float(data.gl_closing_balance)
        variance_pct = abs(variance) / gl_cb * 100 if gl_cb != 0 else 0.0

        exceptions: List[Dict[str, Any]] = []

        if abs(variance) > 0:
            exceptions.append(
                {
                    "type": "RECONCILING_DIFFERENCE",
                    "severity": (
                        "HIGH"
                        if abs(variance_pct) > 1
                        else "MEDIUM"
                        if abs(variance_pct) > 0.1
                        else "LOW"
                    ),
                    "description": (
                        f"Calculated closing balance "
                        f"(${calculated_closing:,.2f}) differs from "
                        f"GL balance (${gl_cb:,.2f}) "
                        f"by ${variance:,.2f} "
                        f"({variance_pct:.2f}%). Investigation required."
                    ),
                    "action": (
                        "Review journal entries posted directly "
                        "to deferred revenue. Check for manual "
                        "adjustments not captured in components."
                    ),
                }
            )

        ob = float(data.opening_balance)
        release_rate = (
            float(data.revenue_released) / ob * 100 if ob != 0 else 0.0
        )
        if release_rate > 15:
            exceptions.append(
                {
                    "type": "HIGH_RELEASE_RATE",
                    "severity": "MEDIUM",
                    "description": (
                        f"Revenue released ({release_rate:.1f}% of "
                        f"opening balance) is higher than expected "
                        f"for a monthly close. Confirm no "
                        f"accelerated or incorrect releases."
                    ),
                    "action": (
                        "Review revenue recognition schedules "
                        "for any contracts where release was "
                        f"above 1/12th of annual value."
                    ),
                }
            )

        churn_rate = (
            float(data.cancellations) / ob * 100 if ob != 0 else 0.0
        )
        if churn_rate > 3:
            exceptions.append(
                {
                    "type": "HIGH_CHURN",
                    "severity": "HIGH",
                    "description": (
                        f"Cancellations represent {churn_rate:.1f}% "
                        f"of opening deferred revenue. "
                        f"Elevated churn risk. Flag to FP&A "
                        f"for revenue forecast update."
                    ),
                    "action": (
                        "Identify which customers cancelled. "
                        "Confirm termination rights and any "
                        "termination fees are correctly accounted for."
                    ),
                }
            )

        rollforward_lines: List[Dict[str, Any]] = [
            {"line": "Opening Balance", "amount": data.opening_balance, "type": "opening"},
            {
                "line": "Add: New Bookings (Invoices Raised)",
                "amount": data.new_bookings,
                "type": "addition",
            },
            {
                "line": "Less: Revenue Released to P&L",
                "amount": -float(data.revenue_released),
                "type": "deduction",
            },
            {
                "line": "Less: Cancellations / Churn",
                "amount": -float(data.cancellations),
                "type": "deduction",
            },
            {
                "line": "Add/(Less): Contract Modifications",
                "amount": data.modifications_impact,
                "type": (
                    "addition"
                    if float(data.modifications_impact) >= 0
                    else "deduction"
                ),
            },
            {
                "line": "Add/(Less): FX Retranslation",
                "amount": data.fx_impact,
                "type": (
                    "addition"
                    if float(data.fx_impact) >= 0
                    else "deduction"
                ),
            },
            {
                "line": "Calculated Closing Balance",
                "amount": calculated_closing,
                "type": "subtotal",
            },
            {
                "line": "GL Closing Balance (Control Total)",
                "amount": data.gl_closing_balance,
                "type": "control",
            },
            {
                "line": "Variance (must be zero)",
                "amount": variance,
                "type": "variance",
            },
        ]

        return {
            "period": data.period,
            "currency": data.currency,
            "rollforward_lines": rollforward_lines,
            "calculated_closing_balance": calculated_closing,
            "gl_closing_balance": data.gl_closing_balance,
            "variance": variance,
            "variance_pct": round(variance_pct, 4),
            "reconciled": abs(variance) < 0.01,
            "exceptions": exceptions,
            "exception_count": len(exceptions),
            "highest_severity": (
                "HIGH"
                if any(e["severity"] == "HIGH" for e in exceptions)
                else "MEDIUM"
                if any(e["severity"] == "MEDIUM" for e in exceptions)
                else "NONE"
            ),
            "churn_rate_pct": round(churn_rate, 2),
            "release_rate_pct": round(release_rate, 2),
            "ifrs_reference": "IFRS 15.116",
        }

    def calculate_rpo(self, contracts: List[Any]) -> Dict[str, Any]:
        """
        IFRS 15.120-122 — RPO Disclosure.

        Calculates remaining performance obligations across all contracts and produces
        the mandatory disclosure note in full.

        Practical expedients (IFRS 15.121):
        a) Contract with original duration <= 1 year → not required to disclose
        b) Revenue recognised using right-to-invoice practical expedient → not required
           to disclose (caller flags via practical_expedient_applied).
        """
        buckets = {
            "within_1_year": 0.0,
            "1_to_2_years": 0.0,
            "2_to_5_years": 0.0,
            "beyond_5_years": 0.0,
        }

        contract_details: List[Dict[str, Any]] = []
        expedient_contracts: List[Dict[str, Any]] = []
        total_rpo = 0.0
        expedient_count = 0

        for raw in contracts:
            c = self._normalize_rpo_contract(raw)

            if c.practical_expedient_applied:
                expedient_count += 1
                expedient_contracts.append(
                    {
                        "contract_id": c.contract_id,
                        "customer_name": c.customer_name,
                        "contract_end": c.contract_end,
                        "total_transaction_price": float(c.total_transaction_price),
                        "revenue_recognised_to_date": float(c.revenue_recognised_to_date),
                        "practical_expedient_applied": True,
                    }
                )
                continue

            rpo_this_contract = float(c.total_transaction_price) - float(c.revenue_recognised_to_date)
            if rpo_this_contract < 0:
                rpo_this_contract = 0.0

            total_rpo += rpo_this_contract

            po_details: List[Dict[str, Any]] = []
            for po_raw in c.performance_obligations or []:
                po = po_raw if isinstance(po_raw, dict) else getattr(po_raw, "model_dump", lambda: {})()
                if not isinstance(po, dict):
                    continue
                alloc = float(po.get("allocated_amount", 0) or 0)
                rec = float(po.get("recognised_to_date", 0) or 0)
                po_rpo = alloc - rec
                if po_rpo < 0:
                    po_rpo = 0.0

                pattern = po.get("expected_recognition_pattern", "within_1_year")
                if pattern in buckets:
                    buckets[pattern] += po_rpo

                po_name = po.get("name") or po.get("obligation_name") or "Performance obligation"
                po_details.append(
                    {
                        "name": po_name,
                        "allocated_amount": alloc,
                        "recognised_to_date": rec,
                        "rpo_amount": round(po_rpo, 2),
                        "recognition_pattern": pattern,
                        "recognition_type": po.get("recognition_type", "over_time"),
                    }
                )

            contract_details.append(
                {
                    "contract_id": c.contract_id,
                    "customer_name": c.customer_name,
                    "contract_end": c.contract_end,
                    "total_transaction_price": float(c.total_transaction_price),
                    "revenue_recognised_to_date": float(c.revenue_recognised_to_date),
                    "rpo_amount": round(rpo_this_contract, 2),
                    "performance_obligations": po_details,
                }
            )

        disclosure_note = self._build_rpo_disclosure(
            total_rpo,
            buckets,
            len(contracts),
            expedient_count,
        )

        return {
            "total_rpo": round(total_rpo, 2),
            "buckets": {k: round(v, 2) for k, v in buckets.items()},
            "contract_count": len(contracts),
            "expedient_contracts_excluded": expedient_count,
            "expedient_contracts": expedient_contracts,
            "contract_details": contract_details,
            "disclosure_note": disclosure_note,
            "ifrs_reference": "IFRS 15.120-122",
        }

    def _normalize_rpo_contract(self, raw: Any) -> RPOContract:
        if isinstance(raw, RPOContract):
            return raw
        if isinstance(raw, dict):
            pos = raw.get("performance_obligations") or []
            return RPOContract(
                contract_id=str(raw.get("contract_id", "") or ""),
                customer_name=str(raw.get("customer_name", "") or ""),
                contract_start=str(raw.get("contract_start", "") or ""),
                contract_end=str(raw.get("contract_end", "") or ""),
                total_transaction_price=float(raw.get("total_transaction_price", 0) or 0),
                revenue_recognised_to_date=float(raw.get("revenue_recognised_to_date", 0) or 0),
                performance_obligations=list(pos),
                practical_expedient_applied=bool(raw.get("practical_expedient_applied", False)),
            )
        raise TypeError("RPO contract must be RPOContract or dict")

    def _build_rpo_disclosure(
        self,
        total_rpo: float,
        buckets: Dict[str, float],
        total_contracts: int,
        expedient_count: int,
    ) -> Dict[str, Any]:
        """Generates the complete IFRS 15.120 disclosure note in audit-ready text."""
        _ = total_contracts  # retained for signature parity with disclosure templates
        note_title = "Note: Remaining Performance Obligations"

        para_1 = (
            f"As at the reporting date, the aggregate amount of the transaction price allocated "
            f"to performance obligations that are unsatisfied or partially unsatisfied is "
            f"${total_rpo:,.0f}."
        )

        if expedient_count > 0:
            para_1 += (
                f" This amount excludes contracts with an original expected duration of one "
                f"year or less, for which the entity has applied the practical expedient in "
                f"IFRS 15.121(a) ({expedient_count} contract(s))."
            )

        para_2_lines = [
            "The entity expects to recognise this revenue in the following periods:",
        ]
        bucket_labels = {
            "within_1_year": "Within 1 year",
            "1_to_2_years": "1 to 2 years",
            "2_to_5_years": "2 to 5 years",
            "beyond_5_years": "Beyond 5 years",
        }
        for k, label in bucket_labels.items():
            para_2_lines.append(f"  {label}: ${buckets[k]:,.0f}")
        para_2_lines.append(f"  Total: ${total_rpo:,.0f}")

        para_3 = (
            "The amounts disclosed above include fixed consideration and variable consideration "
            "that has been included in the transaction price in accordance with the constraint "
            "requirements of IFRS 15.56-58. Variable consideration that has been constrained is excluded."
        )

        return {
            "title": note_title,
            "paragraph_1": para_1,
            "paragraph_2": "\n".join(para_2_lines),
            "paragraph_3": para_3,
            "full_text": "\n\n".join([note_title, para_1, "\n".join(para_2_lines), para_3]),
        }

    def assess_principal_agent(self, data: PrincipalAgentInput) -> Dict[str, Any]:
        """
        IFRS 15.B34-B38 — Principal vs Agent.

        The key assessment is whether the entity CONTROLS the good or service before it is
        transferred to the customer. Under IFRS 15, there is no hierarchy among indicators;
        all indicators are considered together. Control is the key determinant — indicators
        are evidence of control, not a scoring system. Professional judgement is required.
        """
        indicators = {
            "controls_before_transfer": bool(data.controls_before_transfer),
            "primary_obligor": bool(data.primary_obligor),
            "inventory_risk": bool(data.inventory_risk),
            "pricing_discretion": bool(data.pricing_discretion),
            "credit_risk": bool(data.credit_risk),
        }

        principal_indicators = sum(1 for v in indicators.values() if v)
        agent_indicators = 5 - principal_indicators

        if data.controls_before_transfer and principal_indicators >= 3:
            conclusion = "PRINCIPAL"
            confidence = "HIGH"
            revenue_treatment = "GROSS"
            revenue_amount = float(data.gross_contract_value)
            cost_amount = float(data.third_party_cost)
        elif (not data.controls_before_transfer) and principal_indicators <= 1:
            conclusion = "AGENT"
            confidence = "HIGH"
            revenue_treatment = "NET"
            revenue_amount = float(data.gross_contract_value) - float(data.third_party_cost)
            cost_amount = 0.0
        elif principal_indicators >= 4:
            conclusion = "PRINCIPAL"
            confidence = "MEDIUM"
            revenue_treatment = "GROSS"
            revenue_amount = float(data.gross_contract_value)
            cost_amount = float(data.third_party_cost)
        elif agent_indicators >= 4:
            conclusion = "AGENT"
            confidence = "MEDIUM"
            revenue_treatment = "NET"
            revenue_amount = float(data.gross_contract_value) - float(data.third_party_cost)
            cost_amount = 0.0
        else:
            conclusion = "JUDGEMENT REQUIRED"
            confidence = "LOW"
            revenue_treatment = "UNCERTAIN"
            revenue_amount = float(data.gross_contract_value)
            cost_amount = float(data.third_party_cost)

        net_margin = float(data.gross_contract_value) - float(data.third_party_cost)

        indicator_labels = {
            "controls_before_transfer": (
                "Controls the good/service before transfer (KEY indicator — IFRS 15.B35)"
            ),
            "primary_obligor": (
                "Primary obligor — customer holds entity responsible for fulfilment"
            ),
            "inventory_risk": "Bears inventory risk before or after transfer",
            "pricing_discretion": "Has discretion in setting price to customer",
            "credit_risk": "Bears credit risk — pays third party regardless of customer payment",
        }

        principal_present = [indicator_labels[k] for k, v in indicators.items() if v]
        agent_present = [indicator_labels[k] for k, v in indicators.items() if not v]

        if conclusion == "PRINCIPAL":
            explanation = (
                f"The entity is acting as a PRINCIPAL. {principal_indicators} of 5 principal indicators are present, "
                f"including the key indicator of control before transfer. Under IFRS 15.B35, revenue is recognised on "
                f"a GROSS basis at the full contract value of ${data.gross_contract_value:,.2f}. The third-party cost of "
                f"${data.third_party_cost:,.2f} is recognised as cost of sales."
            )
        elif conclusion == "AGENT":
            explanation = (
                f"The entity is acting as an AGENT. Only {principal_indicators} of 5 principal indicators are present "
                f"and the entity does not control the good/service before transfer. Under IFRS 15.B36, revenue is recognised "
                f"on a NET basis at the commission/margin of ${net_margin:,.2f} (${data.gross_contract_value:,.2f} less "
                f"${data.third_party_cost:,.2f})."
            )
        else:
            explanation = (
                f"The indicators are mixed ({principal_indicators} principal, {agent_indicators} agent). Under IFRS 15, "
                f"all indicators are considered together — no hierarchy applies. Professional judgement is required. "
                f"An accounting judgement memo must be prepared and reviewed by the Controller before revenue is recognised. "
                f"Consider consulting the Revenue Assurance team."
            )

        if conclusion == "PRINCIPAL":
            journal = [
                {
                    "description": "On invoicing — principal (gross)",
                    "debit_account": "Accounts Receivable",
                    "credit_account": "Revenue",
                    "amount": float(data.gross_contract_value),
                    "reference": "IFRS 15.B35 — Gross",
                },
                {
                    "description": "Third-party cost recognition",
                    "debit_account": "Cost of Sales",
                    "credit_account": "Accounts Payable / Accrual",
                    "amount": float(data.third_party_cost),
                    "reference": "Cost of fulfilment",
                },
            ]
        elif conclusion == "AGENT":
            journal = [
                {
                    "description": "On invoicing — agent (net)",
                    "debit_account": "Accounts Receivable",
                    "credit_account": "Revenue",
                    "amount": net_margin,
                    "reference": "IFRS 15.B36 — Net",
                }
            ]
        else:
            journal = []

        revenue_recognised = round(revenue_amount, 2) if revenue_amount is not None else None
        cost_recognised = round(cost_amount, 2) if cost_amount is not None else None

        revenue_impact_vs_gross = round((revenue_amount if revenue_amount is not None else net_margin) - float(data.gross_contract_value), 2)

        return {
            "arrangement_id": data.arrangement_id,
            "description": data.description,
            "conclusion": conclusion,
            "confidence": confidence,
            "revenue_treatment": revenue_treatment,
            "principal_indicators_count": principal_indicators,
            "agent_indicators_count": agent_indicators,
            "indicators_detail": {
                k: {"present": v, "label": indicator_labels[k], "supports": "PRINCIPAL" if v else "AGENT"}
                for k, v in indicators.items()
            },
            "principal_indicators_present": principal_present,
            "agent_indicators_present": agent_present,
            "gross_contract_value": float(data.gross_contract_value),
            "third_party_cost": float(data.third_party_cost),
            "net_margin": round(net_margin, 2),
            "revenue_recognised": revenue_recognised,
            "cost_recognised": cost_recognised,
            "revenue_impact_vs_gross": revenue_impact_vs_gross,
            "explanation": explanation,
            "journal_entries": journal,
            "judgement_memo_required": conclusion == "JUDGEMENT REQUIRED",
            "ifrs_reference": "IFRS 15.B34-B38",
        }

    def calculate_contract_costs(self, costs: List[Any]) -> Dict[str, Any]:
        """
        IFRS 15.91-94 — Costs to obtain a contract; IFRS 15.95-98 — costs to fulfil.

        For each cost item: capitalisation test, amortisation period, monthly schedule,
        journals, and practical expedient (IFRS 15.94) for incremental obtaining costs
        when amortisation period ≤ 12 months.
        """
        results: List[Dict[str, Any]] = []
        total_capitalised = 0.0
        total_expensed_immediately = 0.0
        total_amortised_to_date = 0.0
        total_asset_balance = 0.0

        for raw in costs:
            if not isinstance(raw, ContractCostInput):
                raise TypeError("calculate_contract_costs expects ContractCostInput instances")
            c = raw

            start = datetime.strptime(c.contract_start[:10], "%Y-%m-%d").date()
            end = datetime.strptime(c.contract_end[:10], "%Y-%m-%d").date()
            incurred = datetime.strptime(c.incurred_date[:10], "%Y-%m-%d").date()

            delta = relativedelta(end, start)
            base_months = delta.years * 12 + delta.months
            if delta.days > 0:
                base_months += 1
            base_months = max(base_months, 1)

            total_months = base_months + (c.expected_renewal_months if c.expected_renewal else 0)
            total_months = max(int(total_months), 1)

            practical_expedient = (
                total_months <= 12 and c.cost_type == "incremental_obtaining"
            )

            qualifies = (
                c.cost_type == "incremental_obtaining" and not practical_expedient
            ) or (c.cost_type == "fulfillment_cost" and total_months > 12)

            if not qualifies or practical_expedient:
                if practical_expedient:
                    reason = (
                        "Practical expedient applied — amortisation period ≤ 1 year (IFRS 15.94)"
                    )
                    desc_j = f"Commission expense — practical expedient (IFRS 15.94)"
                    ref = "IFRS 15.94"
                else:
                    reason = "Does not meet capitalisation criteria — expense as incurred"
                    desc_j = "Contract-related cost expensed as incurred"
                    ref = "IFRS 15.91-95"
                item: Dict[str, Any] = {
                    "cost_id": c.cost_id,
                    "contract_id": c.contract_id,
                    "description": c.description,
                    "cost_type": c.cost_type,
                    "cost_amount": float(c.cost_amount),
                    "treatment": "EXPENSE_IMMEDIATELY",
                    "practical_expedient_applied": bool(practical_expedient),
                    "reason": reason,
                    "asset_balance": 0.0,
                    "total_amortised": float(c.cost_amount),
                    "amortisation_schedule": [],
                    "journal_entries": [
                        {
                            "date": c.incurred_date,
                            "description": desc_j,
                            "debit_account": "Sales Commission Expense" if c.cost_type == "incremental_obtaining" else "Operating Expense",
                            "credit_account": "Accrued Liabilities",
                            "amount": float(c.cost_amount),
                            "reference": ref,
                        }
                    ],
                }
                total_expensed_immediately += float(c.cost_amount)
            else:
                monthly_amortisation = round(float(c.cost_amount) / total_months, 2)
                schedule: List[Dict[str, Any]] = []
                today = date.today()
                current = start
                cumulative = 0.0

                for m in range(total_months):
                    period_str = current.strftime("%Y-%m")
                    if m == total_months - 1:
                        amt = round(float(c.cost_amount) - cumulative, 2)
                    else:
                        amt = monthly_amortisation
                    cumulative = round(cumulative + amt, 2)
                    remaining = round(float(c.cost_amount) - cumulative, 2)
                    status = "Amortised" if current <= today else "Future"
                    schedule.append(
                        {
                            "period": period_str,
                            "amortisation": round(amt, 2),
                            "cumulative_amortised": round(cumulative, 2),
                            "asset_balance": max(remaining, 0.0),
                            "status": status,
                        }
                    )
                    current = current + relativedelta(months=1)

                amortised_to_date = sum(
                    float(r["amortisation"]) for r in schedule if r["status"] == "Amortised"
                )
                asset_balance = round(float(c.cost_amount) - amortised_to_date, 2)

                total_capitalised += float(c.cost_amount)
                total_amortised_to_date += amortised_to_date
                total_asset_balance += asset_balance

                reason = (
                    f"Incremental cost capitalised under IFRS 15.91. Amortised straight-line over {total_months} months"
                    + (
                        f" (including {c.expected_renewal_months} month renewal estimate)"
                        if c.expected_renewal
                        else ""
                    )
                    + "."
                )
                if c.cost_type == "fulfillment_cost":
                    reason = (
                        f"Fulfilment cost capitalised under IFRS 15.95. Amortised straight-line over {total_months} months."
                    )

                item = {
                    "cost_id": c.cost_id,
                    "contract_id": c.contract_id,
                    "description": c.description,
                    "cost_type": c.cost_type,
                    "cost_amount": float(c.cost_amount),
                    "treatment": "CAPITALISE",
                    "practical_expedient_applied": False,
                    "amortisation_period_months": total_months,
                    "monthly_amortisation": monthly_amortisation,
                    "asset_balance": asset_balance,
                    "total_amortised": round(amortised_to_date, 2),
                    "amortisation_schedule": schedule,
                    "reason": reason,
                    "journal_entries": [
                        {
                            "date": c.incurred_date,
                            "description": "Capitalise contract cost",
                            "debit_account": "Contract Cost Asset (Costs to Obtain)",
                            "credit_account": "Accrued Liabilities / Cash",
                            "amount": float(c.cost_amount),
                            "reference": "IFRS 15.91" if c.cost_type == "incremental_obtaining" else "IFRS 15.95",
                        },
                        {
                            "date": "Monthly",
                            "description": "Monthly amortisation",
                            "debit_account": "Sales Commission Expense",
                            "credit_account": "Contract Cost Asset",
                            "amount": monthly_amortisation,
                            "reference": "IFRS 15.99",
                        },
                    ],
                }

            results.append(item)

        return {
            "costs": results,
            "summary": {
                "total_costs_assessed": len(costs),
                "total_capitalised": round(total_capitalised, 2),
                "total_expensed_immediately": round(total_expensed_immediately, 2),
                "total_amortised_to_date": round(total_amortised_to_date, 2),
                "net_asset_balance": round(total_asset_balance, 2),
            },
            "ifrs_reference": "IFRS 15.91-94, 15.99",
        }

    def assess_license_ip(self, data: LicenseIPInput) -> Dict[str, Any]:
        """IFRS 15.B52-B63 — licences of intellectual property (right to use vs right to access)."""
        indicator_labels = {
            "entity_activities_affect_ip": (
                "Entity's ongoing activities significantly affect the IP (IFRS 15.B58a)"
            ),
            "customer_exposed_to_effect": (
                "Customer is directly exposed to the positive/negative effects (IFRS 15.B58b)"
            ),
            "no_separate_functional_utility": (
                "IP does not have significant standalone functionality without entity's involvement (IFRS 15.B58c)"
            ),
        }
        indicators = {
            "entity_activities_affect_ip": bool(data.entity_activities_affect_ip),
            "customer_exposed_to_effect": bool(data.customer_exposed_to_effect),
            "no_separate_functional_utility": bool(data.no_separate_functional_utility),
        }

        if data.is_perpetual and not data.entity_activities_affect_ip:
            license_type = "RIGHT_TO_USE"
            recognition = "POINT_IN_TIME"
        elif (
            data.entity_activities_affect_ip
            and data.customer_exposed_to_effect
            and data.no_separate_functional_utility
        ):
            license_type = "RIGHT_TO_ACCESS"
            recognition = "OVER_TIME"
        elif data.entity_activities_affect_ip:
            license_type = "JUDGEMENT_REQUIRED"
            recognition = "UNCERTAIN"
        else:
            license_type = "RIGHT_TO_USE"
            recognition = "POINT_IN_TIME"

        schedule: List[Dict[str, Any]] = []
        revenue_amount = 0.0

        if recognition == "POINT_IN_TIME":
            revenue_amount = float(data.license_fee)
            schedule = [
                {
                    "period": data.license_start[:7],
                    "amount": float(data.license_fee),
                    "cumulative": float(data.license_fee),
                    "balance": 0.0,
                    "note": "Full licence fee recognised on delivery of licence",
                }
            ]
        elif recognition == "OVER_TIME":
            start = datetime.strptime(data.license_start[:10], "%Y-%m-%d").date()
            if not data.is_perpetual and (data.license_end or "").strip():
                end = datetime.strptime(data.license_end[:10], "%Y-%m-%d").date()
                delta = relativedelta(end, start)
                months = delta.years * 12 + delta.months
                if delta.days > 0:
                    months += 1
                months = max(months, 1)
            else:
                months = 36

            monthly = round(float(data.license_fee) / months, 2)
            cumulative = 0.0
            current = start
            for m in range(months):
                if m == months - 1:
                    amt = round(float(data.license_fee) - cumulative, 2)
                else:
                    amt = monthly
                cumulative = round(cumulative + amt, 2)
                schedule.append(
                    {
                        "period": current.strftime("%Y-%m"),
                        "amount": round(amt, 2),
                        "cumulative": round(cumulative, 2),
                        "balance": round(float(data.license_fee) - cumulative, 2),
                        "note": "Straight-line over licence term",
                    }
                )
                current = current + relativedelta(months=1)
            revenue_amount = monthly

        if license_type == "RIGHT_TO_ACCESS":
            explanation = (
                f"'{data.product_name}' is a RIGHT TO ACCESS licence. All three IFRS 15.B58 criteria are met: the entity's ongoing activities "
                f"significantly affect the IP, the customer is exposed to those effects, and the IP lacks standalone utility. Revenue of "
                f"${data.license_fee:,.2f} is recognised OVER TIME — straight-line over the licence period ({len(schedule)} months)."
            )
        elif license_type == "RIGHT_TO_USE":
            explanation = (
                f"'{data.product_name}' is a RIGHT TO USE licence. The entity's ongoing activities do not significantly affect the IP after delivery. "
                f"The customer receives a static right to use the IP as it exists at the grant date. Revenue of ${data.license_fee:,.2f} is recognised at the "
                f"POINT IN TIME when the licence is made accessible to the customer (IFRS 15.B56)."
            )
        else:
            explanation = (
                f"'{data.product_name}' requires judgement. The entity's activities affect the IP but not all three B58 criteria are clearly met. "
                f"An accounting judgement memo is required. Consider whether the IP has standalone functionality and whether customers are "
                f"directly exposed to ongoing activity effects. Consult the Revenue Assurance team."
            )

        if recognition == "POINT_IN_TIME":
            journals = [
                {
                    "date": data.license_start,
                    "description": f"Licence revenue — right to use ({data.product_name})",
                    "debit_account": "Accounts Receivable",
                    "credit_account": "Licence Revenue",
                    "amount": float(data.license_fee),
                    "reference": "IFRS 15.B56",
                }
            ]
        elif recognition == "OVER_TIME":
            monthly = float(schedule[0]["amount"]) if schedule else 0.0
            journals = [
                {
                    "date": data.license_start,
                    "description": "Licence fee invoiced",
                    "debit_account": "Accounts Receivable",
                    "credit_account": "Deferred Revenue",
                    "amount": float(data.license_fee),
                    "reference": "IFRS 15.B58",
                },
                {
                    "date": "Monthly",
                    "description": "Monthly licence revenue release",
                    "debit_account": "Deferred Revenue",
                    "credit_account": "Licence Revenue",
                    "amount": monthly,
                    "reference": "IFRS 15.B58",
                },
            ]
        else:
            journals = []

        return {
            "license_id": data.license_id,
            "product_name": data.product_name,
            "license_type": license_type,
            "recognition_basis": recognition,
            "license_fee": float(data.license_fee),
            "is_perpetual": bool(data.is_perpetual),
            "indicators": {k: {"present": v, "label": indicator_labels[k]} for k, v in indicators.items()},
            "criteria_met_count": sum(1 for v in indicators.values() if v),
            "explanation": explanation,
            "recognition_schedule": schedule,
            "revenue_per_period": float(data.license_fee) if recognition != "OVER_TIME" else float(revenue_amount),
            "journal_entries": journals,
            "judgement_memo_required": license_type == "JUDGEMENT_REQUIRED",
            "ifrs_reference": "IFRS 15.B52-B63",
        }

    def assess_material_right(self, data: CustomerOptionInput) -> Dict[str, Any]:
        """IFRS 15.B40–B43 — customer options; material right vs incremental discount proxy."""
        prob = min(1.0, max(0.0, float(data.exercise_probability or 0.0)))
        option_ssp = float(data.option_ssp or 0.0)
        option_price = float(data.option_price or 0.0)
        discount_amount = option_ssp - option_price
        discount_pct = (discount_amount / option_ssp * 100.0) if option_ssp > 0 else 0.0

        material_right_exists = option_price < option_ssp and discount_pct > 10.0

        if not material_right_exists:
            return {
                "option_id": data.option_id,
                "contract_id": data.contract_id,
                "option_type": data.option_type,
                "original_contract_value": float(data.original_contract_value),
                "original_ssp": float(data.original_ssp),
                "option_price": option_price,
                "option_ssp": option_ssp,
                "material_right_exists": False,
                "discount_amount": round(discount_amount, 2),
                "discount_pct": round(discount_pct, 2),
                "exercise_probability_pct": round(prob * 100.0, 1),
                "explanation": (
                    f"No material right identified. The option discount of {discount_pct:.1f}% "
                    f"(${discount_amount:,.2f}) does not represent an incremental benefit beyond discounts available to "
                    f"similar customers in the market. This option is NOT a separate performance obligation. Account "
                    f"for any renewal or exercise if and when it occurs."
                ),
                "treatment": "NOT_A_SEPARATE_PO",
                "allocated_to_option": 0.0,
                "allocated_to_original": float(data.original_contract_value),
                "journal_entries": [],
                "ifrs_reference": "IFRS 15.B40",
            }

        option_ssp_estimated = round(discount_amount * prob, 2)
        total_ssp = float(data.original_ssp) + option_ssp_estimated
        alloc_ratio_original = (float(data.original_ssp) / total_ssp) if total_ssp > 0 else 1.0
        alloc_ratio_option = (option_ssp_estimated / total_ssp) if total_ssp > 0 else 0.0

        allocated_original = round(float(data.original_contract_value) * alloc_ratio_original, 2)
        allocated_option = round(float(data.original_contract_value) * alloc_ratio_option, 2)

        explanation = (
            f"A material right EXISTS. The renewal/option price of ${option_price:,.2f} represents a {discount_pct:.1f}% "
            f"discount below the standalone selling price of ${option_ssp:,.2f} — a discount the customer would not receive "
            f"without entering the original contract (IFRS 15.B40).\n\n"
            f"The option is a SEPARATE PERFORMANCE OBLIGATION. Its SSP is estimated at ${option_ssp_estimated:,.2f} "
            f"(discount of ${discount_amount:,.2f} × exercise probability of {prob * 100:.0f}% per IFRS 15.B42).\n\n"
            f"Of the ${float(data.original_contract_value):,.2f} original transaction price:\n"
            f"  ${allocated_original:,.2f} allocated to original performance obligations\n"
            f"  ${allocated_option:,.2f} allocated to the option (contract liability until exercised or expired)"
        )

        journals = [
            {
                "date": "On contract inception",
                "description": "Invoice original contract value",
                "debit_account": "Accounts Receivable",
                "credit_account": "Revenue / Contract Liability",
                "amount": float(data.original_contract_value),
                "split": {
                    "Revenue (original POs)": allocated_original,
                    "Contract Liability (option)": allocated_option,
                },
                "reference": "IFRS 15.B40-B42",
            },
            {
                "date": "If option exercised",
                "description": "Release contract liability on exercise",
                "debit_account": "Cash / Accounts Receivable",
                "credit_account": "Revenue",
                "amount": option_price + allocated_option,
                "note": (
                    f"Revenue = ${option_price:,.2f} cash received + ${allocated_option:,.2f} released from contract liability"
                ),
                "reference": "IFRS 15.B43",
            },
            {
                "date": "If option expires unexercised",
                "description": "Recognise on expiry of option",
                "debit_account": "Contract Liability",
                "credit_account": "Revenue",
                "amount": allocated_option,
                "reference": "IFRS 15.B43",
            },
        ]

        return {
            "option_id": data.option_id,
            "contract_id": data.contract_id,
            "option_type": data.option_type,
            "original_contract_value": float(data.original_contract_value),
            "original_ssp": float(data.original_ssp),
            "option_price": option_price,
            "option_ssp": option_ssp,
            "material_right_exists": True,
            "treatment": "SEPARATE_PERFORMANCE_OBLIGATION",
            "discount_amount": round(discount_amount, 2),
            "discount_pct": round(discount_pct, 2),
            "exercise_probability_pct": round(prob * 100.0, 1),
            "option_ssp_estimated": option_ssp_estimated,
            "total_ssp_pool": round(total_ssp, 2),
            "allocated_to_original": allocated_original,
            "allocated_to_option": allocated_option,
            "allocation_pct_original": round(alloc_ratio_original * 100.0, 2),
            "allocation_pct_option": round(alloc_ratio_option * 100.0, 2),
            "explanation": explanation,
            "journal_entries": journals,
            "ifrs_reference": "IFRS 15.B40-B43",
        }

    def classify_warranty(self, data: WarrantyInput) -> Dict[str, Any]:
        """
        IFRS 15.B28-B33 — Warranty classification.

        ASSURANCE-TYPE (IAS 37):
        Required conditions (ALL of these):
        - Covers only that product/service meets
          already-agreed specifications
        - Does NOT provide services beyond assurance
        - NOT separately purchasable by customer

        SERVICE-TYPE (IFRS 15 — separate PO):
        Required: ANY ONE of these:
        - Customer can purchase separately
        - Provides services beyond spec assurance
        - Extended period indicating service intent

        LEGAL REQUIREMENT:
        If required_by_law and covers specs only
        → always assurance (IAS 37 provision)

        EXTENDED PERIOD INDICATOR:
        Warranty > 24 months → strong service-type
        signal (IFRS 15.B31)
        """
        if data.required_by_law and data.covers_specs_only:
            warranty_type = "ASSURANCE"
            confidence = "HIGH"
        elif data.customer_can_purchase_separately or data.provides_additional_service:
            warranty_type = "SERVICE"
            confidence = "HIGH"
        elif not data.covers_specs_only and data.warranty_period_months > 24:
            warranty_type = "SERVICE"
            confidence = "MEDIUM"
        elif data.covers_specs_only:
            warranty_type = "ASSURANCE"
            confidence = "HIGH" if data.warranty_period_months <= 24 else "MEDIUM"
        else:
            warranty_type = "JUDGEMENT_REQUIRED"
            confidence = "LOW"

        if warranty_type == "ASSURANCE":
            accounting_standard = "IAS 37"
            treatment = (
                "Recognise a provision under IAS 37 for "
                "the estimated cost of fulfilling warranty "
                "obligations. This is NOT a performance "
                "obligation under IFRS 15. Warranty costs "
                "are recognised in cost of sales, not as "
                "a reduction of revenue."
            )
            provision_required = True
            deferred_revenue = 0.0
            journals = [
                {
                    "date": "On sale",
                    "description": ("Recognise warranty provision (IAS 37)"),
                    "debit_account": "Warranty Expense",
                    "credit_account": "Warranty Provision",
                    "amount": data.warranty_value,
                    "reference": "IAS 37.14",
                },
                {
                    "date": "As costs incurred",
                    "description": "Warranty claims settled",
                    "debit_account": "Warranty Provision",
                    "credit_account": ("Cash / Inventory / Labour"),
                    "amount": data.warranty_value,
                    "note": "Actual claims; reverse excess",
                    "reference": "IAS 37.59",
                },
            ]
            explanation = (
                f"'{data.warranty_description}' is an "
                f"ASSURANCE-TYPE warranty. It assures the "
                f"customer that the product meets agreed "
                f"specifications — it does not provide "
                f"additional services. Under IFRS 15.B29, "
                f"assurance warranties are NOT performance "
                f"obligations. Account for under IAS 37: "
                f"recognise a provision of "
                f"${data.warranty_value:,.2f} at the "
                f"point of sale. Warranty costs are "
                f"presented in cost of sales, not as a "
                f"deduction from revenue."
            )

        elif warranty_type == "SERVICE":
            accounting_standard = "IFRS 15"
            allocated = data.allocated_fee if data.allocated_fee > 0 else data.warranty_value
            monthly = (
                round(allocated / data.warranty_period_months, 2)
                if data.warranty_period_months > 0
                else 0.0
            )
            treatment = (
                f"This is a SERVICE-TYPE warranty — a "
                f"separate performance obligation under "
                f"IFRS 15.B30. Allocate "
                f"${allocated:,.2f} of the transaction "
                f"price to this warranty. Recognise "
                f"straight-line over {data.warranty_period_months}"
                f" months (${monthly:,.2f}/month)."
            )
            provision_required = False
            deferred_revenue = float(allocated)
            journals = [
                {
                    "date": "On contract inception",
                    "description": ("Defer allocated warranty fee"),
                    "debit_account": ("Accounts Receivable / Cash"),
                    "credit_account": ("Contract Liability (Warranty)"),
                    "amount": allocated,
                    "reference": "IFRS 15.B30",
                },
                {
                    "date": "Monthly",
                    "description": ("Release warranty revenue"),
                    "debit_account": ("Contract Liability (Warranty)"),
                    "credit_account": "Warranty Revenue",
                    "amount": monthly,
                    "reference": "IFRS 15.B30",
                },
            ]
            explanation = (
                f"'{data.warranty_description}' is a "
                f"SERVICE-TYPE warranty — a separate "
                f"performance obligation under IFRS 15.B30. "
                + (
                    "The customer can purchase this "
                    "separately, confirming service intent. "
                    if data.customer_can_purchase_separately
                    else "It provides services beyond "
                    "specification assurance. "
                )
                + f"${allocated:,.2f} of the transaction "
                f"price is allocated and recognised over "
                f"{data.warranty_period_months} months "
                f"(${monthly:,.2f}/month). This creates a "
                f"CONTRACT LIABILITY, not an IAS 37 provision."
            )

        else:
            accounting_standard = "JUDGEMENT REQUIRED"
            treatment = (
                "Indicators are mixed. Prepare an accounting "
                "judgement memo. Key question: does the "
                "warranty provide a service BEYOND ensuring "
                "the product meets specifications? If yes "
                "→ service-type (IFRS 15). If no → "
                "assurance-type (IAS 37)."
            )
            provision_required = False
            deferred_revenue = 0.0
            journals = []
            explanation = (
                f"'{data.warranty_description}' requires "
                f"judgement. The indicators are not "
                f"conclusive. Prepare an accounting "
                f"judgement memo and escalate to Controller. "
                f"Key factors to assess: (1) Can the "
                f"customer purchase this separately? "
                f"(2) Does it provide services beyond "
                f"defect correction? (3) Is the period "
                f"extended beyond typical assurance "
                f"({data.warranty_period_months} months)?"
            )

        allocated_for_monthly = (
            (data.allocated_fee if data.allocated_fee > 0 else data.warranty_value)
            if warranty_type == "SERVICE"
            else 0.0
        )
        monthly_release = (
            round(allocated_for_monthly / data.warranty_period_months, 2)
            if warranty_type == "SERVICE" and data.warranty_period_months > 0
            else 0.0
        )

        indicators_detail = {
            "required_by_law": {
                "value": data.required_by_law,
                "supports": ("ASSURANCE" if data.required_by_law else "neutral"),
                "label": ("Required by law (always assurance)"),
            },
            "covers_specs_only": {
                "value": data.covers_specs_only,
                "supports": ("ASSURANCE" if data.covers_specs_only else "SERVICE"),
                "label": ("Covers specification compliance only"),
            },
            "customer_can_purchase_separately": {
                "value": data.customer_can_purchase_separately,
                "supports": ("SERVICE" if data.customer_can_purchase_separately else "neutral"),
                "label": ("Customer can purchase separately"),
            },
            "provides_additional_service": {
                "value": data.provides_additional_service,
                "supports": ("SERVICE" if data.provides_additional_service else "neutral"),
                "label": ("Provides service beyond spec assurance"),
            },
            "extended_period": {
                "value": data.warranty_period_months > 24,
                "supports": ("SERVICE" if data.warranty_period_months > 24 else "neutral"),
                "label": (
                    f"Extended period "
                    f"({data.warranty_period_months} months "
                    f"{'> 24 — service signal' if data.warranty_period_months > 24 else '≤ 24'})"
                ),
            },
        }

        return {
            "warranty_id": data.warranty_id,
            "contract_id": data.contract_id,
            "product_description": data.product_description,
            "warranty_description": data.warranty_description,
            "warranty_type": warranty_type,
            "confidence": confidence,
            "accounting_standard": accounting_standard,
            "provision_required": provision_required,
            "deferred_revenue_amount": deferred_revenue,
            "treatment": treatment,
            "explanation": explanation,
            "indicators_detail": indicators_detail,
            "journal_entries": journals,
            "judgement_memo_required": (warranty_type == "JUDGEMENT_REQUIRED"),
            "ifrs_reference": (
                "IAS 37.14 / IFRS 15.B29"
                if warranty_type == "ASSURANCE"
                else "IFRS 15.B28-B33"
            ),
            "warranty_period_months": data.warranty_period_months,
            "warranty_value": float(data.warranty_value),
            "monthly_release": monthly_release,
        }

    def assess_bill_and_hold(self, data: BillAndHoldInput) -> Dict[str, Any]:
        """
        IFRS 15.B79-B82 — Bill-and-hold arrangements.

        ALL FOUR criteria must be met for revenue
        to be recognised before physical transfer.

        If any criterion fails → DEFER REVENUE
        until physical delivery.
        """
        criteria: Dict[str, Dict[str, Any]] = {
            "a_reason_substantive": {
                "met": data.reason_is_substantive,
                "label": (
                    "a) Reason is substantive "
                    "(customer-requested)"
                ),
                "explanation": (
                    "Met — customer has a genuine "
                    "business reason for the arrangement "
                    "(e.g. storage capacity, production "
                    "scheduling)."
                    if data.reason_is_substantive
                    else "FAILED — The reason for "
                    "bill-and-hold does not appear to be "
                    "substantive or customer-initiated. "
                    "Seller convenience is not sufficient."
                ),
            },
            "b_separately_identified": {
                "met": data.product_separately_identified,
                "label": (
                    "b) Product identified as belonging "
                    "to customer"
                ),
                "explanation": (
                    "Met — product is physically tagged "
                    "or segregated as belonging to this "
                    "specific customer."
                    if data.product_separately_identified
                    else "FAILED — Product is commingled "
                    "with other inventory and cannot be "
                    "identified as belonging to this customer."
                ),
            },
            "c_ready_for_transfer": {
                "met": data.product_ready_for_transfer,
                "label": (
                    "c) Product is ready for "
                    "physical transfer"
                ),
                "explanation": (
                    "Met — product is complete and could "
                    "be immediately delivered if customer "
                    "requested."
                    if data.product_ready_for_transfer
                    else "FAILED — Product is not yet "
                    "ready for transfer (e.g. still in "
                    "production, awaiting quality sign-off)."
                ),
            },
            "d_cannot_redirect": {
                "met": data.entity_cannot_redirect,
                "label": (
                    "d) Entity cannot redirect product "
                    "to another customer"
                ),
                "explanation": (
                    "Met — this product is committed to "
                    "this customer and cannot be sold "
                    "to another party."
                    if data.entity_cannot_redirect
                    else "FAILED — Entity retains ability "
                    "to redirect this product, meaning "
                    "customer does not yet have control."
                ),
            },
        }

        all_met = all(bool(v["met"]) for v in criteria.values())
        failed = [str(v["label"]) for v in criteria.values() if not v["met"]]
        met_count = sum(1 for v in criteria.values() if v["met"])

        if all_met:
            conclusion = "REVENUE_RECOGNISABLE"
            explanation = (
                f"All four IFRS 15.B79 criteria are met "
                f"for '{data.product_description}'. "
                f"Control has transferred to "
                f"{data.customer_name} even though the "
                f"product has not been physically delivered. "
                f"Revenue of ${data.contract_value:,.2f} "
                f"may be recognised on the billing date "
                f"({data.billing_date}). "
                f"Disclose the bill-and-hold arrangement "
                f"in the financial statement notes."
            )
            journals = [
                {
                    "date": data.billing_date,
                    "description": (
                        "Revenue recognised — "
                        "bill-and-hold (all criteria met)"
                    ),
                    "debit_account": "Accounts Receivable",
                    "credit_account": "Revenue",
                    "amount": data.contract_value,
                    "reference": "IFRS 15.B79",
                }
            ]
        else:
            conclusion = "DEFER_UNTIL_DELIVERY"
            explanation = (
                f"{len(failed)} of 4 criteria "
                f"{'is' if len(failed) == 1 else 'are'} "
                f"NOT met for "
                f"'{data.product_description}'. "
                f"Revenue CANNOT be recognised on the "
                f"billing date. Control has not yet "
                f"transferred to {data.customer_name}. "
                f"Revenue of ${data.contract_value:,.2f} "
                f"must be DEFERRED until physical delivery "
                f"on or after {data.expected_delivery_date}. "
                f"\nFailed criteria: "
                + "; ".join(failed)
            )
            journals = [
                {
                    "date": data.billing_date,
                    "description": (
                        "Bill customer — defer revenue "
                        "(criteria not met)"
                    ),
                    "debit_account": "Accounts Receivable",
                    "credit_account": "Contract Liability",
                    "amount": data.contract_value,
                    "reference": "IFRS 15.B79",
                },
                {
                    "date": data.expected_delivery_date,
                    "description": (
                        "Revenue recognised on delivery"
                    ),
                    "debit_account": "Contract Liability",
                    "credit_account": "Revenue",
                    "amount": data.contract_value,
                    "reference": "IFRS 15.38",
                },
            ]

        return {
            "arrangement_id": data.arrangement_id,
            "contract_id": data.contract_id,
            "customer_name": data.customer_name,
            "product_description": data.product_description,
            "contract_value": float(data.contract_value),
            "billing_date": data.billing_date,
            "expected_delivery_date": data.expected_delivery_date,
            "conclusion": conclusion,
            "criteria_met_count": met_count,
            "all_criteria_met": all_met,
            "failed_criteria": failed,
            "revenue_recognisable_now": (
                float(data.contract_value) if all_met else 0.0
            ),
            "revenue_deferred": (
                0.0 if all_met else float(data.contract_value)
            ),
            "earliest_recognition_date": (
                data.billing_date if all_met
                else data.expected_delivery_date
            ),
            "criteria_detail": criteria,
            "explanation": explanation,
            "journal_entries": journals,
            "disclosure_required": all_met,
            "ifrs_reference": "IFRS 15.B79-B82",
        }

    def calculate_financing_component(
        self, data: FinancingComponentInput
    ) -> Dict[str, Any]:
        """
        IFRS 15.60-65 — Significant financing component.

        1. Calculate period between transfer and payment
        2. Apply practical expedient if <= 12 months
        3. Calculate PV of payment using discount rate
        4. Determine revenue amount (PV) and
           financing income/expense (difference)
        5. Build amortisation schedule for
           interest recognition
        """
        transfer_d = datetime.strptime(
            data.transfer_date.strip()[:10], "%Y-%m-%d"
        ).date()
        payment_d = datetime.strptime(
            data.payment_date.strip()[:10], "%Y-%m-%d"
        ).date()

        early, late = (
            (payment_d, transfer_d)
            if payment_d <= transfer_d
            else (transfer_d, payment_d)
        )
        delta = relativedelta(late, early)
        period_months = delta.years * 12 + delta.months
        if delta.days > 0:
            period_months += 1
        period_months = max(int(period_months), 0)

        timing = (data.payment_timing or "").strip().lower()
        if timing not in ("advance", "deferred"):
            timing = "deferred"

        practical_expedient = period_months <= 12
        nominal = float(data.contract_value)

        if practical_expedient:
            return {
                "contract_id": data.contract_id,
                "description": (data.description or "").strip(),
                "payment_timing": timing,
                "practical_expedient_applied": True,
                "period_months": period_months,
                "explanation": (
                    f"Practical expedient applied "
                    f"(IFRS 15.63). The period between "
                    f"transfer ({data.transfer_date}) and "
                    f"payment ({data.payment_date}) is "
                    f"{period_months} months (≤ 12 months). "
                    f"No adjustment for financing component "
                    f"required. Revenue = ${nominal:,.2f}."
                ),
                "revenue_amount": nominal,
                "financing_amount": 0.0,
                "financing_type": "NONE",
                "pv_of_payment": nominal,
                "nominal_payment": nominal,
                "transfer_date": data.transfer_date,
                "payment_date": data.payment_date,
                "amortisation_schedule": [],
                "journal_entries": [
                    {
                        "date": data.transfer_date,
                        "description": "Revenue recognised",
                        "debit_account": "Accounts Receivable",
                        "credit_account": "Revenue",
                        "amount": nominal,
                        "reference": "IFRS 15.63 (expedient)",
                    }
                ],
                "ifrs_reference": "IFRS 15.63",
            }

        period_years = period_months / 12.0 if period_months > 0 else 0.0
        rate = max(float(data.discount_rate), 0.0) / 100.0
        if rate <= 0.0 or period_years <= 0.0:
            pv = round(nominal, 2)
            financing_amount = 0.0
        else:
            pv = round(nominal / ((1.0 + rate) ** period_years), 2)
            financing_amount = round(nominal - pv, 2)

        if timing == "advance":
            financing_type = "INTEREST_EXPENSE"
            revenue_amount = pv
            explanation = (
                f"The customer pays ${nominal:,.2f} "
                f"in ADVANCE ({data.payment_date}), "
                f"{period_months} months before goods/services "
                f"are transferred ({data.transfer_date}). "
                f"The customer is providing financing to "
                f"the entity. Under IFRS 15.62, revenue is "
                f"recognised at the CASH EQUIVALENT selling "
                f"price = PV of ${pv:,.2f}. "
                f"The financing benefit of "
                f"${financing_amount:,.2f} is recognised as "
                f"INTEREST EXPENSE over the advance period "
                f"using the {data.discount_rate}% discount rate."
            )
        else:
            financing_type = "INTEREST_INCOME"
            revenue_amount = pv
            explanation = (
                f"The customer pays ${nominal:,.2f} "
                f"on a DEFERRED basis ({data.payment_date}), "
                f"{period_months} months after goods/services "
                f"are transferred ({data.transfer_date}). "
                f"The entity is providing financing to "
                f"the customer. Under IFRS 15.61, revenue is "
                f"recognised at the PRESENT VALUE = "
                f"${pv:,.2f}. "
                f"The financing component of "
                f"${financing_amount:,.2f} is recognised as "
                f"INTEREST INCOME over the payment period "
                f"using the {data.discount_rate}% discount rate."
            )

        monthly_rate = (1.0 + rate) ** (1.0 / 12.0) - 1.0 if rate > 0 else 0.0
        schedule: List[Dict[str, Any]] = []
        carrying = float(pv)
        period_start = payment_d if timing == "advance" else transfer_d
        current_d = period_start

        for _m in range(max(period_months, 1)):
            opening = round(carrying, 2)
            interest = round(opening * monthly_rate, 2) if monthly_rate > 0 else 0.0
            candidate = round(opening + interest, 2)
            closing = min(candidate, nominal)
            if closing < opening:
                closing = opening
            actual_interest = round(closing - opening, 2)
            schedule.append(
                {
                    "period": current_d.strftime("%Y-%m"),
                    "opening_balance": opening,
                    "interest": actual_interest,
                    "closing_balance": closing,
                }
            )
            carrying = closing
            current_d = current_d + relativedelta(months=1)

        first_interest = float(schedule[0]["interest"]) if schedule else 0.0

        if timing == "advance":
            journals = [
                {
                    "date": data.payment_date,
                    "description": ("Advance payment received"),
                    "debit_account": "Cash",
                    "credit_account": "Contract Liability",
                    "amount": nominal,
                    "reference": "IFRS 15.62",
                },
                {
                    "date": "Monthly (advance period)",
                    "description": "Interest expense accrual",
                    "debit_account": "Interest Expense",
                    "credit_account": "Contract Liability",
                    "amount": first_interest,
                    "note": (
                        "Monthly interest; increases "
                        "contract liability to revenue amount"
                    ),
                    "reference": "IFRS 15.65",
                },
                {
                    "date": data.transfer_date,
                    "description": "Revenue recognised",
                    "debit_account": "Contract Liability",
                    "credit_account": "Revenue",
                    "amount": nominal,
                    "reference": "IFRS 15.62",
                },
            ]
        else:
            journals = [
                {
                    "date": data.transfer_date,
                    "description": "Revenue at PV amount",
                    "debit_account": "Contract Asset / AR",
                    "credit_account": "Revenue",
                    "amount": pv,
                    "reference": "IFRS 15.61",
                },
                {
                    "date": "Monthly (deferred period)",
                    "description": "Interest income accrual",
                    "debit_account": "Contract Asset / AR",
                    "credit_account": "Interest Income",
                    "amount": first_interest,
                    "note": (
                        "Monthly interest; increases "
                        "receivable to nominal payment amount"
                    ),
                    "reference": "IFRS 15.65",
                },
                {
                    "date": data.payment_date,
                    "description": "Cash received",
                    "debit_account": "Cash",
                    "credit_account": "Contract Asset / AR",
                    "amount": nominal,
                    "reference": "IFRS 15.61",
                },
            ]

        return {
            "contract_id": data.contract_id,
            "description": (data.description or "").strip(),
            "payment_timing": timing,
            "practical_expedient_applied": False,
            "period_months": period_months,
            "financing_type": financing_type,
            "nominal_payment": nominal,
            "pv_of_payment": pv,
            "revenue_amount": revenue_amount,
            "financing_amount": financing_amount,
            "discount_rate_pct": float(data.discount_rate),
            "explanation": explanation,
            "amortisation_schedule": schedule,
            "journal_entries": journals,
            "ifrs_reference": "IFRS 15.60-65",
            "transfer_date": data.transfer_date,
            "payment_date": data.payment_date,
        }

    def calculate_non_cash_consideration(
        self, items: List[NonCashConsiderationInput]
    ) -> Dict[str, Any]:
        """
        IFRS 15.66-69 — Non-cash consideration.
        Measure at FV at contract inception. If FV not reliably estimable → use SSP.
        """
        results: List[Dict[str, Any]] = []
        total_tp_adjustment = 0.0

        for item in items:
            fv_ok = bool(item.fair_value_determinable)
            fv = float(item.fair_value or 0)
            ssp = float(item.fallback_ssp or 0)
            ctype = (item.consideration_type or "other").strip().lower()

            if fv_ok:
                tp_addition = round(fv, 2)
                method = "FAIR_VALUE"
                explanation = (
                    f"Non-cash consideration ({ctype}) measured at fair value of "
                    f"${tp_addition:,.2f} at contract inception per IFRS 15.66. "
                    f"Included in transaction price."
                )
            else:
                tp_addition = round(ssp, 2)
                method = "SSP_FALLBACK"
                explanation = (
                    f"Fair value of non-cash consideration ({ctype}) cannot be "
                    f"reliably estimated. Per IFRS 15.67, using the standalone selling "
                    f"price of the promised goods/services as a proxy: ${tp_addition:,.2f}."
                )

            total_tp_adjustment += tp_addition
            results.append(
                {
                    "item_id": item.item_id,
                    "contract_id": item.contract_id,
                    "description": item.description,
                    "consideration_type": ctype,
                    "measurement_method": method,
                    "transaction_price_addition": tp_addition,
                    "explanation": explanation,
                    "journal_entries": [
                        {
                            "date": "Contract inception",
                            "description": f"Non-cash consideration received ({ctype})",
                            "debit_account": "Asset / Resource Received",
                            "credit_account": "Revenue",
                            "amount": tp_addition,
                            "reference": "IFRS 15.66-67",
                        }
                    ],
                    "ifrs_reference": "IFRS 15.66-69",
                    "currency": item.currency or "USD",
                }
            )

        return {
            "items": results,
            "total_tp_from_non_cash": round(total_tp_adjustment, 2),
            "ifrs_reference": "IFRS 15.66-69",
        }

    def calculate_consideration_payable(
        self, items: List[ConsiderationPayableInput]
    ) -> Dict[str, Any]:
        """
        IFRS 15.70-72 — Consideration payable to customer.
        """
        results: List[Dict[str, Any]] = []
        total_revenue_reduction = 0.0
        total_cost = 0.0

        for item in items:
            amt = float(item.amount or 0)
            fv_ben = float(item.fair_value_of_benefit or 0)
            distinct = bool(item.distinct_benefit_received)
            ptype = (item.payment_type or "cash").strip().lower()

            if not distinct:
                revenue_reduction = round(amt, 2)
                cost_recognition = 0.0
                treatment = "REVENUE_REDUCTION"
                explanation = (
                    f"${amt:,.2f} payable to the customer ({item.description}) reduces the "
                    f"transaction price. No distinct benefit is received by the entity in return. "
                    f"Per IFRS 15.70, this is NOT a cost — it is a reduction of revenue. "
                    f"Recognised when the later of: (a) entity recognises revenue, or "
                    f"(b) entity pays/promises to pay."
                )
                journals = [
                    {
                        "date": "When revenue recognised or payment made",
                        "description": "Consideration payable to customer — revenue reduction",
                        "debit_account": "Revenue",
                        "credit_account": "Accounts Payable / Cash",
                        "amount": amt,
                        "reference": "IFRS 15.70",
                    }
                ]
            else:
                if fv_ben + 1e-9 >= amt:
                    cost_recognition = round(amt, 2)
                    revenue_reduction = 0.0
                    treatment = "COST_FULL"
                    explanation = (
                        f"The entity receives a distinct benefit from the customer with "
                        f"fair value ${fv_ben:,.2f} ≥ payment of ${amt:,.2f}. "
                        f"Per IFRS 15.72, the full ${amt:,.2f} is recognised as a COST, "
                        f"not a revenue reduction."
                    )
                    journals = [
                        {
                            "date": "When benefit received",
                            "description": "Customer consideration — marketing/service cost",
                            "debit_account": "Marketing / Service Expense",
                            "credit_account": "Accounts Payable / Cash",
                            "amount": amt,
                            "reference": "IFRS 15.72",
                        }
                    ]
                else:
                    cost_recognition = round(fv_ben, 2)
                    revenue_reduction = round(amt - fv_ben, 2)
                    treatment = "COST_PLUS_REVENUE_REDUCTION"
                    explanation = (
                        f"Fair value of benefit received (${fv_ben:,.2f}) is less than the "
                        f"payment (${amt:,.2f}). Per IFRS 15.72: ${fv_ben:,.2f} recognised as COST; "
                        f"excess ${revenue_reduction:,.2f} reduces revenue."
                    )
                    journals = [
                        {
                            "date": "When benefit received",
                            "description": "Cost portion",
                            "debit_account": "Marketing Expense",
                            "credit_account": "Cash / Payable",
                            "amount": fv_ben,
                            "reference": "IFRS 15.72",
                        },
                        {
                            "date": "When revenue recognised",
                            "description": "Excess reduces revenue",
                            "debit_account": "Revenue",
                            "credit_account": "Cash / Payable",
                            "amount": revenue_reduction,
                            "reference": "IFRS 15.72",
                        },
                    ]

            total_revenue_reduction += revenue_reduction
            total_cost += cost_recognition
            results.append(
                {
                    "item_id": item.item_id,
                    "contract_id": item.contract_id,
                    "description": item.description,
                    "payment_type": ptype,
                    "amount": amt,
                    "treatment": treatment,
                    "revenue_reduction": revenue_reduction,
                    "cost_recognition": cost_recognition,
                    "explanation": explanation,
                    "journal_entries": journals,
                    "ifrs_reference": "IFRS 15.70-72",
                    "currency": item.currency or "USD",
                }
            )

        return {
            "items": results,
            "total_revenue_reduction": round(total_revenue_reduction, 2),
            "total_cost_recognition": round(total_cost, 2),
            "ifrs_reference": "IFRS 15.70-72",
        }

    def create_audit_entry(
        self,
        action: str,
        contract_id: str,
        description: str,
        before_value: Dict[str, Any],
        after_value: Dict[str, Any],
        ifrs_reference: str,
        user: str = "System",
        materiality_threshold: float = 10000.0,
        changed_amount: float = 0.0,
    ) -> Dict[str, Any]:
        """Creates a single audit trail entry; sign-off flagged by materiality or sensitive actions."""
        from datetime import timezone

        sign_off_required = abs(float(changed_amount or 0)) >= float(materiality_threshold) or action in (
            "OVERRIDE",
            "REVERSAL",
        )
        return {
            "entry_id": str(uuid.uuid4())[:8].upper(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "user": user,
            "action": action,
            "contract_id": contract_id,
            "description": description,
            "before_value": dict(before_value or {}),
            "after_value": dict(after_value or {}),
            "ifrs_reference": ifrs_reference,
            "sign_off_required": bool(sign_off_required),
            "signed_off_by": "",
            "signed_off_at": "",
            "notes": "",
        }

    def sign_off_entry(self, entry: Dict[str, Any], reviewer: str, notes: str = "") -> Dict[str, Any]:
        from datetime import timezone

        entry["signed_off_by"] = reviewer
        entry["signed_off_at"] = datetime.now(timezone.utc).isoformat()
        entry["notes"] = notes or ""
        return entry

    def calculate_transaction_price(self, contract: IFRS15Input) -> Decimal:
        """
        IFRS 15 Step 3: Determine transaction price.
        Variable consideration is constrained per §56–58 before inclusion.
        """
        vc_raw = contract.variable_consideration
        factor_result = self.apply_vc_constraint(
            float(vc_raw),
            contract.vc_constraint_factors or {},
            currency=contract.currency,
        )
        vc_from_factors = Decimal(str(factor_result["constrained_amount"])).quantize(
            Decimal("0.01")
        )
        legacy_constrained = self.apply_variable_consideration_constraint(contract)
        constrained_vc = min(vc_from_factors, legacy_constrained)

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
        d = (ob.description or "").lower()
        if self._parse_named_calendar_months(ob.description or ""):
            return "training" in d or "session" in d
        if ob.recognition_method != "point_in_time":
            return False
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
        ob_meta: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> None:
        num_sessions, freq_months = self._session_count_and_frequency_months(ob)
        meta = (ob_meta or {}).get(ob.obligation_id, {})
        session_start = self._resolve_obligation_start(ob, contract, meta)
        explicit_dates = self._parse_training_session_dates(ob, contract, num_sessions)
        contract_start = self._contract_start_date(contract)
        today = date.today()
        running = Decimal("0")
        per = (allocated_amount / Decimal(str(num_sessions))).quantize(self.precision, ROUND_HALF_UP)
        for sn in range(1, num_sessions + 1):
            if sn == num_sessions:
                amt = (allocated_amount - running).quantize(self.precision, ROUND_HALF_UP)
            else:
                amt = per
                running += amt
            if explicit_dates and sn - 1 < len(explicit_dates):
                session_date = explicit_dates[sn - 1]
            else:
                session_date = session_start + relativedelta(months=freq_months * (sn - 1))
            session_dt = datetime(session_date.year, session_date.month, session_date.day)
            period_is_recognized = session_date <= today
            schedule.append(
                {
                    "Period": self._months_between(contract_start, session_date) + 1,
                    "Date": session_dt.strftime("%Y-%m-%d"),
                    "Month": session_dt.strftime("%b %Y"),
                    "Obligation_ID": ob.obligation_id,
                    "Obligation": f"{ob.description} — Session {sn}",
                    "Method": "Point In Time (sessions)",
                    "Scheduled_Revenue": float(amt),
                    "Revenue": float(amt) if period_is_recognized else 0.0,
                    "Status": "Recognised" if period_is_recognized else "Deferred",
                    "Cumulative": 0,
                }
            )

    _MONTH_NAME_PATTERN = (
        r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
        r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
    )

    def _month_token_to_number(self, token: str) -> int:
        key = (token or "").strip().lower()[:3]
        return {
            "jan": 1,
            "feb": 2,
            "mar": 3,
            "apr": 4,
            "may": 5,
            "jun": 6,
            "jul": 7,
            "aug": 8,
            "sep": 9,
            "oct": 10,
            "nov": 11,
            "dec": 12,
        }.get(key, 0)

    def _parse_month_year_tokens(
        self, text: str, *, exclude_service_start_months: bool = True
    ) -> List[date]:
        """Extract ordered month+year dates; skip 'from January 2024' service-start phrases."""
        t = (text or "").lower()
        per_month: List[Tuple[str, str]] = []
        for m in re.finditer(
            rf"({self._MONTH_NAME_PATTERN})\s+(\d{{4}})",
            t,
            re.I,
        ):
            if exclude_service_start_months:
                prefix = t[max(0, m.start() - 10) : m.start()]
                if re.search(r"\bfrom\s*$", prefix, re.I):
                    continue
            per_month.append((m.group(1), m.group(2)))
        if len(per_month) >= 2:
            dates: List[date] = []
            for name, year_s in per_month:
                month_num = self._month_token_to_number(name)
                if month_num:
                    dates.append(date(int(year_s), month_num, 1))
            return dates
        shared = re.search(
            rf"((?:{self._MONTH_NAME_PATTERN})(?:\s+and\s+(?:{self._MONTH_NAME_PATTERN})){{0,5}})\s+(\d{{4}})",
            t,
            re.I,
        )
        if shared:
            year = int(shared.group(2))
            dates = []
            for name in re.findall(self._MONTH_NAME_PATTERN, shared.group(1), re.I):
                month_num = self._month_token_to_number(name)
                if month_num:
                    dates.append(date(year, month_num, 1))
            if dates:
                return dates
        if len(per_month) == 1:
            name, year_s = per_month[0]
            month_num = self._month_token_to_number(name)
            if month_num:
                return [date(int(year_s), month_num, 1)]
        return []

    def _parse_named_calendar_months(self, text: str) -> List[date]:
        """Parse delivery months from descriptions (order preserved).

        Supports:
        - 'June and August 2024'
        - 'June 2024 and August 2024' (per-month year — common in extraction)
        - 'delivered June 2024 and August 2024'
        """
        t = (text or "").lower()
        for pat in (
            r"(?:\d{1,2}\s*sessions?\s+)?delivered\s+(?:in\s+)?([^.;,\n]+)",
            r"sessions?\s+(?:in|on|during)\s+([^.;,\n]+)",
            r"delivery\s+(?:in|on|during|dates?\s*:?\s*)([^.;,\n]+)",
        ):
            m = re.search(pat, t, re.I)
            if m:
                parsed = self._parse_month_year_tokens(m.group(1))
                if parsed:
                    return parsed
        return self._parse_month_year_tokens(t)

    def _parse_obligation_start_from_text(
        self, text: str, contract: IFRS15Input
    ) -> Optional[date]:
        """Service start or first session delivery month from obligation text."""
        t = (text or "").lower()
        if "session" in t or "training" in t:
            delivery_months = self._parse_named_calendar_months(text)
            if delivery_months:
                return delivery_months[0]
        range_m = re.search(
            rf"({self._MONTH_NAME_PATTERN})\s+(\d{{4}})\s+to\s+"
            rf"(?:{self._MONTH_NAME_PATTERN})\s+(\d{{4}})",
            t,
            re.I,
        )
        if range_m:
            month_num = self._month_token_to_number(range_m.group(1))
            if month_num:
                return date(int(range_m.group(2)), month_num, 1)
        m = re.search(
            rf"(?:from|starting|commencing)\s+({self._MONTH_NAME_PATTERN})\s+(\d{{4}})",
            t,
            re.I,
        )
        if m:
            month_num = self._month_token_to_number(m.group(1))
            if month_num:
                return date(int(m.group(2)), month_num, 1)
        return None

    def _is_point_in_time_delivery_obligation(self, ob: PerformanceObligation) -> bool:
        """Handover / completion / delivery phrases imply point-in-time (not straight-line)."""
        d = (ob.description or "").lower()
        if re.search(r"(?:delivered\s+)?(?:over|for|within)\s+\d+\s+months?", d):
            return False
        return bool(
            re.search(
                r"\bat\s+handover\b|\bon\s+completion\b|\bon\s+delivery\b|"
                r"\bat\s+handover\s+on\s+completion\b|\bdelivered\s+at\s+handover\b|"
                r"\bupon\s+completion\b|\bwhen\s+completed\b",
                d,
            )
        )

    def _latest_delivery_obligation_end(self, contract: IFRS15Input, exclude_id: str = "") -> Optional[date]:
        """Last month of the longest over-time delivery PO (e.g. fit-out ending August)."""
        best: Optional[date] = None
        for ob in contract.performance_obligations:
            if ob.obligation_id == exclude_id:
                continue
            if self._is_support_obligation(ob) or self._is_license_obligation(ob):
                continue
            if self._is_multi_session_training_obligation(ob):
                continue
            d = (ob.description or "").lower()
            if "training" in d and "session" in d:
                continue
            method = (ob.recognition_method or "").lower()
            if method == "point_in_time" and not self._is_point_in_time_delivery_obligation(ob):
                continue
            start = self._resolve_obligation_start(ob, contract, {})
            months = self._resolve_obligation_duration(ob, contract)
            if months <= 0:
                continue
            end = start + relativedelta(months=months - 1)
            if best is None or end > best:
                best = end
        return best

    def _as_datetime(self, value: Any) -> Optional[datetime]:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        if isinstance(value, date):
            return datetime(value.year, value.month, value.day)
        return None

    def _resolve_pit_recognition_date(
        self, ob: PerformanceObligation, contract: IFRS15Input
    ) -> Optional[datetime]:
        """Single source for point-in-time transfer / recognition date (obligation text only)."""
        for raw in (ob.recognition_date, ob.transfer_date):
            dt = self._as_datetime(raw)
            if dt:
                return dt

        desc = ob.description or ""
        low = desc.lower()

        m = re.search(
            r"handover\s+date\s*[:\-]?\s*(\d{1,2}\s+[a-z]+\s+\d{4}|\d{4}-\d{2}-\d{2})",
            low,
            re.I,
        )
        if m:
            parsed = self._parse_date_from_text(m.group(1))
            if parsed:
                return datetime(parsed.year, parsed.month, parsed.day)

        for pat in (
            rf"(?:at\s+handover|on\s+completion|on\s+delivery|delivered\s+at\s+handover)[^.]*?"
            rf"\b({self._MONTH_NAME_PATTERN})\s+(\d{{4}})",
            rf"\b({self._MONTH_NAME_PATTERN})\s+(\d{{4}})\s*(?:handover|completion)\b",
        ):
            hm = re.search(pat, low, re.I)
            if hm:
                month_num = self._month_token_to_number(hm.group(1))
                if month_num:
                    return datetime(int(hm.group(2)), month_num, 1)

        if "handover" in low or "completion" in low:
            parsed = self._parse_date_from_text(desc)
            if parsed:
                return datetime(parsed.year, parsed.month, parsed.day)

        if self._is_point_in_time_delivery_obligation(ob):
            months = self._parse_named_calendar_months(desc)
            if months:
                last = months[-1]
                return datetime(last.year, last.month, last.day)

        fallback = self._latest_delivery_obligation_end(contract, exclude_id=ob.obligation_id)
        if fallback:
            return datetime(fallback.year, fallback.month, fallback.day)
        return None

    def _infer_handover_transfer_date(
        self, ob: PerformanceObligation, contract: IFRS15Input
    ) -> Optional[date]:
        dt = self._resolve_pit_recognition_date(ob, contract)
        if dt:
            return dt.date() if hasattr(dt, "date") else dt
        return None

    def _parse_training_session_dates(
        self,
        ob: PerformanceObligation,
        contract: IFRS15Input,
        num_sessions: int,
    ) -> List[date]:
        named = self._parse_named_calendar_months(ob.description or "")
        if len(named) >= num_sessions:
            return named[:num_sessions]
        if len(named) >= 2:
            return named
        return []

    def _parse_duration_from_text(self, text: str, default: int = 0) -> int:
        """Parse obligation duration from description (e.g. 'over 3 months', '12 months from go-live')."""
        t = (text or "").lower()
        for pat in (
            r"(?:delivered\s+)?(?:over|for|within)\s+(\d+)\s+months?",
            r"(\d{1,2})[- ]months?\s+(?:maintenance|contract|support|service)?",
            r"(\d+)\s+months?\s+from\s+go[- ]?live",
            r"(\d+)\s+months?\s+from\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)",
            r"(\d+)\s+month\s+(?:term|period)",
        ):
            m = re.search(pat, t, re.I)
            if m:
                return max(1, int(m.group(1)))
        return default

    def _contract_start_date(self, contract: IFRS15Input) -> date:
        eff = contract.effective_date
        return eff.date() if isinstance(eff, datetime) else eff

    def _resolve_obligation_start(
        self,
        ob: PerformanceObligation,
        contract: IFRS15Input,
        meta: Dict[str, Any],
    ) -> date:
        desc = ob.description or ""
        explicit = self._parse_obligation_start_from_text(desc, contract)
        if explicit:
            return explicit
        if ob.obligation_start_date:
            dt = ob.obligation_start_date
            return dt.date() if isinstance(dt, datetime) else dt
        for key in ("obligation_start_date", "support_start_date"):
            raw = meta.get(key)
            if raw:
                try:
                    return datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
                except ValueError:
                    pass
        text = desc.lower()
        if "session" in text or "training" in text:
            delivery_months = self._parse_named_calendar_months(desc)
            if delivery_months:
                return delivery_months[0]
        if (
            self._is_license_obligation(ob)
            or self._is_support_obligation(ob)
            or "from go-live" in text
            or "from go live" in text
            or "post go-live" in text
            or "post go live" in text
        ):
            gl = self._infer_go_live_date(ob, contract)
            if gl:
                return gl.date() if isinstance(gl, datetime) else gl
        return self._contract_start_date(contract)

    def _resolve_obligation_duration(self, ob: PerformanceObligation, contract: IFRS15Input) -> int:
        parsed = self._parse_duration_from_text(ob.description, 0)
        if parsed > 0:
            return parsed
        if int(ob.duration_months or 0) > 0:
            return int(ob.duration_months)
        if self._is_implementation_obligation(ob):
            return 3
        if self._is_license_obligation(ob) or self._is_support_obligation(ob):
            return 12
        return max(int(contract.contract_term_months or 0), 1)

    def _is_license_obligation(self, ob: PerformanceObligation) -> bool:
        d = (ob.description or "").lower()
        oid = (ob.obligation_id or "").lower()
        return bool(
            re.search(
                r"\b(software\s+)?licen[cs]e\b|licence\s+of\s+ip|ip\s+licen[cs]e|perpetual\s+licen[cs]e|subscription\s+licen[cs]e",
                d,
            )
            or "license" in oid
            or "licence" in oid
        )

    def _is_support_obligation(self, ob: PerformanceObligation) -> bool:
        d = (ob.description or "").lower()
        return bool(
            re.search(
                r"\b(support|maintenance|help\s*desk|technical\s+support|customer\s+support)\b",
                d,
            )
        )

    def _support_starts_post_implementation(self, contract: IFRS15Input, ob: PerformanceObligation) -> bool:
        text = " ".join(
            [
                ob.description or "",
                contract.payment_terms or "",
                " ".join(o.description for o in contract.performance_obligations),
            ]
        ).lower()
        return bool(
            re.search(
                r"support\s+commenc(es|ing)\s+post\s+go[- ]?live|"
                r"commenc(es|ing)\s+post\s+go[- ]?live|"
                r"after\s+(go[- ]?live|implementation)|"
                r"following\s+implementation|"
                r"post[- ]?implementation|"
                r"support\s+commenc(es|ing)\s+(after|following)\s+implementation",
                text,
            )
        )

    def _is_implementation_obligation(self, ob: PerformanceObligation) -> bool:
        d = (ob.description or "").lower()
        return bool(
            re.search(
                r"\b(implementation|customi[sz]ation|deployment|installation|integration|onboarding)\b",
                d,
            )
        )

    def _is_migration_obligation(self, ob: PerformanceObligation) -> bool:
        return "migration" in (ob.description or "").lower()

    def _implementation_completion_date(self, contract: IFRS15Input) -> Optional[date]:
        """Latest implementation PO end date (start + duration), else None."""
        best: Optional[date] = None
        for ob in contract.performance_obligations:
            if not self._is_implementation_obligation(ob):
                continue
            start = self._resolve_obligation_start(ob, contract, {})
            months = self._resolve_obligation_duration(ob, contract)
            end = start + relativedelta(months=max(months - 1, 0))
            if best is None or end > best:
                best = end
        return best

    def _parse_date_from_text(self, text: str) -> Optional[date]:
        if not text:
            return None
        for pat in (
            r"(\d{4}-\d{2}-\d{2})",
            r"(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})",
        ):
            m = re.search(pat, text, re.I)
            if not m:
                continue
            raw = m.group(1).strip()
            try:
                return datetime.strptime(raw[:10], "%Y-%m-%d").date()
            except ValueError:
                pass
            try:
                return datetime.strptime(raw, "%d %b %Y").date()
            except ValueError:
                try:
                    return datetime.strptime(raw, "%d %B %Y").date()
                except ValueError:
                    continue
        return None

    def _infer_go_live_date(
        self,
        ob: PerformanceObligation,
        contract: IFRS15Input,
        *,
        obligation_only: bool = False,
    ) -> Optional[datetime]:
        if ob.recognition_date:
            return self._as_datetime(ob.recognition_date)
        if ob.transfer_date:
            return ob.transfer_date
        blob = (ob.description or "").lower()
        if not obligation_only:
            for other in contract.performance_obligations:
                if other.obligation_id != ob.obligation_id:
                    blob += " " + (other.description or "").lower()
            blob += " " + (contract.payment_terms or "").lower()
        for phrase in (
            r"go[- ]?live\s*(?:date)?\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})",
            r"live\s+date\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})",
            r"accessible\s+(?:from|on)\s+(\d{4}-\d{2}-\d{2})",
            r"grant\s+date\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})",
        ):
            m = re.search(phrase, blob, re.I)
            if m:
                try:
                    return datetime.strptime(m.group(1), "%Y-%m-%d")
                except ValueError:
                    pass
        parsed = self._parse_date_from_text(blob)
        if parsed:
            return datetime(parsed.year, parsed.month, parsed.day)
        impl_end = self._implementation_completion_date(contract)
        if impl_end:
            return datetime(impl_end.year, impl_end.month, impl_end.day)
        eff = contract.effective_date
        return eff if isinstance(eff, datetime) else datetime(eff.year, eff.month, eff.day)

    def _classify_license_b58(
        self, ob: PerformanceObligation, contract: IFRS15Input
    ) -> Dict[str, Any]:
        """
        IFRS 15.B58–B63 — right-to-use (point in time) vs right-to-access (over time).
        """
        text = (ob.description or "").lower()
        for other in contract.performance_obligations:
            text += " " + (other.description or "").lower()
        text += " " + (contract.payment_terms or "").lower()

        access_hits = 0
        for pat in (
            r"right[- ]?to[- ]?access",
            r"ongoing\s+activities",
            r"entity\s+activities\s+affect",
            r"updates?\s+to\s+the\s+ip",
            r"dynamic\s+content",
            r"saas\b",
            r"cloud\s+access",
            r"subscription\s+with\s+updates",
        ):
            if re.search(pat, text, re.I):
                access_hits += 1

        use_hits = 0
        for pat in (
            r"right[- ]?to[- ]?use",
            r"perpetual",
            r"static\s+licen[cs]e",
            r"go[- ]?live",
            r"upon\s+(signing|contract\s+signing|delivery|grant)",
            r"made\s+accessible",
            r"point\s+in\s+time",
        ):
            if re.search(pat, text, re.I):
                use_hits += 1

        b58a = bool(re.search(r"entity.*activities.*affect|ongoing\s+activities", text, re.I))
        b58b = bool(re.search(r"exposed.*effect|positive.*negative.*effect", text, re.I))
        b58c = bool(
            re.search(
                r"no\s+separate\s+function|standalone\s+functionality|without\s+entity",
                text,
                re.I,
            )
        )

        if b58a and b58b and b58c and access_hits >= use_hits:
            classification = "right-to-access"
            confidence = min(95, 72 + access_hits * 6 + (3 if b58a and b58b and b58c else 0))
        elif use_hits > 0 or access_hits == 0:
            classification = "right-to-use"
            confidence = min(95, 78 + use_hits * 5)
        elif access_hits > use_hits:
            classification = "right-to-access"
            confidence = min(88, 65 + access_hits * 5)
        else:
            classification = "right-to-use"
            confidence = 70

        review_recommended = confidence < 85 or classification == "right-to-access"
        return {
            "license_classification": classification,
            "confidence": int(confidence),
            "review_recommended": review_recommended,
        }

    def _resolve_license_obligation(
        self, ob: PerformanceObligation, contract: IFRS15Input
    ) -> Tuple[PerformanceObligation, Dict[str, Any]]:
        meta = self._classify_license_b58(ob, contract)
        text = (ob.description or "").lower()
        go_live = self._infer_go_live_date(ob, contract)
        duration_parsed = self._parse_duration_from_text(ob.description, 0)
        saas_like = bool(re.search(r"\bsaas\b|software as a service|subscription", text))

        # SaaS / subscription licences: over time from go-live for stated term (IFRS 15.B58 access)
        if saas_like or duration_parsed > 0 or "from go-live" in text or "from go live" in text:
            method = "over_time"
            duration = duration_parsed or max(int(ob.duration_months or 0), 12)
            transfer = None
            if go_live:
                meta["obligation_start_date"] = (
                    go_live.date() if isinstance(go_live, datetime) else go_live
                ).isoformat()
            meta["license_classification"] = "right-to-access"
        elif meta["license_classification"] == "right-to-access":
            method = "over_time"
            duration = duration_parsed or max(int(ob.duration_months or 0), 12)
            transfer = None
            if go_live:
                meta["obligation_start_date"] = (
                    go_live.date() if isinstance(go_live, datetime) else go_live
                ).isoformat()
        else:
            method = "point_in_time"
            duration = 0
            transfer = go_live
        return (
            PerformanceObligation(
                obligation_id=ob.obligation_id,
                description=ob.description,
                standalone_selling_price=ob.standalone_selling_price,
                recognition_method=method,
                duration_months=duration,
                transfer_date=transfer,
                obligation_start_date=go_live if meta.get("obligation_start_date") else ob.obligation_start_date,
                completion_percentage=ob.completion_percentage,
            ),
            meta,
        )

    def _resolve_obligations_for_schedule(
        self, contract: IFRS15Input
    ) -> Tuple[List[PerformanceObligation], Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
        resolved: List[PerformanceObligation] = []
        per_ob_meta: Dict[str, Dict[str, Any]] = {}
        license_analysis: List[Dict[str, Any]] = []

        for ob in contract.performance_obligations:
            meta: Dict[str, Any] = {}
            working = ob
            if self._is_license_obligation(ob):
                working, meta = self._resolve_license_obligation(ob, contract)
                license_analysis.append(
                    {
                        "obligation_id": ob.obligation_id,
                        "description": ob.description,
                        **meta,
                    }
                )
            elif self._is_support_obligation(ob):
                explicit_start = self._parse_obligation_start_from_text(ob.description or "", contract)
                if explicit_start:
                    meta["obligation_start_date"] = explicit_start.isoformat()
                    working = PerformanceObligation(
                        obligation_id=working.obligation_id,
                        description=working.description,
                        standalone_selling_price=working.standalone_selling_price,
                        recognition_method=working.recognition_method,
                        duration_months=working.duration_months,
                        transfer_date=working.transfer_date,
                        recognition_date=working.recognition_date,
                        obligation_start_date=datetime(
                            explicit_start.year, explicit_start.month, explicit_start.day
                        ),
                        completion_percentage=working.completion_percentage,
                    )
                elif self._support_starts_post_implementation(contract, ob):
                    impl_end = self._implementation_completion_date(contract)
                    if impl_end:
                        meta["support_start_date"] = impl_end.isoformat()
                else:
                    gl = self._infer_go_live_date(ob, contract, obligation_only=True)
                    if gl:
                        meta["obligation_start_date"] = (
                            gl.date() if isinstance(gl, datetime) else gl
                        ).isoformat()
            if self._is_migration_obligation(working) and working.recognition_method == "point_in_time" and not (
                working.recognition_date or working.transfer_date
            ):
                mig_date = self._contract_start_date(contract) + relativedelta(months=1)
                mig_dt = datetime(mig_date.year, mig_date.month, mig_date.day)
                working = PerformanceObligation(
                    obligation_id=working.obligation_id,
                    description=working.description,
                    standalone_selling_price=working.standalone_selling_price,
                    recognition_method=working.recognition_method,
                    duration_months=0,
                    recognition_date=mig_dt,
                    transfer_date=mig_dt,
                    obligation_start_date=working.obligation_start_date,
                    completion_percentage=working.completion_percentage,
                )
            if self._is_point_in_time_delivery_obligation(working) or (
                (working.recognition_method or "").lower() == "point_in_time"
                and not self._is_multi_session_training_obligation(working)
            ):
                rec_dt = self._resolve_pit_recognition_date(working, contract)
                if rec_dt:
                    working = PerformanceObligation(
                        obligation_id=working.obligation_id,
                        description=working.description,
                        standalone_selling_price=working.standalone_selling_price,
                        recognition_method="point_in_time",
                        duration_months=0,
                        recognition_date=rec_dt,
                        transfer_date=rec_dt,
                        obligation_start_date=working.obligation_start_date,
                        completion_percentage=working.completion_percentage,
                    )
            explicit_start = self._parse_obligation_start_from_text(working.description or "", contract)
            if explicit_start:
                meta["obligation_start_date"] = explicit_start.isoformat()
            working = PerformanceObligation(
                obligation_id=working.obligation_id,
                description=working.description,
                standalone_selling_price=working.standalone_selling_price,
                recognition_method=working.recognition_method,
                duration_months=working.duration_months or self._resolve_obligation_duration(working, contract),
                transfer_date=working.transfer_date,
                recognition_date=working.recognition_date,
                obligation_start_date=working.obligation_start_date,
                completion_percentage=working.completion_percentage,
            )
            if working.duration_months <= 0:
                working = PerformanceObligation(
                    obligation_id=working.obligation_id,
                    description=working.description,
                    standalone_selling_price=working.standalone_selling_price,
                    recognition_method=working.recognition_method,
                    duration_months=self._resolve_obligation_duration(working, contract),
                    transfer_date=working.transfer_date,
                    recognition_date=working.recognition_date,
                    obligation_start_date=working.obligation_start_date,
                    completion_percentage=working.completion_percentage,
                )
            resolved.append(working)
            if meta:
                per_ob_meta[ob.obligation_id] = meta

        return resolved, per_ob_meta, license_analysis

    def generate_recognition_schedule(
        self,
        contract: IFRS15Input,
        allocations: Dict[str, Decimal]
    ) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
        """
        Step 5: Generate revenue recognition schedule

        Each obligation is spread over its own duration and start date (go-live, support start, etc.),
        not uniformly over the contract term.
        """
        schedule: List[Dict[str, Any]] = []
        today = date.today()
        contract_start = self._contract_start_date(contract)
        obligations, ob_meta, license_analysis = self._resolve_obligations_for_schedule(contract)

        horizon_end = contract_start + relativedelta(months=max(int(contract.contract_term_months or 12), 1) - 1)
        for ob in obligations:
            if self._is_multi_session_training_obligation(ob):
                num_sessions, freq_months = self._session_count_and_frequency_months(ob)
                ob_start = self._resolve_obligation_start(ob, contract, ob_meta.get(ob.obligation_id, {}))
                last_session = ob_start + relativedelta(months=freq_months * max(num_sessions - 1, 0))
                if last_session > horizon_end:
                    horizon_end = last_session
                continue
            meta = ob_meta.get(ob.obligation_id, {})
            ob_start = self._resolve_obligation_start(ob, contract, meta)
            if ob.recognition_method == "over_time":
                duration = max(int(ob.duration_months or 0), 1)
                ob_end = ob_start + relativedelta(months=duration - 1)
                if ob_end > horizon_end:
                    horizon_end = ob_end
            elif ob.recognition_method == "point_in_time":
                rec_dt = self._as_datetime(ob.recognition_date or ob.transfer_date)
                if rec_dt:
                    t_day = rec_dt.date()
                    if t_day > horizon_end:
                        horizon_end = t_day

        month_cursor = contract_start
        while month_cursor <= horizon_end:
            month_day = month_cursor
            month_date = datetime(month_day.year, month_day.month, month_day.day)
            period = self._months_between(contract_start, month_day) + 1

            for ob in obligations:
                if self._is_multi_session_training_obligation(ob):
                    continue
                allocated_amount = allocations[ob.obligation_id]
                meta = ob_meta.get(ob.obligation_id, {})
                ob_start = self._resolve_obligation_start(ob, contract, meta)
                planned_revenue = Decimal("0")

                if ob.recognition_method == "over_time":
                    duration = max(int(ob.duration_months or 0), 1)
                    if month_day >= ob_start:
                        months_into = self._months_between(ob_start, month_day) + 1
                        if 1 <= months_into <= duration:
                            planned_revenue = (
                                allocated_amount / Decimal(str(duration))
                            ).quantize(self.precision, ROUND_HALF_UP)
                elif ob.recognition_method == "point_in_time":
                    rec_dt = self._as_datetime(ob.recognition_date or ob.transfer_date)
                    if rec_dt:
                        t_day = rec_dt.date()
                        if month_day.year == t_day.year and month_day.month == t_day.month:
                            planned_revenue = allocated_amount

                if planned_revenue > 0:
                    period_is_recognized = month_day <= today
                    recognized_revenue = planned_revenue if period_is_recognized else Decimal("0")
                    status = "Recognised" if period_is_recognized else "Deferred"
                    row = {
                        "Period": period,
                        "Date": month_date.strftime("%Y-%m-%d"),
                        "Month": month_date.strftime("%b %Y"),
                        "Obligation_ID": ob.obligation_id,
                        "Obligation": ob.description,
                        "Method": ob.recognition_method.replace("_", " ").title(),
                        "Scheduled_Revenue": float(planned_revenue),
                        "Revenue": float(recognized_revenue),
                        "Status": status,
                        "Cumulative": 0,
                    }
                    rec_iso = self._as_datetime(ob.recognition_date or ob.transfer_date)
                    if rec_iso and ob.recognition_method == "point_in_time":
                        row["Recognition_Date"] = rec_iso.strftime("%Y-%m-%d")
                    if meta.get("license_classification"):
                        row["license_classification"] = meta["license_classification"]
                        row["confidence"] = meta.get("confidence")
                        row["review_recommended"] = meta.get("review_recommended")
                    schedule.append(row)

            month_cursor = month_cursor + relativedelta(months=1)

        for ob in obligations:
            if self._is_multi_session_training_obligation(ob):
                self._append_training_session_rows(
                    contract, ob, allocations[ob.obligation_id], schedule, ob_meta
                )

        df = pd.DataFrame(schedule)
        df = self._finalize_schedule_recognition(df)

        if not df.empty:
            for col in ("Revenue", "Scheduled_Revenue", "Cumulative"):
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0).astype("float64")
            for col in ("license_classification", "confidence", "review_recommended"):
                if col in df.columns:
                    df[col] = df[col].apply(
                        lambda v: None if v is None or (isinstance(v, float) and pd.isna(v)) else v
                    )

        if not df.empty:
            sort_cols = [c for c in ("Date", "Obligation_ID", "Period") if c in df.columns]
            if sort_cols:
                df = df.sort_values(by=list(sort_cols), kind="mergesort").reset_index(drop=True)

        if not df.empty and "Obligation_ID" in df.columns and "Revenue" in df.columns:
            for ob in obligations:
                ob_mask = df["Obligation_ID"] == ob.obligation_id
                df.loc[ob_mask, "Cumulative"] = df.loc[ob_mask, "Revenue"].cumsum()

        return df, license_analysis
    
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
        
        resolved_obs, _, _ = self._resolve_obligations_for_schedule(contract)
        resolved_by_id = {o.obligation_id: o for o in resolved_obs}

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

            resolved = resolved_by_id.get(ob.obligation_id, ob)
            recognition_method = resolved.recognition_method or ob.recognition_method
            if not recognition_schedule.empty and not ob_schedule.empty:
                methods = ob_schedule.get("Method", pd.Series(dtype=str)).astype(str).tolist()
                if any("point" in m.lower() for m in methods):
                    recognition_method = "point_in_time"

            rec_dt = self._as_datetime(
                getattr(resolved, "recognition_date", None) or getattr(resolved, "transfer_date", None)
            )
            po_row: Dict[str, Any] = {
                'obligation_id': ob.obligation_id,
                'obligation': ob.description,
                'recognition_method': recognition_method,
                'allocated_amount': allocated,
                'revenue_recognized': recognized,
                'recognised_to_date': recognized,
                'remaining': allocated - recognized,
                'pct_complete': pct_complete,
                'recognition_status': recognition_status,
            }
            if rec_dt and recognition_method == "point_in_time":
                po_row['recognition_date'] = rec_dt.strftime("%Y-%m-%d")
                po_row['transfer_date'] = rec_dt.strftime("%Y-%m-%d")
            revenue_by_obligation.append(po_row)
        
        # Remaining performance obligations
        total_remaining = sum(item['remaining'] for item in revenue_by_obligation)

        fr = self.apply_vc_constraint(
            float(contract.variable_consideration),
            contract.vc_constraint_factors or {},
            currency=contract.currency,
        )
        vc_from_factors = Decimal(str(fr["constrained_amount"])).quantize(Decimal("0.01"))
        legacy_vc = self.apply_variable_consideration_constraint(contract)
        vc_in_transaction_price = min(vc_from_factors, legacy_vc)

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
                'variable_consideration': float(vc_in_transaction_price),
                'variable_consideration_unconstrained': float(contract.variable_consideration),
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
    
    def _build_ssp_allocation_table(
        self,
        contract: IFRS15Input,
        allocations: Dict[str, Decimal],
    ) -> List[Dict[str, Any]]:
        total_ssp = sum(ob.standalone_selling_price for ob in contract.performance_obligations)
        rows: List[Dict[str, Any]] = []
        for ob in contract.performance_obligations:
            list_ssp = float(ob.standalone_selling_price)
            allocated = float(allocations[ob.obligation_id])
            pct = round((list_ssp / float(total_ssp)) * 100.0, 2) if total_ssp else 0.0
            rows.append(
                {
                    "obligation_id": ob.obligation_id,
                    "obligation": ob.description,
                    "list_ssp": list_ssp,
                    "adjusted_ssp": list_ssp,
                    "allocated_pct": pct,
                    "allocated_amount": allocated,
                    "currency": contract.currency,
                }
            )
        return rows

    def _build_revenue_audit_trail(
        self,
        contract: IFRS15Input,
        allocations: Dict[str, Decimal],
        disclosure: Dict,
        total_recognised: float,
    ) -> str:
        parts: List[str] = []
        for po in disclosure.get("performance_obligations", []):
            name = po.get("obligation") or po.get("obligation_id") or "PO"
            allocated = float(po.get("allocated_amount", 0) or 0)
            recognised = float(po.get("revenue_recognized", 0) or 0)
            pct = float(po.get("pct_complete", 0) or 0)
            rec_on = po.get("recognition_date") or ""
            suffix = f", recognised on {rec_on}" if rec_on else ""
            parts.append(
                f"{name} {contract.currency} {recognised:,.0f} ({pct:.0f}% of {allocated:,.0f} allocated{suffix})"
            )
        if not parts:
            return f"{contract.currency} {total_recognised:,.0f}"
        return f"{contract.currency} {total_recognised:,.0f} = " + " + ".join(parts)
    
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
        raw_period = revenue_engine_result.get("revenue_this_period")
        base_period_revenue = Decimal("0") if raw_period is None else Decimal(str(raw_period))
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
        constraint_result = self.apply_vc_constraint(
            float(contract.variable_consideration),
            contract.vc_constraint_factors or {},
            currency=contract.currency,
        )
        vc_from_factors = Decimal(str(constraint_result["constrained_amount"])).quantize(
            Decimal("0.01")
        )
        legacy_constrained = self.apply_variable_consideration_constraint(contract)
        constrained_vc = min(vc_from_factors, legacy_constrained)
        vc_reversed = contract.variable_consideration - constrained_vc

        # Step 3: Determine transaction price
        transaction_price = self.calculate_transaction_price(contract)
        
        # Step 4: Allocate transaction price
        allocations = self.allocate_transaction_price(
            transaction_price, 
            contract.performance_obligations
        )
        
        # Step 5: Recognize revenue (schedule rows carry today-aware Status / Revenue)
        recognition_schedule, license_recognition_analysis = self.generate_recognition_schedule(
            contract, allocations
        )

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
        try:
            ssp_allocation_table = self._build_ssp_allocation_table(contract, allocations)
        except Exception:
            ssp_allocation_table = []
        try:
            revenue_recognition_audit_trail = self._build_revenue_audit_trail(
                contract, allocations, disclosure, total_recognised
            )
        except Exception:
            revenue_recognition_audit_trail = (
                f"{contract.currency} {total_recognised:,.0f} (audit trail unavailable)"
            )

        performance_obligations = disclosure.get("performance_obligations", [])
        revenue_schedule = self._schedule_df_to_records(recognition_schedule)
        journal_entries_list = self.flatten_journal_entries(journal_entries)

        return {
            'total_contract_value': float(transaction_price),
            'total_recognised': total_recognised,
            'total_deferred': total_deferred_val,
            'total_contract_assets': float(balances.get('contract_asset_amount', 0)),
            'contract_asset_note': contract_asset_note,
            'payment_terms_mode': payment_mode,
            'revenue_schedule': revenue_schedule,
            'license_recognition_analysis': license_recognition_analysis,
            'performance_obligations': performance_obligations,
            'ssp_allocation_table': ssp_allocation_table,
            'revenue_recognition_audit_trail': revenue_recognition_audit_trail,
            'disclosure_notes': {
                'accounting_policy': 'Revenue is recognised when control of promised goods or services transfers to the customer.',
                'disaggregation_of_revenue': f"Revenue recognised to date: {float(balances.get('revenue_recognized_to_date', 0)):,.2f}.",
                'contract_balances': f"Contract assets: {float(balances.get('contract_asset_amount', 0)):,.2f}; Contract liabilities: {float(balances.get('contract_liability_amount', 0)):,.2f}.",
                'performance_obligations_note': f"{len(performance_obligations)} performance obligations identified.",
                'transaction_price_rpo': f"Unrecognised transaction price: {max(float(transaction_price) - float(balances.get('revenue_recognized_to_date', 0)), 0):,.2f}.",
                'significant_judgements': 'Management judgement is applied for identifying obligations, estimating variable consideration, and timing of recognition.',
            },
            'transaction_price': float(transaction_price),
            'vc_constraint_result': constraint_result,
            'variable_consideration_analysis': {
                'raw_variable_consideration': float(contract.variable_consideration),
                'constraint_method': contract.constraint_method,
                'constraint_percentage': float(contract.constraint_percentage),
                'constrained_variable_consideration': float(constrained_vc),
                'amount_excluded_by_constraint': float(vc_reversed),
                'amount_excluded': float(vc_reversed),
                'constraint_applied': vc_reversed > 0,
                'vc_constraint_result': constraint_result,
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

