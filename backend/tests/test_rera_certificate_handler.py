"""Unit tests for RERA completion certificate extraction."""

from backend.app.services.arabic_pdf_handler import detect_pdf_language, extract_arabic_numerals
from backend.app.services.rera_certificate_handler import (
    RERACertificateFields,
    cross_check_rera_number,
    extract_rera_certificate,
    score_certificate_confidence,
)


def test_score_full_extraction():
    fields = RERACertificateFields(
        completion_pct=65.0,
        certificate_date="2026-03-15",
        certificate_ref="DLD/CC/2026/00123",
        rera_registration_number="RERA-2024-DXB-00123",
        project_name="Marina Heights",
        developer_name="Dev LLC",
    )
    score, low = score_certificate_confidence(fields)
    assert score > 0.9
    assert not low


def test_mismatch_detected():
    class FakeContent:
        text = (
            '{"completion_pct": 65.0, "certificate_date": "2026-03-15", '
            '"certificate_ref": "DLD/CC/2026/00123", "rera_registration_number": "RERA-2024-DXB-00123"}'
        )

    class FakeMsg:
        content = [FakeContent()]

    class FakeMessages:
        def create(self, **kwargs):
            return FakeMsg()

    class FakeClient:
        messages = FakeMessages()

    import backend.app.services.rera_certificate_handler as mod

    orig = mod._read_pdf_text
    mod._read_pdf_text = lambda _b: "English certificate " * 80
    try:
        result = extract_rera_certificate(b"%PDF-1.4", FakeClient(), form_completion_pct=72.0)
    finally:
        mod._read_pdf_text = orig

    assert result.success
    assert result.mismatch_detected
    assert result.fields.completion_pct == 65.0
    assert "7.0" in (result.mismatch_detail or "")


def test_rera_number_cross_check():
    from backend.app.services.rera_certificate_handler import RERACertificateResult

    res = RERACertificateResult(
        fields=RERACertificateFields(rera_registration_number="RERA-2024-DXB-00123")
    )
    out = cross_check_rera_number(res, "RERA-2024-DXB-99999")
    assert any("does not match" in w for w in out.warnings)


def test_low_confidence_only_pct():
    fields = RERACertificateFields(completion_pct=65.0)
    score, low = score_certificate_confidence(fields)
    assert abs(score - 0.35) < 0.01
    assert "certificate_date" in low


def test_arabic_language_and_numerals():
    raw = "نسبة الإنجاز: ٦٥٪"
    converted = extract_arabic_numerals(raw)
    assert "65" in converted
    lang = detect_pdf_language("نسبة الإنجاز " * 30 + "english " * 5)
    assert lang.value == "arabic"


def test_full_extraction_no_mismatch():
    class FakeContent:
        text = (
            '{"completion_pct": 65.0, "certificate_date": "2026-03-15", '
            '"certificate_ref": "DLD/CC/2026/00123", "rera_registration_number": "RERA-2024-DXB-00123", '
            '"project_name": "Marina Heights", "developer_name": "Al Mansoori Development LLC", '
            '"authority_name": "Dubai Land Department"}'
        )

    class FakeMsg:
        content = [FakeContent()]

    class FakeMessages:
        def create(self, **kwargs):
            return FakeMsg()

    class FakeClient:
        messages = FakeMessages()

    import backend.app.services.rera_certificate_handler as mod

    orig = mod._read_pdf_text
    mod._read_pdf_text = lambda _b: "English certificate " * 80
    try:
        result = extract_rera_certificate(b"%PDF-1.4", FakeClient(), form_completion_pct=65.0)
    finally:
        mod._read_pdf_text = orig
    assert result.confidence_score > 0.9
    assert not result.mismatch_detected
