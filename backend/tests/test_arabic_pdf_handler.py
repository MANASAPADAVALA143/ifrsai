"""Unit tests for Arabic SPA PDF handler."""

from backend.app.services.arabic_pdf_handler import (
    ExtractionLanguage,
    SPAExtractedFields,
    detect_pdf_language,
    extract_arabic_numerals,
    extract_spa_fields,
    score_extraction_confidence,
)


def test_arabic_numeral_conversion():
    raw = "قيمة العقد: ٣٬٥٠٠٬٠٠٠ درهم"
    out = extract_arabic_numerals(raw)
    assert "3500000" in out.replace(",", "")
    assert "قيمة العقد" in out


def test_detect_language_arabic():
    text = "عقد البيع " * 50 + "a" * 5
    assert detect_pdf_language(text) == ExtractionLanguage.ARABIC


def test_detect_language_english():
    text = "Sale and Purchase Agreement " * 20
    assert detect_pdf_language(text) == ExtractionLanguage.ENGLISH


def test_score_partial_three_of_seven():
    fields = SPAExtractedFields(
        contract_price_aed=3_500_000,
        buyer_name="Buyer",
        developer_name="Dev",
    )
    score, low = score_extraction_confidence(fields)
    assert 0.5 <= score <= 0.6
    assert "handover_date" in low
    assert len(low) >= 2


def test_score_low_confidence_fallback():
    fields = SPAExtractedFields(contract_price_aed=1_000_000)
    score, low = score_extraction_confidence(fields)
    assert score < 0.4
    assert "handover_date" in low


def test_extract_spa_fields_low_confidence_mock(monkeypatch):
    class FakeContent:
        text = '{"contract_price_aed": 3500000}'

    class FakeMsg:
        content = [FakeContent()]

    class FakeMessages:
        def create(self, **kwargs):
            return FakeMsg()

    class FakeClient:
        messages = FakeMessages()

    monkeypatch.setattr(
        "backend.app.services.arabic_pdf_handler._read_text_from_bytes",
        lambda *_a, **_k: "English contract " * 100,
    )
    result = extract_spa_fields(b"%PDF", FakeClient())
    assert result.fallback_triggered
    assert result.extraction_method == "manual_fallback"
    assert result.confidence_score < 0.4


def test_extract_spa_fields_partial_mock(monkeypatch):
    class FakeContent:
        text = '{"contract_price_aed": 3500000, "buyer_name": "A", "developer_name": "B"}'

    class FakeMsg:
        content = [FakeContent()]

    class FakeMessages:
        def create(self, **kwargs):
            return FakeMsg()

    class FakeClient:
        messages = FakeMessages()

    monkeypatch.setattr(
        "backend.app.services.arabic_pdf_handler._read_text_from_bytes",
        lambda *_a, **_k: "English contract " * 100,
    )
    result = extract_spa_fields(b"%PDF", FakeClient())
    assert not result.fallback_triggered
    assert result.confidence_score < 0.7
    assert result.warnings
    assert "handover_date" in result.low_confidence_fields
