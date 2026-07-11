"""
IFRS transaction classifier — routes AP invoice / transaction lines to IFRS standards.

Hybrid: keyword heuristic (fast) + Claude fallback (ambiguous cases).
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from claude_model_config import CLAUDE_MODEL

IFRS_STANDARD_VALUES = ("IFRS_16", "IFRS_15", "OPEX", "UNCERTAIN")

# (pattern, weight) — weight > 1 for stronger signals
IFRS_16_PATTERNS: List[Tuple[str, int]] = [
    (r"\brent\b", 2),
    (r"\blease\b", 2),
    (r"\bleasing\b", 2),
    (r"\blessor\b", 2),
    (r"\blessee\b", 2),
    (r"\brou\b", 2),
    (r"\bright[\s-]?of[\s-]?use\b", 2),
    (r"\boccupancy\b", 1),
    (r"\boffice\s+space\b", 1),
    (r"\bwarehouse\s+rent\b", 2),
    (r"\bsubscription\b", 1),
    (r"\bsaas\b", 2),
    (r"\bsoftware\s+as\s+a\s+service\b", 2),
    (r"\bcloud\s+subscription\b", 2),
    (r"\bannual\s+subscription\b", 1),
    (r"\bmonthly\s+subscription\b", 1),
]

IFRS_15_PATTERNS: List[Tuple[str, int]] = [
    (r"\bcontract\b", 1),
    (r"\bservice\s+agreement\b", 2),
    (r"\bprofessional\s+services\b", 2),
    (r"\bconsulting\b", 1),
    (r"\bimplementation\b", 1),
    (r"\bproject\b", 1),
    (r"\bmilestone\b", 2),
    (r"\bdeliverable\b", 2),
    (r"\bperformance\s+obligation\b", 3),
    (r"\bstatement\s+of\s+work\b", 2),
    (r"\bsow\b", 1),
    (r"\bretainer\b", 1),
    (r"\bfixed\s+fee\b", 1),
    (r"\btime\s+and\s+materials?\b", 2),
    (r"\bt&m\b", 1),
    (r"\bconstruction\b", 1),
    (r"\bdevelopment\s+services\b", 2),
]

OPEX_PATTERNS: List[Tuple[str, int]] = [
    (r"\butilities\b", 2),
    (r"\belectricity\b", 1),
    (r"\btravel\b", 2),
    (r"\bflight\b", 1),
    (r"\bhotel\b", 1),
    (r"\bstationery\b", 2),
    (r"\boffice\s+supplies\b", 2),
    (r"\bcatering\b", 1),
    (r"\bfuel\b", 1),
    (r"\bpostage\b", 1),
    (r"\bcourier\b", 1),
    (r"\bmaintenance\s+and\s+repair\b", 1),
    (r"\badvertising\b", 1),
    (r"\bmarketing\b", 1),
    (r"\binsurance\b", 1),
    (r"\btelecom\b", 1),
    (r"\btelephone\b", 1),
    (r"\binternet\b", 1),
]


@dataclass
class HeuristicResult:
    ifrs_standard: str
    confidence: int
    reason: str
    matched_keywords: List[str]
    scores: Dict[str, int]


def _score_patterns(text: str, patterns: List[Tuple[str, int]]) -> Tuple[int, List[str]]:
    total = 0
    hits: List[str] = []
    for pattern, weight in patterns:
        match = re.search(pattern, text, flags=re.I)
        if match:
            total += weight
            hits.append(match.group(0).lower())
    return total, hits


def _heuristic_classify(
    vendor: str,
    description: str,
) -> Tuple[Optional[HeuristicResult], bool]:
    """
    Returns (result, is_confident).
    is_confident=False means caller should use Claude fallback.
    """
    combined = f"{vendor} {description}".strip().lower()
    if not combined:
        return None, False

    s16, h16 = _score_patterns(combined, IFRS_16_PATTERNS)
    s15, h15 = _score_patterns(combined, IFRS_15_PATTERNS)
    sox, hox = _score_patterns(combined, OPEX_PATTERNS)

    scores = {"IFRS_16": s16, "IFRS_15": s15, "OPEX": sox}
    ranked = sorted(scores.items(), key=lambda x: (-x[1], x[0]))
    top_std, top_score = ranked[0]

    if top_score == 0:
        return None, False

    # Clear winner: top category leads and no competing category scores
    competitors = [std for std, sc in scores.items() if sc > 0 and std != top_std]
    if competitors:
        return None, False

    # Margin check: weak single hit on a borderline term
    if top_score == 1 and top_std in ("IFRS_16", "IFRS_15"):
        return None, False

    hit_map = {"IFRS_16": h16, "IFRS_15": h15, "OPEX": hox}
    matched = hit_map[top_std]

    if top_score >= 3:
        confidence = 95
    elif top_score >= 2:
        confidence = 90
    else:
        confidence = 85

    label = {
        "IFRS_16": "lease or subscription-style arrangement",
        "IFRS_15": "contractual service or project revenue/expense pattern",
        "OPEX": "operating expenditure",
    }[top_std]

    reason = (
        f"Heuristic match: description/vendor indicates {label} "
        f"(score {top_score}, keywords: {', '.join(matched[:4])})."
    )
    return HeuristicResult(top_std, confidence, reason, matched, scores), True


def _parse_claude_json(text: str) -> Dict[str, Any]:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.I)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned.replace("'", '"'))


def _claude_classify(
    vendor: str,
    description: str,
    amount: float,
    currency: str,
    date: str,
    api_key: str,
) -> Dict[str, Any]:
    import anthropic

    prompt = (
        "You are an IFRS technical accountant classifying an accounts-payable invoice line.\n"
        "Decide which IFRS treatment applies from the buyer's expense recognition perspective.\n\n"
        "Return ONLY valid JSON (no markdown):\n"
        "{\n"
        '  "ifrs_standard": "IFRS_16" | "IFRS_15" | "OPEX" | "UNCERTAIN",\n'
        '  "confidence": 0-100,\n'
        '  "reason": "one sentence explanation"\n'
        "}\n\n"
        "Guidance:\n"
        "- IFRS_16: leases, rent, right-of-use assets, long-term subscriptions with identified asset/control.\n"
        "- IFRS_15: multi-period service contracts, projects, milestones, professional services deliverables.\n"
        "- OPEX: ordinary operating expenses (utilities, travel, supplies, one-off consumables).\n"
        "- UNCERTAIN: insufficient information to decide.\n\n"
        f"Vendor: {vendor}\n"
        f"Description: {description}\n"
        f"Amount: {amount} {currency}\n"
        f"Date: {date}\n"
    )

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=500,
        temperature=0,
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text if response.content else ""
    parsed = _parse_claude_json(text)

    standard = str(parsed.get("ifrs_standard", "UNCERTAIN")).upper().replace(" ", "_")
    if standard not in IFRS_STANDARD_VALUES:
        standard = "UNCERTAIN"

    try:
        confidence = int(parsed.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0
    confidence = max(0, min(100, confidence))

    reason = str(parsed.get("reason") or "AI classification.").strip()

    return {
        "ifrs_standard": standard,
        "confidence": confidence,
        "reason": reason,
        "source": "claude",
    }


def classify_transaction(
    vendor: str,
    description: str,
    amount: float,
    currency: str,
    date: str,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Classify a transaction into IFRS_16, IFRS_15, OPEX, or UNCERTAIN.
    """
    vendor = (vendor or "").strip()
    description = (description or "").strip()
    currency = (currency or "USD").strip().upper()
    date = (date or "").strip()

    heuristic, confident = _heuristic_classify(vendor, description)
    if confident and heuristic is not None:
        return {
            "ifrs_standard": heuristic.ifrs_standard,
            "confidence": heuristic.confidence,
            "reason": heuristic.reason,
            "source": "heuristic",
        }

    key = (api_key or os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        return {
            "ifrs_standard": "UNCERTAIN",
            "confidence": 0,
            "reason": (
                "Ambiguous transaction and Claude API not configured "
                "(set ANTHROPIC_API_KEY for AI fallback)."
            ),
            "source": "none",
        }

    try:
        return _claude_classify(vendor, description, amount, currency, date, key)
    except Exception as exc:
        return {
            "ifrs_standard": "UNCERTAIN",
            "confidence": 0,
            "reason": f"AI classification failed: {exc}",
            "source": "error",
        }
