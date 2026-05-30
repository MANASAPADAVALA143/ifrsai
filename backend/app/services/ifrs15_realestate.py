"""
UAE Real Estate IFRS 15 module — off-plan sales, RERA escrow, modifications, costs, P vs A, VAT.
"""

from __future__ import annotations

import calendar
import copy
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional, Tuple

UAE_CENTRAL_BANK_PEG = 3.6725
DisplayCurrency = Literal["AED", "USD"]
RecognitionTrigger = Literal[
    "rera_completion_certificate",
    "spa_handover_date",
    "earlier_of_both",
]


def completion_pct_from_costs(
    costs_incurred_to_date: float, total_estimated_costs: float
) -> float:
    """Input-method completion % consistent with OffPlanSalesEngine."""
    total_costs = max(float(total_estimated_costs or 0), 1e-9)
    costs_td = float(costs_incurred_to_date or 0)
    return round(min(100.0, max(0.0, (costs_td / total_costs) * 100.0)), 4)


def effective_completion_pct(data: Dict[str, Any]) -> float:
    """Authoritative completion % — RERA certificate overrides cost input method."""
    cert = data.get("rera_certificate_verified_pct")
    if cert is not None:
        return round(min(100.0, max(0.0, float(cert))), 4)
    return completion_pct_from_costs(
        float(data.get("costs_incurred_to_date", 0) or 0),
        float(data.get("total_estimated_costs", 0) or 0),
    )


def validate_rera_registration_number(value: str) -> str:
    """Alphanumeric RERA registration number, 4–20 chars."""
    v = (value or "").strip()
    if not v:
        raise ValueError("RERA registration number is required")
    if len(v) < 4 or len(v) > 20:
        raise ValueError("RERA registration number must be 4–20 characters")
    if not re.match(r"^[A-Za-z0-9\-]+$", v):
        raise ValueError("RERA registration number must be alphanumeric (hyphens allowed)")
    return v


def _escrow_cumulative_by_date(
    escrow_receipts: List[Dict[str, Any]], as_of: date
) -> float:
    total = 0.0
    for r in escrow_receipts or []:
        rd = _parse_date(r.get("date"))
        if rd and rd <= as_of:
            total += float(r.get("amount", 0) or 0)
    return round(total, 2)


def resolve_recognition_trigger(data: Dict[str, Any]) -> Dict[str, Any]:
    """Handover / RERA completion trigger for final recognition date (IFRS 15.38)."""
    trigger = str(
        data.get("revenue_recognition_trigger") or "earlier_of_both"
    ).lower()
    rera_d = _parse_date(data.get("rera_completion_date"))
    spa_d = _parse_date(data.get("spa_handover_date")) or _parse_date(
        data.get("expected_handover")
    )

    warning: Optional[str] = None
    if rera_d and spa_d:
        diff_days = abs((rera_d - spa_d).days)
        if diff_days > 90:
            warning = (
                f"WARNING: RERA completion and SPA handover differ by {diff_days} days. "
                "Confirm revenue trigger with legal counsel per IFRS 15 para 38."
            )

    if trigger == "rera_completion_certificate":
        effective = rera_d
        summary = (
            f"Revenue recognition trigger: RERA completion certificate"
            + (f" ({effective.isoformat()})" if effective else " — date not provided")
        )
    elif trigger == "spa_handover_date":
        effective = spa_d
        summary = (
            f"Revenue recognition trigger: SPA handover date"
            + (f" ({effective.isoformat()})" if effective else " — date not provided")
        )
    else:
        dates = [d for d in (rera_d, spa_d) if d]
        effective = min(dates) if dates else spa_d
        summary = (
            "Revenue recognition trigger: earlier of RERA completion and SPA handover"
            + (f" → {effective.isoformat()}" if effective else "")
        )

    return {
        "revenue_recognition_trigger": trigger,
        "rera_completion_date": rera_d.isoformat() if rera_d else None,
        "spa_handover_date": spa_d.isoformat() if spa_d else None,
        "effective_recognition_date": effective.isoformat() if effective else None,
        "trigger_warning": warning,
        "recognition_trigger_summary": summary,
    }


def _recognition_end_date(data: Dict[str, Any]) -> Optional[date]:
    trig = resolve_recognition_trigger(data)
    return _parse_date(trig.get("effective_recognition_date")) or _parse_date(
        data.get("expected_handover")
    )


def build_realestate_disclosure_text(data: Dict[str, Any], report: Dict[str, Any]) -> str:
    """Synthetic disclosure narrative for IFRS 15.110–129 scoring."""
    off = report.get("off_plan") or {}
    trig = report.get("recognition_trigger") or {}
    spa = data.get("spa") or {}
    lines = [
        "IFRS 15 revenue from contracts with customers — UAE real estate off-plan sales.",
        f"Project: {data.get('project_name') or spa.get('project_name') or 'N/A'}.",
        f"RERA registration number: {data.get('rera_registration_number', 'N/A')}.",
        f"Revenue recognition policy: {trig.get('recognition_trigger_summary', 'over time input method')}.",
        "Performance obligation: transfer of residential unit under construction — "
        "distinct good recognised over time per IFRS 15.35(c).",
        f"Transaction price allocated to performance obligation: AED {float(data.get('contract_value', 0) or 0):,.2f}.",
        f"Contract balances: contract asset AED {float(off.get('contract_asset', 0) or 0):,.2f}, "
        f"contract liability AED {float(off.get('contract_liability', 0) or 0):,.2f}.",
        f"Remaining performance obligation (unsatisfied): AED {float(off.get('remaining_revenue', 0) or 0):,.2f}.",
        "Significant judgement: estimation of costs to complete and RERA escrow milestone timing.",
        "Disaggregation: geography UAE, product residential off-plan, timing over time.",
        "Contract modifications: assessed per IFRS 15.18–21 where applicable.",
    ]
    vc = spa.get("variable_consideration") or data.get("variable_consideration_notes")
    if vc:
        lines.append(f"Variable consideration: {vc}")
    return "\n".join(lines)


def score_realestate_disclosure(data: Dict[str, Any], report: Dict[str, Any]) -> Dict[str, Any]:
    from ifrs15_calculator import IFRS15DisclosureScorer

    text = build_realestate_disclosure_text(data, report)
    raw = IFRS15DisclosureScorer().score(text, report)
    pct = float(raw.get("quality_pct") or 0)
    gaps: List[Dict[str, str]] = []
    for key, crit in (raw.get("criteria_scores") or {}).items():
        for issue in (crit or {}).get("issues") or []:
            gaps.append(
                {
                    "criterion": key.replace("_", " ").title(),
                    "gap": issue,
                    "ifrs_reference": "IFRS 15.110–129",
                }
            )
    for sug in (raw.get("improvement_suggestions") or [])[:5]:
        if isinstance(sug, str):
            gaps.append(
                {"criterion": "Improvement", "gap": sug, "ifrs_reference": "IFRS 15.110–129"}
            )
    return {
        "disclosure_score": round(pct, 1),
        "disclosure_score_raw": raw.get("total_score"),
        "disclosure_quality_level": raw.get("quality_level"),
        "disclosure_gaps": gaps,
        "disclosure_score_detail": raw,
    }


def validate_realestate_health(report: Dict[str, Any]) -> Dict[str, Any]:
    """Health monitor checks A/B/C for real estate report."""
    from backend.app.services.rera_escrow_validator import validate_escrow_release

    schedule = list(report.get("period_schedule") or [])
    off = report.get("off_plan") or {}
    vat_rows = list((report.get("vat") or {}).get("alignment_table") or [])
    rev_td = float(off.get("revenue_recognised_to_date") or 0)
    cv = float(report.get("contract_value") or 0)

    sum_period = round(
        sum(float(r.get("revenue_recognised") or 0) for r in schedule), 2
    )
    check_a = abs(sum_period - rev_td) <= 1.0
    msg_a = (
        f"Schedule sum {sum_period:,.2f} vs revenue to date {rev_td:,.2f} (tolerance ±1)"
        if check_a
        else f"FAIL: period revenue sum {sum_period:,.2f} != recognised to date {rev_td:,.2f}"
    )

    escrow_receipts = list(report.get("escrow_receipts") or [])
    if not escrow_receipts and (report.get("escrow") or {}).get("escrow_receipts"):
        escrow_receipts = list((report.get("escrow") or {}).get("escrow_receipts") or [])
    first_escrow: Optional[date] = None
    for r in escrow_receipts:
        rd = _parse_date(r.get("date"))
        if rd and (first_escrow is None or rd < first_escrow):
            first_escrow = rd

    check_b1 = True
    msg_b_parts: List[str] = []
    for row in schedule:
        pr = float(row.get("revenue_recognised") or 0)
        esc = float(row.get("cumulative_escrow_received") or 0)
        pe = _parse_date(row.get("period_end"))
        if pr <= 0:
            continue
        if first_escrow and pe and pe < first_escrow:
            continue
        if esc <= 0:
            check_b1 = False
            msg_b_parts.append(
                f"{row.get('period')}: revenue {pr:,.2f} but zero escrow received"
            )
    msg_b1 = (
        "All revenue periods have escrow received (RERA Art. 8)"
        if check_b1
        else "FAIL: " + "; ".join(msg_b_parts)
    )

    releases = list(report.get("escrow_releases") or [])
    completion_pct_b2 = float((report.get("off_plan") or {}).get("completion_pct") or 0)
    cv_esc = float(report.get("contract_value") or 0)
    escrow_val = validate_escrow_release([], releases, completion_pct_b2, cv_esc)
    check_b2_pass = not escrow_val.is_violation
    msg_b2 = (
        "Escrow release ≤ construction completion (Law 8/2007 Art. 8)"
        if check_b2_pass
        else escrow_val.violation_message
    )
    check_b_pass = check_b1 and check_b2_pass

    check_c = True
    msg_c_parts: List[str] = []
    for row in vat_rows:
        rev = float(row.get("revenue_recognised") or 0)
        vat = float(row.get("vat_5pct") or 0)
        expected = round(rev * 0.05, 2)
        if abs(vat - expected) > 1.0:
            check_c = False
            msg_c_parts.append(
                f"{row.get('period')}: VAT {vat} vs expected {expected}"
            )
    msg_c = (
        "VAT aligned at 5% per quarter"
        if check_c
        else "FAIL: " + "; ".join(msg_c_parts)
    )

    details = [f"A: {msg_a}", f"B1: {msg_b1}", f"B2: {msg_b2}", f"C: {msg_c}"]
    return {
        "check_a_pass": check_a,
        "check_b1_pass": check_b1,
        "check_b2_pass": check_b2_pass,
        "check_b_pass": check_b_pass,
        "check_c_pass": check_c,
        "overall_pass": check_a and check_b_pass and check_c,
        "details": details,
        "detail_b_escrow_art8": escrow_val.model_dump(),
    }


def apply_currency_display(
    report: Dict[str, Any], currency: str, exchange_rate: float = UAE_CENTRAL_BANK_PEG
) -> Dict[str, Any]:
    """Convert AED-internal amounts for API/Excel display."""
    out = copy.deepcopy(report)
    cur = (currency or "AED").upper()
    rate = float(exchange_rate or UAE_CENTRAL_BANK_PEG)
    if cur not in ("AED", "USD"):
        cur = "AED"
    divisor = 1.0 if cur == "AED" else rate

    def div(v: Any) -> Any:
        if isinstance(v, (int, float)):
            return round(float(v) / divisor, 2)
        return v

    for block_key in ("off_plan", "escrow", "contract_costs", "cancellation_refund"):
        block = out.get(block_key)
        if not isinstance(block, dict):
            continue
        for k, v in list(block.items()):
            if k.endswith("_pct") or k in ("completion_pct", "recognition_basis"):
                continue
            if isinstance(v, (int, float)) and k not in ("developer_score", "agent_score"):
                block[k] = div(v)
            elif k == "journal_entries" and isinstance(v, list):
                for je in v:
                    if isinstance(je, dict) and "amount" in je:
                        je["amount"] = div(je["amount"])

    for row in out.get("period_schedule") or []:
        if isinstance(row, dict):
            for k in ("revenue_recognised", "cumulative_revenue", "cumulative_escrow_received"):
                if k in row:
                    row[k] = div(row[k])

    vat = out.get("vat")
    if isinstance(vat, dict):
        vat["total_revenue"] = div(vat.get("total_revenue"))
        vat["total_vat"] = div(vat.get("total_vat"))
        for row in vat.get("alignment_table") or []:
            if isinstance(row, dict):
                row["revenue_recognised"] = div(row.get("revenue_recognised"))
                row["vat_5pct"] = div(row.get("vat_5pct"))
                row["currency"] = cur

    out["currency"] = cur
    out["exchange_rate"] = rate
    out["amounts_stored_in"] = "AED"
    out["currency_note"] = (
        "All amounts in AED"
        if cur == "AED"
        else f"All amounts in USD (1 USD = {rate} AED)"
    )
    return out


def _parse_date(value: str | date | None) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    s = str(value).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _quarter_label(d: date) -> str:
    q = (d.month - 1) // 3 + 1
    return f"Q{q} {d.year}"


def _quarter_start(d: date) -> date:
    q = (d.month - 1) // 3
    return date(d.year, q * 3 + 1, 1)


def _spa_execution_date(data: Dict[str, Any]) -> Optional[date]:
    """SPA / contract execution date — revenue cannot start before IFRS 15.9 contract exists."""
    for key in (
        "spa_execution_date",
        "contract_date",
        "spa_contract_date",
        "agreement_date",
    ):
        d = _parse_date(data.get(key))
        if d:
            return d
    for src in (data.get("spa_mapped") or {}, data.get("spa") or {}):
        if not isinstance(src, dict):
            continue
        for key in (
            "execution_date",
            "contract_date",
            "agreement_date",
            "effective_date",
            "signing_date",
        ):
            d = _parse_date(src.get(key))
            if d:
                return d
    return None


def _schedule_start_date(data: Dict[str, Any]) -> Optional[date]:
    """Later of construction start and SPA execution (contract inception)."""
    construction = _parse_date(data.get("construction_start"))
    spa = _spa_execution_date(data)
    if construction and spa:
        return max(construction, spa)
    return spa or construction


def _period_bounds_for_quarter_end(q_end: date, schedule_start: date) -> Tuple[str, str]:
    qs = _quarter_start(q_end)
    period_start = max(schedule_start, qs)
    return period_start.isoformat(), q_end.isoformat()


OVER_TIME_RECOGNITION_NOTE = (
    "Revenue recognised over time (IFRS 15.35(c), input method) — the handover / RERA "
    "completion trigger applies to final satisfaction of the performance obligation, not "
    "to periodic percentage-of-completion recognition."
)


def _quarter_end_dates(start: date, end: date) -> List[date]:
    """Quarter-end dates strictly after start through end (inclusive)."""
    results: List[date] = []
    y, m = start.year, start.month
    q = (m - 1) // 3 + 1
    q_month = q * 3
    while True:
        last = calendar.monthrange(y, q_month)[1]
        qe = date(y, q_month, last)
        if qe > end:
            break
        if qe > start:
            results.append(qe)
        if q_month == 12:
            y += 1
            q_month = 3
        else:
            q_month += 3
    return results


def generate_quarterly_revenue_schedule(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Quarterly revenue from contract inception (SPA date) using input-method cost curve."""
    schedule_start = _schedule_start_date(data)
    end = _recognition_end_date(data)
    current = _parse_date(data.get("current_date"))
    if not schedule_start or not end or not current:
        return []

    cv = float(data.get("contract_value", 0) or 0)
    total_costs = max(float(data.get("total_estimated_costs", 0) or 0), 1e-9)
    costs_to_date = float(data.get("costs_incurred_to_date", 0) or 0)
    cap_date = min(current, end)
    span_days = max((cap_date - schedule_start).days, 1)
    escrow_receipts = list(data.get("escrow_receipts") or [])

    quarter_ends = [d for d in _quarter_end_dates(schedule_start, cap_date) if d <= cap_date]
    if not quarter_ends or quarter_ends[-1] < cap_date:
        quarter_ends.append(cap_date)
    quarter_ends = sorted(set(quarter_ends))

    prior_revenue = 0.0
    schedule: List[Dict[str, Any]] = []
    for q_end in quarter_ends:
        if q_end < cap_date:
            elapsed = max((q_end - schedule_start).days, 0)
            frac = min(1.0, elapsed / span_days)
            cum_cost = frac * costs_to_date
        else:
            cum_cost = costs_to_date
        completion = min(100.0, (cum_cost / total_costs) * 100.0)
        cum_rev = round(cv * (completion / 100.0), 2)
        period_rev = round(cum_rev - prior_revenue, 2)
        prior_revenue = cum_rev
        period_start, period_end = _period_bounds_for_quarter_end(q_end, schedule_start)
        schedule.append(
            {
                "period": _quarter_label(q_end),
                "quarter": _quarter_label(q_end),
                "period_start": period_start,
                "period_end": period_end,
                "completion_pct": round(completion, 1),
                "revenue_recognised": period_rev,
                "revenue": period_rev,
                "cumulative_revenue": cum_rev,
                "cumulative_escrow_received": _escrow_cumulative_by_date(
                    escrow_receipts, q_end
                ),
                "fta_filing_period": f"{q_end.year}-Q{(q_end.month - 1) // 3 + 1}",
            }
        )
    return schedule


def _sum_escrow(escrow_receipts: List[Dict[str, Any]]) -> float:
    return round(sum(float(r.get("amount", 0) or 0) for r in (escrow_receipts or [])), 2)


def _sum_billings(billings: List[Dict[str, Any]] | None, escrow_receipts: List[Dict[str, Any]]) -> float:
    if billings:
        return round(sum(float(b.get("amount", 0) or 0) for b in billings), 2)
    return _sum_escrow(escrow_receipts)


@dataclass
class OffPlanInput:
    contract_value: float
    construction_start: str
    expected_handover: str
    current_date: str
    costs_incurred_to_date: float
    total_estimated_costs: float
    escrow_receipts: List[Dict[str, Any]]
    revenue_prior_period: float = 0.0
    billings: Optional[List[Dict[str, Any]]] = None


class OffPlanSalesEngine:
    """IFRS 15.35(c) — revenue over time via input method (% completion)."""

    def calculate(self, data: Dict[str, Any]) -> Dict[str, Any]:
        inp = OffPlanInput(
            contract_value=float(data.get("contract_value", 0) or 0),
            construction_start=str(data.get("construction_start", "")),
            expected_handover=str(data.get("expected_handover", "")),
            current_date=str(data.get("current_date", "")),
            costs_incurred_to_date=float(data.get("costs_incurred_to_date", 0) or 0),
            total_estimated_costs=float(data.get("total_estimated_costs", 0) or 0),
            escrow_receipts=list(data.get("escrow_receipts") or []),
            revenue_prior_period=float(data.get("revenue_prior_period", 0) or 0),
            billings=data.get("billings"),
        )
        cert_pct = data.get("rera_certificate_verified_pct")
        if cert_pct is not None:
            completion_pct = round(min(100.0, max(0.0, float(cert_pct))), 1)
        else:
            total_costs = max(inp.total_estimated_costs, 1e-9)
            completion_pct = round(
                min(100.0, max(0.0, (inp.costs_incurred_to_date / total_costs) * 100.0)), 1
            )
        revenue_to_date = round(inp.contract_value * (completion_pct / 100.0), 2)
        revenue_current = round(revenue_to_date - inp.revenue_prior_period, 2)
        billings_to_date = _sum_billings(inp.billings, inp.escrow_receipts)
        diff = round(revenue_to_date - billings_to_date, 2)
        contract_asset = diff if diff > 0 else 0.0
        contract_liability = round(-diff, 2) if diff < 0 else 0.0
        escrow_balance = _sum_escrow(inp.escrow_receipts)
        remaining_revenue = round(max(0.0, inp.contract_value - revenue_to_date), 2)

        handover_d = _parse_date(inp.expected_handover)
        estimated_handover = _quarter_label(handover_d) if handover_d else inp.expected_handover

        current_d = _parse_date(inp.current_date)
        period_label = _quarter_label(current_d) if current_d else "current period"

        journal_entries: List[Dict[str, Any]] = []
        if abs(revenue_current) > 1e-6:
            journal_entries.append(
                {
                    "dr": "Contract Asset" if revenue_current > 0 else "Revenue",
                    "cr": "Revenue" if revenue_current > 0 else "Contract Asset",
                    "amount": abs(revenue_current),
                    "narrative": (
                        f"Revenue recognised {period_label} — {completion_pct}% completion "
                        f"(IFRS 15.35(c), input method)"
                    ),
                }
            )

        return {
            "completion_pct": completion_pct,
            "revenue_recognised_to_date": revenue_to_date,
            "revenue_current_period": revenue_current,
            "contract_asset": contract_asset,
            "contract_liability": contract_liability,
            "billings_to_date": billings_to_date,
            "escrow_balance": escrow_balance,
            "remaining_revenue": remaining_revenue,
            "estimated_handover": estimated_handover,
            "recognition_basis": "over_time_input_method",
            "journal_entries": journal_entries,
        }


class ReraEscrowTracker:
    """RERA escrow receipts vs milestone releases — revenue at later of completion % or release."""

    def analyse(self, data: Dict[str, Any]) -> Dict[str, Any]:
        contract_value = float(data.get("contract_value", 0) or 0)
        cert_pct = data.get("rera_certificate_verified_pct")
        if cert_pct is not None:
            completion_pct = min(100.0, max(0.0, float(cert_pct)))
        else:
            costs_incurred = float(data.get("costs_incurred_to_date", 0) or 0)
            total_costs = max(float(data.get("total_estimated_costs", 0) or 0), 1e-9)
            completion_pct = min(100.0, max(0.0, (costs_incurred / total_costs) * 100.0))

        escrow_receipts = list(data.get("escrow_receipts") or [])
        milestones = list(data.get("milestone_releases") or [])
        revenue_prior = float(data.get("revenue_prior_period", 0) or 0)

        cumulative_escrow = 0.0
        cumulative_released = 0.0
        timeline: List[Dict[str, Any]] = []

        all_events: List[Tuple[str, str, Dict[str, Any]]] = []
        for r in escrow_receipts:
            all_events.append(("receipt", str(r.get("date", "")), r))
        for m in milestones:
            all_events.append(("release", str(m.get("milestone", m.get("date", ""))), m))

        all_events.sort(key=lambda x: x[1])

        revenue_recognised_cumulative = revenue_prior
        for event_type, _key, payload in all_events:
            if event_type == "receipt":
                amt = float(payload.get("amount", 0) or 0)
                cumulative_escrow = round(cumulative_escrow + amt, 2)
                timeline.append(
                    {
                        "type": "escrow_receipt",
                        "date": payload.get("date"),
                        "unit_id": payload.get("unit_id"),
                        "buyer_name": payload.get("buyer_name"),
                        "amount": amt,
                        "escrow_balance": cumulative_escrow,
                    }
                )
            else:
                pct_req = float(payload.get("completion_pct_required", 0) or 0)
                released = float(payload.get("amount_released", 0) or 0)
                cumulative_released = round(cumulative_released + released, 2)
                pct_completion_at_release = completion_pct
                gate_pct = max(pct_completion_at_release, pct_req)
                revenue_at_gate = round(contract_value * (gate_pct / 100.0), 2)
                revenue_recognised_cumulative = max(revenue_recognised_cumulative, revenue_at_gate)
                timeline.append(
                    {
                        "type": "milestone_release",
                        "milestone": payload.get("milestone"),
                        "completion_pct_required": pct_req,
                        "amount_released": released,
                        "revenue_recognised_to_date": revenue_recognised_cumulative,
                        "timing_rule": "later_of_completion_or_escrow_release",
                    }
                )

        cost_based_revenue = round(contract_value * (completion_pct / 100.0), 2)
        revenue_to_date = round(max(cost_based_revenue, revenue_recognised_cumulative), 2)
        revenue_current = round(revenue_to_date - revenue_prior, 2)

        return {
            "completion_pct": round(completion_pct, 1),
            "escrow_balance": cumulative_escrow,
            "total_released_to_developer": cumulative_released,
            "revenue_recognised_to_date": revenue_to_date,
            "revenue_current_period": revenue_current,
            "timeline": timeline,
            "escrow_receipts": escrow_receipts,
            "milestone_releases": milestones,
        }


class RealEstateModificationEngine:
    """UAE contract modifications — prospective vs cumulative catch-up (IFRS 15.18–21)."""

    def assess(self, data: Dict[str, Any]) -> Dict[str, Any]:
        original = data.get("original_contract") or {}
        mod_type = str(data.get("modification_type", "")).lower()
        details = data.get("modification_details") or {}

        orig_value = float(original.get("value", 0) or 0)
        completion_pct = float(original.get("completion_pct", 0) or 0) / 100.0
        revenue_to_date = round(orig_value * completion_pct, 2)

        if mod_type == "price_change":
            new_price = float(details.get("new_price", orig_value) or orig_value)
            new_revenue_to_date = round(new_price * completion_pct, 2)
            adjustment = round(new_revenue_to_date - revenue_to_date, 2)
            treatment = "cumulative_catch_up"
            narrative = (
                "Price change treated as modification of existing contract — "
                "cumulative catch-up per IFRS 15.21(b)"
            )
            if adjustment < 0:
                journal = {"dr": "Revenue", "cr": "Contract Liability", "amount": abs(adjustment)}
            elif adjustment > 0:
                journal = {"dr": "Contract Asset", "cr": "Revenue", "amount": adjustment}
            else:
                journal = {"dr": "", "cr": "", "amount": 0}

        elif mod_type == "unit_swap":
            treatment = "prospective_new_contract"
            adjustment = 0.0
            narrative = (
                "Unit swap — distinct new good/service; account as separate contract "
                "prospectively per IFRS 15.21(a)"
            )
            journal = {"dr": "", "cr": "", "amount": 0}

        elif mod_type == "cancellation":
            refund = float(details.get("refund_amount", orig_value) or 0)
            adjustment = round(-revenue_to_date, 2)
            treatment = "cumulative_catch_up"
            narrative = (
                f"Cancellation — reverse revenue recognised to date; "
                f"refund from escrow AED {refund:,.2f}"
            )
            journal = {
                "dr": "Contract Liability",
                "cr": "Revenue",
                "amount": abs(adjustment) if adjustment else refund,
            }

        elif mod_type == "extension":
            treatment = "cumulative_catch_up"
            adjustment = 0.0
            new_date = details.get("new_date", "")
            narrative = (
                f"Handover extension to {new_date} — update over-time measure; "
                "no immediate revenue adjustment unless transaction price changes"
            )
            journal = {"dr": "", "cr": "", "amount": 0}

        else:
            treatment = "requires_judgment"
            adjustment = 0.0
            narrative = f"Unknown modification type: {mod_type}"
            journal = {"dr": "", "cr": "", "amount": 0}

        return {
            "treatment": treatment,
            "modification_type": mod_type,
            "revenue_adjustment": adjustment,
            "journal_entry": journal,
            "narrative": narrative,
        }


class RealEstateContractCostsEngine:
    """IFRS 15.91 — sales commissions capitalised when amortisation > 1 year."""

    def calculate(self, data: Dict[str, Any]) -> Dict[str, Any]:
        commission = float(data.get("commission_paid", 0) or 0)
        contract_value = float(data.get("contract_value", 0) or 0)
        months = max(int(data.get("expected_amortisation_period", 12) or 12), 1)
        capitalise = months > 12

        if not capitalise:
            return {
                "capitalise": False,
                "asset_recognised": 0.0,
                "expensed_immediately": commission,
                "monthly_amortisation": 0.0,
                "amortisation_schedule": [],
                "journal_entries": [
                    {
                        "dr": "Commission Expense",
                        "cr": "Cash / Payable",
                        "amount": commission,
                        "narrative": "Commission expensed — amortisation period ≤ 12 months (IFRS 15.94)",
                    }
                ],
                "contract_value": contract_value,
            }

        monthly = round(commission / months, 2)
        schedule: List[Dict[str, Any]] = []
        opening = commission
        for m in range(1, months + 1):
            charge = monthly if m < months else round(opening, 2)
            closing = round(opening - charge, 2)
            schedule.append(
                {"month": m, "opening": round(opening, 2), "charge": charge, "closing": closing}
            )
            opening = closing

        return {
            "capitalise": True,
            "asset_recognised": commission,
            "expensed_immediately": 0.0,
            "monthly_amortisation": monthly,
            "amortisation_schedule": schedule,
            "journal_entries": [
                {
                    "dr": "Contract Cost Asset",
                    "cr": "Cash / Payable",
                    "amount": commission,
                    "narrative": "Capitalise sales commission (IFRS 15.91)",
                },
                {
                    "dr": "Amortisation Expense",
                    "cr": "Contract Cost Asset",
                    "amount": monthly,
                    "narrative": f"Monthly amortisation — {months} months straight-line",
                },
            ],
            "contract_value": contract_value,
        }


class RealEstatePrincipalAgentChecker:
    """UAE developer vs agent — gross vs net (IFRS 15.B34–B38)."""

    CHECKLIST = [
        ("controls_before_transfer", "Who controls the property before transfer to buyer?"),
        ("inventory_risk", "Who bears inventory / completion risk?"),
        ("pricing_discretion", "Who sets the price?"),
        ("credit_risk", "Who accepts buyer credit risk?"),
    ]

    def assess(self, data: Dict[str, Any]) -> Dict[str, Any]:
        developer_scores = 0
        agent_scores = 0
        checklist_results: List[Dict[str, Any]] = []

        for key, question in self.CHECKLIST:
            party = str(data.get(key, "developer")).lower()
            is_developer = party in ("developer", "yes", "true", "1")
            if is_developer:
                developer_scores += 1
            else:
                agent_scores += 1
            checklist_results.append(
                {"factor": key, "question": question, "party": "developer" if is_developer else "agent"}
            )

        gross = float(data.get("gross_contract_value", data.get("contract_value", 0)) or 0)
        commission = float(data.get("agent_commission", 0) or 0)

        if developer_scores >= 3:
            conclusion = "PRINCIPAL"
            revenue_basis = "GROSS"
            net_revenue = None
            assessment = (
                "Developer controls unit before transfer, bears price and inventory risk — "
                f"gross revenue recognition (score {developer_scores}/4 developer indicators)."
            )
        else:
            conclusion = "AGENT"
            revenue_basis = "NET"
            net_revenue = commission if commission > 0 else round(gross * 0.03, 2)
            assessment = (
                "Agent arrangement — recognise net commission only per IFRS 15.B34–B38 "
                f"(score {agent_scores}/4 agent indicators)."
            )

        return {
            "conclusion": conclusion,
            "revenue_basis": revenue_basis,
            "gross_revenue": gross if conclusion == "PRINCIPAL" else None,
            "net_revenue": net_revenue,
            "developer_score": developer_scores,
            "agent_score": agent_scores,
            "checklist": checklist_results,
            "assessment": assessment,
        }


class UaeVatTimingEngine:
    """UAE 5% VAT aligned to IFRS 15 revenue recognition periods."""

    VAT_RATE = 0.05

    def align(self, data: Dict[str, Any]) -> Dict[str, Any]:
        schedule = list(data.get("revenue_schedule") or [])
        currency = str(data.get("currency", "AED"))

        if not schedule and data.get("revenue_current_period") is not None:
            schedule = [
                {
                    "period": data.get("period", "Current"),
                    "revenue_recognised": float(data.get("revenue_current_period", 0) or 0),
                    "fta_filing_period": data.get("fta_filing_period", ""),
                }
            ]

        rows: List[Dict[str, Any]] = []
        total_rev = 0.0
        total_vat = 0.0
        for item in schedule:
            period = str(item.get("period", ""))
            rev = round(float(item.get("revenue_recognised", 0) or 0), 2)
            vat = round(rev * self.VAT_RATE, 2)
            fta = str(item.get("fta_filing_period", item.get("fta_period", "")))
            rows.append(
                {
                    "period": period,
                    "revenue_recognised": rev,
                    "vat_5pct": vat,
                    "fta_filing_period": fta,
                    "currency": currency,
                }
            )
            total_rev += rev
            total_vat += vat

        return {
            "vat_rate_pct": 5.0,
            "currency": currency,
            "alignment_table": rows,
            "total_revenue": round(total_rev, 2),
            "total_vat": round(total_vat, 2),
            "note": "VAT output tax triggered at revenue recognition milestone (aligned with IFRS 15 schedule).",
        }


def _months_between(start: Optional[date], end: Optional[date], default: int = 24) -> int:
    if not start or not end or end <= start:
        return default
    return max(1, (end.year - start.year) * 12 + (end.month - start.month))


class CancellationRefundEngine:
    """UAE Law No. 8 of 2007 Article 11 — cancellation refund waterfall."""

    def calculate(self, data: Dict[str, Any]) -> Dict[str, Any]:
        contract_price = float(data.get("contract_price", 0) or 0)
        amount_paid = float(data.get("amount_paid_by_buyer", 0) or 0)
        completion = min(
            100.0, max(0.0, float(data.get("construction_completion_pct", 0) or 0))
        )
        escrow_balance = float(data.get("escrow_balance", 0) or 0)
        reason = str(data.get("cancellation_reason") or "buyer_default").lower()
        warnings: List[str] = []

        if reason == "buyer_default":
            if completion < 30:
                developer_keeps = min(amount_paid, contract_price * 0.25)
            elif completion < 60:
                developer_keeps = min(amount_paid, contract_price * 0.35)
            elif completion < 80:
                developer_keeps = min(amount_paid, contract_price * 0.40)
            else:
                developer_keeps = min(amount_paid, contract_price * 0.50)
            buyer_refund = round(amount_paid - developer_keeps, 2)
            developer_keeps = round(developer_keeps, 2)
        elif reason == "developer_default":
            developer_keeps = 0.0
            buyer_refund = round(amount_paid, 2)
            warnings.append(
                "Developer default — buyer entitled to full refund; compensation may apply separately."
            )
        else:
            developer_keeps = round(min(amount_paid, contract_price * 0.30), 2)
            buyer_refund = round(amount_paid - developer_keeps, 2)

        escrow_to_buyer = round(min(buyer_refund, escrow_balance), 2)
        escrow_to_developer = round(
            min(developer_keeps, max(0.0, escrow_balance - escrow_to_buyer)), 2
        )
        shortfall = round(max(0.0, buyer_refund - escrow_balance), 2)
        if shortfall > 0:
            warnings.append(
                f"Escrow shortfall AED {shortfall:,.2f} — developer must fund refund outside escrow."
            )

        revenue_recognised = round(contract_price * (completion / 100.0), 2)
        ifrs15_revenue_reversal = revenue_recognised

        journal_entries = [
            {
                "dr": "Revenue",
                "cr": "Contract Liability",
                "amount": ifrs15_revenue_reversal,
                "narrative": "Reverse revenue on cancellation — IFRS 15 modification",
            },
            {
                "dr": "Contract Liability",
                "cr": "Payable to Buyer (Escrow)",
                "amount": escrow_to_buyer,
                "narrative": "Release escrow to buyer per Law 8/2007 Art. 11",
            },
        ]
        if escrow_to_developer > 0:
            journal_entries.append(
                {
                    "dr": "Cash / Escrow",
                    "cr": "Contract Liability",
                    "amount": escrow_to_developer,
                    "narrative": "Developer retention released from escrow",
                }
            )

        return {
            "developer_retention_amount": developer_keeps,
            "buyer_refund_amount": buyer_refund,
            "escrow_release_to_buyer": escrow_to_buyer,
            "escrow_release_to_developer": escrow_to_developer,
            "escrow_shortfall": shortfall,
            "ifrs15_revenue_reversal": ifrs15_revenue_reversal,
            "journal_entries": journal_entries,
            "law_reference": "UAE Law No. 8 of 2007, Article 11",
            "warning_flags": warnings,
            "rera_registration_number": data.get("rera_registration_number"),
            "cancellation_reason": reason,
        }


def build_ifrs15_calculate_payload(
    *,
    off_plan: Dict[str, Any],
    spa: Optional[Dict[str, Any]] = None,
    spa_mapped: Optional[Dict[str, Any]] = None,
    construction_start: str = "",
    expected_handover: str = "",
    contract_value: float = 0.0,
    costs_incurred: float = 0.0,
    total_costs: float = 0.0,
    revenue_prior: float = 0.0,
    escrow_total: float = 0.0,
    rera_registration_number: str = "",
    project_name: str = "",
    revenue_recognition_trigger: str = "earlier_of_both",
    recognition_trigger_summary: str = "",
    currency: str = "AED",
    exchange_rate: float = UAE_CENTRAL_BANK_PEG,
) -> Dict[str, Any]:
    """Map UAE real estate off-plan results into main IFRS 15 /calculate request body."""
    spa = spa or {}
    mapped = spa_mapped or {}
    cv = float(contract_value or mapped.get("contract_value") or spa.get("total_contract_price") or 0)
    start_s = construction_start or str(mapped.get("construction_start") or "")
    end_s = expected_handover or str(mapped.get("expected_handover") or spa.get("handover_date") or "")
    start_d = _parse_date(start_s)
    end_d = _parse_date(end_s)
    term = _months_between(start_d, end_d)

    unit = str(spa.get("property_unit_number") or mapped.get("unit_id") or "UNIT")
    buyer = str(spa.get("buyer_name") or mapped.get("customer_name") or "Buyer")
    developer = str(spa.get("developer_name") or mapped.get("vendor_name") or "Developer")
    eff = start_s[:10] if start_s else "2024-01-01"

    billings = float(off_plan.get("billings_to_date") or escrow_total or 0)
    return {
        "contract_id": f"RE-{unit}",
        "customer_name": buyer,
        "vendor_name": developer,
        "effective_date": eff,
        "contract_term_months": term,
        "fixed_consideration": cv,
        "variable_consideration": 0.0,
        "currency": "AED",
        "cash_received": billings,
        "contract_type": "fixed_price",
        "total_estimated_cost": float(total_costs or 0),
        "actual_cost_to_date": float(costs_incurred or 0),
        "prior_revenue_recognised": float(revenue_prior or 0),
        "cumulative_billed": billings,
        "performance_obligations": [
            {
                "obligation_id": "PO-RE-1",
                "description": f"Off-plan unit {unit} — construction (IFRS 15.35c)",
                "standalone_selling_price": cv,
                "recognition_method": "over_time",
                "duration_months": term,
                "transfer_date": end_s[:10] if end_s else None,
            }
        ],
        "realestate_overlay": {
            "completion_pct": off_plan.get("completion_pct"),
            "revenue_recognised_to_date": off_plan.get("revenue_recognised_to_date"),
            "revenue_current_period": off_plan.get("revenue_current_period"),
            "contract_asset": off_plan.get("contract_asset"),
            "contract_liability": off_plan.get("contract_liability"),
            "escrow_balance": off_plan.get("escrow_balance"),
            "project_name": project_name or spa.get("project_name") or mapped.get("project_name"),
            "rera_registration_number": rera_registration_number,
            "revenue_recognition_trigger": revenue_recognition_trigger,
            "recognition_trigger_summary": recognition_trigger_summary,
            "currency": currency,
            "exchange_rate": exchange_rate,
        },
    }


class RealEstateReportEngine:
    """Full UAE real estate IFRS 15 report — off-plan, escrow, VAT schedule, optional modules."""

    def build(self, data: Dict[str, Any]) -> Dict[str, Any]:
        rera = validate_rera_registration_number(
            str(data.get("rera_registration_number") or "")
        )
        data = {**data, "rera_registration_number": rera}
        recognition_trigger = resolve_recognition_trigger(data)

        off_plan = OffPlanSalesEngine().calculate(data)
        escrow_result = None
        if data.get("escrow_receipts") or data.get("milestone_releases"):
            escrow_result = ReraEscrowTracker().analyse(data)

        period_schedule = generate_quarterly_revenue_schedule(data)
        vat = UaeVatTimingEngine().align(
            {"revenue_schedule": period_schedule, "currency": "AED"}
        )

        costs_result = None
        if data.get("commission_paid") is not None:
            costs_result = RealEstateContractCostsEngine().calculate(
                {
                    "commission_paid": data.get("commission_paid"),
                    "contract_value": data.get("contract_value"),
                    "expected_amortisation_period": data.get("expected_amortisation_period", 24),
                }
            )

        pa_result = None
        if data.get("assess_principal_agent"):
            pa_result = RealEstatePrincipalAgentChecker().assess(data)

        calculate_payload = build_ifrs15_calculate_payload(
            off_plan=off_plan,
            spa=data.get("spa"),
            spa_mapped=data.get("spa_mapped"),
            construction_start=str(data.get("construction_start", "")),
            expected_handover=str(data.get("expected_handover", "")),
            contract_value=float(data.get("contract_value", 0) or 0),
            costs_incurred=float(data.get("costs_incurred_to_date", 0) or 0),
            total_costs=float(data.get("total_estimated_costs", 0) or 0),
            revenue_prior=float(data.get("revenue_prior_period", 0) or 0),
            escrow_total=_sum_escrow(list(data.get("escrow_receipts") or [])),
            rera_registration_number=rera,
            project_name=str(data.get("project_name") or ""),
            revenue_recognition_trigger=recognition_trigger.get(
                "revenue_recognition_trigger", ""
            ),
            recognition_trigger_summary=recognition_trigger.get(
                "recognition_trigger_summary", ""
            ),
            currency=str(data.get("currency") or "AED"),
            exchange_rate=float(data.get("exchange_rate") or UAE_CENTRAL_BANK_PEG),
        )

        spa_exec = _spa_execution_date(data)
        schedule_start = _schedule_start_date(data)
        report_aed: Dict[str, Any] = {
            "rera_registration_number": rera,
            "project_name": data.get("project_name"),
            "contract_value": float(data.get("contract_value", 0) or 0),
            "spa_execution_date": spa_exec.isoformat() if spa_exec else None,
            "schedule_start_date": schedule_start.isoformat() if schedule_start else None,
            "recognition_trigger": recognition_trigger,
            "recognition_trigger_summary": recognition_trigger.get(
                "recognition_trigger_summary"
            ),
            "over_time_recognition_note": (
                OVER_TIME_RECOGNITION_NOTE
                if off_plan.get("recognition_basis") == "over_time_input_method"
                else None
            ),
            "off_plan": off_plan,
            "escrow": escrow_result,
            "period_schedule": period_schedule,
            "vat": vat,
            "contract_costs": costs_result,
            "principal_agent": pa_result,
            "ifrs15_calculate_payload": calculate_payload,
            "currency": "AED",
            "exchange_rate": float(data.get("exchange_rate") or UAE_CENTRAL_BANK_PEG),
        }
        report_aed.update(score_realestate_disclosure(data, report_aed))
        report_aed["escrow_receipts"] = list(data.get("escrow_receipts") or [])
        report_aed["escrow_releases"] = list(data.get("escrow_releases") or [])
        from backend.app.services.rera_escrow_validator import validate_escrow_release as _rera_ev

        ev_esc = _rera_ev(
            list(data.get("escrow_receipts") or []),
            list(report_aed["escrow_releases"]),
            effective_completion_pct(data),
            float(data.get("contract_value") or 0),
        )
        report_aed["escrow_validation"] = ev_esc.model_dump()
        report_aed["health_validation"] = validate_realestate_health(report_aed)

        cert_pct = data.get("rera_certificate_verified_pct")
        if cert_pct is not None:
            report_aed["completion_source"] = "rera_certificate"
            report_aed["rera_certificate"] = {
                "ref": data.get("rera_certificate_ref"),
                "date": data.get("rera_certificate_date"),
                "verified_pct": float(cert_pct),
            }
            ref = data.get("rera_certificate_ref") or "N/A"
            dt = data.get("rera_certificate_date") or "N/A"
            cert_note = (
                f" Completion % sourced from RERA certificate {ref} dated {dt}."
            )
            base_summary = str(report_aed.get("recognition_trigger_summary") or "")
            report_aed["recognition_trigger_summary"] = base_summary + cert_note
        else:
            report_aed["completion_source"] = "manual_input"

        display_currency = str(data.get("currency") or "AED").upper()
        if display_currency == "USD":
            return apply_currency_display(
                report_aed,
                "USD",
                float(data.get("exchange_rate") or UAE_CENTRAL_BANK_PEG),
            )
        return apply_currency_display(report_aed, "AED")


def map_spa_to_ifrs15_inputs(spa: Dict[str, Any]) -> Dict[str, Any]:
    """Map SPA parser output to off-plan calculator pre-fill."""
    payments = spa.get("payment_schedule") or []
    escrow_receipts = [
        {
            "date": p.get("date"),
            "amount": float(p.get("amount", 0) or 0),
            "unit_id": spa.get("property_unit_number"),
            "buyer_name": spa.get("buyer_name"),
        }
        for p in payments
        if p.get("amount")
    ]
    return {
        "contract_value": float(spa.get("total_contract_price", 0) or 0),
        "expected_handover": spa.get("handover_date"),
        "construction_start": spa.get("construction_start") or spa.get("effective_date"),
        "escrow_receipts": escrow_receipts,
        "customer_name": spa.get("buyer_name"),
        "vendor_name": spa.get("developer_name"),
        "project_name": spa.get("project_name"),
        "unit_id": spa.get("property_unit_number"),
        "variable_consideration_notes": spa.get("variable_consideration"),
    }
