"""
IFRS 16 — Lessor Accounting Calculator
Covers: Finance Lease, Operating Lease, Dealer/Manufacturer (IFRS 16 §61–97)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal

from dateutil.relativedelta import relativedelta


@dataclass
class LessorLeaseInput:
    asset_description: str
    lessee_name: str
    commencement_date: str
    lease_term_months: int
    payment_amount: float
    payment_frequency: str = "monthly"
    payment_timing: str = "arrears"
    interest_rate_implicit: float = 0.0
    fair_value_of_asset: float = 0.0
    carrying_amount_of_asset: float = 0.0
    unguaranteed_residual_value: float = 0.0
    guaranteed_residual_value: float = 0.0
    is_dealer_manufacturer: bool = False
    cost_of_asset: float = 0.0
    initial_direct_costs: float = 0.0
    lease_type_override: str | None = None
    currency: str = "AED"
    useful_life_months: int = 0


FINANCE_INDICATORS = [
    "transfers_ownership",
    "purchase_option_reasonably_certain",
    "major_part_of_economic_life",
    "substantially_all_fair_value",
    "specialised_nature",
]


def classify_lease(inp: LessorLeaseInput, indicators: list[str] | None = None) -> str:
    """IFRS 16 §61–62 lessor classification."""
    if inp.lease_type_override:
        return inp.lease_type_override.lower()

    indicators = indicators or []

    if inp.fair_value_of_asset > 0:
        pv = _pv_of_payments(inp)
        if pv / inp.fair_value_of_asset >= 0.90:
            return "finance"

    if inp.useful_life_months > 0:
        if inp.lease_term_months / inp.useful_life_months >= 0.75:
            return "finance"

    strong = {
        "transfers_ownership",
        "purchase_option_reasonably_certain",
        "specialised_nature",
    }
    if any(i in strong for i in indicators):
        return "finance"

    return "operating"


@dataclass
class FinanceLessorResult:
    lease_type: str = "finance"
    is_dealer_manufacturer: bool = False
    net_investment_in_lease: float = 0.0
    gross_investment_in_lease: float = 0.0
    unearned_finance_income: float = 0.0
    selling_profit_loss: float = 0.0
    day1_finance_income: float = 0.0
    amortization_schedule: list[dict] = field(default_factory=list)
    journal_entries: list[dict] = field(default_factory=list)
    summary: dict = field(default_factory=dict)


def calculate_finance_lessor(inp: LessorLeaseInput) -> FinanceLessorResult:
    """IFRS 16 §67–80 — finance lease (lessor)."""
    result = FinanceLessorResult(is_dealer_manufacturer=inp.is_dealer_manufacturer)

    rate = inp.interest_rate_implicit
    periods = _period_count(inp)
    payment = inp.payment_amount
    ugr = inp.unguaranteed_residual_value
    ggr = inp.guaranteed_residual_value
    idc = inp.initial_direct_costs
    period_rate = _period_rate(rate, inp.payment_frequency)

    pv_payments = _pv_annuity(payment, period_rate, periods, inp.payment_timing)
    pv_ggr = ggr / ((1 + period_rate) ** periods) if ggr > 0 else 0.0
    pv_ugr = ugr / ((1 + period_rate) ** periods) if ugr > 0 else 0.0

    if inp.is_dealer_manufacturer:
        net_investment = pv_payments + pv_ggr + pv_ugr
    else:
        net_investment = pv_payments + pv_ggr + pv_ugr + idc

    gross_receipts = payment * periods + ggr + ugr
    unearned = gross_receipts - net_investment

    result.net_investment_in_lease = round(net_investment, 2)
    result.gross_investment_in_lease = round(gross_receipts, 2)
    result.unearned_finance_income = round(unearned, 2)

    if inp.is_dealer_manufacturer and inp.fair_value_of_asset > 0:
        revenue = min(inp.fair_value_of_asset, pv_payments + pv_ggr)
        cogs = inp.carrying_amount_of_asset - pv_ugr
        result.selling_profit_loss = round(revenue - cogs, 2)
        result.day1_finance_income = round(-idc, 2)

    schedule = []
    balance = net_investment
    start = _parse_date(inp.commencement_date)

    for i in range(1, periods + 1):
        period_date = _advance_date(start, i, inp.payment_frequency)
        finance_income = round(balance * period_rate, 2)
        principal_recovery = round(payment - finance_income, 2)
        residual_receipt = (ggr + ugr) if i == periods else 0.0
        closing = round(balance + finance_income - payment - (ggr + ugr if i == periods else 0), 2)

        schedule.append({
            "period": i,
            "date": period_date.isoformat(),
            "opening_net_investment": round(balance, 2),
            "lease_receipt": round(payment, 2),
            "finance_income": finance_income,
            "principal_recovery": principal_recovery,
            "residual_receipt": round(residual_receipt, 2),
            "closing_net_investment": round(max(closing, 0), 2),
        })
        balance = max(closing, 0)

    result.amortization_schedule = schedule

    carrying = inp.carrying_amount_of_asset or net_investment
    journals = [{
        "date": inp.commencement_date,
        "description": "Commencement — recognise net investment in lease",
        "entries": [
            {"account": "Net Investment in Lease (Asset)", "debit": net_investment, "credit": 0},
            {"account": "Unearned Finance Income", "debit": 0, "credit": unearned},
            {"account": "Asset (derecognised)", "debit": 0, "credit": carrying},
        ],
    }]

    if inp.is_dealer_manufacturer and result.selling_profit_loss != 0:
        journals.append({
            "date": inp.commencement_date,
            "description": "Dealer/manufacturer — selling profit at commencement",
            "entries": [
                {"account": "Revenue (P&L)", "debit": 0, "credit": max(result.selling_profit_loss, 0)},
                {"account": "Cost of Sales (P&L)", "debit": inp.carrying_amount_of_asset, "credit": 0},
            ],
        })

    if schedule:
        ex = schedule[0]
        journals.append({
            "date": ex["date"],
            "description": "Recurring — receipt and finance income (period 1 example)",
            "entries": [
                {"account": "Cash / Bank", "debit": ex["lease_receipt"], "credit": 0},
                {"account": "Net Investment in Lease", "debit": 0, "credit": ex["principal_recovery"]},
                {"account": "Unearned Finance Income", "debit": ex["finance_income"], "credit": 0},
                {"account": "Finance Income (P&L)", "debit": 0, "credit": ex["finance_income"]},
            ],
        })

    result.journal_entries = journals
    total_finance_income = sum(r["finance_income"] for r in schedule)
    result.summary = {
        "lease_type": "Finance Lease (Lessor)",
        "is_dealer_manufacturer": inp.is_dealer_manufacturer,
        "currency": inp.currency,
        "net_investment_in_lease": result.net_investment_in_lease,
        "gross_investment_in_lease": result.gross_investment_in_lease,
        "unearned_finance_income": result.unearned_finance_income,
        "total_finance_income_over_term": round(total_finance_income, 2),
        "selling_profit_loss": result.selling_profit_loss,
        "implicit_rate_pct": round(rate * 100, 4),
        "lease_term_months": inp.lease_term_months,
        "unguaranteed_residual_value": ugr,
        "guaranteed_residual_value": ggr,
        "classification_basis": "IFRS 16 §61–62",
        "recognition_basis": "IFRS 16 §67–80",
    }
    return result


@dataclass
class OperatingLessorResult:
    lease_type: str = "operating"
    asset_carrying_amount: float = 0.0
    annual_depreciation: float = 0.0
    total_lease_income: float = 0.0
    annual_lease_income: float = 0.0
    income_schedule: list[dict] = field(default_factory=list)
    journal_entries: list[dict] = field(default_factory=list)
    summary: dict = field(default_factory=dict)


def calculate_operating_lessor(inp: LessorLeaseInput) -> OperatingLessorResult:
    """IFRS 16 §83–97 — operating lease (lessor)."""
    result = OperatingLessorResult()
    result.asset_carrying_amount = inp.carrying_amount_of_asset or inp.fair_value_of_asset

    periods = _period_count(inp)
    payment = inp.payment_amount
    idc = inp.initial_direct_costs
    total_income = payment * periods
    result.total_lease_income = round(total_income, 2)

    sl_income_per_period = total_income / periods if periods else 0
    result.annual_lease_income = round(
        sl_income_per_period * _periods_per_year(inp.payment_frequency), 2
    )

    useful_life = inp.useful_life_months or inp.lease_term_months
    monthly_depreciation = result.asset_carrying_amount / useful_life if useful_life > 0 else 0
    result.annual_depreciation = round(monthly_depreciation * 12, 2)

    schedule = []
    start = _parse_date(inp.commencement_date)
    asset_balance = result.asset_carrying_amount
    periods_per_year = _periods_per_year(inp.payment_frequency)

    for i in range(1, periods + 1):
        period_date = _advance_date(start, i, inp.payment_frequency)
        depreciation = round(monthly_depreciation * (12 / periods_per_year), 2)
        asset_balance = round(asset_balance - depreciation, 2)
        schedule.append({
            "period": i,
            "date": period_date.isoformat(),
            "cash_received": round(payment, 2),
            "income_recognised_sl": round(sl_income_per_period, 2),
            "difference_deferred": round(payment - sl_income_per_period, 2),
            "asset_depreciation": depreciation,
            "asset_closing_balance": round(max(asset_balance, 0), 2),
        })

    result.income_schedule = schedule

    journals = []
    if idc > 0:
        journals.append({
            "date": inp.commencement_date,
            "description": "Initial direct costs — added to asset carrying amount",
            "entries": [
                {"account": "Underlying Asset (carrying amount)", "debit": idc, "credit": 0},
                {"account": "Cash / Payables", "debit": 0, "credit": idc},
            ],
        })

    if schedule:
        ex = schedule[0]
        journals.append({
            "date": ex["date"],
            "description": "Recurring — lease receipt and straight-line income (period 1 example)",
            "entries": [
                {"account": "Cash / Bank", "debit": ex["cash_received"], "credit": 0},
                {"account": "Lease Income (P&L)", "debit": 0, "credit": ex["income_recognised_sl"]},
                {"account": "Deferred Lease Income", "debit": 0, "credit": max(ex["difference_deferred"], 0)},
                {"account": "Accrued Lease Income", "debit": max(-ex["difference_deferred"], 0), "credit": 0},
            ],
        })
        journals.append({
            "date": ex["date"],
            "description": "Recurring — depreciation of underlying asset (period 1 example)",
            "entries": [
                {"account": "Depreciation Expense (P&L)", "debit": ex["asset_depreciation"], "credit": 0},
                {"account": "Accumulated Depreciation", "debit": 0, "credit": ex["asset_depreciation"]},
            ],
        })

    result.journal_entries = journals
    result.summary = {
        "lease_type": "Operating Lease (Lessor)",
        "currency": inp.currency,
        "asset_carrying_amount": result.asset_carrying_amount,
        "total_lease_income": result.total_lease_income,
        "annual_lease_income_sl": result.annual_lease_income,
        "annual_depreciation": result.annual_depreciation,
        "net_annual_contribution": round(result.annual_lease_income - result.annual_depreciation, 2),
        "income_recognition_basis": "Straight-line over lease term (IFRS 16 §81)",
        "asset_stays_on_balance_sheet": True,
        "lease_term_months": inp.lease_term_months,
        "classification_basis": "IFRS 16 §61–62",
        "recognition_basis": "IFRS 16 §83–97",
    }
    return result


def calculate_lessor(
    inp: LessorLeaseInput,
    classification_indicators: list[str] | None = None,
) -> dict:
    lease_type = classify_lease(inp, classification_indicators)

    if lease_type == "finance":
        result = calculate_finance_lessor(inp)
        return {
            "lease_type": "finance",
            "classification_indicators": classification_indicators or [],
            "summary": result.summary,
            "net_investment_schedule": result.amortization_schedule,
            "journal_entries": result.journal_entries,
            "selling_profit_loss": result.selling_profit_loss,
            "is_dealer_manufacturer": result.is_dealer_manufacturer,
        }

    result = calculate_operating_lessor(inp)
    return {
        "lease_type": "operating",
        "classification_indicators": classification_indicators or [],
        "summary": result.summary,
        "income_schedule": result.income_schedule,
        "journal_entries": result.journal_entries,
    }


def _parse_date(d: str) -> date:
    return datetime.strptime(d, "%Y-%m-%d").date()


def _period_count(inp: LessorLeaseInput) -> int:
    freq = inp.payment_frequency.lower()
    if freq == "monthly":
        return inp.lease_term_months
    if freq == "quarterly":
        return max(1, inp.lease_term_months // 3)
    if freq == "annual":
        return max(1, inp.lease_term_months // 12)
    return inp.lease_term_months


def _periods_per_year(frequency: str) -> float:
    freq = frequency.lower()
    if freq == "monthly":
        return 12
    if freq == "quarterly":
        return 4
    if freq == "annual":
        return 1
    return 12


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


def _pv_of_payments(inp: LessorLeaseInput) -> float:
    period_rate = _period_rate(inp.interest_rate_implicit, inp.payment_frequency)
    return _pv_annuity(inp.payment_amount, period_rate, _period_count(inp), inp.payment_timing)


def _advance_date(start: date, period: int, frequency: str) -> date:
    freq = frequency.lower()
    if freq == "monthly":
        return start + relativedelta(months=period)
    if freq == "quarterly":
        return start + relativedelta(months=period * 3)
    if freq == "annual":
        return start + relativedelta(years=period)
    return start + relativedelta(months=period)
