"""IFRS 16 compliance health score and audit PDF bundle."""

from __future__ import annotations

import io
from datetime import datetime
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def compute_health_score(leases: List[Dict[str, Any]], alerts_count: int = 0) -> Dict[str, Any]:
    score = 100
    issues: List[Dict[str, str]] = []

    def deduct(pts: int, desc: str, severity: str, cap: Optional[int] = None):
        nonlocal score
        applied = pts
        if cap is not None:
            applied = min(pts, cap)
        score -= applied
        issues.append({"description": desc, "severity": severity})

    missing_ibr = [l for l in leases if not _lease_ibr(l)]
    if missing_ibr:
        deduct(min(15 * len(missing_ibr), 30), f"{len(missing_ibr)} lease(s) missing IBR", "HIGH", 30)

    stale = [l for l in leases if _days_since_calc(l) > 90]
    if stale:
        deduct(min(10 * len(stale), 20), f"{len(stale)} lease(s) not recalculated in 90+ days", "MEDIUM", 20)

    expiring = [l for l in leases if _days_to_expiry(l) is not None and 0 <= _days_to_expiry(l) < 30]
    if expiring:
        deduct(min(10 * len(expiring), 20), f"{len(expiring)} lease(s) expiring within 30 days", "HIGH", 20)

    no_disclosure = [l for l in leases if not l.get("disclosure_generated") and not (l.get("results") or {}).get("disclosure_notes")]
    if no_disclosure and leases:
        deduct(10, "Disclosure notes not generated for some leases", "MEDIUM")

    if alerts_count > 0:
        deduct(min(5 * alerts_count, 15), f"{alerts_count} unacknowledged smart alert(s)", "MEDIUM", 15)

    score = max(0, min(100, score))
    return {"score": score, "issues": issues}


def _lease_ibr(l: Dict[str, Any]) -> bool:
    rate = l.get("annual_discount_rate") or l.get("discount_rate") or l.get("ibr")
    if rate is None and isinstance(l.get("results"), dict):
        rate = l["results"].get("annual_discount_rate")
    try:
        return float(rate or 0) > 0
    except (TypeError, ValueError):
        return False


def _days_since_calc(l: Dict[str, Any]) -> int:
    raw = l.get("last_calculated_at") or l.get("updated_at") or l.get("calculated_at")
    if not raw:
        return 999
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return (datetime.now(dt.tzinfo) - dt).days if dt.tzinfo else (datetime.now() - dt).days
    except Exception:
        return 999


def _days_to_expiry(l: Dict[str, Any]) -> Optional[int]:
    end = l.get("end_date") or l.get("endDate") or (l.get("dates") or {}).get("end")
    if not end:
        return None
    try:
        d = datetime.strptime(str(end)[:10], "%Y-%m-%d")
        return (d - datetime.now()).days
    except Exception:
        return None


def build_audit_pdf(
    period: str,
    leases: List[Dict[str, Any]],
    health: Dict[str, Any],
    prepared_by: str = "IFRS AI",
    reviewed_by: str = "",
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=2 * cm, leftMargin=2 * cm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("Title", parent=styles["Heading1"], fontSize=16, textColor=colors.HexColor("#1F4E78"))
    body = styles["Normal"]
    story: List[Any] = []

    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    story.append(Paragraph("IFRS 16 Audit Pack", title_style))
    story.append(Paragraph(f"Period: {period} | Generated: {ts}", body))
    story.append(Spacer(1, 0.5 * cm))

    story.append(Paragraph(f"<b>Section 1 — Health Score: {health.get('score', 0)}/100</b>", body))
    for iss in health.get("issues") or []:
        story.append(Paragraph(f"• [{iss.get('severity', '')}] {iss.get('description', '')}", body))
    story.append(Spacer(1, 0.4 * cm))

    story.append(Paragraph("<b>Section 2 — Lease Portfolio Summary</b>", body))
    rows = [["Lease", "Liability", "ROU", "End Date"]]
    for l in leases[:50]:
        res = l.get("results") or {}
        rows.append(
            [
                str(l.get("title") or l.get("asset_description") or l.get("id", ""))[:40],
                f"{float(l.get('liability') or res.get('lease_liability') or 0):,.0f}",
                f"{float(l.get('rou') or res.get('rou_asset') or 0):,.0f}",
                str(l.get("end_date") or "")[:10],
            ]
        )
    t = Table(rows, colWidths=[6 * cm, 3.5 * cm, 3.5 * cm, 3 * cm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4472C4")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 0.5 * cm))

    story.append(Paragraph("<b>Section 3–5 — Per-lease schedules & disclosures</b>", body))
    story.append(
        Paragraph(
            "Detailed amortization schedules and journal entries are available in the Excel exports per lease.",
            body,
        )
    )
    story.append(Spacer(1, 0.5 * cm))

    story.append(Paragraph("<b>Section 6 — Certification</b>", body))
    story.append(Paragraph(f"Prepared by: {prepared_by}", body))
    if reviewed_by:
        story.append(Paragraph(f"Reviewed by: {reviewed_by}", body))
    story.append(Paragraph(f"Date: {ts}", body))

    doc.build(story)
    return buf.getvalue()
