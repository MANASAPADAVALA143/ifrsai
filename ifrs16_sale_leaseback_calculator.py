"""
IFRS 16 — Sale and Leaseback Calculator
Qualifying sale (§99–103) and failed sale (IFRS 15 §B3–B8).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any


@dataclass
class SaleLeasebackInput:
    asset_description: str
    asset_carrying_amount: float
    fair_value_of_asset: float
    sale_proceeds: float
    transaction_date: str
    leaseback_payment: float
    leaseback_term_months: int
    leaseback_payment_frequency: str = "monthly"
    leaseback_payment_timing: str = "arrears"
    ibr: float = 0.055
    leaseback_percentage: float = 1.0
    market_rent_per_period: float = 0.0
    buyer_has_present_right_to_payment: bool = True
    buyer_has_legal_title: bool = True
    buyer_has_physical_possession: bool = True
    buyer_has_risks_rewards: bool = True
    buyer_accepted_asset: bool = True
    failed_sale: bool = False
    currency: str = "AED"


@dataclass
class SaleLeasebackResult:
    is_sale: bool
    ifrs15_indicators_met: int
    ifrs15_indicators_total: int = 5
    summary: dict[str, Any] = field(default_factory=dict)
    leaseback_schedule: list[dict[str, Any]] = field(default_factory=list)
    journal_entries: list[dict[str, Any]] = field(default_factory=list)
    gain_loss_recognised: float = 0.0
    gain_loss_deferred: float = 0.0
    gain_loss_type: str = "gain"
    rou_asset: float = 0.0
    rou_asset_basis: str = ""
    lease_liability: float = 0.0
    financial_liability: float = 0.0
    rent_adjustment_type: str = "at_market"
    prepaid_rent: float = 0.0
    accrued_rent: float = 0.0


def _parse_date(d: str) -> date:
    return datetime.strptime(d, "%Y-%m-%d").date()


def _periods_per_year(frequency: str) -> float:
    freq = frequency.lower()
    if freq == "monthly":
        return 12
    if freq == "quarterly":
        return 4
    if freq == "annual":
        return 1
    return 12


def _period_count(term_months: int, frequency: str) -> int:
    freq = frequency.lower()
    if freq == "monthly":
        return term_months
    if freq == "quarterly":
        return max(1, term_months // 3)
    if freq == "annual":
        return max(1, term_months // 12)
    return term_months


def _period_rate(annual_rate: float, frequency: str) -> float:
    ppy = _periods_per_year(frequency)
    return (1 + annual_rate) ** (1 / ppy) - 1


def _pv_annuity(payment: float, rate: float, n: int, timing: str) -> float:
    if n <= 0:
        return 0.0
    if rate == 0:
        return payment * n
    pv = payment * (1 - (1 + rate) ** -n) / rate
    if timing.lower() == "advance":
        pv *= 1 + rate
    return pv


def _advance_date(start: date, period: int, frequency: str) -> date:
    freq = frequency.lower()
    months = period
    if freq == "quarterly":
        months = period * 3
    elif freq == "annual":
        months = period * 12
    year = start.year + (start.month - 1 + months) // 12
    month = (start.month - 1 + months) % 12 + 1
    day = min(start.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date(year, month, day)


def _normalize_leaseback_pct(pct: float) -> float:
    if pct > 1:
        return min(pct / 100.0, 1.0)
    return min(max(pct, 0.0), 1.0)


def _assess_sale_qualification(inp: SaleLeasebackInput) -> tuple[bool, int]:
    if inp.failed_sale:
        return False, 0
    flags = [
        inp.buyer_has_present_right_to_payment,
        inp.buyer_has_legal_title,
        inp.buyer_has_physical_possession,
        inp.buyer_has_risks_rewards,
        inp.buyer_accepted_asset,
    ]
    met = sum(1 for x in flags if x)
    return met >= 3, met


def _rent_adjustment(
    inp: SaleLeasebackInput, rate: float, n: int
) -> tuple[float, float, str]:
    market = inp.market_rent_per_period
    if market <= 0:
        return 0.0, 0.0, "at_market"
    diff = market - inp.leaseback_payment
    if abs(diff) < 0.01:
        return 0.0, 0.0, "at_market"
    pv = _pv_annuity(abs(diff), rate, n, inp.leaseback_payment_timing)
    if diff > 0:
        return round(pv, 2), 0.0, "below_market"
    return 0.0, round(pv, 2), "above_market"


def _failed_sale_schedule(
    inp: SaleLeasebackInput,
    liability: float,
    rate: float,
    n: int,
) -> list[dict[str, Any]]:
    start = _parse_date(inp.transaction_date)
    rows: list[dict[str, Any]] = []
    balance = liability
    for period in range(1, n + 1):
        interest = balance * rate if inp.leaseback_payment_timing.lower() == "arrears" else balance * rate
        if inp.leaseback_payment_timing.lower() == "advance" and period == 1:
            interest = 0.0
        payment = inp.leaseback_payment
        closing = balance + interest - payment
        rows.append(
            {
                "period": period,
                "date": _advance_date(start, period, inp.leaseback_payment_frequency).isoformat(),
                "opening_liability": round(balance, 2),
                "interest_expense": round(interest, 2),
                "payment": round(payment, 2),
                "closing_liability": round(max(closing, 0.0), 2),
                "treatment": "failed_sale_financial_liability",
            }
        )
        balance = max(closing, 0.0)
    return rows


def _qualifying_sale_schedule(
    inp: SaleLeasebackInput,
    lease_liability: float,
    rou: float,
    deferred_gl: float,
    rate: float,
    n: int,
) -> list[dict[str, Any]]:
    start = _parse_date(inp.transaction_date)
    rows: list[dict[str, Any]] = []
    liab = lease_liability
    rou_nbv = rou
    dep_per_period = rou / n if n > 0 else 0.0
    deferred_amort = deferred_gl / n if n > 0 else 0.0

    for period in range(1, n + 1):
        interest = liab * rate
        payment = inp.leaseback_payment
        closing_liab = liab + interest - payment
        rou_nbv = max(rou_nbv - dep_per_period, 0.0)
        rows.append(
            {
                "period": period,
                "date": _advance_date(start, period, inp.leaseback_payment_frequency).isoformat(),
                "opening_liability": round(liab, 2),
                "interest_expense": round(interest, 2),
                "lease_payment": round(payment, 2),
                "closing_liability": round(max(closing_liab, 0.0), 2),
                "rou_depreciation": round(dep_per_period, 2),
                "rou_nbv": round(rou_nbv, 2),
                "deferred_gain_loss_amort": round(deferred_amort, 2),
                "total_expense": round(interest + dep_per_period - deferred_amort, 2),
                "treatment": "qualifying_sale_leaseback",
            }
        )
        liab = max(closing_liab, 0.0)
    return rows


def _day1_journals_qualifying(
    inp: SaleLeasebackInput,
    rou: float,
    lease_liability: float,
    gain_rec: float,
    gain_def: float,
    gain_type: str,
    prepaid: float,
    additional: float,
) -> list[dict[str, Any]]:
    tx = inp.transaction_date
    entries: list[dict[str, Any]] = [
        {
            "date": tx,
            "description": "Day 1 — Sale and leaseback (qualifying sale)",
            "lines": [
                {"account": "Cash / Bank", "dr": round(inp.sale_proceeds, 2), "cr": 0, "narration": "Sale proceeds received"},
                {"account": "Property, Plant & Equipment", "dr": 0, "cr": round(inp.asset_carrying_amount, 2), "narration": "Derecognise carrying amount of asset sold"},
                {
                    "account": "Gain on sale" if gain_type == "gain" else "Loss on sale",
                    "dr": round(abs(gain_rec), 2) if gain_type == "loss" else 0,
                    "cr": round(gain_rec, 2) if gain_type == "gain" else 0,
                    "narration": "Gain/loss on rights transferred to buyer-lessor",
                },
                {"account": "Right-of-use asset", "dr": round(rou, 2), "cr": 0, "narration": "ROU asset — retained use (§100)"},
                {
                    "account": "Deferred gain on sale" if gain_type == "gain" else "Deferred loss on sale",
                    "dr": round(abs(gain_def), 2) if gain_type == "loss" else 0,
                    "cr": round(gain_def, 2) if gain_type == "gain" else 0,
                    "narration": "Deferred gain/loss on retained rights",
                },
                {"account": "Lease liability", "dr": 0, "cr": round(lease_liability, 2), "narration": "Lease liability at PV of leaseback payments (IBR)"},
            ],
        }
    ]
    if prepaid > 0:
        entries[0]["lines"].append(
            {"account": "Prepaid rent (below-market adjustment)", "dr": prepaid, "cr": 0, "narration": "§100(b) below-market rent — prepaid lease payment"}
        )
    if additional > 0:
        entries[0]["lines"].append(
            {"account": "Additional financing (above-market rent)", "dr": 0, "cr": additional, "narration": "§100(b) above-market rent — additional financing"}
        )
    return entries


def _day1_journals_failed(inp: SaleLeasebackInput, liability: float) -> list[dict[str, Any]]:
    return [
        {
            "date": inp.transaction_date,
            "description": "Day 1 — Failed sale (financial liability)",
            "lines": [
                {"account": "Cash / Bank", "dr": round(inp.sale_proceeds, 2), "cr": 0, "narration": "Proceeds received — asset not derecognised"},
                {"account": "Financial liability (IFRS 15 §B68)", "dr": 0, "cr": round(liability, 2), "narration": "Proceeds as financial liability — no gain/loss"},
            ],
        }
    ]


def calculate_sale_leaseback(inp: SaleLeasebackInput) -> SaleLeasebackResult:
    """Full IFRS 16 §99–103 sale and leaseback calculation."""
    is_sale, met = _assess_sale_qualification(inp)
    leaseback_pct = _normalize_leaseback_pct(inp.leaseback_percentage)
    rate = _period_rate(inp.ibr, inp.leaseback_payment_frequency)
    n = _period_count(inp.leaseback_term_months, inp.leaseback_payment_frequency)

    base_ll = _pv_annuity(inp.leaseback_payment, rate, n, inp.leaseback_payment_timing)
    prepaid, additional, rent_adj = _rent_adjustment(inp, rate, n)

    result = SaleLeasebackResult(
        is_sale=is_sale,
        ifrs15_indicators_met=met,
        rent_adjustment_type=rent_adj,
        prepaid_rent=prepaid,
        accrued_rent=additional,
    )

    if not is_sale:
        liability = round(inp.sale_proceeds, 2)
        result.financial_liability = liability
        result.lease_liability = 0.0
        result.rou_asset = 0.0
        result.gain_loss_recognised = 0.0
        result.gain_loss_deferred = 0.0
        result.leaseback_schedule = _failed_sale_schedule(inp, liability, rate, n)
        result.journal_entries = _day1_journals_failed(inp, liability)
        result.summary = {
            "treatment": "Failed Sale — Financial Liability (IFRS 15 §B3–B8)",
            "asset_description": inp.asset_description,
            "currency": inp.currency,
            "financial_liability": liability,
            "asset_carrying_amount_retained": round(inp.asset_carrying_amount, 2),
            "sale_proceeds": round(inp.sale_proceeds, 2),
            "leaseback_term_months": inp.leaseback_term_months,
            "ibr_pct": round(inp.ibr * 100, 4),
            "ifrs15_indicators_met": met,
            "ifrs15_indicators_total": 5,
        }
        return result

    retained = min(base_ll / inp.fair_value_of_asset, 1.0) if inp.fair_value_of_asset > 0 else 1.0
    transferred = 1.0 - retained
    gross_gl = inp.sale_proceeds - inp.asset_carrying_amount
    gain_type = "gain" if gross_gl >= 0 else "loss"
    gain_rec = gross_gl * transferred
    gain_def = gross_gl * retained

    rou = inp.asset_carrying_amount * retained
    lease_liability = base_ll - prepaid + additional

    result.lease_liability = round(lease_liability, 2)
    result.rou_asset = round(rou, 2)
    result.rou_asset_basis = (
        f"Carrying amount × (lease liability ÷ FV) = "
        f"{inp.asset_carrying_amount:,.0f} × ({base_ll:,.0f} ÷ {inp.fair_value_of_asset:,.0f})"
    )
    result.gain_loss_recognised = round(gain_rec, 2)
    result.gain_loss_deferred = round(gain_def, 2)
    result.gain_loss_type = gain_type
    result.leaseback_schedule = _qualifying_sale_schedule(
        inp, lease_liability, rou, gain_def, rate, n
    )
    result.journal_entries = _day1_journals_qualifying(
        inp, rou, lease_liability, gain_rec, gain_def, gain_type, prepaid, additional
    )
    result.summary = {
        "treatment": "Qualifying Sale (IFRS 16 §99–103)",
        "asset_description": inp.asset_description,
        "currency": inp.currency,
        "sale_proceeds": round(inp.sale_proceeds, 2),
        "fair_value_of_asset": round(inp.fair_value_of_asset, 2),
        "asset_carrying_amount": round(inp.asset_carrying_amount, 2),
        "lease_liability": round(lease_liability, 2),
        "rou_asset": round(rou, 2),
        "retained_proportion_pct": round(retained * 100, 2),
        "transferred_proportion_pct": round(transferred * 100, 2),
        "gain_loss_recognised": round(gain_rec, 2),
        "gain_loss_deferred": round(gain_def, 2),
        "gain_loss_type": gain_type,
        "leaseback_percentage": round(leaseback_pct * 100, 2),
        "rent_adjustment_type": rent_adj,
        "prepaid_rent": prepaid,
        "additional_financing": additional,
        "ibr_pct": round(inp.ibr * 100, 4),
        "ifrs15_indicators_met": met,
        "ifrs15_indicators_total": 5,
    }
    return result
