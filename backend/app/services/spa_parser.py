"""
UAE Sale & Purchase Agreement (SPA) parser — extract IFRS 15 inputs via Claude API.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional

from claude_model_config import CLAUDE_MODEL

SPA_EXTRACTION_PROMPT = """Extract these fields from this UAE property Sale & Purchase Agreement:
- property_unit_number
- total_contract_price (AED, numeric only)
- payment_schedule (list of: milestone, amount, date)
- agreement_date (SPA execution / contract signing date, YYYY-MM-DD if possible)
- contract_date (same as agreement_date if only one date is stated, else null)
- handover_date (YYYY-MM-DD if possible)
- construction_start (YYYY-MM-DD if stated, else null)
- developer_name
- buyer_name
- project_name
- variable_consideration (price adjustments, penalties, or null)

Return as JSON only with exactly these keys. Use AED amounts as numbers without commas."""


def read_spa_file_to_text(file_path: str) -> str:
    """Read SPA text from PDF, DOCX, or plain text."""
    path = Path(file_path)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        try:
            from PyPDF2 import PdfReader

            reader = PdfReader(str(path))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            raise ValueError(f"Could not read PDF: {exc}") from exc
    if suffix in (".docx", ".doc"):
        try:
            import docx

            doc = docx.Document(str(path))
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception as exc:
            raise ValueError(f"Could not read Word document: {exc}") from exc
    return path.read_text(encoding="utf-8", errors="replace")


def _extract_json_from_response(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


class SPAParser:
    """Parse UAE SPA documents for IFRS 15 real estate inputs."""

    def __init__(self, api_key: Optional[str] = None) -> None:
        key = (api_key or os.getenv("ANTHROPIC_API_KEY", "")).strip()
        if not key:
            raise ValueError("ANTHROPIC_API_KEY not configured")
        import anthropic

        self._client = anthropic.Anthropic(api_key=key)
        self._model = CLAUDE_MODEL

    def extract_from_text(self, contract_text: str) -> Dict[str, Any]:
        if not (contract_text or "").strip():
            raise ValueError("SPA text is empty")

        msg = self._client.messages.create(
            model=self._model,
            max_tokens=4096,
            temperature=0,
            system="You are a UAE real estate contract analyst. Return valid JSON only.",
            messages=[
                {
                    "role": "user",
                    "content": f"{SPA_EXTRACTION_PROMPT}\n\nSPA DOCUMENT:\n{contract_text[:120000]}",
                }
            ],
        )
        raw = (msg.content[0].text or "").strip()
        extracted = _extract_json_from_response(raw)
        extracted["extraction_source"] = "claude_spa_parser"
        return extracted

    def extract_from_file(self, file_path: str) -> Dict[str, Any]:
        text = read_spa_file_to_text(file_path)
        return self.extract_from_text(text)
