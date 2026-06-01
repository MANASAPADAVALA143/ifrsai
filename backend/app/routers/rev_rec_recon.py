"""Revenue recognition month-end reconciliation — IFRS 15 R2R tools."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.services.nova_service import call_nova

router = APIRouter(prefix="/api/rev-rec", tags=["rev-rec-reconciliation"])


# ─── SSP Allocation Variance Check (Prompt 4) ───────────────────────────────


class PerformanceObligationInput(BaseModel):
    po_name: str
    ssp_used: float
    ssp_supported: float
    allocated_amount: float
    recognition_pattern: Literal["Over time", "Point in time"]


class SspAllocationCheckRequest(BaseModel):
    period: str
    contract_id: str
    customer_name: str
    total_contract_value: float
    ssp_method: str
    performance_obligations: List[PerformanceObligationInput] = Field(min_length=1)


def _po_status(
    allocation_variance: float,
    ssp_variance: float,
    ssp_supported: float,
) -> str:
    alloc_err = abs(allocation_variance) >= 1.00
    ssp_threshold = abs(ssp_supported) * 0.05
    ssp_err = abs(ssp_variance) >= ssp_threshold
    if alloc_err and ssp_err:
        return "BOTH"
    if alloc_err:
        return "ALLOCATION ERROR"
    if ssp_err:
        return "SSP VARIANCE"
    return "COMPLIANT"


def _po_risk(po_status: str) -> str:
    if po_status in ("ALLOCATION ERROR", "BOTH"):
        return "HIGH"
    if po_status == "SSP VARIANCE":
        return "MEDIUM"
    return "LOW"


def _build_reallocation_journal(
    po_results: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Suggest journal lines when allocation errors exist."""
    over = [p for p in po_results if p["allocation_variance"] > 0.5]
    under = [p for p in po_results if p["allocation_variance"] < -0.5]
    if not over or not under:
        return []

    over.sort(key=lambda x: x["allocation_variance"], reverse=True)
    under.sort(key=lambda x: x["allocation_variance"])
    journals: List[Dict[str, Any]] = []
    for src, tgt in zip(over, under):
        amount = round(min(src["allocation_variance"], abs(tgt["allocation_variance"])), 2)
        if amount < 0.01:
            continue
        journals.append(
            {
                "dr_account": f"{tgt['po_name']} — Revenue",
                "cr_account": f"{src['po_name']} — Revenue",
                "amount": amount,
                "narrative": (
                    f"Reallocate SSP-based revenue from {src['po_name']} to {tgt['po_name']} "
                    f"per IFRS 15.73–76"
                ),
            }
        )
    return journals


@router.post("/ssp-allocation-check")
async def ssp_allocation_check(body: SspAllocationCheckRequest) -> Dict[str, Any]:
    pos = body.performance_obligations
    total_ssp_used = sum(p.ssp_used for p in pos)
    if total_ssp_used == 0:
        raise HTTPException(
            status_code=400,
            detail="Sum of SSP used across performance obligations must be greater than zero.",
        )

    total_allocated = sum(p.allocated_amount for p in pos)
    allocation_rounding_diff = round(body.total_contract_value - total_allocated, 2)

    po_results: List[Dict[str, Any]] = []
    correct_allocations: List[float] = []
    po_statuses: List[str] = []

    for po in pos:
        correct_allocation = round(
            body.total_contract_value * (po.ssp_used / total_ssp_used), 2
        )
        allocation_variance = round(po.allocated_amount - correct_allocation, 2)
        ssp_variance = round(po.ssp_used - po.ssp_supported, 2)
        status = _po_status(allocation_variance, ssp_variance, po.ssp_supported)

        correct_allocations.append(correct_allocation)
        po_statuses.append(status)
        po_results.append(
            {
                "po_name": po.po_name,
                "ssp_used": po.ssp_used,
                "ssp_supported": po.ssp_supported,
                "ssp_variance": ssp_variance,
                "allocated_amount": po.allocated_amount,
                "correct_allocation": correct_allocation,
                "allocation_variance": allocation_variance,
                "recognition_pattern": po.recognition_pattern,
                "po_status": status,
                "risk": _po_risk(status),
            }
        )

    exception_count = sum(1 for s in po_statuses if s != "COMPLIANT")
    rounding_ok = abs(allocation_rounding_diff) < 1.00
    overall_status = (
        "COMPLIANT"
        if exception_count == 0 and rounding_ok
        else "EXCEPTIONS FOUND"
    )

    has_allocation_error = any(
        p["po_status"] in ("ALLOCATION ERROR", "BOTH") for p in po_results
    )
    reallocation_journal = (
        _build_reallocation_journal(po_results) if has_allocation_error else []
    )

    po_lines = "\n".join(
        [
            (
                f"- {po.po_name}: SSP used ${po.ssp_used:,.0f} vs supported "
                f"${po.ssp_supported:,.0f} | Allocated ${po.allocated_amount:,.0f} "
                f"vs correct ${correct_allocations[i]:,.0f} | Status: {po_statuses[i]}"
            )
            for i, po in enumerate(pos)
        ]
    )

    nova_user = f"""
SSP Allocation Review — {body.contract_id} ({body.customer_name}) — {body.period}
Total contract value: ${body.total_contract_value:,.0f}
SSP method used: {body.ssp_method}
Performance obligations: {len(pos)}
Allocation rounding difference: ${allocation_rounding_diff:,.2f}
Exceptions found: {exception_count}

PO detail:
{po_lines}

Write:
1. One sentence on whether the SSP methodology is appropriate (IFRS 15 para 78-80) for this contract type.
2. One sentence on the most significant allocation variance and its revenue impact.
3. One sentence on audit risk level and recommended action (reallocation journal, SSP model update, or accept with documentation).
""".strip()

    nova_commentary = await call_nova(
        system=(
            "You are an IFRS 15 technical accounting expert reviewing standalone selling price "
            "(SSP) allocation for audit purposes. Reference IFRS 15 paragraphs 73-86 specifically."
        ),
        user=nova_user,
    )

    return {
        "contract_id": body.contract_id,
        "customer_name": body.customer_name,
        "period": body.period,
        "overall_status": overall_status,
        "exception_count": exception_count,
        "allocation_rounding_diff": allocation_rounding_diff,
        "total_contract_value": body.total_contract_value,
        "total_allocated": round(total_allocated, 2),
        "ssp_method": body.ssp_method,
        "po_results": po_results,
        "reallocation_journal": reallocation_journal,
        "nova_commentary": nova_commentary,
    }


# ─── Contract Asset vs Liability Tracker (Prompt 5) ─────────────────────────


class ContractAssetInput(BaseModel):
    opening_balance: float
    revenue_recognised_unbilled: float
    invoiced_this_period: float
    cancellations_reversed: float
    gl_closing_balance: float


class DeferredRevenueInput(BaseModel):
    opening_balance: float
    new_billings_received: float
    revenue_recognised: float
    cancellations_refunded: float
    gl_closing_balance: float


class AccruedRevenueInput(BaseModel):
    opening_balance: float
    accruals_raised: float
    accruals_reversed_on_billing: float
    gl_closing_balance: float


class TradeReceivablesInput(BaseModel):
    opening_balance: float
    invoices_raised: float
    cash_collected: float
    bad_debt_written_off: float
    gl_closing_balance: float


class ContractBalanceTrackerRequest(BaseModel):
    period: str
    prior_period: str
    contract_asset: ContractAssetInput
    deferred_revenue: DeferredRevenueInput
    accrued_revenue: AccruedRevenueInput
    trade_receivables: TradeReceivablesInput


def _reconcile_account(
    opening: float,
    opening_label: str,
    movement_lines: List[tuple[str, float]],
    gl_closing: float,
) -> Dict[str, Any]:
    expected_closing = round(opening + sum(m[1] for m in movement_lines), 2)
    difference = round(expected_closing - gl_closing, 2)
    status = "RECONCILED" if abs(difference) < 0.01 else "DIFFERENCE"
    movements = [{"line": opening_label, "amount": round(opening, 2)}]
    movements.extend(
        {"line": label, "amount": round(amount, 2)} for label, amount in movement_lines
    )
    movements.append({"line": "Expected closing", "amount": expected_closing})
    movements.append({"line": "GL closing balance", "amount": round(gl_closing, 2)})
    movements.append({"line": "Difference", "amount": difference})
    return {
        "opening": round(opening, 2),
        "expected_closing": expected_closing,
        "gl_closing": round(gl_closing, 2),
        "difference": difference,
        "status": status,
        "movements": movements,
    }


@router.post("/contract-balance-tracker")
async def contract_balance_tracker(body: ContractBalanceTrackerRequest) -> Dict[str, Any]:
    ca = body.contract_asset
    ca_expected = (
        ca.opening_balance
        + ca.revenue_recognised_unbilled
        - ca.invoiced_this_period
        - ca.cancellations_reversed
    )
    contract_asset_result = _reconcile_account(
        ca.opening_balance,
        "Opening contract asset",
        [
            ("Revenue recognised (unbilled)", ca.revenue_recognised_unbilled),
            ("Invoiced in period (converted to AR)", -ca.invoiced_this_period),
            ("Cancellations reversed", -ca.cancellations_reversed),
        ],
        ca.gl_closing_balance,
    )

    dr = body.deferred_revenue
    dr_expected = (
        dr.opening_balance
        + dr.new_billings_received
        - dr.revenue_recognised
        - dr.cancellations_refunded
    )
    deferred_revenue_result = _reconcile_account(
        dr.opening_balance,
        "Opening deferred revenue",
        [
            ("New billings received", dr.new_billings_received),
            ("Revenue recognised", -dr.revenue_recognised),
            ("Cancellations refunded", -dr.cancellations_refunded),
        ],
        dr.gl_closing_balance,
    )

    ar = body.accrued_revenue
    ar_expected = ar.opening_balance + ar.accruals_raised - ar.accruals_reversed_on_billing
    accrued_revenue_result = _reconcile_account(
        ar.opening_balance,
        "Opening accrued revenue",
        [
            ("Accruals raised", ar.accruals_raised),
            ("Accruals reversed on billing", -ar.accruals_reversed_on_billing),
        ],
        ar.gl_closing_balance,
    )

    tr = body.trade_receivables
    tr_expected = (
        tr.opening_balance
        + tr.invoices_raised
        - tr.cash_collected
        - tr.bad_debt_written_off
    )
    trade_receivables_result = _reconcile_account(
        tr.opening_balance,
        "Opening trade receivables",
        [
            ("Invoices raised", tr.invoices_raised),
            ("Cash collected", -tr.cash_collected),
            ("Bad debt written off", -tr.bad_debt_written_off),
        ],
        tr.gl_closing_balance,
    )

    accounts = {
        "contract_asset": contract_asset_result,
        "deferred_revenue": deferred_revenue_result,
        "accrued_revenue": accrued_revenue_result,
        "trade_receivables": trade_receivables_result,
    }

    exception_count = sum(1 for a in accounts.values() if a["status"] != "RECONCILED")
    overall_status = (
        "ALL RECONCILED"
        if exception_count == 0
        else f"{exception_count} ACCOUNT(S) WITH DIFFERENCES"
    )

    ca_opening = ca.opening_balance
    ca_closing = ca.gl_closing_balance
    ca_movement = ca_closing - ca_opening
    dr_opening = dr.opening_balance
    dr_closing = dr.gl_closing_balance
    dr_movement = dr_closing - dr_opening

    ifrs15_disclosure_note = f"""
Revenue from Contracts with Customers — Contract Balances

The following table shows the movement in contract balances for the period ended {body.period}:

                          {body.prior_period}    Movement    {body.period}
Contract asset (note X)   ${ca_opening:>12,.0f}  ${ca_movement:>+12,.0f}  ${ca_closing:>12,.0f}
Contract liability        ${dr_opening:>12,.0f}  ${dr_movement:>+12,.0f}  ${dr_closing:>12,.0f}

Contract assets represent revenue recognised on professional services contracts where billing milestones have not yet been reached. Contract liabilities represent subscription fees received in advance of the performance period.
""".strip()

    nova_user = f"""
Period: {body.period}. Contract balance movements:

Contract Asset: ${ca.opening_balance:,.0f} opening → ${ca_expected:,.0f} expected → ${ca.gl_closing_balance:,.0f} GL (diff: ${contract_asset_result['difference']:,.0f}, status: {contract_asset_result['status']})

Deferred Revenue (Contract Liability): ${dr.opening_balance:,.0f} → ${dr_expected:,.0f} expected → ${dr.gl_closing_balance:,.0f} GL (diff: ${deferred_revenue_result['difference']:,.0f}, status: {deferred_revenue_result['status']})

Accrued Revenue: ${ar.opening_balance:,.0f} → ${ar_expected:,.0f} expected → ${ar.gl_closing_balance:,.0f} GL (diff: ${accrued_revenue_result['difference']:,.0f}, status: {accrued_revenue_result['status']})

Trade Receivables: ${tr.opening_balance:,.0f} → ${tr_expected:,.0f} expected → ${tr.gl_closing_balance:,.0f} GL (diff: ${trade_receivables_result['difference']:,.0f}, status: {trade_receivables_result['status']})

Write:
1. Two sentences suitable for inclusion in the IFRS 15 contract balances note (para 116) explaining the key movements.
2. One sentence flagging any reconciling difference that needs resolution before sign-off.
3. If all accounts reconcile, one sentence confirming the balances are consistent with IFRS 15 disclosure requirements.
""".strip()

    nova_commentary = await call_nova(
        system=(
            "You are a senior IFRS 15 reporting specialist preparing the contract balances "
            "disclosure note for financial statements. Reference IFRS 15 para 116-118 specifically."
        ),
        user=nova_user,
    )

    return {
        "period": body.period,
        "overall_status": overall_status,
        "accounts": accounts,
        "ifrs15_disclosure_note": ifrs15_disclosure_note,
        "nova_commentary": nova_commentary,
    }


# ─── Period GL vs IFRS.ai revenue reconciliation (Prompt 17) ───────────────


class GlEntryInput(BaseModel):
    contract_id: str
    gl_revenue: float
    gl_date: str = ""


class IfrsContractRevenueInput(BaseModel):
    contract_id: str
    customer_name: str = ""
    ifrs_revenue: float


class RevRecPeriodRequest(BaseModel):
    period: str
    gl_entries: List[GlEntryInput] = Field(default_factory=list)
    ifrs_contracts: List[IfrsContractRevenueInput] = Field(default_factory=list)


def _rec_status(variance: float) -> str:
    av = abs(variance)
    if av < 100:
        return "MATCHED"
    if av < 1000:
        return "MINOR VARIANCE"
    return "MAJOR VARIANCE"


@router.post("/period-reconciliation")
async def period_reconciliation(body: RevRecPeriodRequest) -> Dict[str, Any]:
    ifrs_map = {c.contract_id: c for c in body.ifrs_contracts}
    gl_map = {g.contract_id: g for g in body.gl_entries}

    all_ids = set(ifrs_map.keys()) | set(gl_map.keys())
    rows: List[Dict[str, Any]] = []
    matched = minor = major = unmatched = gl_only = 0
    total_ifrs = 0.0
    total_gl = 0.0

    for cid in sorted(all_ids):
        ifrs_row = ifrs_map.get(cid)
        gl_row = gl_map.get(cid)
        ifrs_rev = float(ifrs_row.ifrs_revenue) if ifrs_row else 0.0
        gl_rev = float(gl_row.gl_revenue) if gl_row else 0.0
        variance = round(gl_rev - ifrs_rev, 2)
        total_ifrs += ifrs_rev
        total_gl += gl_rev

        if ifrs_row and not gl_row:
            status = "UNMATCHED"
            unmatched += 1
        elif gl_row and not ifrs_row:
            status = "GL ONLY"
            gl_only += 1
        else:
            status = _rec_status(variance)
            if status == "MATCHED":
                matched += 1
            elif status == "MINOR VARIANCE":
                minor += 1
            else:
                major += 1

        rows.append(
            {
                "contract_id": cid,
                "customer_name": (ifrs_row.customer_name if ifrs_row else "") or "",
                "ifrs_revenue": round(ifrs_rev, 2),
                "gl_revenue": round(gl_rev, 2),
                "variance": variance,
                "variance_pct": round((variance / ifrs_rev * 100) if ifrs_rev else 0, 2),
                "status": status,
            }
        )

    blackline_export = [
        {
            "Account": "Revenue",
            "Description": f"{r['contract_id']} — {r['customer_name']}",
            "Balance per IFRS": r["ifrs_revenue"],
            "Balance per GL": r["gl_revenue"],
            "Variance": r["variance"],
            "Status": r["status"],
            "Preparer": "IFRS AI",
            "Date": body.period,
        }
        for r in rows
    ]

    return {
        "period": body.period,
        "summary": {
            "total_contracts": len(rows),
            "matched": matched,
            "minor_variance": minor,
            "major_variance": major,
            "unmatched": unmatched,
            "gl_only": gl_only,
            "total_ifrs_revenue": round(total_ifrs, 2),
            "total_gl_revenue": round(total_gl, 2),
            "net_variance": round(total_gl - total_ifrs, 2),
        },
        "reconciliation": rows,
        "blackline_export": blackline_export,
    }


@router.get("/period-export")
async def period_export_csv(period: str = Query(..., description="YYYY-MM")):
    import csv
    import io

    return {
        "period": period,
        "message": "POST /api/rev-rec/period-reconciliation with data, then use blackline_export from response",
    }
