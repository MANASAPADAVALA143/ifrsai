"""
UAE Real Estate IFRS 15 — branded client PDF report (reportlab).
"""

from __future__ import annotations

import io
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

NAVY = colors.HexColor("#1E3A5F")
GOLD = colors.HexColor("#C9A84C")
GREEN = colors.HexColor("#16A34A")
RED = colors.HexColor("#DC2626")
GREY = colors.HexColor("#6B7280")
LIGHT_BG = colors.HexColor("#F8FAFC")

MARGIN = 2 * cm
PAGE_W, PAGE_H = A4
CONTENT_W = PAGE_W - 2 * MARGIN


class RealEstatePDFInput(BaseModel):
    project_name: str = "Unnamed Project"
    developer_name: str = "Developer"
    rera_registration_number: str = "N/A"
    report_date: str = ""
    reporting_period: str = ""
    currency: str = "AED"

    contract_price: float = 0.0
    completion_pct: float = 0.0
    completion_source: str = "Manual Input"
    rera_certificate_ref: Optional[str] = None
    rera_certificate_date: Optional[str] = None
    revenue_recognition_trigger: str = ""
    rera_completion_date: Optional[str] = None
    spa_handover_date: Optional[str] = None
    trigger_warning: Optional[str] = None
    recognition_trigger_summary: Optional[str] = None

    revenue_recognised: float = 0.0
    deferred_revenue: float = 0.0
    contract_asset: float = 0.0
    vat_amount: float = 0.0
    remaining_performance_obligation: float = 0.0

    total_escrow_received: float = 0.0
    total_escrow_released: float = 0.0
    net_escrow_balance: float = 0.0
    escrow_compliance_status: str = "Compliant"

    quarterly_schedule: List[Dict[str, Any]] = Field(default_factory=list)
    health_checks: Dict[str, Any] = Field(default_factory=dict)
    disclosure_score: float = 0.0
    disclosure_gaps: List[str] = Field(default_factory=list)
    oqood_assessments: List[Dict[str, Any]] = Field(default_factory=list)
    cancellation_summary: Optional[Dict[str, Any]] = None
    rera_certificate_verified: bool = False
    rera_certificate_confidence: Optional[float] = None
    journal_entries: List[Dict[str, Any]] = Field(default_factory=list)


def format_money(amount: Any, currency: str = "AED") -> str:
    cur = (currency or "AED").upper()
    try:
        val = float(amount or 0)
    except (TypeError, ValueError):
        val = 0.0
    return f"{cur} {val:,.2f}"


def format_pct(val: Any) -> str:
    try:
        return f"{float(val):.1f}%"
    except (TypeError, ValueError):
        return "0.0%"


def format_display_date(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    raw = str(iso).strip()[:10]
    try:
        d = datetime.strptime(raw, "%Y-%m-%d")
        return d.strftime("%d %b %Y")
    except ValueError:
        return raw


def _disclosure_band(score: float) -> str:
    if score >= 90:
        return "Excellent"
    if score >= 80:
        return "Good"
    if score >= 60:
        return "Adequate"
    return "Needs Improvement"


def _safe(val: Any, fallback: str = "—") -> str:
    if val is None or val == "":
        return fallback
    return str(val)


class _NumberedCanvas(canvas.Canvas):
    """Footer with page X of Y on every page."""

    def __init__(self, rera_number: str, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._rera_number = rera_number
        self._saved: List[Dict[str, Any]] = []
        self.page_count = 0

    def showPage(self) -> None:
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        total = len(self._saved)
        self.page_count = total
        for i, state in enumerate(self._saved, start=1):
            self.__dict__.update(state)
            self._draw_footer(i, total)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def _draw_footer(self, page_no: int, total: int) -> None:
        y = 1.2 * cm
        self.setStrokeColor(colors.HexColor("#E5E7EB"))
        self.line(MARGIN, 1.6 * cm, PAGE_W - MARGIN, 1.6 * cm)
        self.setFont("Helvetica", 7)
        self.setFillColor(GREY)
        self.drawString(MARGIN, y, "FinReportAI — IFRS 15 Real Estate UAE")
        self.drawCentredString(PAGE_W / 2, y, f"RERA Reg: {self._rera_number}")
        self.drawRightString(PAGE_W - MARGIN, y, f"Page {page_no} of {total}")


def _section_header(c: canvas.Canvas, title: str, y: float) -> float:
    h = 0.65 * cm
    c.setFillColor(NAVY)
    c.rect(MARGIN, y - h, CONTENT_W, h, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(MARGIN + 0.2 * cm, y - 0.48 * cm, title)
    return y - h - 0.35 * cm


def _draw_wrapped(
    c: canvas.Canvas, text: str, x: float, y: float, width: float, size: int = 9
) -> float:
    styles = getSampleStyleSheet()
    style = ParagraphStyle(
        "body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=size,
        leading=size + 3,
        textColor=colors.black,
    )
    p = Paragraph(text.replace("\n", "<br/>"), style)
    _, h = p.wrap(width, 1000)
    p.drawOn(c, x, y - h)
    return y - h - 0.15 * cm


def _health_result(
    checks: Dict[str, Any], key: str, na_if_missing: bool = False
) -> Tuple[str, str]:
    """Return (symbol, colour name) for Pass/Fail/N/A."""
    key_map = {
        "a": "check_a_pass",
        "b1": "check_b1_pass",
        "b2": "check_b2_pass",
        "c": "check_c_pass",
        "d": "check_d_pass",
        "e": "check_e_pass",
    }
    pass_key = key_map.get(key, key if key.endswith("_pass") else f"check_{key}_pass")
    if pass_key not in checks:
        if na_if_missing:
            return "—", "grey"
        return "✗", "red"
    ok = bool(checks.get(pass_key))
    return ("✓", "green") if ok else ("✗", "red")


def _draw_cover(c: canvas.Canvas, data: RealEstatePDFInput) -> None:
    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - 3.5 * cm, PAGE_W, 3.5 * cm, stroke=0, fill=1)
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(MARGIN, PAGE_H - 2.2 * cm, "FinReportAI — IFRS Compliance Platform")

    y = PAGE_H - 7 * cm
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(MARGIN, y, "IFRS 15 Revenue Recognition Report")
    y -= 1.0 * cm
    c.setFont("Helvetica", 14)
    c.drawString(MARGIN, y, "UAE Real Estate — Off-Plan Development")
    y -= 0.7 * cm
    c.setFont("Helvetica-Oblique", 10)
    c.setFillColor(GREY)
    c.drawString(MARGIN, y, "Prepared under IFRS 15 (IASB 2014)")

    box_y = PAGE_H - 14 * cm
    c.setStrokeColor(NAVY)
    c.setFillColor(LIGHT_BG)
    c.roundRect(MARGIN, box_y, CONTENT_W, 5.5 * cm, 6, stroke=1, fill=1)
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 10)
    rows = [
        ("Project:", data.project_name),
        ("Developer:", data.developer_name),
        ("RERA Reg No:", data.rera_registration_number),
        ("Report Date:", format_display_date(data.report_date) if data.report_date else datetime.now().strftime("%d %b %Y")),
        ("Period:", data.reporting_period or "—"),
        ("Currency:", data.currency.upper()),
    ]
    ty = box_y + 4.6 * cm
    for label, val in rows:
        c.setFont("Helvetica-Bold", 9)
        c.drawString(MARGIN + 0.4 * cm, ty, label)
        c.setFont("Helvetica", 9)
        c.drawString(MARGIN + 4.2 * cm, ty, _safe(val))
        ty -= 0.75 * cm

    c.setFillColor(GREY)
    c.setFont("Helvetica", 8)
    c.drawString(MARGIN, 2.8 * cm, "Confidential — Prepared by FinReportAI")
    c.drawString(MARGIN, 2.2 * cm, "This report does not constitute audit opinion.")


def _draw_executive_summary(c: canvas.Canvas, data: RealEstatePDFInput) -> None:
    y = PAGE_H - MARGIN
    y = _section_header(c, "Executive Summary", y)

    cur = data.currency.upper()
    kpis = [
        ("Contract Price", format_money(data.contract_price, cur)),
        ("Revenue Recognised", format_money(data.revenue_recognised, cur)),
        ("Deferred Revenue", format_money(data.deferred_revenue, cur)),
        ("VAT (5%)", format_money(data.vat_amount, cur)),
        ("Completion %", format_pct(data.completion_pct)),
        ("RPO", format_money(data.remaining_performance_obligation, cur)),
    ]
    col_w = CONTENT_W / 2 - 0.15 * cm
    row_h = 1.1 * cm
    for i, (label, val) in enumerate(kpis):
        col = i % 2
        row = i // 2
        x = MARGIN + col * (col_w + 0.3 * cm)
        ty = y - row * (row_h + 0.15 * cm)
        c.setFillColor(LIGHT_BG)
        c.setStrokeColor(colors.HexColor("#E5E7EB"))
        c.rect(x, ty - row_h, col_w, row_h, stroke=1, fill=1)
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x + 0.2 * cm, ty - 0.35 * cm, label)
        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + 0.2 * cm, ty - 0.85 * cm, val)
    y -= 4.0 * cm

    if data.rera_certificate_verified and data.rera_certificate_ref:
        note = (
            f"✓ Completion % verified by RERA Certificate {data.rera_certificate_ref} "
            f"dated {format_display_date(data.rera_certificate_date)}"
        )
        c.setFillColor(GREEN)
    else:
        note = "Completion % based on manual input"
        c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    y = _draw_wrapped(c, note, MARGIN, y, CONTENT_W, 9)

    y = _section_header(c, "Revenue Recognition Trigger", y - 0.2 * cm)
    trig_lines = [
        f"Trigger: {_safe(data.revenue_recognition_trigger)}",
        f"RERA completion date: {format_display_date(data.rera_completion_date)}",
        f"SPA handover date: {format_display_date(data.spa_handover_date)}",
    ]
    if data.recognition_trigger_summary:
        trig_lines.append(data.recognition_trigger_summary)
    for line in trig_lines:
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 9)
        y = _draw_wrapped(c, line, MARGIN, y, CONTENT_W, 9)
    if data.trigger_warning:
        c.setFillColor(colors.HexColor("#D97706"))
        y = _draw_wrapped(c, data.trigger_warning, MARGIN, y, CONTENT_W, 9)

    y = _section_header(c, "Escrow Compliance", y - 0.2 * cm)
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.black)
    c.drawString(MARGIN, y, f"Total Received: {format_money(data.total_escrow_received, cur)}")
    c.drawString(MARGIN + 6.5 * cm, y, f"Total Released: {format_money(data.total_escrow_released, cur)}")
    c.drawString(MARGIN + 13 * cm, y, f"Net: {format_money(data.net_escrow_balance, cur)}")
    y -= 0.55 * cm
    violation = str(data.escrow_compliance_status).upper() == "VIOLATION"
    if violation:
        c.setFillColor(RED)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(MARGIN, y, "⛔ VIOLATION DETECTED")
    else:
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(MARGIN, y, "✓ RERA Compliant")
    y -= 0.45 * cm
    c.setFillColor(GREY)
    c.setFont("Helvetica", 8)
    c.drawString(MARGIN, y, "UAE Law No. 8 of 2007, Article 8")
    y -= 0.7 * cm

    y = _section_header(c, "Disclosure Quality", y - 0.1 * cm)
    band = _disclosure_band(data.disclosure_score)
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    c.drawString(MARGIN, y, f"Score: {data.disclosure_score:.0f}/100 — {band}")
    y -= 0.55 * cm
    if data.disclosure_gaps:
        for gap in data.disclosure_gaps[:3]:
            y = _draw_wrapped(c, f"• {gap}", MARGIN + 0.2 * cm, y, CONTENT_W - 0.4 * cm, 8)
    else:
        y = _draw_wrapped(c, "No disclosure gaps identified.", MARGIN, y, CONTENT_W, 9)


def _draw_table_header(
    c: canvas.Canvas, headers: List[str], col_widths: List[float], y: float
) -> float:
    x = MARGIN
    c.setFillColor(NAVY)
    c.rect(MARGIN, y - 0.55 * cm, CONTENT_W, 0.55 * cm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 8)
    for h, w in zip(headers, col_widths):
        c.drawString(x + 0.1 * cm, y - 0.4 * cm, h[:28])
        x += w
    return y - 0.65 * cm


def _draw_schedule_and_journals(
    c: canvas.Canvas, data: RealEstatePDFInput, start_new_page: bool = True
) -> float:
    if start_new_page:
        c.showPage()
    y = PAGE_H - MARGIN
    y = _section_header(c, "Quarterly Revenue Recognition Schedule", y)

    headers = ["Quarter", "Compl.%", "Revenue", "Cumulative", "VAT (5%)", "Status"]
    widths = [2.8 * cm, 1.6 * cm, 3.2 * cm, 3.2 * cm, 2.8 * cm, 2.0 * cm]
    cur = data.currency.upper()
    rows = data.quarterly_schedule or []
    min_y = MARGIN + 3 * cm

    def new_page_if_needed(current_y: float) -> float:
        if current_y < min_y:
            c.showPage()
            return PAGE_H - MARGIN - 0.5 * cm
        return current_y

    y = _draw_table_header(c, headers, widths, y)
    total_rev = 0.0
    total_vat = 0.0
    for i, row in enumerate(rows):
        y = new_page_if_needed(y)
        if y == PAGE_H - MARGIN - 0.5 * cm:
            y = _section_header(c, "Quarterly Revenue Recognition Schedule (cont.)", y)
            y = _draw_table_header(c, headers, widths, y)
        if i % 2 == 0:
            c.setFillColor(LIGHT_BG)
            c.rect(MARGIN, y - 0.45 * cm, CONTENT_W, 0.45 * cm, stroke=0, fill=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 8)
        rev = float(row.get("revenue") or row.get("revenue_recognised") or 0)
        total_rev += rev
        vat = float(row.get("vat") or row.get("vat_5pct") or rev * 0.05)
        total_vat += vat
        cells = [
            _safe(row.get("quarter") or row.get("period")),
            format_pct(row.get("completion_pct")),
            format_money(rev, cur),
            format_money(row.get("cumulative_revenue") or 0, cur),
            format_money(vat, cur),
            _safe(row.get("status"), "Recognised"),
        ]
        x = MARGIN
        for cell, w in zip(cells, widths):
            c.drawString(x + 0.08 * cm, y - 0.32 * cm, str(cell)[:22])
            x += w
        y -= 0.48 * cm

    y = new_page_if_needed(y)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 8)
    x = MARGIN
    totals = ["TOTAL", "—", format_money(total_rev, cur), format_money(data.contract_price, cur), format_money(total_vat, cur), "—"]
    for cell, w in zip(totals, widths):
        c.drawString(x + 0.08 * cm, y - 0.32 * cm, str(cell)[:22])
        x += w
    y -= 0.7 * cm

    c.setFillColor(GREY)
    c.setFont("Helvetica", 8)
    y = _draw_wrapped(
        c,
        "Revenue recognised on percentage-of-completion basis. VAT of 5% per UAE Federal Decree-Law No. 8 of 2017.",
        MARGIN,
        y,
        CONTENT_W,
        8,
    )

    y = new_page_if_needed(y - 0.3 * cm)
    y = _section_header(c, "Journal Entries", y)
    j_headers = ["Date", "Description", "Dr", "Cr", "Amount"]
    j_widths = [2.2 * cm, 5.5 * cm, 3.0 * cm, 3.0 * cm, 2.8 * cm]
    y = _draw_table_header(c, j_headers, j_widths, y)
    for i, je in enumerate(data.journal_entries or []):
        y = new_page_if_needed(y)
        if y < min_y + 1 * cm:
            c.showPage()
            y = PAGE_H - MARGIN
            y = _section_header(c, "Journal Entries (cont.)", y)
            y = _draw_table_header(c, j_headers, j_widths, y)
        if i % 2 == 0:
            c.setFillColor(LIGHT_BG)
            c.rect(MARGIN, y - 0.45 * cm, CONTENT_W, 0.45 * cm, stroke=0, fill=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 8)
        cells = [
            format_display_date(data.report_date),
            _safe(je.get("narrative"), "Revenue recognition"),
            _safe(je.get("dr")),
            _safe(je.get("cr")),
            format_money(je.get("amount"), cur),
        ]
        x = MARGIN
        for cell, w in zip(cells, j_widths):
            c.drawString(x + 0.06 * cm, y - 0.32 * cm, str(cell)[:32])
            x += w
        y -= 0.48 * cm
    y = _draw_wrapped(
        c,
        "Journal entries prepared under IFRS 15 para 38.",
        MARGIN,
        y - 0.2 * cm,
        CONTENT_W,
        8,
    )
    return y


def _draw_compliance_page(c: canvas.Canvas, data: RealEstatePDFInput) -> None:
    c.showPage()
    y = PAGE_H - MARGIN
    y = _section_header(c, "UAE Regulatory Compliance Summary", y)

    hc = data.health_checks or {}
    checks = [
        ("A", "Quarterly schedule totals to contract price", "a"),
        ("B1", "No revenue before escrow receipt", "b1"),
        ("B2", "Escrow release ≤ construction completion", "b2"),
        ("C", "VAT aligned to FTA filing periods", "c"),
        ("D", "Oqood amendment filings current", "d", True),
        ("E", "Multi-unit bundling assessed", "e", True),
    ]
    headers = ["Check", "Description", "Result"]
    widths = [1.2 * cm, 11.5 * cm, 2.5 * cm]
    y = _draw_table_header(c, headers, widths, y)
    for i, row in enumerate(checks):
        code, desc, key = row[0], row[1], row[2]
        na = len(row) > 3 and row[3]
        sym, tone = _health_result(hc, key, na_if_missing=na)
        if i % 2 == 0:
            c.setFillColor(LIGHT_BG)
            c.rect(MARGIN, y - 0.45 * cm, CONTENT_W, 0.45 * cm, stroke=0, fill=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 8)
        c.drawString(MARGIN + 0.1 * cm, y - 0.32 * cm, code)
        c.drawString(MARGIN + 1.4 * cm, y - 0.32 * cm, desc[:70])
        if tone == "green":
            c.setFillColor(GREEN)
            label = f"{sym} Pass"
        elif tone == "red":
            c.setFillColor(RED)
            label = f"{sym} Fail"
        else:
            c.setFillColor(GREY)
            label = sym
        c.drawString(MARGIN + 12.8 * cm, y - 0.32 * cm, label)
        y -= 0.48 * cm

    if data.oqood_assessments:
        y -= 0.3 * cm
        y = _section_header(c, "Oqood Amendment Notices", y)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 8)
        for oq in data.oqood_assessments:
            line = (
                f"• {oq.get('modification_type', 'Modification')}: "
                f"amendment required={oq.get('requires_oqood_amendment', '—')} "
                f"— {oq.get('dld_reference', oq.get('recommendation', ''))}"
            )
            y = _draw_wrapped(c, line, MARGIN, y, CONTENT_W, 8)
        y = _draw_wrapped(c, "Dubai Law No. 13 of 2008, Article 3", MARGIN, y, CONTENT_W, 8)

    if data.cancellation_summary:
        y -= 0.2 * cm
        y = _section_header(c, "Contract Cancellation Summary", y)
        cs = data.cancellation_summary
        cur = data.currency.upper()
        for label, key in [
            ("Developer retention", "developer_retention_amount"),
            ("Buyer refund", "buyer_refund_amount"),
            ("Escrow release to buyer", "escrow_release_to_buyer"),
        ]:
            c.setFont("Helvetica", 8)
            c.setFillColor(colors.black)
            c.drawString(MARGIN, y, f"{label}: {format_money(cs.get(key), cur)}")
            y -= 0.45 * cm
        y = _draw_wrapped(c, "UAE Law No. 8 of 2007, Article 11", MARGIN, y, CONTENT_W, 8)

    sign_h = 4.2 * cm
    if y < MARGIN + sign_h + 0.5 * cm:
        c.showPage()
        y = PAGE_H - MARGIN

    c.setStrokeColor(NAVY)
    c.setFillColor(colors.white)
    c.roundRect(MARGIN, y - sign_h, CONTENT_W, sign_h, 4, stroke=1, fill=0)
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    rd = format_display_date(data.report_date) if data.report_date else datetime.now().strftime("%d %b %Y")
    ty = y - 0.55 * cm
    c.drawString(MARGIN + 0.3 * cm, ty, f"This report was generated by FinReportAI on {rd}.")
    ty -= 0.65 * cm
    c.drawString(MARGIN + 0.3 * cm, ty, "Prepared by: _________________________   Date: _________")
    ty -= 0.55 * cm
    c.drawString(MARGIN + 0.3 * cm, ty, "Reviewed by: _________________________   Date: _________")
    ty -= 0.7 * cm
    c.setFont("Helvetica", 8)
    c.setFillColor(GREY)
    _draw_wrapped(
        c,
        "This report is prepared for management purposes and does not constitute an audit opinion or legal advice.",
        MARGIN + 0.3 * cm,
        ty,
        CONTENT_W - 0.6 * cm,
        8,
    )


def generate_realestate_pdf(data: RealEstatePDFInput) -> Tuple[bytes, int]:
    """Build PDF bytes and return (bytes, page_count estimate)."""
    buf = io.BytesIO()
    rera = (data.rera_registration_number or "N/A")[:40]
    c = _NumberedCanvas(rera, buf, pagesize=A4)
    c.setTitle("IFRS 15 Real Estate UAE Client Report")

    _draw_cover(c, data)
    c.showPage()
    _draw_executive_summary(c, data)
    _draw_schedule_and_journals(c, data, start_new_page=True)
    _draw_compliance_page(c, data)

    c.save()
    pdf_bytes = buf.getvalue()
    return pdf_bytes, int(getattr(c, "page_count", 4) or 4)
