"""
RERA / DLD construction completion certificate — PDF extraction and confidence scoring.
"""

from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

from backend.app.services.arabic_pdf_handler import (
    detect_pdf_language,
    extract_arabic_numerals,
)
from backend.app.services.spa_parser import _extract_json_from_response, read_spa_file_to_text

_CERTIFICATE_BASE_PROMPT = """
This is a UAE RERA Construction Completion Certificate issued by
the Dubai Land Department or an authorized inspection authority.

Extract these fields exactly as they appear:
- completion_pct: The construction completion percentage (number only, e.g. 65.0)
- certificate_date: Date the certificate was issued (YYYY-MM-DD)
- inspection_date: Date of the physical inspection (YYYY-MM-DD)
- certificate_ref: Certificate reference or serial number
- rera_registration_number: Project RERA registration number
- project_name: Name of the development project
- developer_name: Name of the developer company
- authority_name: Issuing authority name
- inspector_name: Name of inspector or inspection company
- certificate_valid_until: Expiry date if stated (YYYY-MM-DD), else null
- raw_completion_text: The exact sentence/phrase stating completion %

IMPORTANT:
- completion_pct must be a number (e.g. 65.0 not "65%")
- Dates must be YYYY-MM-DD format
- If a field is not present return null
- Do not infer or estimate any values
- Return ONLY valid JSON, no markdown
"""

_ARABIC_CERT_ADDITION = """
This certificate may contain Arabic text. Arabic field mappings:
  - نسبة الإنجاز = Completion Percentage
  - تاريخ الشهادة = Certificate Date
  - تاريخ الفحص = Inspection Date
  - رقم المرجع = Reference Number
  - رقم تسجيل ريرا = RERA Registration Number
  - اسم المشروع = Project Name
  - اسم المطور = Developer Name
  - الجهة المصدرة = Issuing Authority
  - شهادة الإنجاز = Completion Certificate
  - درجة الإنجاز = Degree of Completion
Convert Arabic-Indic numerals to Western format.
"""

_CRITICAL = ("completion_pct", "certificate_date")
_IMPORTANT = ("certificate_ref", "rera_registration_number")
_USEFUL = ("project_name", "developer_name")

_WEIGHTS: Dict[str, float] = {
    "completion_pct": 0.35,
    "certificate_date": 0.35,
    "certificate_ref": 0.15,
    "rera_registration_number": 0.15,
    "project_name": 0.075,
    "developer_name": 0.075,
}


class RERACertificateFields(BaseModel):
    completion_pct: Optional[float] = None
    certificate_date: Optional[str] = None
    inspection_date: Optional[str] = None
    certificate_ref: Optional[str] = None
    rera_registration_number: Optional[str] = None
    project_name: Optional[str] = None
    developer_name: Optional[str] = None
    authority_name: Optional[str] = None
    inspector_name: Optional[str] = None
    certificate_valid_until: Optional[str] = None
    raw_completion_text: Optional[str] = None


class RERACertificateResult(BaseModel):
    success: bool = True
    language_detected: str = "unknown"
    confidence_score: float = 0.0
    fields: RERACertificateFields = Field(default_factory=RERACertificateFields)
    low_confidence_fields: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    extraction_method: str = "claude_english"
    mismatch_detected: bool = False
    mismatch_detail: Optional[str] = None


def build_certificate_prompt(language: str, pdf_text: str) -> str:
    prefix = ""
    if language in ("arabic", "bilingual"):
        prefix = _ARABIC_CERT_ADDITION + "\n"
    return f"{prefix}{_CERTIFICATE_BASE_PROMPT}\n\nCERTIFICATE DOCUMENT:\n{pdf_text[:120000]}"


def score_certificate_confidence(
    fields: RERACertificateFields,
) -> Tuple[float, List[str]]:
    data = fields.model_dump()
    score = 0.0
    low: List[str] = []
    for name, weight in _WEIGHTS.items():
        val = data.get(name)
        present = val is not None and val != ""
        if present:
            score += weight
        elif name in _CRITICAL or name in _IMPORTANT:
            low.append(name)
    return (min(score, 1.0), low)


def _read_pdf_text(pdf_bytes: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = tmp.name
    try:
        return read_spa_file_to_text(tmp_path)
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _parse_fields(raw: Dict[str, Any]) -> RERACertificateFields:
    pct = raw.get("completion_pct")
    try:
        pct_f = float(str(pct).replace("%", "").strip()) if pct is not None else None
    except (TypeError, ValueError):
        pct_f = None
    return RERACertificateFields(
        completion_pct=pct_f,
        certificate_date=raw.get("certificate_date"),
        inspection_date=raw.get("inspection_date"),
        certificate_ref=raw.get("certificate_ref"),
        rera_registration_number=raw.get("rera_registration_number"),
        project_name=raw.get("project_name"),
        developer_name=raw.get("developer_name"),
        authority_name=raw.get("authority_name"),
        inspector_name=raw.get("inspector_name"),
        certificate_valid_until=raw.get("certificate_valid_until"),
        raw_completion_text=raw.get("raw_completion_text"),
    )


def _extraction_method(language: str) -> str:
    if language == "arabic":
        return "claude_arabic"
    if language == "bilingual":
        return "claude_bilingual"
    return "claude_english"


def extract_rera_certificate(
    pdf_bytes: bytes,
    claude_client: Any,
    form_completion_pct: Optional[float] = None,
    *,
    model: str = "claude-sonnet-4-20250514",
) -> RERACertificateResult:
    warnings: List[str] = []

    if not pdf_bytes.startswith(b"%PDF"):
        return RERACertificateResult(
            success=False,
            language_detected="unknown",
            confidence_score=0.0,
            extraction_method="manual_fallback",
            low_confidence_fields=list(_CRITICAL) + list(_IMPORTANT),
            warnings=["File is not a valid PDF."],
        )

    try:
        raw_text = _read_pdf_text(pdf_bytes)
    except Exception as exc:
        return RERACertificateResult(
            success=False,
            language_detected="unknown",
            confidence_score=0.0,
            extraction_method="manual_fallback",
            low_confidence_fields=list(_CRITICAL) + list(_IMPORTANT),
            warnings=[str(exc)],
        )

    if not (raw_text or "").strip():
        return RERACertificateResult(
            success=False,
            language_detected="unknown",
            confidence_score=0.0,
            extraction_method="manual_fallback",
            low_confidence_fields=list(_CRITICAL) + list(_IMPORTANT),
            warnings=["No text could be extracted from the certificate PDF."],
        )

    lang_enum = detect_pdf_language(raw_text)
    language = lang_enum.value
    text_for_claude = raw_text
    if language in ("arabic", "bilingual"):
        text_for_claude = extract_arabic_numerals(raw_text)

    prompt = build_certificate_prompt(language, text_for_claude)
    method = _extraction_method(language)

    try:
        msg = claude_client.messages.create(
            model=model,
            max_tokens=1000,
            temperature=0,
            system="You are a UAE RERA completion certificate analyst. Return valid JSON only.",
            messages=[{"role": "user", "content": prompt}],
        )
        raw = (msg.content[0].text or "").strip()
        parsed = _extract_json_from_response(raw)
        fields = _parse_fields(parsed)
    except Exception as exc:
        return RERACertificateResult(
            success=False,
            language_detected=language,
            confidence_score=0.0,
            extraction_method="manual_fallback",
            low_confidence_fields=list(_CRITICAL) + list(_IMPORTANT),
            warnings=[str(exc)],
        )

    confidence, low_fields = score_certificate_confidence(fields)
    mismatch_detected = False
    mismatch_detail: Optional[str] = None

    if (
        form_completion_pct is not None
        and fields.completion_pct is not None
    ):
        diff = abs(float(fields.completion_pct) - float(form_completion_pct))
        if diff > 2.0:
            mismatch_detected = True
            mismatch_detail = (
                f"Certificate shows {fields.completion_pct}% but form "
                f"has {form_completion_pct}%. Difference: {diff:.1f}pp. "
                "The certificate value will be used for recognition. "
                "Update the form or re-upload the correct certificate."
            )

    return RERACertificateResult(
        success=True,
        language_detected=language,
        confidence_score=confidence,
        fields=fields,
        low_confidence_fields=low_fields,
        warnings=warnings,
        extraction_method=method,
        mismatch_detected=mismatch_detected,
        mismatch_detail=mismatch_detail,
    )


def cross_check_rera_number(
    result: RERACertificateResult,
    form_rera: Optional[str],
) -> RERACertificateResult:
    """Warn if certificate RERA number differs from form (case-insensitive)."""
    cert_num = (result.fields.rera_registration_number or "").strip()
    form_num = (form_rera or "").strip()
    if cert_num and form_num and cert_num.upper() != form_num.upper():
        result.warnings.append(
            f"Certificate RERA number ({cert_num}) does not match "
            f"form RERA number ({form_num}). Verify correct certificate."
        )
    return result
