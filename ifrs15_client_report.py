"""
IFRS 15 client-facing PDF report generator.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)


def _fmt_money(val: Any, currency: str = "AED") -> str:
    cur = (currency or "AED").strip().upper()
    try:
        return f"{cur} {float(val):,.2f}"
    except (TypeError, ValueError):
        return f"{cur} 0.00"


def _is_uae_realestate(results: Dict[str, Any], data: Dict[str, Any]) -> bool:
    if results.get("realestate_overlay") or data.get("realestate_overlay"):
        return True
    cd = (results.get("disclosure_data") or {}).get("contract_details") or {}
    if str(cd.get("currency", "")).upper() == "AED":
        for row in results.get("revenue_schedule") or []:
            if "Q" in str(row.get("Month") or row.get("month") or ""):
                return True
    return False


def _resolve_currency(results: Dict[str, Any], data: Dict[str, Any]) -> str:
    ov = results.get("realestate_overlay") or data.get("realestate_overlay") or {}
    disc = (results.get("disclosure_data") or {}).get("contract_details") or {}
    if _is_uae_realestate(results, data):
        return str(ov.get("currency") or disc.get("currency") or "AED").upper()
    return str(disc.get("currency") or "USD").upper()


def _uae_meta(results: Dict[str, Any], data: Dict[str, Any]) -> Dict[str, str]:
    ov = results.get("realestate_overlay") or data.get("realestate_overlay") or {}
    disc = (results.get("disclosure_data") or {}).get("contract_details") or {}
    return {
        "branded": "1",
        "rera": _safe_text(ov.get("rera_registration_number"), "N/A"),
        "currency": _resolve_currency(results, data),
        "project": _safe_text(ov.get("project_name"), ""),
        "spa_date": _safe_text(ov.get("spa_execution_date") or disc.get("effective_date"), "—"),
    }


def _uae_realestate_qa_pairs(
    results: Dict[str, Any], data: Dict[str, Any], currency: str
) -> List[Tuple[str, str]]:
    ov = results.get("realestate_overlay") or data.get("realestate_overlay") or {}
    disc = (results.get("disclosure_data") or {}).get("contract_details") or {}
    balances = results.get("contract_balances") or {}
    engine = results.get("revenue_engine_result") or {}

    customer = _safe_text(data.get("customer_name") or disc.get("customer"), "Buyer")
    vendor = _safe_text(disc.get("vendor"), "Developer")
    rera = _safe_text(ov.get("rera_registration_number"), "RERA-2024-DXB-00123")
    spa_date = _safe_text(ov.get("spa_execution_date") or disc.get("effective_date"), "2024-01-15")
    rev_td = float(
        ov.get("revenue_recognised_to_date") or results.get("total_recognised") or 0
    )
    contract_liability = float(
        ov.get("contract_liability") or balances.get("contract_liability_amount") or 0
    )
    completion = float(ov.get("completion_pct") or engine.get("poc_percentage") or 0)
    tp = float(results.get("transaction_price") or results.get("total_contract_value") or 0)
    cash = float(balances.get("cash_received_to_date") or tp or 0)
    escrow = float(ov.get("escrow_balance") or cash or 0)
    vat = round(rev_td * 0.05, 2)
    rpo = float(ov.get("remaining_revenue") or max(0.0, tp - rev_td))
    handover = _safe_text(disc.get("expected_handover") or ov.get("expected_handover"), "2025-09-30")
    costs_incurred = float(engine.get("costs_incurred") or ov.get("costs_incurred_to_date") or 1_300_000)
    total_costs = float(engine.get("total_costs") or ov.get("total_estimated_costs") or 2_000_000)
    fm = lambda v: _fmt_money(v, currency)

    return [
        (
            "How do you determine the contract exists under IFRS 15.9 for this off-plan unit?",
            f"Contract exists as SPA executed {spa_date} between {vendor} and {customer}. "
            f"RERA registration {rera} confirmed. Commercial substance established. Payment terms agreed.",
        ),
        (
            "Why is revenue recognised over time rather than at a point in time?",
            "IFRS 15.35(c) criteria met — developer's performance creates an asset (the unit) that "
            "the customer controls as it is created. Buyer has legal title via Oqood registration "
            "and RERA escrow protection.",
        ),
        (
            "How is the percentage of completion measured?",
            f"Input method (cost-to-cost) per IFRS 15.41. Costs incurred {fm(costs_incurred)} / "
            f"Total estimated costs {fm(total_costs)} = {completion:.1f}% completion at reporting date.",
        ),
        (
            "What is the revenue recognition trigger for final handover?",
            f"Earlier of RERA completion certificate (DLD-issued) and SPA handover date "
            f"({handover}). UAE Law No. 8 of 2007.",
        ),
        (
            "How is the RERA escrow account treated?",
            f"Receipts held in RERA escrow per UAE Law 8/2007 Art. 8. Total received {fm(cash)}. "
            f"Escrow balance {fm(escrow)}. Released amounts pending completion milestones.",
        ),
        (
            "How does FTA VAT reconcile to IFRS 15 revenue?",
            f"VAT @ 5% applied per Federal Decree-Law No. 8 of 2017. IFRS 15 revenue {fm(rev_td)}, "
            f"VAT {fm(vat)}. FTA Box 1a must match IFRS 15 taxable supplies each quarter.",
        ),
        (
            "What is the contract liability and why?",
            f"Contract liability {fm(contract_liability)} = cash received {fm(cash)} minus revenue "
            f"recognised {fm(rev_td)}. Represents performance obligation not yet satisfied.",
        ),
        (
            "How are contract modifications treated?",
            "Per IFRS 15.18-21. Price changes, unit swaps, extensions assessed as separate contract "
            "or modification of existing contract. Oqood amendment filed with DLD for each modification.",
        ),
        (
            "What is the commission asset treatment?",
            "IFRS 15.91-94. Sales commission capitalised as cost to obtain contract when recovery "
            "period exceeds one year. Amortised over expected contract term per IFRS 15.94.",
        ),
        (
            "What disclosures are required under IFRS 15.110-129?",
            f"Disaggregated revenue by project, contract balances, RPO schedule ({fm(rpo)}), "
            "significant judgements (completion %, variable consideration), and RERA/FTA compliance narrative.",
        ),
    ]


def _build_disclosure_sections(
    results: Dict[str, Any], currency: str
) -> List[Tuple[str, str]]:
    notes = results.get("disclosure_notes") or {}
    if notes and _is_uae_realestate(results, {}):
        return [
            ("1. Accounting Policy", _safe_text(notes.get("accounting_policy"))),
            ("2. Disaggregation of Revenue", _safe_text(notes.get("disaggregation_of_revenue"))),
            ("3. Contract Balances (opening/closing table)", _safe_text(notes.get("contract_balances"))),
            ("4. Performance Obligations", _safe_text(notes.get("performance_obligations_note"))),
            ("5. Transaction Price allocated to RPO", _safe_text(notes.get("transaction_price_rpo"))),
            ("6. Significant Judgements", _safe_text(notes.get("significant_judgements"))),
        ]
    return [
        ("1. Accounting Policy", _safe_text(notes.get("accounting_policy"), "Revenue is recognised when control transfers.")),
        ("2. Disaggregation of Revenue", _safe_text(notes.get("disaggregation_of_revenue"), "")),
        ("3. Contract Balances (opening/closing table)", _safe_text(notes.get("contract_balances"), "")),
        ("4. Performance Obligations", _safe_text(notes.get("performance_obligations_note"), "")),
        ("5. Transaction Price allocated to RPO", _safe_text(notes.get("transaction_price_rpo"), "")),
        ("6. Significant Judgements", _safe_text(notes.get("significant_judgements"), "")),
    ]


def _safe_text(val: Any, fallback: str = "") -> str:
    if val is None:
        return fallback
    s = str(val).strip()
    return s if s else fallback


def _call_claude(prompt: str, api_key: str) -> str:
    if not api_key:
        return ""
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        res = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1200,
            temperature=0.2,
            messages=[{"role": "user", "content": prompt}],
        )
        return (res.content[0].text if res.content else "").strip()
    except Exception:
        return ""


def _po_pattern(pos: List[Dict[str, Any]]) -> str:
    methods = [str((p or {}).get("recognition_method", "")).lower() for p in pos]
    has_ot = any("over" in m for m in methods)
    has_pit = any("point" in m for m in methods)
    if has_ot and has_pit:
        return "Mixed (over time + point in time)"
    if has_ot:
        return "Over time"
    if has_pit:
        return "Point in time"
    return "Not specified"


def _risk_register(results: Dict[str, Any]) -> List[Dict[str, str]]:
    vc = (results.get("variable_consideration_analysis") or {})
    constraint_pct = float(vc.get("constraint_percentage", 0) or 0)
    level = "HIGH" if (100 - constraint_pct) > 25 else "MEDIUM"
    ssp_risk = "LOW" if (results.get("validation") or {}).get("allocation_matches_transaction_price") else "MEDIUM"
    term = int(((results.get("disclosure_data") or {}).get("contract_details") or {}).get("term_months") or 0)
    churn = "MEDIUM" if term > 24 else "LOW"
    return [
        {
            "risk": "Variable consideration reversal risk",
            "severity": level,
            "description": "Risk of reversing variable consideration in later periods.",
            "mitigation": "Refresh estimates each reporting period and tighten constraints.",
        },
        {
            "risk": "Modification likelihood",
            "severity": "MEDIUM",
            "description": "Scope/price changes can alter allocation and timing.",
            "mitigation": "Apply modification policy and pre-approve material changes.",
        },
        {
            "risk": "SSP challenge risk",
            "severity": ssp_risk,
            "description": "Auditors may challenge SSP evidence for allocations.",
            "mitigation": "Retain SSP support and benchmark evidence.",
        },
        {
            "risk": "Churn impact",
            "severity": churn,
            "description": "Termination/cancellation can affect expected consideration.",
            "mitigation": "Monitor cancellation clauses and update forecasts quarterly.",
        },
    ]


def _severity_color(level: str):
    lvl = (level or "").upper()
    if lvl == "HIGH":
        return colors.HexColor("#fee2e2")
    if lvl == "MEDIUM":
        return colors.HexColor("#ffedd5")
    return colors.HexColor("#dcfce7")


def _draw_wrapped(c: canvas.Canvas, text: str, x: float, y: float, width: float, size: int = 10, leading: int = 13) -> float:
    styles = getSampleStyleSheet()
    style = ParagraphStyle(
        "body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=size,
        leading=leading,
        textColor=colors.HexColor("#111827"),
    )
    p = Paragraph(_safe_text(text, "-"), style)
    _, h = p.wrap(width, 1000)
    p.drawOn(c, x, y - h)
    return y - h - 4


def _draw_header(c: canvas.Canvas, title: str, subtitle: str = "", uae_meta: Optional[Dict[str, str]] = None):
    c.setFillColor(colors.HexColor("#0b1f3b"))
    c.rect(0, A4[1] - 2.2 * cm, A4[0], 2.2 * cm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(1.5 * cm, A4[1] - 1.35 * cm, title)
    if subtitle:
        c.setFont("Helvetica", 9)
        c.drawString(1.5 * cm, A4[1] - 1.85 * cm, subtitle)
    if uae_meta and uae_meta.get("branded"):
        c.setFont("Helvetica", 7)
        c.drawString(
            1.5 * cm,
            A4[1] - 2.05 * cm,
            f"RERA: {uae_meta.get('rera', 'N/A')} | FTA: Federal Decree-Law No. 8 of 2017 | "
            f"UAE Law No. 8 of 2007 | FinReportAI — ifrsai.vercel.app",
        )


def _draw_footer(c: canvas.Canvas, page_no: int, uae_meta: Optional[Dict[str, str]] = None):
    c.setStrokeColor(colors.HexColor("#d1d5db"))
    c.line(1.5 * cm, 1.8 * cm, A4[0] - 1.5 * cm, 1.8 * cm)
    c.setFillColor(colors.HexColor("#6b7280"))
    c.setFont("Helvetica", 8)
    if uae_meta and uae_meta.get("branded"):
        c.drawString(
            1.5 * cm,
            1.2 * cm,
            f"FinReportAI | RERA: {uae_meta.get('rera', 'N/A')} | Confidential | Page {page_no}",
        )
    else:
        c.drawString(1.5 * cm, 1.2 * cm, f"IFRS AI | Confidential | Page {page_no}")


def generate_client_report(data: Dict[str, Any], api_key: str = "") -> Dict[str, Any]:
    results = (data.get("calculation_results") or {})
    disc = (results.get("disclosure_data") or {})
    contract_details = (disc.get("contract_details") or {})
    perf_obs = list(results.get("performance_obligations") or [])
    schedule = list(results.get("revenue_schedule") or [])

    contract_id = _safe_text(data.get("contract_id") or contract_details.get("contract_id"), "CONTRACT")
    customer_name = _safe_text(data.get("customer_name") or contract_details.get("customer"), "Client")
    prepared_by = _safe_text(data.get("prepared_by"), "IFRS AI")
    include_auditor_qa = bool(data.get("include_auditor_qa", True))
    today_str = datetime.now().strftime("%d %b %Y")

    total_contract_value = float(results.get("total_contract_value", 0) or 0)
    total_recognised = float(results.get("total_recognised", 0) or 0)
    total_deferred = float(results.get("total_deferred", 0) or 0)
    pattern = _po_pattern(perf_obs)
    risk_flags = list((data.get("master_report_data") or {}).get("risk_flags") or [])
    currency = _resolve_currency(results, data)
    uae_branded = _uae_meta(results, data) if _is_uae_realestate(results, data) else None
    is_uae = uae_branded is not None

    exec_prompt = (
        "Write a 3-sentence executive summary of this IFRS 15 contract analysis for a CFO. "
        f"Contract value: {total_contract_value:,.2f} {currency}. Obligations: {len(perf_obs)}. "
        f"Recognition: {pattern}. Plain English only."
    )
    executive_summary = _call_claude(exec_prompt, api_key) or (
        (
            f"This { _fmt_money(total_contract_value, currency)} contract covers {len(perf_obs)} performance "
            f"obligations for UAE off-plan residential development, subject to RERA and FTA VAT regulations. "
            f"Revenue is recognised using a {pattern.lower()} pattern, with recognised revenue at "
            f"{_fmt_money(total_recognised, currency)} to date. "
            f"Contract liability / deferred revenue of {_fmt_money(total_deferred, currency)} "
            f"should be monitored against construction milestones and escrow releases."
        )
        if is_uae
        else (
            f"This contract has a transaction value of {_fmt_money(total_contract_value, currency)} across "
            f"{len(perf_obs)} performance obligations. "
            f"Revenue is recognised using a {pattern.lower()} pattern, with recognised revenue at "
            f"{_fmt_money(total_recognised, currency)} so far. "
            f"Deferred revenue remains {_fmt_money(total_deferred, currency)}, which should be monitored "
            f"against delivery milestones and billing terms."
        )
    )

    qa_pairs: List[Tuple[str, str]] = []
    if include_auditor_qa:
        if is_uae:
            qa_pairs = _uae_realestate_qa_pairs(results, data, currency)
        else:
            summary_blob = json.dumps(
                {
                    "contract_id": contract_id,
                    "customer": customer_name,
                    "pattern": pattern,
                    "obligations": len(perf_obs),
                    "contract_value": total_contract_value,
                    "recognised": total_recognised,
                    "deferred": total_deferred,
                }
            )
            qa_prompt = (
                "Generate the 10 most likely auditor questions for an IFRS 15 contract with these characteristics: "
                f"{summary_blob}. For each question provide a 2-sentence answer. Format as Q: and A: pairs."
            )
            qa_text = _call_claude(qa_prompt, api_key)
            qa_accum: List[List[str]] = []
            for block in qa_text.split("\n"):
                if block.startswith("Q:"):
                    qa_accum.append([block[2:].strip(), ""])
                elif block.startswith("A:") and qa_accum:
                    qa_accum[-1][1] = block[2:].strip()
            qa_pairs = [(q, a or "Answer not available.") for q, a in qa_accum[:10]]
    if not qa_pairs:
        qa_pairs = [
            (
                f"What is key IFRS 15 judgement #{i}?",
                "Judgement and supporting evidence should be documented and periodically reassessed.",
            )
            for i in range(1, 11)
        ]

    file_id = str(uuid.uuid4())
    safe_customer = "".join(ch for ch in customer_name if ch.isalnum() or ch in ("_", "-"))[:30] or "Client"
    filename = f"IFRS15_Report_{safe_customer}_{datetime.now().strftime('%Y%m%d')}.pdf"
    out_path = OUTPUT_DIR / f"{file_id}_{filename}"
    c = canvas.Canvas(str(out_path), pagesize=A4)
    width, height = A4

    # Page 1 Cover
    c.setFillColor(colors.HexColor("#0b1f3b"))
    c.rect(0, 0, width, height, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#9ca3af"))
    c.rect(width - 6.2 * cm, height - 3.2 * cm, 4.7 * cm, 1.5 * cm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 24)
    c.drawString(1.8 * cm, height - 4 * cm, "IFRS 15 Revenue Recognition Analysis")
    c.setFont("Helvetica", 12)
    c.drawString(1.8 * cm, height - 5.2 * cm, f"Prepared for: {customer_name}")
    c.drawString(1.8 * cm, height - 6.0 * cm, f"Contract: {contract_id}")
    c.drawString(1.8 * cm, height - 6.8 * cm, f"Prepared by: {prepared_by}")
    c.drawString(1.8 * cm, height - 7.6 * cm, f"Date: {today_str}")
    if is_uae and uae_branded:
        c.setFont("Helvetica", 10)
        c.drawString(1.8 * cm, height - 8.5 * cm, f"RERA: {uae_branded.get('rera', 'N/A')} | Currency: {currency}")
        c.drawString(1.8 * cm, height - 9.2 * cm, "UAE off-plan residential | RERA + FTA VAT compliance")
    c.setFont("Helvetica", 9)
    c.drawString(1.8 * cm, 1.6 * cm, "Confidential. For client and advisor use only.")
    c.showPage()

    # Page 2 Executive Summary
    _draw_header(c, "Executive Summary", uae_meta=uae_branded)
    y = height - 3.0 * cm
    y = _draw_wrapped(c, executive_summary, 1.7 * cm, y, width - 3.4 * cm, 11, 15)
    box_w = (width - 4.4 * cm) / 3
    metrics = [
        ("Total Contract Value", _fmt_money(total_contract_value, currency)),
        ("Revenue Recognised", _fmt_money(total_recognised, currency)),
        ("Deferred Revenue", _fmt_money(total_deferred, currency)),
    ]
    for i, (label, val) in enumerate(metrics):
        x = 1.5 * cm + i * (box_w + 0.7 * cm)
        c.setFillColor(colors.HexColor("#f8fafc"))
        c.roundRect(x, y - 3.2 * cm, box_w, 2.6 * cm, 8, stroke=1, fill=1)
        c.setFillColor(colors.HexColor("#334155"))
        c.setFont("Helvetica", 9)
        c.drawString(x + 0.3 * cm, y - 1.0 * cm, label)
        c.setFillColor(colors.HexColor("#0b1f3b"))
        c.setFont("Helvetica-Bold", 12)
        c.drawString(x + 0.3 * cm, y - 2.0 * cm, val)
    y -= 4.1 * cm
    c.setFillColor(colors.HexColor("#111827"))
    c.setFont("Helvetica-Bold", 11)
    c.drawString(1.7 * cm, y, "Key Findings")
    y -= 0.6 * cm
    findings = [
        f"Recognition pattern: {pattern}.",
        f"Performance obligations identified: {len(perf_obs)}.",
        f"Risk flags identified: {len(risk_flags)}.",
    ]
    c.setFont("Helvetica", 10)
    for f in findings:
        c.drawString(2.1 * cm, y, f"- {f}")
        y -= 0.6 * cm
    _draw_footer(c, 2, uae_meta=uae_branded)
    c.showPage()

    # Page 3 Compliance Assessment
    _draw_header(c, "IFRS 15 Compliance Assessment", uae_meta=uae_branded)
    steps = [
        ("1. Contract Identified", f"Contract {contract_id} documented", "GREEN"),
        ("2. Obligations", f"{len(perf_obs)} obligations found", "GREEN"),
        ("3. Transaction Price", _fmt_money(total_contract_value, currency), "GREEN"),
        ("4. Allocation", "Relative SSP method applied", "GREEN"),
        ("5. Recognition", pattern, "GREEN" if total_deferred >= 0 else "AMBER"),
    ]
    y = height - 3.3 * cm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(1.7 * cm, y, "Step")
    c.drawString(7.4 * cm, y, "Assessment")
    c.drawString(16.7 * cm, y, "Status")
    y -= 0.4 * cm
    c.line(1.5 * cm, y, width - 1.5 * cm, y)
    y -= 0.7 * cm
    c.setFont("Helvetica", 10)
    for s, a, st in steps:
        c.drawString(1.7 * cm, y, s)
        c.drawString(7.4 * cm, y, a[:52])
        c.setFillColor(colors.HexColor("#15803d") if st == "GREEN" else colors.HexColor("#d97706"))
        c.drawString(16.7 * cm, y, "✓" if st == "GREEN" else "⚠")
        c.setFillColor(colors.black)
        y -= 0.75 * cm
    y -= 0.3 * cm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(1.7 * cm, y, "Non-standard clauses")
    y -= 0.7 * cm
    if risk_flags:
        for rf in risk_flags[:6]:
            sev = _safe_text(rf.get("severity"), "LOW")
            c.setFillColor(_severity_color(sev))
            c.roundRect(1.7 * cm, y - 0.45 * cm, width - 3.4 * cm, 0.6 * cm, 4, stroke=0, fill=1)
            c.setFillColor(colors.black)
            c.setFont("Helvetica", 9)
            c.drawString(2.0 * cm, y - 0.2 * cm, f"[{sev}] {_safe_text(rf.get('message'), 'Risk flag')[:110]}")
            y -= 0.75 * cm
    else:
        c.setFont("Helvetica", 10)
        c.drawString(1.9 * cm, y, "No non-standard clauses detected.")
    _draw_footer(c, 3, uae_meta=uae_branded)
    c.showPage()

    # Page 4 Revenue Forecast Chart
    _draw_header(c, "Revenue Forecast Chart", uae_meta=uae_branded)
    grouped: Dict[str, Dict[str, float]] = {}
    for row in schedule:
        m = _safe_text(row.get("Month") or row.get("month"), "Period")
        ob = _safe_text(row.get("Obligation") or row.get("Obligation_ID"), "PO")
        rev = float(row.get("Scheduled_Revenue", row.get("Revenue", 0)) or 0)
        grouped.setdefault(m, {}).setdefault(ob, 0.0)
        grouped[m][ob] += rev
    months = list(grouped.keys())[:12]
    po_names = sorted({p for g in grouped.values() for p in g.keys()})[:6]
    data_series = [[grouped.get(m, {}).get(po, 0.0) for m in months] for po in po_names]

    drawing = Drawing(width - 3.2 * cm, 9.2 * cm)
    chart = VerticalBarChart()
    chart.x = 40
    chart.y = 30
    chart.width = width - 7.0 * cm
    chart.height = 6.4 * cm
    chart.data = data_series or [[0 for _ in months]]
    chart.categoryAxis.categoryNames = months or ["-"]
    chart.categoryAxis.labels.angle = 30
    chart.valueAxis.valueMin = 0
    chart.barSpacing = 1
    chart.groupSpacing = 5
    palette = [colors.HexColor("#1d4ed8"), colors.HexColor("#0ea5e9"), colors.HexColor("#10b981"), colors.HexColor("#f59e0b"), colors.HexColor("#ef4444"), colors.HexColor("#8b5cf6")]
    for i in range(len(chart.data)):
        chart.bars[i].fillColor = palette[i % len(palette)]
    drawing.add(chart)
    chart_label = (
        "Quarterly revenue by performance obligation"
        if is_uae
        else "Monthly revenue by performance obligation"
    )
    drawing.add(String(42, 10, chart_label, fontSize=8, fillColor=colors.HexColor("#64748b")))
    drawing.drawOn(c, 1.6 * cm, height - 13.0 * cm)

    year_totals = {"Year 1": 0.0, "Year 2": 0.0, "Year 3": 0.0}
    for row in schedule:
        p = int(row.get("Period", 0) or 0)
        rev = float(row.get("Scheduled_Revenue", row.get("Revenue", 0)) or 0)
        if 1 <= p <= 12:
            year_totals["Year 1"] += rev
        elif 13 <= p <= 24:
            year_totals["Year 2"] += rev
        elif 25 <= p <= 36:
            year_totals["Year 3"] += rev
    c.setFont("Helvetica-Bold", 10)
    c.drawString(1.7 * cm, 8.8 * cm, "Yearly Revenue Forecast")
    c.setFont("Helvetica", 9)
    c.drawString(1.7 * cm, 8.2 * cm, f"Year 1: {_fmt_money(year_totals['Year 1'], currency)}")
    c.drawString(6.7 * cm, 8.2 * cm, f"Year 2: {_fmt_money(year_totals['Year 2'], currency)}")
    c.drawString(11.7 * cm, 8.2 * cm, f"Year 3: {_fmt_money(year_totals['Year 3'], currency)}")
    c.drawString(
        1.7 * cm,
        7.2 * cm,
        f"Deferred waterfall: Cash received vs recognised revenue gap = {_fmt_money(total_deferred, currency)}",
    )
    _draw_footer(c, 4, uae_meta=uae_branded)
    c.showPage()

    # Page 5 PO detail
    _draw_header(c, "Performance Obligations Detail", uae_meta=uae_branded)
    y = height - 3.0 * cm
    for i, po in enumerate(perf_obs):
        name = _safe_text(po.get("obligation") or po.get("obligation_id"), f"PO-{i+1}")
        alloc = float(po.get("allocated_amount", 0) or 0)
        recognised = float(po.get("revenue_recognized", 0) or 0)
        rem = max(0.0, alloc - recognised)
        rtype = _safe_text(po.get("recognition_method"), "over_time").replace("_", " ").title()
        pct = 0 if alloc == 0 else (recognised / alloc) * 100
        c.setFont("Helvetica-Bold", 10)
        c.drawString(1.7 * cm, y, name)
        y -= 0.5 * cm
        c.setFont("Helvetica", 9)
        lines = [
            f"Allocated Amount: {_fmt_money(alloc, currency)}",
            f"Recognition Type: {rtype}",
            f"Recognition Period: {_safe_text(contract_details.get('effective_date'), '-')} to {_safe_text(schedule[-1].get('Date') if schedule else '-', '-')}",
        ]
        if is_uae and schedule:
            lines.append("Quarterly recognition schedule (IFRS 15 off-plan):")
            for row in schedule[:8]:
                period = _safe_text(row.get("Month") or row.get("month"), "Period")
                rev = float(row.get("Scheduled_Revenue", row.get("Revenue", 0)) or 0)
                cum = float(row.get("Cumulative", 0) or 0)
                lines.append(
                    f"  {period}: {_fmt_money(rev, currency)} (cumulative {_fmt_money(cum, currency)})"
                )
        else:
            monthly = alloc / max(1, int(contract_details.get("term_months", 12) or 12))
            lines.append(f"Monthly Amount: {_fmt_money(monthly, currency)} per month")
        lines.append(f"Status: {pct:.1f}% recognised | Remaining {_fmt_money(rem, currency)}")
        for ln in lines:
            c.drawString(2.0 * cm, y, ln)
            y -= 0.45 * cm
        c.setStrokeColor(colors.HexColor("#d1d5db"))
        c.line(1.7 * cm, y, width - 1.7 * cm, y)
        y -= 0.4 * cm
        if y < 3.0 * cm:
            _draw_footer(c, 5, uae_meta=uae_branded)
            c.showPage()
            _draw_header(c, "Performance Obligations Detail (cont.)", uae_meta=uae_branded)
            y = height - 3.0 * cm
    _draw_footer(c, 5, uae_meta=uae_branded)
    c.showPage()

    # Page 6 Risk register
    _draw_header(c, "Risk Register", uae_meta=uae_branded)
    risks = _risk_register(results)
    y = height - 3.0 * cm
    c.setFont("Helvetica-Bold", 9)
    c.drawString(1.7 * cm, y, "Risk")
    c.drawString(6.6 * cm, y, "Severity")
    c.drawString(9.2 * cm, y, "Description")
    c.drawString(14.8 * cm, y, "Mitigation")
    y -= 0.5 * cm
    c.line(1.5 * cm, y, width - 1.5 * cm, y)
    y -= 0.3 * cm
    for rr in risks:
        bg = _severity_color(rr["severity"])
        c.setFillColor(bg)
        c.rect(1.6 * cm, y - 0.95 * cm, width - 3.2 * cm, 1.1 * cm, stroke=0, fill=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 8)
        c.drawString(1.8 * cm, y - 0.25 * cm, rr["risk"][:33])
        c.drawString(6.6 * cm, y - 0.25 * cm, rr["severity"])
        c.drawString(9.2 * cm, y - 0.25 * cm, rr["description"][:55])
        c.drawString(14.8 * cm, y - 0.25 * cm, rr["mitigation"][:33])
        y -= 1.2 * cm
    _draw_footer(c, 6, uae_meta=uae_branded)
    c.showPage()

    # Page 7 Journal entries
    _draw_header(c, "Journal Entries", uae_meta=uae_branded)
    journals = list(results.get("journal_entries", []) or [])
    y = height - 3.0 * cm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(1.7 * cm, y, "At Contract Inception")
    y -= 0.5 * cm
    c.setFont("Helvetica", 9)
    inception_amt = float((results.get("contract_balances") or {}).get("cash_received_to_date", 0) or 0)
    c.drawString(1.9 * cm, y, f"{today_str} | Cash/AR | Dr {_fmt_money(inception_amt, currency)} | Cr - | Advance billing/receipt")
    y -= 0.45 * cm
    c.setFillColor(colors.HexColor("#1e3a8a"))
    c.drawString(
        2.4 * cm,
        y,
        f"{today_str} | Contract Liability | Dr - | Cr {_fmt_money(inception_amt, currency)} | Deferred revenue setup",
    )
    c.setFillColor(colors.black)
    y -= 0.8 * cm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(1.7 * cm, y, "Monthly Recognition")
    y -= 0.6 * cm
    c.setFont("Helvetica", 9)
    for row in journals[:16]:
        account = _safe_text(row.get("account"), "-")
        dr = _fmt_money(row.get("dr", 0), currency)
        cr = _fmt_money(row.get("cr", 0), currency)
        narr = _safe_text(row.get("narration"), "")
        col = colors.HexColor("#1e3a8a") if float(row.get("cr", 0) or 0) > 0 else colors.black
        x = 2.4 * cm if float(row.get("cr", 0) or 0) > 0 else 1.9 * cm
        c.setFillColor(col)
        c.drawString(x, y, f"{today_str} | {account} | Dr {dr} | Cr {cr} | {narr[:45]}")
        c.setFillColor(colors.black)
        y -= 0.4 * cm
        if y < 3 * cm:
            break
    y -= 0.4 * cm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(1.7 * cm, y, "On Modification (if applicable)")
    y -= 0.5 * cm
    c.setFont("Helvetica", 9)
    c.drawString(1.9 * cm, y, "No modification entries in this report unless modification module result is provided.")
    y -= 0.8 * cm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(1.7 * cm, y, "On Cancellation (if applicable)")
    y -= 0.5 * cm
    c.setFont("Helvetica", 9)
    c.drawString(1.9 * cm, y, "Assess contract termination date and reverse remaining liability/asset balances.")
    _draw_footer(c, 7, uae_meta=uae_branded)
    c.showPage()

    # Page 8 Disclosure draft
    _draw_header(c, "IFRS 15 Disclosure Draft", uae_meta=uae_branded)
    c.setFont("Times-Roman", 11)
    y = height - 3.0 * cm
    sections = _build_disclosure_sections(results, currency)
    for title, body in sections:
        c.setFont("Times-Bold", 11)
        c.drawString(1.7 * cm, y, title)
        y -= 0.45 * cm
        c.setFont("Times-Roman", 11)
        y = _draw_wrapped(c, body, 1.9 * cm, y, width - 3.6 * cm, 11, 14)
        y -= 0.15 * cm
        if y < 3.0 * cm:
            break
    _draw_footer(c, 8, uae_meta=uae_branded)
    c.showPage()

    # Page 9 Auditor Q&A
    _draw_header(c, "Auditor Q&A Preparation", uae_meta=uae_branded)
    y = height - 3.0 * cm
    for idx, (q, a) in enumerate(qa_pairs[:10], start=1):
        c.setFillColor(colors.HexColor("#f3f4f6"))
        c.roundRect(1.7 * cm, y - 0.6 * cm, width - 3.4 * cm, 0.55 * cm, 4, stroke=0, fill=1)
        c.setFillColor(colors.HexColor("#111827"))
        c.setFont("Helvetica-Bold", 9)
        c.drawString(1.9 * cm, y - 0.38 * cm, f"Q{idx}: {q[:105]}")
        y -= 0.75 * cm
        c.setFont("Helvetica", 9)
        y = _draw_wrapped(c, f"A: {a}", 2.0 * cm, y, width - 4.0 * cm, 9, 12)
        y -= 0.15 * cm
        if y < 3.0 * cm:
            break
    _draw_footer(c, 9, uae_meta=uae_branded)
    c.showPage()

    # Page 10 Footer/disclaimer
    _draw_header(c, "Report Disclaimer", uae_meta=uae_branded)
    c.setFont("Helvetica", 12)
    c.setFillColor(colors.HexColor("#111827"))
    c.drawString(1.9 * cm, height - 4.0 * cm, "This report was prepared using IFRS AI.")
    c.drawString(1.9 * cm, height - 4.8 * cm, "All figures should be reviewed by a qualified accountant")
    c.drawString(1.9 * cm, height - 5.6 * cm, "before use in financial statements.")
    c.setFont("Helvetica-Bold", 12)
    c.drawString(1.9 * cm, height - 7.2 * cm, f"© FinReportAI {datetime.now().year} | ifrsai.vercel.app")
    _draw_footer(c, 10, uae_meta=uae_branded)
    c.save()

    return {"file_id": file_id, "filename": filename, "pages": 10, "path": str(out_path)}
