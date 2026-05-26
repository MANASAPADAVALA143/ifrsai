"""IFRS 15 para 17 multi-unit bundling checks."""

from __future__ import annotations

import hashlib
from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class UnitContract(BaseModel):
    contract_id: str
    unit_number: str
    unit_type: Literal["apartment", "villa", "townhouse", "retail", "office", "parking"]
    contract_price_aed: float
    contract_date: date
    completion_pct: float = Field(ge=0, le=100)
    costs_incurred_aed: float
    buyer_name: str
    buyer_id: str


class BundlingAssessment(BaseModel):
    should_bundle: bool
    bundling_criteria_met: List[str] = Field(default_factory=list)
    combined_transaction_price_aed: float
    individual_prices_aed: List[float] = Field(default_factory=list)
    discount_detected: bool
    discount_amount_aed: float
    combined_revenue_recognised_aed: float
    combined_completion_pct: float
    combined_journal_entries: List[Dict[str, Any]] = Field(default_factory=list)
    ifrs15_reference: str = "IFRS 15 para 17(a)(b)(c)"
    audit_risk_level: Literal["low", "medium", "high"]
    recommendation: str
    individual_schedules: List[Dict[str, Any]] = Field(default_factory=list)
    warning_flags: List[str] = Field(default_factory=list)
    buyer_id_masked: Optional[str] = None


def hash_buyer_id(raw: str) -> str:
    return hashlib.sha256((raw or "").encode("utf-8")).hexdigest()


def mask_buyer_id(raw: str) -> str:
    val = (raw or "").strip()
    tail = val[-4:] if len(val) >= 4 else val
    return f"EID-****-{tail}" if tail else "EID-****-0000"


def _parse_date(v: Any) -> Optional[date]:
    if isinstance(v, date):
        return v
    s = str(v or "").strip()[:10]
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def _tower_prefix(unit_number: str) -> str:
    s = (unit_number or "").upper().replace("-", " ").replace("_", " ")
    return s.split()[0] if s.split() else ""


def assess_bundling(units: List[UnitContract]) -> BundlingAssessment:
    if len(units) < 2:
        u = units[0] if units else None
        price = float(u.contract_price_aed) if u else 0.0
        completion = float(u.completion_pct) if u else 0.0
        rev = round(price * (completion / 100.0), 2)
        return BundlingAssessment(
            should_bundle=False,
            bundling_criteria_met=[],
            combined_transaction_price_aed=price,
            individual_prices_aed=[price] if u else [],
            discount_detected=False,
            discount_amount_aed=0.0,
            combined_revenue_recognised_aed=rev,
            combined_completion_pct=completion,
            combined_journal_entries=[],
            audit_risk_level="low",
            recommendation="Contracts appear to be independent based on available data. Monitor if further units are purchased by the same buyer.",
            individual_schedules=[],
            warning_flags=[],
            buyer_id_masked=mask_buyer_id(u.buyer_id) if u else None,
        )

    sorted_units = sorted(units, key=lambda x: x.contract_date)
    buyer_mask = mask_buyer_id(sorted_units[0].buyer_id)
    dates = [u.contract_date for u in sorted_units]
    days_span = (max(dates) - min(dates)).days if dates else 999
    same_tower = len({_tower_prefix(u.unit_number) for u in sorted_units}) == 1

    criteria: List[str] = []
    warnings: List[str] = []
    if days_span <= 90:
        criteria.append("(a) Contracts negotiated near same time (<=90 days)")
    warnings.append("(b) Consideration dependency requires legal contract review (not auto-determinable)")
    if same_tower:
        criteria.append("(c) Units appear in same tower/development — possible single PO")

    should_bundle = days_span <= 90 and same_tower
    prices = [float(u.contract_price_aed) for u in sorted_units]
    combined_tp = round(sum(prices), 2)
    weights = [max(float(u.costs_incurred_aed), 0.0) for u in sorted_units]
    weighted_base = sum(weights) if sum(weights) > 0 else float(len(sorted_units))
    weighted_completion = sum(float(u.completion_pct) * (w if sum(weights) > 0 else 1.0) for u, w in zip(sorted_units, weights)) / weighted_base
    combined_completion = round(weighted_completion, 4)
    combined_revenue = round(combined_tp * (combined_completion / 100.0), 2)
    individual_revenue = [round(float(u.contract_price_aed) * float(u.completion_pct) / 100.0, 2) for u in sorted_units]
    individual_sum = round(sum(individual_revenue), 2)
    delta = round(combined_revenue - individual_sum, 2)
    discount_detected = abs(delta) > 1.0
    if abs(delta) > 1.0:
        warnings.append(
            f"Combined revenue differs from sum of individual schedules by AED {delta:,.2f}."
        )

    if days_span <= 30 and same_tower:
        risk: Literal["low", "medium", "high"] = "high"
    elif len(sorted_units) >= 2 and days_span <= 90:
        risk = "medium"
    else:
        risk = "low"

    rec = (
        f"These {len(sorted_units)} contracts meet IFRS 15 para 17 criteria and should be combined. "
        f"Revenue recognised on a weighted-average completion basis. Consult audit team before period-end. Risk level: {risk}."
        if should_bundle
        else "Contracts appear to be independent based on available data. Monitor if further units are purchased by the same buyer."
    )

    individual_sched = [
        {
            "contract_id": u.contract_id,
            "unit_number": u.unit_number,
            "unit_type": u.unit_type,
            "contract_price_aed": float(u.contract_price_aed),
            "completion_pct": float(u.completion_pct),
            "costs_incurred_aed": float(u.costs_incurred_aed),
            "revenue_recognised_aed": rev,
            "contract_date": u.contract_date.isoformat(),
            "buyer_name": u.buyer_name,
            "buyer_id_masked": buyer_mask,
        }
        for u, rev in zip(sorted_units, individual_revenue)
    ]

    je = [
        {
            "dr": "Contract Asset",
            "cr": "Revenue",
            "amount": combined_revenue,
            "narrative": "Combined contracts revenue recognition per IFRS 15 para 17",
        }
    ] if should_bundle else []

    return BundlingAssessment(
        should_bundle=should_bundle,
        bundling_criteria_met=criteria,
        combined_transaction_price_aed=combined_tp,
        individual_prices_aed=prices,
        discount_detected=discount_detected,
        discount_amount_aed=abs(delta),
        combined_revenue_recognised_aed=combined_revenue,
        combined_completion_pct=round(combined_completion, 2),
        combined_journal_entries=je,
        audit_risk_level=risk,
        recommendation=rec,
        individual_schedules=individual_sched,
        warning_flags=warnings,
        buyer_id_masked=buyer_mask,
    )

