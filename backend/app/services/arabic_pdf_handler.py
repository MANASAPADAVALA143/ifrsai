"""
Arabic / bilingual UAE SPA PDF extraction — language detection, numeral normalization,
confidence scoring, and manual-entry fallback.
"""

from __future__ import annotations

import json
import re
import tempfile
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from pydantic import BaseModel, Field

from claude_model_config import CLAUDE_MODEL
from backend.app.services.spa_parser import (
    SPA_EXTRACTION_PROMPT,
    _extract_json_from_response,
    read_spa_file_to_text,
)

# ── Models ──────────────────────────────────────────────────────────────────


class ExtractionLanguage(str, Enum):
    ENGLISH = "english"
    ARABIC = "arabic"
    BILINGUAL = "bilingual"
    UNKNOWN = "unknown"


class SPAExtractedFields(BaseModel):
    contract_price_aed: Optional[float] = None
    buyer_name: Optional[str] = None
    developer_name: Optional[str] = None
    unit_number: Optional[str] = None
    project_name: Optional[str] = None
    rera_registration_number: Optional[str] = None
    handover_date: Optional[str] = None
    payment_plan_milestones: Optional[List[Dict[str, Any]]] = None
    total_area_sqft: Optional[float] = None
    floor_number: Optional[int] = None


class SPAExtractionResult(BaseModel):
    success: bool = True
    language_detected: ExtractionLanguage = ExtractionLanguage.UNKNOWN
    confidence_score: float = 0.0
    extraction_method: str = "claude_english"
    fields: SPAExtractedFields = Field(default_factory=SPAExtractedFields)
    low_confidence_fields: List[str] = Field(default_factory=list)
    fallback_triggered: bool = False
    fallback_reason: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


_ARABIC_INDIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

_CRITICAL_FIELDS = ("contract_price_aed", "handover_date")
_IMPORTANT_FIELDS = ("buyer_name", "developer_name", "unit_number")
_USEFUL_FIELDS = ("rera_registration_number", "project_name")

_FIELD_WEIGHTS: Dict[str, float] = {
    "contract_price_aed": 0.25,
    "handover_date": 0.25,
    "buyer_name": 0.15,
    "developer_name": 0.15,
    "unit_number": 0.15,
    "rera_registration_number": 0.10,
    "project_name": 0.10,
}

_ARABIC_PROMPT_ADDITION = """
This is an Arabic-language UAE Sale & Purchase Agreement.
Extract the following fields. The document is in Arabic (RTL).
Arabic field name mappings:
  - عقد البيع والشراء = Sale and Purchase Agreement
  - سعر العقد / قيمة العقد = Contract Price
  - اسم المشتري = Buyer Name
  - اسم المطور = Developer Name
  - رقم الوحدة = Unit Number
  - تاريخ التسليم = Handover Date
  - رقم تسجيل ريرا = RERA Registration Number
  - درهم إماراتي = AED
  - خطة الدفع = Payment Plan
  - المساحة الإجمالية = Total Area

Numbers may appear as Arabic-Indic numerals (٣٥٠٠٠٠٠).
Convert all numbers to Western Arabic format in your response.
Return ONLY a JSON object with these keys (null if missing):
  contract_price_aed, buyer_name, developer_name, unit_number, project_name,
  rera_registration_number, handover_date, payment_plan_milestones,
  total_area_sqft, floor_number
Do not guess or infer values not explicitly stated.
"""

_BILINGUAL_PROMPT_ADDITION = """
This is a bilingual Arabic/English UAE Sale & Purchase Agreement.
The English and Arabic sections contain the same information.
Prefer the English section for extraction where available.
If a field appears only in Arabic, use the Arabic section.
Arabic-Indic numerals should be converted to Western format.
Arabic field name mappings:
  - عقد البيع والشراء = Sale and Purchase Agreement
  - سعر العقد / قيمة العقد = Contract Price
  - اسم المشتري = Buyer Name
  - اسم المطور = Developer Name
  - رقم الوحدة = Unit Number
  - تاريخ التسليم = Handover Date
  - رقم تسجيل ريرا = RERA Registration Number
  - درهم إماراتي = AED
  - خطة الدفع = Payment Plan
  - المساحة الإجمالية = Total Area
Return ONLY a JSON object with these keys (null if missing):
  contract_price_aed, buyer_name, developer_name, unit_number, project_name,
  rera_registration_number, handover_date, payment_plan_milestones,
  total_area_sqft, floor_number
"""


def detect_pdf_language(pdf_text: str) -> ExtractionLanguage:
    text = pdf_text or ""
    arabic_chars = sum(1 for c in text if "\u0600" <= c <= "\u06ff")
    latin_chars = sum(1 for c in text if ("a" <= c.lower() <= "z"))
    total_chars = arabic_chars + latin_chars
    arabic_ratio = arabic_chars / max(total_chars, 1)

    if arabic_ratio > 0.6:
        return ExtractionLanguage.ARABIC
    if arabic_ratio > 0.15:
        return ExtractionLanguage.BILINGUAL
    if arabic_ratio < 0.05:
        return ExtractionLanguage.ENGLISH
    return ExtractionLanguage.UNKNOWN


def extract_arabic_numerals(text: str) -> str:
    """Convert Arabic-Indic digits and thousand separators to Western numerals."""
    cleaned = text.translate(_ARABIC_INDIC_DIGITS)
    cleaned = cleaned.replace("\u066c", "").replace("\u066b", ".")  # ٬ thousands, ٫ decimal
    return cleaned


def build_extraction_prompt(language: ExtractionLanguage, pdf_text: str) -> str:
    if language == ExtractionLanguage.ENGLISH:
        return f"{SPA_EXTRACTION_PROMPT}\n\nSPA DOCUMENT:\n{pdf_text[:120000]}"
    if language == ExtractionLanguage.ARABIC:
        return f"{_ARABIC_PROMPT_ADDITION}\n\nSPA DOCUMENT:\n{pdf_text[:120000]}"
    if language == ExtractionLanguage.BILINGUAL:
        return f"{_BILINGUAL_PROMPT_ADDITION}\n\nSPA DOCUMENT:\n{pdf_text[:120000]}"
    return f"{SPA_EXTRACTION_PROMPT}\n\nSPA DOCUMENT:\n{pdf_text[:120000]}"


def score_extraction_confidence(
    fields: SPAExtractedFields,
) -> Tuple[float, List[str]]:
    data = fields.model_dump()
    overall = 0.0
    low: List[str] = []
    for name in list(_CRITICAL_FIELDS) + list(_IMPORTANT_FIELDS) + list(_USEFUL_FIELDS):
        val = data.get(name)
        present = val is not None and val != "" and val != []
        if present:
            overall += _FIELD_WEIGHTS[name]
        elif name in _CRITICAL_FIELDS or name in _IMPORTANT_FIELDS:
            low.append(name)
    return (min(overall, 1.0), low)


def _legacy_dict_to_fields(raw: Dict[str, Any]) -> SPAExtractedFields:
    milestones = raw.get("payment_schedule") or raw.get("payment_plan_milestones")
    price = raw.get("contract_price_aed") or raw.get("total_contract_price")
    try:
        price_f = float(price) if price is not None else None
    except (TypeError, ValueError):
        price_f = None
    unit = raw.get("unit_number") or raw.get("property_unit_number")
    return SPAExtractedFields(
        contract_price_aed=price_f,
        buyer_name=raw.get("buyer_name"),
        developer_name=raw.get("developer_name"),
        unit_number=str(unit) if unit is not None else None,
        project_name=raw.get("project_name"),
        rera_registration_number=raw.get("rera_registration_number"),
        handover_date=raw.get("handover_date"),
        payment_plan_milestones=milestones if isinstance(milestones, list) else None,
        total_area_sqft=raw.get("total_area_sqft"),
        floor_number=raw.get("floor_number"),
    )


def fields_to_legacy_dict(
    fields: SPAExtractedFields,
    *,
    exclude_fields: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Map SPAExtractedFields to legacy spa_parser keys for map_spa_to_ifrs15_inputs."""
    skip = set(exclude_fields or [])
    out: Dict[str, Any] = {}
    if "contract_price_aed" not in skip and fields.contract_price_aed is not None:
        out["total_contract_price"] = fields.contract_price_aed
    if "buyer_name" not in skip and fields.buyer_name:
        out["buyer_name"] = fields.buyer_name
    if "developer_name" not in skip and fields.developer_name:
        out["developer_name"] = fields.developer_name
    if "unit_number" not in skip and fields.unit_number:
        out["property_unit_number"] = fields.unit_number
    if "project_name" not in skip and fields.project_name:
        out["project_name"] = fields.project_name
    if "rera_registration_number" not in skip and fields.rera_registration_number:
        out["rera_registration_number"] = fields.rera_registration_number
    if "handover_date" not in skip and fields.handover_date:
        out["handover_date"] = fields.handover_date
    if fields.payment_plan_milestones:
        out["payment_schedule"] = fields.payment_plan_milestones
    if fields.total_area_sqft is not None:
        out["total_area_sqft"] = fields.total_area_sqft
    if fields.floor_number is not None:
        out["floor_number"] = fields.floor_number
    return out


def _extraction_method_for_language(language: ExtractionLanguage) -> str:
    if language == ExtractionLanguage.ARABIC:
        return "claude_arabic"
    if language == ExtractionLanguage.BILINGUAL:
        return "claude_bilingual"
    return "claude_english"


def _read_text_from_bytes(file_bytes: bytes, filename: str = "upload.pdf") -> str:
    suffix = Path(filename).suffix.lower() or ".pdf"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        return read_spa_file_to_text(tmp_path)
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _call_claude_json(
    client: Any,
    model: str,
    prompt: str,
    *,
    max_tokens: int = 1000,
) -> Dict[str, Any]:
    msg = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=0,
        system="You are a UAE real estate contract analyst. Return valid JSON only.",
        messages=[{"role": "user", "content": prompt}],
    )
    raw = (msg.content[0].text or "").strip()
    return _extract_json_from_response(raw)


def extract_spa_fields(
    pdf_bytes: bytes,
    existing_claude_client: Any,
    *,
    filename: str = "upload.pdf",
    model: str = CLAUDE_MODEL,
) -> SPAExtractionResult:
    warnings: List[str] = []

    try:
        raw_text = _read_text_from_bytes(pdf_bytes, filename)
    except Exception as exc:
        return SPAExtractionResult(
            success=False,
            language_detected=ExtractionLanguage.UNKNOWN,
            confidence_score=0.0,
            extraction_method="manual_fallback",
            fields=SPAExtractedFields(),
            low_confidence_fields=list(_CRITICAL_FIELDS) + list(_IMPORTANT_FIELDS),
            fallback_triggered=True,
            fallback_reason=(
                "PDF could not be read. Please check the file is not password-protected and try again."
            ),
            warnings=[str(exc)],
        )

    if not (raw_text or "").strip():
        return SPAExtractionResult(
            success=False,
            language_detected=ExtractionLanguage.UNKNOWN,
            confidence_score=0.0,
            extraction_method="manual_fallback",
            fields=SPAExtractedFields(),
            low_confidence_fields=list(_CRITICAL_FIELDS) + list(_IMPORTANT_FIELDS),
            fallback_triggered=True,
            fallback_reason=(
                "PDF could not be read. Please check the file is not password-protected and try again."
            ),
            warnings=["No text could be extracted from the document."],
        )

    language = detect_pdf_language(raw_text)
    text_for_claude = raw_text
    if language in (ExtractionLanguage.ARABIC, ExtractionLanguage.BILINGUAL):
        text_for_claude = extract_arabic_numerals(raw_text)

    method = _extraction_method_for_language(language)

    try:
        prompt = build_extraction_prompt(language, text_for_claude)
        max_tok = 4096 if language in (ExtractionLanguage.ENGLISH, ExtractionLanguage.UNKNOWN) else 1000
        raw_json = _call_claude_json(existing_claude_client, model, prompt, max_tokens=max_tok)
        if language in (ExtractionLanguage.ENGLISH, ExtractionLanguage.UNKNOWN):
            raw_json["extraction_source"] = "claude_spa_parser"
        spa_fields = _legacy_dict_to_fields(raw_json)
    except Exception as exc:
        return SPAExtractionResult(
            success=False,
            language_detected=language,
            confidence_score=0.0,
            extraction_method="manual_fallback",
            fields=SPAExtractedFields(),
            low_confidence_fields=list(_CRITICAL_FIELDS) + list(_IMPORTANT_FIELDS),
            fallback_triggered=True,
            fallback_reason=f"Extraction failed: {exc}",
            warnings=[str(exc)],
        )

    confidence, low_fields = score_extraction_confidence(spa_fields)

    if confidence < 0.4:
        return SPAExtractionResult(
            success=True,
            language_detected=language,
            confidence_score=confidence,
            extraction_method="manual_fallback",
            fields=SPAExtractedFields(),
            low_confidence_fields=low_fields,
            fallback_triggered=True,
            fallback_reason=(
                f"Extraction confidence too low ({confidence:.0%}). "
                f"Missing critical fields: {', '.join(low_fields) or 'several'}. "
                "Manual entry required."
            ),
            warnings=warnings,
        )

    exclude: List[str] = []
    if confidence < 0.7 and low_fields:
        exclude = list(low_fields)
        warnings.append(
            f"Partial extraction — {len(low_fields)} field(s) could not be extracted: "
            f"{', '.join(low_fields)}. Please verify highlighted fields manually."
        )
        cleared = spa_fields.model_dump()
        for fname in low_fields:
            cleared[fname] = None
        spa_fields = SPAExtractedFields(**cleared)

    return SPAExtractionResult(
        success=True,
        language_detected=language,
        confidence_score=confidence,
        extraction_method=method,
        fields=spa_fields,
        low_confidence_fields=low_fields,
        fallback_triggered=False,
        fallback_reason=None,
        warnings=warnings,
    )


def extraction_meta_dict(result: SPAExtractionResult) -> Dict[str, Any]:
    return {
        "language_detected": result.language_detected.value,
        "confidence_score": result.confidence_score,
        "extraction_method": result.extraction_method,
        "low_confidence_fields": result.low_confidence_fields,
        "fallback_triggered": result.fallback_triggered,
        "fallback_reason": result.fallback_reason,
        "warnings": result.warnings,
        "success": result.success,
    }


def legacy_extracted_from_result(
    result: SPAExtractionResult,
) -> Dict[str, Any]:
    """Build legacy `extracted` dict; empty when full manual fallback."""
    if result.fallback_triggered and result.extraction_method == "manual_fallback":
        legacy = {}
    else:
        exclude = result.low_confidence_fields if result.confidence_score < 0.7 else []
        legacy = fields_to_legacy_dict(result.fields, exclude_fields=exclude)
    legacy["extraction_source"] = result.extraction_method
    return legacy
