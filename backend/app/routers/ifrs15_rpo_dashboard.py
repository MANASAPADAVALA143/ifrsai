"""IFRS 15 §120 RPO portfolio dashboard."""

from __future__ import annotations

import io
import json
import os
import re
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.app.services.ifrs15_db import ifrs15_db
from backend.app.services.ifrs15_rpo_dashboard_db import rpo_dash_db
from backend.app.services.supabase_client import is_supabase_configured

router = APIRouter(prefix="/api/ifrs15/rpo-dashboard", tags=["ifrs15-rpo-dashboard"])

MONEY_Q = Decimal("0.0001")
PCT_Q = Decimal("0.0001")
MONTH_Q = Decimal("0.01")


def D(v: Any) -> Decimal:
    try:
        return Decimal(str(v if v is not None and v != "" else 0))
    except Exception:
        return Decimal("0")


def money(v: Decimal) -> float:
    return float(v.quantize(MONEY_Q, rounding=ROUND_HALF_UP))


def money_s(v: Decimal) -> str:
    return str(v.quantize(MONEY_Q, rounding=ROUND_HALF_UP))


def pct4(v: Decimal) -> float:
    return float(v.quantize(PCT_Q, rounding=ROUND_HALF_UP))


def _firm_id(request: Request, company_id: Optional[str] = None, x_firm_id: Optional[str] = None) -> str:
    if company_id and str(company_id).strip():
        return str(company_id).strip()
    if x_firm_id and str(x_firm_id).strip():
        return str(x_firm_id).strip()
    hdr = request.headers.get("x-firm-id") or request.headers.get("X-Firm-Id")
    if hdr and str(hdr).strip():
        return str(hdr).strip()
    return os.getenv("IFRS15_FIRM_ID", "default")


def _require_db() -> None:
    if not is_supabase_configured():
        raise HTTPException(status_code=503, detail="Supabase is not configured")


def _parse_date(v: Any) -> date | None:
    if v is None or v == "":
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    s = str(v)[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except Exception:
        return None


def _months_remaining(snap: date, end: date | None) -> Decimal:
    if end is None:
        return Decimal("0")
    if end <= snap:
        return Decimal("0")
    months = (end.year - snap.year) * 12 + (end.month - snap.month)
    frac = Decimal(end.day - snap.day) / Decimal("30")
    out = Decimal(months) + frac
    return out if out > 0 else Decimal("0")


def _time_bucket(months: Decimal) -> str:
    if months < Decimal("12"):
        return "lt_1yr"
    if months < Decimal("24"):
        return "1_2yr"
    if months < Decimal("60"):
        return "2_5yr"
    return "gt_5yr"


def _normalize_type(raw: Any) -> str:
    t = str(raw or "other").strip().lower().replace(" ", "_").replace("-", "_")
    if t in {"uae_real_estate", "real_estate", "uae_re", "off_plan", "spa"}:
        return "uae_real_estate"
    if t in {"saas_subscription", "saas", "subscription", "b2b_saas"}:
        return "saas_subscription"
    if t in {"professional_services", "ps", "services", "advisory"}:
        return "professional_services"
    if t in {"uae_real_estate", "saas_subscription", "professional_services", "other"}:
        return t
    return "other"


def _contract_status(
    progress: Decimal,
    end: date | None,
    snap: date,
    rpo: Decimal,
    tp: Decimal,
    months_rem: Decimal,
) -> str:
    if end and end < snap:
        return "overdue"
    if progress > Decimal("0.80"):
        return "near_complete"
    if tp > 0 and (rpo / tp) > Decimal("0.5") and months_rem < Decimal("6"):
        return "at_risk"
    return "active"


def _same_quarter(a: date, b: date) -> bool:
    return a.year == b.year and (a.month - 1) // 3 == (b.month - 1) // 3


def _gather_contracts(company_id: str) -> list[dict[str, Any]]:
    by_ref: dict[str, dict[str, Any]] = {}
    for row in rpo_dash_db.list_source_contracts(company_id):
        ref = str(row.get("contract_ref") or row.get("id") or "").strip()
        if not ref:
            continue
        by_ref[ref] = {
            "contract_id": str(row.get("id") or ref),
            "contract_ref": ref,
            "contract_type": _normalize_type(row.get("contract_type")),
            "customer_name": row.get("customer_name") or "",
            "transaction_price": D(row.get("transaction_price")),
            "revenue_recognised": D(row.get("revenue_recognised")),
            "start_date": _parse_date(row.get("start_date")),
            "end_date": _parse_date(row.get("end_date")),
            "original_term_months": int(row.get("original_term_months") or 0),
        }
    try:
        port = ifrs15_db.get_portfolio(company_id)
    except Exception:
        port = []
    for p in port:
        data = p.get("contract_data") or {}
        summary = p.get("summary_data") or {}
        ref = str(data.get("contract_id") or p.get("contract_name") or p.get("id") or "").strip()
        if not ref or ref in by_ref:
            continue
        tp = D(
            data.get("transaction_price")
            or data.get("total_transaction_price")
            or data.get("total_tp")
            or summary.get("total_tp")
        )
        rec = D(
            data.get("revenue_recognised_to_date")
            or data.get("revenue_recognised")
            or summary.get("total_recognised")
            or summary.get("revenue_recognised")
        )
        term = int(
            data.get("contract_term_months")
            or data.get("original_term_months")
            or data.get("term_months")
            or 0
        )
        by_ref[ref] = {
            "contract_id": str(p.get("id") or ref),
            "contract_ref": ref,
            "contract_type": _normalize_type(data.get("contract_type") or data.get("industry")),
            "customer_name": data.get("customer_name") or data.get("customer") or p.get("contract_name") or "",
            "transaction_price": tp,
            "revenue_recognised": rec,
            "start_date": _parse_date(data.get("effective_date") or data.get("start_date") or data.get("contract_start")),
            "end_date": _parse_date(data.get("end_date") or data.get("contract_end")),
            "original_term_months": term,
        }
    return list(by_ref.values())


def _compute_detail(c: dict[str, Any], snap: date) -> dict[str, Any]:
    tp = D(c.get("transaction_price"))
    rec = D(c.get("revenue_recognised"))
    if rec > tp > 0:
        rec = tp
    rpo = tp - rec
    if rpo < 0:
        rpo = Decimal("0")
    progress = (rec / tp) if tp > 0 else Decimal("0")
    rpo_pct = (rpo / tp) if tp > 0 else Decimal("0")
    end = c.get("end_date")
    months = _months_remaining(snap, end)
    term = int(c.get("original_term_months") or 0)
    if term <= 0 and c.get("start_date") and end:
        term = max(1, int(round(float(_months_remaining(c["start_date"], end)))))
    expedient = term > 0 and term <= 12
    status = _contract_status(progress, end, snap, rpo, tp, months)
    return {
        "contract_id": c.get("contract_id"),
        "contract_ref": c.get("contract_ref"),
        "contract_type": c.get("contract_type") or "other",
        "customer_name": c.get("customer_name"),
        "transaction_price": tp,
        "revenue_recognised": rec,
        "rpo": rpo,
        "rpo_pct": rpo_pct,
        "progress_pct": progress,
        "start_date": c.get("start_date").isoformat() if c.get("start_date") else None,
        "end_date": end.isoformat() if end else None,
        "months_remaining": months,
        "time_bucket": _time_bucket(months),
        "practical_expedient_applies": expedient,
        "status": status,
        "original_term_months": term,
    }


def _parse_ai_json(text: str) -> dict[str, Any]:
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
        s = re.sub(r"\s*```$", "", s)
    start, end = s.find("{"), s.rfind("}")
    if start >= 0 and end > start:
        s = s[start : end + 1]
    return json.loads(s)


def _fallback_ai(ctx: dict[str, Any]) -> dict[str, str]:
    cur = ctx["currency"]
    total = money(ctx["total_rpo"])
    narrative = (
        f"As at {ctx['snapshot_date']}, remaining performance obligations total {cur} {total:,.0f} "
        f"across {ctx['active_contracts']} active contracts. Near-term visibility (< 1 year) is "
        f"{cur} {money(ctx['bucket_lt_1yr']):,.0f}, with {cur} {money(ctx['bucket_1_2yr']):,.0f} expected in 1–2 years. "
        f"Coverage is {ctx['coverage_txt']}. At-risk / near-complete RPO is {cur} {money(ctx['at_risk_rpo']):,.0f} "
        f"and should be monitored for completion timing."
    )
    disclosure = (
        f"IFRS 15 §120 — Remaining performance obligations\n\n"
        f"The aggregate amount of the transaction price allocated to unsatisfied (or partially unsatisfied) "
        f"performance obligations as at {ctx['snapshot_date']} is {cur} {total:,.0f}.\n\n"
        f"The entity expects to recognise this revenue as follows:\n"
        f"  Within 1 year:     {cur} {money(ctx['bucket_lt_1yr']):,.0f}\n"
        f"  1–2 years:         {cur} {money(ctx['bucket_1_2yr']):,.0f}\n"
        f"  2–5 years:         {cur} {money(ctx['bucket_2_5yr']):,.0f}\n"
        f"  More than 5 years: {cur} {money(ctx['bucket_gt_5yr']):,.0f}\n\n"
        f"Practical expedients (IFRS 15 §121): contracts with an original expected duration of one year or less "
        f"are excluded from the quantitative disclosure above. Weighted average remaining term is "
        f"{ctx['wavg']:.1f} months."
    )
    return {"ai_narrative": narrative, "ai_disclosure_draft": disclosure}


def _claude_ai(ctx: dict[str, Any]) -> dict[str, str]:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    fallback = _fallback_ai(ctx)
    if not api_key:
        return fallback
    user = f"""Generate two outputs for IFRS 15 §120 RPO disclosure.

COMPANY RPO DATA as at {ctx['snapshot_date']}:
Total RPO: {ctx['currency']} {money(ctx['total_rpo']):,.0f}
Active contracts: {ctx['active_contracts']}
Contract types: UAE Real Estate {money(ctx['rpo_uae_real_estate']):,.0f},
  SaaS {money(ctx['rpo_saas_subscription']):,.0f},
  Professional Services {money(ctx['rpo_professional_services']):,.0f}

Time bands:
  < 1 year:   {ctx['currency']} {money(ctx['bucket_lt_1yr']):,.0f}
  1-2 years:  {ctx['currency']} {money(ctx['bucket_1_2yr']):,.0f}
  2-5 years:  {ctx['currency']} {money(ctx['bucket_2_5yr']):,.0f}
  > 5 years:  {ctx['currency']} {money(ctx['bucket_gt_5yr']):,.0f}

RPO Coverage Ratio: {ctx['coverage_txt']}
Weighted avg remaining term: {ctx['wavg']:.1f} months
At-risk RPO: {ctx['currency']} {money(ctx['at_risk_rpo']):,.0f}

OUTPUT 1 — ai_narrative (3-4 sentences for CFO/management):
Summarise the RPO position, revenue visibility, concentration
risks, and any at-risk contracts. Plain business language.

OUTPUT 2 — ai_disclosure_draft (formal IFRS 15 §120 note):
Draft the financial statement disclosure note. Include:
- Opening paragraph referencing IFRS 15 §120
- Table of time-band bucketing
- Practical expedients applied (if any)
- Qualitative description of when revenue expected
Use formal financial reporting language. AED currency.

Return JSON only: {{ "ai_narrative": "...", "ai_disclosure_draft": "..." }}"""
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
            max_tokens=1200,
            system=(
                "You are a senior IFRS 15 technical accountant preparing "
                "financial statement disclosures."
            ),
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(getattr(b, "text", "") or "" for b in (msg.content or []))
        parsed = _parse_ai_json(text)
        narrative = str(parsed.get("ai_narrative") or "").strip()
        draft = str(parsed.get("ai_disclosure_draft") or "").strip()
        if not narrative or not draft:
            return fallback
        return {"ai_narrative": narrative, "ai_disclosure_draft": draft}
    except Exception:
        return fallback


def _pdf_bytes(snap: dict[str, Any], company_id: str) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title="IFRS 15 §120 RPO Disclosure")
    styles = getSampleStyleSheet()
    cur = str(snap.get("currency") or "AED")

    def fmt(v: Any) -> str:
        try:
            return f"{cur} {float(v or 0):,.0f}"
        except Exception:
            return f"{cur} 0"

    story = [
        Paragraph("IFRS 15 §120 — Remaining Performance Obligations", styles["Title"]),
        Spacer(1, 8),
        Paragraph(f"Company: {company_id} &nbsp;&nbsp; Period: {snap.get('period')} &nbsp;&nbsp; Snapshot: {snap.get('snapshot_date')}", styles["Normal"]),
        Spacer(1, 12),
    ]
    table_data = [
        ["Time band", "Amount"],
        ["Within 1 year", fmt(snap.get("bucket_lt_1yr"))],
        ["1–2 years", fmt(snap.get("bucket_1_2yr"))],
        ["2–5 years", fmt(snap.get("bucket_2_5yr"))],
        ["More than 5 years", fmt(snap.get("bucket_gt_5yr"))],
        ["Total RPO (excl. practical expedients)", fmt(snap.get("total_rpo"))],
    ]
    t = Table(table_data, colWidths=[280, 180])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f766e")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#f1f5f9")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 16))
    draft = str(snap.get("ai_disclosure_draft") or "No disclosure draft generated.")
    for line in draft.split("\n"):
        safe = line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        story.append(Paragraph(safe or "&nbsp;", styles["BodyText"]))
        story.append(Spacer(1, 3))
    doc.build(story)
    return buf.getvalue()


def _group_details(details: list[dict[str, Any]]) -> dict[str, Any]:
    by_bucket: dict[str, list] = {"lt_1yr": [], "1_2yr": [], "2_5yr": [], "gt_5yr": []}
    by_type: dict[str, list] = {}
    for d in details:
        b = str(d.get("time_bucket") or "lt_1yr")
        by_bucket.setdefault(b, []).append(d)
        t = str(d.get("contract_type") or "other")
        by_type.setdefault(t, []).append(d)
    return {"by_time_bucket": by_bucket, "by_contract_type": by_type}


def _waterfall(snaps: list[dict[str, Any]], details_by_snap: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    ordered = sorted(snaps, key=lambda s: str(s.get("period") or ""))
    out: list[dict[str, Any]] = []
    prev_close = None
    prev_rev = None
    for snap in ordered:
        sid = str(snap.get("id"))
        close = D(snap.get("total_rpo"))
        rec_sum = sum(
            (D(d.get("revenue_recognised")) for d in details_by_snap.get(sid, []) if not d.get("practical_expedient_applies")),
            Decimal("0"),
        )
        if prev_close is None:
            opening = close
            rev_rec = Decimal("0")
            bookings = Decimal("0")
        else:
            opening = prev_close
            rev_rec = rec_sum - (prev_rev or Decimal("0"))
            if rev_rec < 0:
                rev_rec = Decimal("0")
            bookings = close - opening + rev_rec
        out.append(
            {
                "period": snap.get("period"),
                "opening_rpo": money(opening),
                "new_bookings": money(bookings),
                "revenue_recognised": money(rev_rec),
                "closing_rpo": money(close),
            }
        )
        prev_close = close
        prev_rev = rec_sum
    return out


class RunSnapshotRequest(BaseModel):
    company_id: Optional[str] = None
    snapshot_date: Optional[str] = None
    period: Optional[str] = None
    ltm_revenue: Optional[Decimal] = None
    currency: Optional[str] = "AED"


@router.post("/run-snapshot")
async def run_snapshot(
    body: RunSnapshotRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    company_id = _firm_id(request, body.company_id, x_firm_id)
    snap_date = _parse_date(body.snapshot_date) or date.today()
    period = (body.period or f"{snap_date.year:04d}-{snap_date.month:02d}").strip()
    currency = (body.currency or "AED").strip() or "AED"

    contracts = _gather_contracts(company_id)
    if not contracts:
        raise HTTPException(
            status_code=400,
            detail="No contracts found. Seed RPO contracts or add portfolio contracts first.",
        )

    details_calc = [_compute_detail(c, snap_date) for c in contracts]
    included = [d for d in details_calc if not d["practical_expedient_applies"]]
    total_rpo = sum((d["rpo"] for d in included), Decimal("0"))
    buckets = {
        "lt_1yr": Decimal("0"),
        "1_2yr": Decimal("0"),
        "2_5yr": Decimal("0"),
        "gt_5yr": Decimal("0"),
    }
    type_rpo = {
        "uae_real_estate": Decimal("0"),
        "saas_subscription": Decimal("0"),
        "professional_services": Decimal("0"),
        "other": Decimal("0"),
    }
    at_risk = Decimal("0")
    w_num = Decimal("0")
    w_den = Decimal("0")
    for d in included:
        buckets[str(d["time_bucket"])] = buckets.get(str(d["time_bucket"]), Decimal("0")) + d["rpo"]
        ct = str(d["contract_type"])
        if ct not in type_rpo:
            ct = "other"
        type_rpo[ct] += d["rpo"]
        if d["status"] in {"at_risk", "near_complete"}:
            at_risk += d["rpo"]
        w_num += d["rpo"] * d["months_remaining"]
        w_den += d["rpo"]
    wavg = (w_num / w_den) if w_den > 0 else Decimal("0")

    q_bookings = Decimal("0")
    for c in contracts:
        sd = c.get("start_date")
        if sd and _same_quarter(sd, snap_date):
            q_bookings += D(c.get("transaction_price"))

    ltm = body.ltm_revenue
    if ltm is None:
        prior = rpo_dash_db.latest_snapshot(company_id)
        if prior and prior.get("ltm_revenue") is not None:
            ltm = D(prior.get("ltm_revenue"))
        else:
            ltm = Decimal("0")
    ltm = D(ltm)
    coverage = (total_rpo / ltm) if ltm > 0 else None

    ctx = {
        "snapshot_date": snap_date.isoformat(),
        "currency": currency,
        "total_rpo": total_rpo,
        "active_contracts": len([d for d in details_calc if d["status"] != "overdue"]),
        "rpo_uae_real_estate": type_rpo["uae_real_estate"],
        "rpo_saas_subscription": type_rpo["saas_subscription"],
        "rpo_professional_services": type_rpo["professional_services"],
        "bucket_lt_1yr": buckets["lt_1yr"],
        "bucket_1_2yr": buckets["1_2yr"],
        "bucket_2_5yr": buckets["2_5yr"],
        "bucket_gt_5yr": buckets["gt_5yr"],
        "at_risk_rpo": at_risk,
        "wavg": float(wavg.quantize(MONTH_Q, rounding=ROUND_HALF_UP)),
        "coverage_txt": f"{float(coverage):.1f}x" if coverage is not None else "n/a",
    }
    ai = _claude_ai(ctx)

    payload = {
        "company_id": company_id,
        "snapshot_date": snap_date.isoformat(),
        "period": period,
        "total_rpo": money_s(total_rpo),
        "total_contracts": len(details_calc),
        "active_contracts": ctx["active_contracts"],
        "currency": currency,
        "ltm_revenue": money_s(ltm) if ltm > 0 else None,
        "bucket_lt_1yr": money_s(buckets["lt_1yr"]),
        "bucket_1_2yr": money_s(buckets["1_2yr"]),
        "bucket_2_5yr": money_s(buckets["2_5yr"]),
        "bucket_gt_5yr": money_s(buckets["gt_5yr"]),
        "rpo_uae_real_estate": money_s(type_rpo["uae_real_estate"]),
        "rpo_saas_subscription": money_s(type_rpo["saas_subscription"]),
        "rpo_professional_services": money_s(type_rpo["professional_services"]),
        "rpo_other": money_s(type_rpo["other"]),
        "rpo_coverage_ratio": str(coverage.quantize(PCT_Q, rounding=ROUND_HALF_UP)) if coverage is not None else None,
        "weighted_avg_remaining_months": str(wavg.quantize(MONTH_Q, rounding=ROUND_HALF_UP)),
        "at_risk_rpo": money_s(at_risk),
        "new_bookings_qtd": money_s(q_bookings),
        "ai_narrative": ai["ai_narrative"],
        "ai_disclosure_draft": ai["ai_disclosure_draft"],
    }

    existing = rpo_dash_db.get_snapshot_by_period(company_id, period)
    if existing:
        snap = rpo_dash_db.update_snapshot(str(existing["id"]), payload)
        rpo_dash_db.delete_details(str(snap["id"]))
    else:
        snap = rpo_dash_db.insert_snapshot(payload)

    detail_rows = []
    for d in details_calc:
        detail_rows.append(
            {
                "snapshot_id": snap["id"],
                "company_id": company_id,
                "contract_id": d["contract_id"],
                "contract_ref": d["contract_ref"],
                "contract_type": d["contract_type"],
                "customer_name": d["customer_name"],
                "transaction_price": money_s(d["transaction_price"]),
                "revenue_recognised": money_s(d["revenue_recognised"]),
                "rpo": money_s(d["rpo"]),
                "rpo_pct": pct4(d["rpo_pct"] * Decimal("100")),
                "progress_pct": pct4(d["progress_pct"] * Decimal("100")),
                "start_date": d["start_date"],
                "end_date": d["end_date"],
                "months_remaining": float(d["months_remaining"].quantize(MONTH_Q, rounding=ROUND_HALF_UP)),
                "time_bucket": d["time_bucket"],
                "practical_expedient_applies": d["practical_expedient_applies"],
                "status": d["status"],
            }
        )
    saved_details = rpo_dash_db.insert_details(detail_rows)
    return {
        "success": True,
        "snapshot": snap,
        "contract_detail": saved_details,
        "groups": _group_details(saved_details),
    }


@router.get("/snapshots")
async def list_snapshots(
    request: Request,
    company_id: Optional[str] = Query(None),
    last_n_periods: int = Query(6),
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    cid = _firm_id(request, company_id, x_firm_id)
    rows = rpo_dash_db.list_snapshots(cid, last_n=last_n_periods)
    return {"success": True, "snapshots": rows, "count": len(rows)}


@router.get("/current")
async def current_snapshot(
    request: Request,
    company_id: Optional[str] = Query(None),
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    cid = _firm_id(request, company_id, x_firm_id)
    snap = rpo_dash_db.latest_snapshot(cid)
    if not snap:
        raise HTTPException(status_code=404, detail="No RPO snapshot yet")
    details = rpo_dash_db.list_details(str(snap["id"]))
    return {"success": True, "snapshot": snap, "contract_detail": details, "groups": _group_details(details)}


@router.get("/waterfall")
async def waterfall(
    request: Request,
    company_id: Optional[str] = Query(None),
    periods: int = Query(6),
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    cid = _firm_id(request, company_id, x_firm_id)
    snaps = rpo_dash_db.list_snapshots(cid, last_n=periods)
    ids = [str(s["id"]) for s in snaps]
    details = rpo_dash_db.list_details_for_snapshots(ids)
    by_snap: dict[str, list] = {}
    for d in details:
        by_snap.setdefault(str(d.get("snapshot_id")), []).append(d)
    rows = _waterfall(snaps, by_snap)
    return {"success": True, "waterfall": rows, "count": len(rows)}


@router.get("/snapshots/{snapshot_id}")
async def get_snapshot(snapshot_id: str):
    _require_db()
    snap = rpo_dash_db.get_snapshot(snapshot_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    details = rpo_dash_db.list_details(snapshot_id)
    return {"success": True, "snapshot": snap, "contract_detail": details, "groups": _group_details(details)}


@router.post("/export-disclosure")
async def export_disclosure(
    request: Request,
    company_id: Optional[str] = Query(None),
    snapshot_id: Optional[str] = Query(None),
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    cid = _firm_id(request, company_id, x_firm_id)
    if snapshot_id:
        snap = rpo_dash_db.get_snapshot(snapshot_id)
    else:
        snap = rpo_dash_db.latest_snapshot(cid)
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    data = _pdf_bytes(snap, str(snap.get("company_id") or cid))
    period = str(snap.get("period") or "rpo").replace("-", "")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="IFRS15_RPO_disclosure_{period}.pdf"'},
    )
