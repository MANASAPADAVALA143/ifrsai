"""IFRS 16 Sale and Leaseback — API routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ifrs16_sale_leaseback_calculator import (
    SaleLeasebackInput,
    _assess_sale_qualification,
    _period_count,
    _period_rate,
    _pv_annuity,
    calculate_sale_leaseback,
)

router = APIRouter(prefix="/api/ifrs16/sale-leaseback", tags=["ifrs16-sale-leaseback"])


class SaleLeasebackRequest(BaseModel):
    asset_description: str = Field(..., example="Dubai Office Tower — Floors 1–10")
    asset_carrying_amount: float = Field(..., example=5000000)
    fair_value_of_asset: float = Field(..., example=8000000)
    sale_proceeds: float = Field(..., example=8000000)
    transaction_date: str = Field(..., example="2024-01-01")
    leaseback_payment: float = Field(..., example=55000)
    leaseback_term_months: int = Field(..., example=60)
    leaseback_payment_frequency: str = Field("monthly", example="monthly")
    leaseback_payment_timing: str = Field("arrears", example="arrears")
    ibr: float = Field(0.055, example=0.055, description="Annual IBR decimal e.g. 0.055 = 5.5%")
    leaseback_percentage: float = Field(1.0, example=1.0, description="1.0 = full leaseback")
    market_rent_per_period: float = Field(0.0, example=55000)
    buyer_has_present_right_to_payment: bool = True
    buyer_has_legal_title: bool = True
    buyer_has_physical_possession: bool = True
    buyer_has_risks_rewards: bool = True
    buyer_accepted_asset: bool = True
    failed_sale: bool = False
    currency: str = "AED"


class QuickAssessRequest(BaseModel):
    asset_carrying_amount: float
    fair_value_of_asset: float
    sale_proceeds: float
    leaseback_payment: float
    leaseback_term_months: int
    ibr: float = 0.055
    leaseback_payment_frequency: str = "monthly"
    buyer_has_present_right_to_payment: bool = True
    buyer_has_legal_title: bool = True
    buyer_has_physical_possession: bool = True
    buyer_has_risks_rewards: bool = True
    buyer_accepted_asset: bool = True
    failed_sale: bool = False
    currency: str = "AED"


def _to_input(body: SaleLeasebackRequest) -> SaleLeasebackInput:
    return SaleLeasebackInput(
        asset_description=body.asset_description,
        asset_carrying_amount=body.asset_carrying_amount,
        fair_value_of_asset=body.fair_value_of_asset,
        sale_proceeds=body.sale_proceeds,
        transaction_date=body.transaction_date,
        leaseback_payment=body.leaseback_payment,
        leaseback_term_months=body.leaseback_term_months,
        leaseback_payment_frequency=body.leaseback_payment_frequency,
        leaseback_payment_timing=body.leaseback_payment_timing,
        ibr=body.ibr,
        leaseback_percentage=body.leaseback_percentage,
        market_rent_per_period=body.market_rent_per_period,
        buyer_has_present_right_to_payment=body.buyer_has_present_right_to_payment,
        buyer_has_legal_title=body.buyer_has_legal_title,
        buyer_has_physical_possession=body.buyer_has_physical_possession,
        buyer_has_risks_rewards=body.buyer_has_risks_rewards,
        buyer_accepted_asset=body.buyer_accepted_asset,
        failed_sale=body.failed_sale,
        currency=body.currency,
    )


@router.post("/calculate")
async def sale_leaseback_calculate(body: SaleLeasebackRequest):
    try:
        result = calculate_sale_leaseback(_to_input(body))
        return {
            "success": True,
            "result": {
                "is_sale": result.is_sale,
                "ifrs15_indicators_met": result.ifrs15_indicators_met,
                "ifrs15_indicators_total": result.ifrs15_indicators_total,
                "summary": result.summary,
                "leaseback_schedule": result.leaseback_schedule,
                "journal_entries": result.journal_entries,
                "gain_loss_recognised": result.gain_loss_recognised,
                "gain_loss_deferred": result.gain_loss_deferred,
                "gain_loss_type": result.gain_loss_type,
                "rou_asset": result.rou_asset,
                "rou_asset_basis": result.rou_asset_basis,
                "lease_liability": result.lease_liability,
                "financial_liability": result.financial_liability,
                "rent_adjustment_type": result.rent_adjustment_type,
                "prepaid_rent": result.prepaid_rent,
                "accrued_rent": result.accrued_rent,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/assess")
async def sale_leaseback_assess(body: QuickAssessRequest):
    try:
        stub = SaleLeasebackInput(
            asset_description="",
            asset_carrying_amount=body.asset_carrying_amount,
            fair_value_of_asset=body.fair_value_of_asset,
            sale_proceeds=body.sale_proceeds,
            transaction_date="2024-01-01",
            leaseback_payment=body.leaseback_payment,
            leaseback_term_months=body.leaseback_term_months,
            leaseback_payment_frequency=body.leaseback_payment_frequency,
            buyer_has_present_right_to_payment=body.buyer_has_present_right_to_payment,
            buyer_has_legal_title=body.buyer_has_legal_title,
            buyer_has_physical_possession=body.buyer_has_physical_possession,
            buyer_has_risks_rewards=body.buyer_has_risks_rewards,
            buyer_accepted_asset=body.buyer_accepted_asset,
            failed_sale=body.failed_sale,
            currency=body.currency,
            ibr=body.ibr,
        )
        is_sale, met = _assess_sale_qualification(stub)
        r = _period_rate(body.ibr, body.leaseback_payment_frequency)
        n = _period_count(body.leaseback_term_months, body.leaseback_payment_frequency)
        ll = _pv_annuity(body.leaseback_payment, r, n, "arrears")
        retained = min(ll / body.fair_value_of_asset, 1.0) if body.fair_value_of_asset > 0 else 1.0
        transferred = 1.0 - retained
        gross_gl = body.sale_proceeds - body.asset_carrying_amount
        return {
            "success": True,
            "is_sale": is_sale,
            "ifrs15_indicators_met": met,
            "ifrs15_indicators_total": 5,
            "verdict": (
                "Qualifying Sale (IFRS 16 §99–103)"
                if is_sale
                else "Failed Sale — Financial Liability (IFRS 15 §B3–B8)"
            ),
            "lease_liability": round(ll, 2),
            "rou_asset": round(body.asset_carrying_amount * retained, 2) if is_sale else 0,
            "retained_proportion_pct": round(retained * 100, 2),
            "gain_loss_recognised": round(gross_gl * transferred, 2) if is_sale else 0,
            "gain_loss_deferred": round(gross_gl * retained, 2) if is_sale else 0,
            "gain_loss_type": "gain" if gross_gl >= 0 else "loss",
            "financial_liability": round(body.sale_proceeds, 2) if not is_sale else 0,
            "currency": body.currency,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/ifrs15-indicators")
async def get_ifrs15_indicators():
    return {
        "success": True,
        "indicators": [
            {
                "key": "buyer_has_present_right_to_payment",
                "label": "Buyer-lessor has a present right to payment for the asset",
                "paragraph": "IFRS 15 §B3(a)",
            },
            {
                "key": "buyer_has_legal_title",
                "label": "Buyer-lessor has legal title to the asset",
                "paragraph": "IFRS 15 §B3(b)",
            },
            {
                "key": "buyer_has_physical_possession",
                "label": "Buyer-lessor has physical possession of the asset",
                "paragraph": "IFRS 15 §B3(c)",
            },
            {
                "key": "buyer_has_risks_rewards",
                "label": "Buyer-lessor has the significant risks and rewards of ownership",
                "paragraph": "IFRS 15 §B3(d)",
            },
            {
                "key": "buyer_accepted_asset",
                "label": "Buyer-lessor has accepted the asset",
                "paragraph": "IFRS 15 §B3(e)",
            },
        ],
    }
