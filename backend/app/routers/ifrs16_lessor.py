"""IFRS 16 lessor accounting API routes."""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ifrs16_lessor_calculator import (
    LessorLeaseInput,
    calculate_lessor,
    classify_lease,
)

router = APIRouter(prefix="/api/ifrs16/lessor", tags=["ifrs16-lessor"])


class LessorCalculateRequest(BaseModel):
    asset_description: str = Field(..., example="Commercial Property — Dubai")
    lessee_name: str = Field(..., example="ABC Trading LLC")
    commencement_date: str = Field(..., example="2024-01-01")
    lease_term_months: int = Field(..., example=60)
    payment_amount: float = Field(..., example=150000)
    payment_frequency: str = Field("monthly", example="monthly")
    payment_timing: str = Field("arrears", example="arrears")
    interest_rate_implicit: float = Field(0.0, example=0.055)
    fair_value_of_asset: float = Field(0.0, example=8000000)
    carrying_amount_of_asset: float = Field(0.0, example=7500000)
    unguaranteed_residual_value: float = Field(0.0, example=500000)
    guaranteed_residual_value: float = Field(0.0, example=0)
    is_dealer_manufacturer: bool = Field(False)
    cost_of_asset: float = Field(0.0, example=6000000)
    initial_direct_costs: float = Field(0.0, example=25000)
    lease_type_override: Optional[str] = Field(None, example="finance")
    classification_indicators: List[str] = Field(default_factory=list)
    useful_life_months: int = Field(0, example=600)
    currency: str = Field("AED", example="AED")


class ClassifyRequest(BaseModel):
    fair_value_of_asset: float = 0.0
    payment_amount: float = 0.0
    payment_frequency: str = "monthly"
    payment_timing: str = "arrears"
    interest_rate_implicit: float = 0.0
    lease_term_months: int = 0
    useful_life_months: int = 0
    classification_indicators: List[str] = []


def _to_input(body: LessorCalculateRequest) -> LessorLeaseInput:
    return LessorLeaseInput(
        asset_description=body.asset_description,
        lessee_name=body.lessee_name,
        commencement_date=body.commencement_date,
        lease_term_months=body.lease_term_months,
        payment_amount=body.payment_amount,
        payment_frequency=body.payment_frequency,
        payment_timing=body.payment_timing,
        interest_rate_implicit=body.interest_rate_implicit,
        fair_value_of_asset=body.fair_value_of_asset,
        carrying_amount_of_asset=body.carrying_amount_of_asset,
        unguaranteed_residual_value=body.unguaranteed_residual_value,
        guaranteed_residual_value=body.guaranteed_residual_value,
        is_dealer_manufacturer=body.is_dealer_manufacturer,
        cost_of_asset=body.cost_of_asset,
        initial_direct_costs=body.initial_direct_costs,
        lease_type_override=body.lease_type_override,
        useful_life_months=body.useful_life_months,
        currency=body.currency,
    )


def _quick_pv_ratio(inp: LessorLeaseInput) -> float:
    from ifrs16_lessor_calculator import _period_count, _period_rate, _pv_annuity

    if inp.fair_value_of_asset == 0:
        return 0.0
    rate = _period_rate(inp.interest_rate_implicit, inp.payment_frequency)
    n = _period_count(inp)
    pv = _pv_annuity(inp.payment_amount, rate, n, inp.payment_timing)
    return pv / inp.fair_value_of_asset


@router.post("/calculate")
async def lessor_calculate(body: LessorCalculateRequest):
    try:
        inp = _to_input(body)
        result = calculate_lessor(inp, body.classification_indicators)
        return {"success": True, "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/classify")
async def lessor_classify(body: ClassifyRequest):
    try:
        inp = LessorLeaseInput(
            asset_description="",
            lessee_name="",
            commencement_date="2024-01-01",
            lease_term_months=body.lease_term_months,
            payment_amount=body.payment_amount,
            payment_frequency=body.payment_frequency,
            payment_timing=body.payment_timing,
            interest_rate_implicit=body.interest_rate_implicit,
            fair_value_of_asset=body.fair_value_of_asset,
            useful_life_months=body.useful_life_months,
        )
        lease_type = classify_lease(inp, body.classification_indicators)

        reasons = []
        if body.fair_value_of_asset > 0 and body.payment_amount > 0:
            pv_ratio = _quick_pv_ratio(inp)
            reasons.append({
                "test": "PV of payments ÷ fair value",
                "result": f"{round(pv_ratio * 100, 1)}%",
                "threshold": "≥ 90% → Finance",
                "triggered": pv_ratio >= 0.90,
            })

        if body.useful_life_months > 0 and body.lease_term_months > 0:
            life_ratio = body.lease_term_months / body.useful_life_months
            reasons.append({
                "test": "Lease term ÷ useful life",
                "result": f"{round(life_ratio * 100, 1)}%",
                "threshold": "≥ 75% → Finance",
                "triggered": life_ratio >= 0.75,
            })

        for indicator in body.classification_indicators:
            reasons.append({
                "test": f"Qualitative indicator: {indicator.replace('_', ' ')}",
                "result": "Present",
                "threshold": "Presence → Finance",
                "triggered": True,
            })

        return {
            "success": True,
            "lease_type": lease_type,
            "classification": "Finance Lease" if lease_type == "finance" else "Operating Lease",
            "ifrs_reference": "IFRS 16 §61–62",
            "classification_tests": reasons,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/classification-indicators")
async def get_indicators():
    return {
        "success": True,
        "indicators": [
            {
                "key": "transfers_ownership",
                "label": "Lease transfers ownership to lessee by end of term",
                "paragraph": "IFRS 16 §62(a)",
                "strength": "strong",
            },
            {
                "key": "purchase_option_reasonably_certain",
                "label": "Lessee has purchase option it is reasonably certain to exercise",
                "paragraph": "IFRS 16 §62(b)",
                "strength": "strong",
            },
            {
                "key": "major_part_of_economic_life",
                "label": "Lease term covers major part of asset's economic life",
                "paragraph": "IFRS 16 §62(c)",
                "strength": "moderate",
            },
            {
                "key": "substantially_all_fair_value",
                "label": "PV of payments ≈ substantially all of fair value of asset",
                "paragraph": "IFRS 16 §62(d)",
                "strength": "moderate",
            },
            {
                "key": "specialised_nature",
                "label": "Asset is specialised — only lessee can use without major modifications",
                "paragraph": "IFRS 16 §62(e)",
                "strength": "strong",
            },
        ],
    }
