"""IFRS 15.B34–B38 Principal vs Agent full assessment workflow.

Existing POST /api/ifrs15/principal-agent in app.py is unchanged.
"""

from __future__ import annotations

import io
import json
import os
import re
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.app.services.ifrs15_principal_agent_db import pa_db
from backend.app.services.supabase_client import is_supabase_configured

router = APIRouter(prefix="/api/ifrs15/principal-agent-full", tags=["ifrs15-principal-agent-full"])

MONEY_Q = Decimal("0.0001")
INDICATOR_VALUES = {
    "strong_principal": 2,
    "partial_principal": 1,
    "neutral": 0,
    "partial_agent": -1,
    "strong_agent": -2,
}
DETERMINATIONS = {"principal", "agent", "judgment_required"}
CONTRACT_TYPES = {
    "marketplace",
    "platform",
    "reseller",
    "broker",
    "fund_manager",
    "developer",
    "retailer",
    "other",
}


def D(v: Any) -> Decimal:
    try:
        if v is None or v == "":
            return Decimal("0")
        return Decimal(str(v))
    except Exception:
        return Decimal("0")


def money(v: Decimal | None) -> Optional[float]:
    if v is None:
        return None
    return float(v.quantize(MONEY_Q, rounding=ROUND_HALF_UP))


def money_str(v: Decimal | None) -> Optional[str]:
    if v is None:
        return None
    return str(v.quantize(MONEY_Q, rounding=ROUND_HALF_UP))


def score_indicator(value: str) -> int:
    return INDICATOR_VALUES.get((value or "").strip(), 0)


def get_determination(total_score: int) -> str:
    if total_score > 2:
        return "principal"
    if total_score < -2:
        return "agent"
    return "judgment_required"


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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_ai_json(text: str) -> dict[str, Any]:
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
        s = re.sub(r"\s*```$", "", s)
    start, end = s.find("{"), s.rfind("}")
    if start >= 0 and end > start:
        s = s[start : end + 1]
    return json.loads(s)


def _compute_revenue(
    gross_amount: Optional[Decimal],
    commission_rate: Optional[Decimal],
    determination: str,
) -> dict[str, Optional[Decimal]]:
    gross = gross_amount if gross_amount is not None else Decimal("0")
    rate = commission_rate
    net: Optional[Decimal] = None
    if rate is not None:
        net = (gross * rate).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
    elif determination == "agent":
        net = Decimal("0")
    elif determination == "principal":
        net = Decimal("0")
    else:
        net = (gross * (rate or Decimal("0"))).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
    diff = (gross - (net or Decimal("0"))).quantize(MONEY_Q, rounding=ROUND_HALF_UP)
    return {
        "gross_revenue": gross if determination != "agent" else gross,
        "net_revenue": net,
        "revenue_difference": diff,
    }


def _fallback_ai(body: "AssessRequest", scores: dict[str, int], determination: str, rev: dict) -> dict[str, Any]:
    ctype = (body.contract_type or "other").replace("_", " ")
    conf = "high" if abs(scores["total"]) >= 5 else ("medium" if abs(scores["total"]) > 2 else "low")
    if determination == "principal":
        reasoning = (
            f"Under IFRS 15.B34–B38 the entity appears to control the specified good or service "
            f"before transfer. Primary responsibility ({body.indicator_1_responsibility}, {scores['i1']:+d}), "
            f"inventory risk ({body.indicator_2_inventory}, {scores['i2']:+d}) and pricing discretion "
            f"({body.indicator_3_pricing}, {scores['i3']:+d}) together score {scores['total']:+d}/+6. "
            f"A {ctype} arrangement with these indicators supports PRINCIPAL (gross revenue) presentation."
        )
        impact = (
            f"If principal, revenue = {body.currency} {body.gross_amount} gross. "
            f"If agent, revenue would be commission only "
            f"({body.currency} {rev.get('net_revenue')}). Difference = {body.currency} {rev.get('revenue_difference')}."
        )
        key = "Control before transfer — primary obligor and inventory risk."
    elif determination == "agent":
        reasoning = (
            f"IFRS 15.B34–B38 indicators point to arranging for another party to provide the good/service. "
            f"Responsibility {scores['i1']:+d}, inventory {scores['i2']:+d}, pricing {scores['i3']:+d} "
            f"(total {scores['total']:+d}/+6). Typical of a {ctype}: recognise NET commission only."
        )
        impact = (
            f"If agent, revenue = {body.currency} {rev.get('net_revenue')} commission only. "
            f"Gross transaction price {body.currency} {body.gross_amount} is not revenue. "
            f"Difference = {body.currency} {rev.get('revenue_difference')} — materiality indicator."
        )
        key = "No inventory risk and limited pricing discretion."
    else:
        reasoning = (
            f"Total score {scores['total']:+d} falls in the IFRS 15.B37 judgment zone (−2 to +2). "
            f"Indicators are mixed (responsibility {scores['i1']:+d}, inventory {scores['i2']:+d}, "
            f"pricing {scores['i3']:+d}). Human review is mandatory before approving gross vs net."
        )
        impact = (
            f"Gross amount {body.currency} {body.gross_amount}; possible net/commission "
            f"{body.currency} {rev.get('net_revenue')}; difference {body.currency} {rev.get('revenue_difference')}. "
            f"Presentation choice is material until determination is locked."
        )
        key = "Mixed B37 indicators — document which factor is decisive."
        conf = "low"
    return {
        "determination": determination,
        "confidence": conf,
        "reasoning": reasoning,
        "risk_flag": "Judgment zone — finance review required." if determination == "judgment_required" else None,
        "revenue_impact": impact,
        "key_judgment": key,
    }


def _claude_assess(body: "AssessRequest", scores: dict[str, int], determination: str, rev: dict) -> dict[str, Any]:
    fallback = _fallback_ai(body, scores, determination, rev)
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return fallback
    user = f"""Assess this transaction under IFRS 15.B34-B38:
Transaction: {body.transaction_description}
Contract type: {body.contract_type}
Counterparty (third-party supplier): {body.counterparty_name}
Gross transaction amount: {body.currency} {body.gross_amount}
Commission rate: {body.commission_rate}
THREE INDICATOR SCORES:
1. Primary Responsibility: {body.indicator_1_responsibility}
   Notes: {body.indicator_1_notes}
   Score: {scores['i1']} / +2
2. Inventory Risk: {body.indicator_2_inventory}
   Notes: {body.indicator_2_notes}
   Score: {scores['i2']} / +2
3. Pricing Discretion: {body.indicator_3_pricing}
   Notes: {body.indicator_3_notes}
   Score: {scores['i3']} / +2
TOTAL SCORE: {scores['total']} / +6
SYSTEM DETERMINATION: {determination}
Additional context:
- Has inventory risk: {body.has_inventory_risk}
- Sets price independently: {body.sets_price_independently}
- Primary obligor to customer: {body.primary_obligor}
- Can redirect the good/service: {body.can_redirect_good}

BACKGROUND RULES:
PRINCIPAL recognises GROSS revenue (full selling price).
AGENT recognises NET revenue (commission/fee only).
Entity is principal if it controls the specified good or service BEFORE transfer (IFRS 15.B34–B35).
Three indicators of control (IFRS 15.B37): primary responsibility, inventory risk, pricing discretion.

Provide your assessment as JSON:
{{
  "determination": "principal"|"agent"|"judgment_required",
  "confidence": "high"|"medium"|"low",
  "reasoning": "detailed paragraph referencing IFRS 15.B34-B38 and each indicator",
  "risk_flag": "complexity or judgment area to flag — null if none",
  "revenue_impact": "quantified explanation of gross vs net difference and materiality",
  "key_judgment": "the single most important factor in this case"
}}"""
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
            max_tokens=900,
            system=(
                "You are a Big 4 IFRS 15 technical accounting expert "
                "specialising in principal vs agent assessments."
            ),
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(getattr(b, "text", "") or "" for b in (msg.content or []))
        parsed = _parse_ai_json(text)
        det = str(parsed.get("determination") or determination)
        if det not in DETERMINATIONS:
            det = determination
        conf = str(parsed.get("confidence") or fallback["confidence"]).lower()
        if conf not in {"high", "medium", "low"}:
            conf = fallback["confidence"]
        return {
            "determination": det,
            "confidence": conf,
            "reasoning": str(parsed.get("reasoning") or fallback["reasoning"]),
            "risk_flag": parsed.get("risk_flag"),
            "revenue_impact": str(parsed.get("revenue_impact") or fallback["revenue_impact"]),
            "key_judgment": str(parsed.get("key_judgment") or fallback["key_judgment"]),
        }
    except Exception:
        return fallback


def _claude_memo(row: dict[str, Any]) -> str:
    final = str(row.get("final_determination") or row.get("ai_determination") or "")
    override = ""
    if row.get("human_override_reason"):
        override = f"Human override reason: {row.get('human_override_reason')}"
    net_line = ""
    if final == "agent" or row.get("net_revenue") is not None:
        net_line = f"Commission/net revenue: {row.get('currency')} {row.get('net_revenue')}"
    fallback = (
        f"PRINCIPAL VS AGENT ASSESSMENT MEMO\n"
        f"Ref: {row.get('assessment_ref')} | Date: {row.get('assessment_date')}\n\n"
        f"1. Executive Summary\n"
        f"This assessment concludes {final.upper() or 'UNDETERMINED'} under IFRS 15.B34–B38 "
        f"(score {row.get('total_score')}/+6).\n\n"
        f"2. Background and Transaction Description\n"
        f"{row.get('transaction_description')}\n"
        f"Type: {row.get('contract_type')}. Counterparty: {row.get('counterparty_name')}.\n\n"
        f"3. IFRS 15.B34-B38 Analysis — Three Indicators\n"
        f"3.1 Primary Responsibility (B37a): {row.get('indicator_1_responsibility')} "
        f"({row.get('indicator_1_score'):+d}). {row.get('indicator_1_notes') or ''}\n"
        f"3.2 Inventory Risk (B37b): {row.get('indicator_2_inventory')} "
        f"({row.get('indicator_2_score'):+d}). {row.get('indicator_2_notes') or ''}\n"
        f"3.3 Pricing Discretion (B37c): {row.get('indicator_3_pricing')} "
        f"({row.get('indicator_3_score'):+d}). {row.get('indicator_3_notes') or ''}\n\n"
        f"4. Determination and Revenue Impact\n"
        f"{row.get('ai_reasoning') or ''}\n"
        f"Gross: {row.get('currency')} {row.get('gross_amount')}. {net_line}\n"
        f"Revenue difference: {row.get('currency')} {row.get('revenue_difference')}.\n"
        f"{row.get('ai_revenue_impact') or ''}\n\n"
        f"5. Conclusion and Approvals\n"
        f"Determination: {final}. Status: {row.get('status')}. Prepared by: {row.get('prepared_by')}.\n"
        f"{override}\n"
    )
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return fallback
    user = f"""Write a Principal vs Agent Assessment Memo.
Assessment ref: {row.get("assessment_ref")}
Date: {row.get("assessment_date")}
Transaction: {row.get("transaction_description")}
Contract type: {row.get("contract_type")}
INDICATOR ANALYSIS:
1. Primary Responsibility ({row.get("indicator_1_responsibility")}):
   {row.get("indicator_1_notes")}
2. Inventory Risk ({row.get("indicator_2_inventory")}):
   {row.get("indicator_2_notes")}
3. Pricing Discretion ({row.get("indicator_3_pricing")}):
   {row.get("indicator_3_notes")}
Total score: {row.get("total_score")}/6
Determination: {final}
Confidence: {row.get("ai_confidence")}
AI Reasoning: {row.get("ai_reasoning")}
{override}
Revenue impact:
Gross amount: {row.get("currency")} {row.get("gross_amount")}
{net_line}
Revenue difference: {row.get("currency")} {row.get("revenue_difference")}
Write sections:
1. Executive Summary (2 sentences)
2. Background and Transaction Description
3. IFRS 15.B34-B38 Analysis — Three Indicators
   (one subsection per indicator with score justification)
4. Determination and Revenue Impact
5. Conclusion and Approvals
Professional language. Reference specific IFRS 15 paragraphs."""
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
            max_tokens=1600,
            system="Big 4 IFRS 15 technical accountant writing audit workpaper.",
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(getattr(b, "text", "") or "" for b in (msg.content or [])).strip()
        return text or fallback
    except Exception:
        return fallback


def _memo_pdf_bytes(row: dict[str, Any]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    teal = colors.HexColor("#0D9488")
    buf = io.BytesIO()
    styles = getSampleStyleSheet()
    title = ParagraphStyle("PATitle", parent=styles["Title"], textColor=teal, fontSize=16)
    body = ParagraphStyle("PABody", parent=styles["BodyText"], fontSize=9, leading=12)

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawString(18 * mm, 10 * mm, "IFRS.ai Principal vs Agent Memo | Confidential")
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        title=str(row.get("assessment_ref") or "Principal vs Agent memo"),
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
    )
    story = [
        Paragraph("IFRS 15.B34–B38 Principal vs Agent Memo", title),
        Spacer(1, 8),
        Paragraph(
            f"<b>{row.get('assessment_ref') or ''}</b> &nbsp;|&nbsp; {row.get('assessment_date') or ''} "
            f"&nbsp;|&nbsp; Determination: <b>{str(row.get('final_determination') or '').upper()}</b> "
            f"&nbsp;|&nbsp; Score {row.get('total_score')}/+6",
            body,
        ),
        Spacer(1, 10),
    ]
    memo = str(row.get("assessment_memo") or "No memo generated yet.")
    for line in memo.split("\n"):
        safe = (line or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        story.append(Paragraph(safe or "&nbsp;", body))
        story.append(Spacer(1, 3))
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


def _next_ref(company_id: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]", "", company_id or "CO")[:6].upper() or "CO"
    prefix = f"PA-{slug}-"
    seq = pa_db.count_refs(company_id, prefix) + 1
    return f"{prefix}{seq:03d}"


def _enrich(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    out["ai_key_judgment"] = row.get("ai_key_judgment")
    return out


class AssessRequest(BaseModel):
    company_id: Optional[str] = None
    contract_id: Optional[str] = None
    contract_ref: Optional[str] = None
    assessment_date: Optional[str] = None
    contract_type: Optional[str] = "other"
    customer_name: Optional[str] = None
    counterparty_name: Optional[str] = None
    transaction_description: str
    gross_amount: Optional[float] = None
    commission_rate: Optional[float] = None
    currency: str = "AED"
    indicator_1_responsibility: str
    indicator_1_notes: Optional[str] = None
    indicator_2_inventory: str
    indicator_2_notes: Optional[str] = None
    indicator_3_pricing: str
    indicator_3_notes: Optional[str] = None
    has_inventory_risk: Optional[bool] = None
    sets_price_independently: Optional[bool] = None
    primary_obligor: Optional[bool] = None
    can_redirect_good: Optional[bool] = None
    third_party_involved: bool = True
    prepared_by: Optional[str] = None


class OverrideRequest(BaseModel):
    human_determination: str
    reason: str
    actor: str = "Finance"


class ApproveRequest(BaseModel):
    approved_by: str


@router.post("/assess")
async def assess(
    body: AssessRequest,
    request: Request,
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    company_id = _firm_id(request, body.company_id, x_firm_id)
    for fld, val in (
        ("indicator_1_responsibility", body.indicator_1_responsibility),
        ("indicator_2_inventory", body.indicator_2_inventory),
        ("indicator_3_pricing", body.indicator_3_pricing),
    ):
        if (val or "") not in INDICATOR_VALUES:
            raise HTTPException(400, f"{fld} must be one of {list(INDICATOR_VALUES)}")
    ctype = (body.contract_type or "other").strip()
    if ctype not in CONTRACT_TYPES:
        ctype = "other"
    i1 = score_indicator(body.indicator_1_responsibility)
    i2 = score_indicator(body.indicator_2_inventory)
    i3 = score_indicator(body.indicator_3_pricing)
    total = i1 + i2 + i3
    system_det = get_determination(total)
    gross_d = D(body.gross_amount) if body.gross_amount is not None else Decimal("0")
    rate_d = D(body.commission_rate) if body.commission_rate is not None else None
    rev = _compute_revenue(gross_d, rate_d, system_det)
    scores = {"i1": i1, "i2": i2, "i3": i3, "total": total}
    ai = _claude_assess(body, scores, system_det, rev)
    # Scoring model is authoritative for zone; Claude may refine wording / confidence.
    determination = system_det
    if ai.get("determination") in DETERMINATIONS and abs(total) <= 2:
        # Stay in judgment zone unless human later overrides.
        determination = "judgment_required"
    elif ai.get("determination") in DETERMINATIONS and abs(total) > 2:
        determination = system_det
    rev = _compute_revenue(gross_d, rate_d, determination)
    as_of = (body.assessment_date or date.today().isoformat())[:10]
    ref = _next_ref(company_id)
    row = pa_db.insert(
        {
            "company_id": company_id,
            "contract_id": body.contract_id,
            "contract_ref": body.contract_ref,
            "assessment_ref": ref,
            "assessment_date": as_of,
            "contract_type": ctype,
            "customer_name": body.customer_name,
            "counterparty_name": body.counterparty_name,
            "transaction_description": body.transaction_description.strip(),
            "gross_amount": money_str(gross_d),
            "commission_rate": str(rate_d) if rate_d is not None else None,
            "currency": body.currency or "AED",
            "indicator_1_responsibility": body.indicator_1_responsibility,
            "indicator_1_notes": body.indicator_1_notes,
            "indicator_2_inventory": body.indicator_2_inventory,
            "indicator_2_notes": body.indicator_2_notes,
            "indicator_3_pricing": body.indicator_3_pricing,
            "indicator_3_notes": body.indicator_3_notes,
            "has_inventory_risk": body.has_inventory_risk,
            "sets_price_independently": body.sets_price_independently,
            "primary_obligor": body.primary_obligor,
            "can_redirect_good": body.can_redirect_good,
            "third_party_involved": body.third_party_involved,
            "indicator_1_score": i1,
            "indicator_2_score": i2,
            "indicator_3_score": i3,
            "total_score": total,
            "ai_determination": determination,
            "ai_confidence": ai.get("confidence"),
            "ai_reasoning": ai.get("reasoning"),
            "ai_risk_flag": ai.get("risk_flag"),
            "ai_revenue_impact": ai.get("revenue_impact"),
            "ai_key_judgment": ai.get("key_judgment"),
            "final_determination": determination,
            "gross_revenue": money_str(rev["gross_revenue"]),
            "net_revenue": money_str(rev["net_revenue"]),
            "revenue_difference": money_str(rev["revenue_difference"]),
            "status": "ai_assessed",
            "prepared_by": body.prepared_by,
            "updated_at": _now(),
        }
    )
    pa_db.add_audit(
        row["id"],
        "ai_assessed",
        actor=body.prepared_by,
        new_value={
            "assessment_ref": ref,
            "total_score": total,
            "determination": determination,
            "confidence": ai.get("confidence"),
        },
        note=str(ai.get("key_judgment") or ""),
    )
    return {
        "success": True,
        "assessment": _enrich(row),
        "classification": ai,
    }


@router.post("/generate-memo/{assessment_id}")
async def generate_memo(assessment_id: str):
    _require_db()
    row = pa_db.get(assessment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Assessment not found")
    memo = _claude_memo(row)
    updated = pa_db.update(assessment_id, {"assessment_memo": memo, "updated_at": _now()})
    pa_db.add_audit(assessment_id, "memo_generated", note="Memo generated")
    return {"success": True, "memo": memo, "assessment": _enrich(updated)}


@router.get("/{assessment_id}/memo-pdf")
async def memo_pdf(assessment_id: str):
    _require_db()
    row = pa_db.get(assessment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Assessment not found")
    if not row.get("assessment_memo"):
        row["assessment_memo"] = _claude_memo(row)
        pa_db.update(assessment_id, {"assessment_memo": row["assessment_memo"]})
    data = _memo_pdf_bytes(row)
    ref = str(row.get("assessment_ref") or "principal_agent").replace(" ", "_")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{ref}_memo.pdf"'},
    )


@router.post("/{assessment_id}/override")
async def override_determination(assessment_id: str, body: OverrideRequest):
    _require_db()
    if body.human_determination not in DETERMINATIONS:
        raise HTTPException(400, f"human_determination must be one of {sorted(DETERMINATIONS)}")
    if not (body.reason or "").strip():
        raise HTTPException(400, "reason is required")
    row = pa_db.get(assessment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Assessment not found")
    gross_d = D(row.get("gross_amount"))
    rate_raw = row.get("commission_rate")
    rate_d = D(rate_raw) if rate_raw is not None and rate_raw != "" else None
    rev = _compute_revenue(gross_d, rate_d, body.human_determination)
    updated = pa_db.update(
        assessment_id,
        {
            "human_determination": body.human_determination,
            "human_override_reason": body.reason.strip(),
            "final_determination": body.human_determination,
            "gross_revenue": money_str(rev["gross_revenue"]),
            "net_revenue": money_str(rev["net_revenue"]),
            "revenue_difference": money_str(rev["revenue_difference"]),
            "status": "under_review",
            "updated_at": _now(),
        },
    )
    pa_db.add_audit(
        assessment_id,
        "override",
        actor=body.actor,
        old_value={"ai_determination": row.get("ai_determination"), "final": row.get("final_determination")},
        new_value={"human_determination": body.human_determination},
        note=body.reason,
    )
    return {"success": True, "assessment": _enrich(updated)}


@router.post("/{assessment_id}/approve")
async def approve(assessment_id: str, body: ApproveRequest):
    _require_db()
    row = pa_db.get(assessment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Assessment not found")
    ai_det = str(row.get("ai_determination") or "")
    human = str(row.get("human_determination") or "").strip()
    if ai_det == "judgment_required" and human not in DETERMINATIONS:
        raise HTTPException(
            status_code=400,
            detail="Human determination is required before approving a judgment-zone assessment.",
        )
    if not human and str(row.get("final_determination") or ai_det) == "judgment_required":
        raise HTTPException(
            status_code=400,
            detail="Human determination is required before approving a judgment-zone assessment.",
        )
    updated = pa_db.update(
        assessment_id,
        {
            "status": "approved",
            "approved_by": body.approved_by,
            "approved_at": _now(),
            "updated_at": _now(),
        },
    )
    pa_db.add_audit(assessment_id, "approved", actor=body.approved_by)
    return {"success": True, "assessment": _enrich(updated)}


@router.get("/portfolio-summary")
async def portfolio_summary(
    request: Request,
    company_id: Optional[str] = Query(None),
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    cid = _firm_id(request, company_id, x_firm_id)
    rows = pa_db.list(cid)
    principal = agent = judgment = pending = 0
    at_risk = Decimal("0")
    for r in rows:
        det = str(r.get("final_determination") or r.get("ai_determination") or "")
        if det == "principal":
            principal += 1
        elif det == "agent":
            agent += 1
            at_risk += D(r.get("revenue_difference"))
        elif det == "judgment_required":
            judgment += 1
        if str(r.get("status") or "") in {"draft", "ai_assessed", "under_review"}:
            pending += 1
    return {
        "success": True,
        "total_assessments": len(rows),
        "principal_count": principal,
        "agent_count": agent,
        "judgment_required_count": judgment,
        "total_gross_at_risk": money(at_risk) or 0.0,
        "pending_approval": pending,
    }


@router.get("/")
async def list_assessments(
    request: Request,
    company_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    determination: Optional[str] = Query(None),
    x_firm_id: Optional[str] = Header(None),
):
    _require_db()
    cid = _firm_id(request, company_id, x_firm_id)
    rows = [_enrich(r) for r in pa_db.list(cid, status=status, determination=determination)]
    return {"success": True, "assessments": rows, "count": len(rows)}


@router.get("/{assessment_id}")
async def get_assessment(assessment_id: str):
    _require_db()
    row = pa_db.get(assessment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return {
        "success": True,
        "assessment": _enrich(row),
        "audit_trail": pa_db.list_audit(assessment_id),
    }
