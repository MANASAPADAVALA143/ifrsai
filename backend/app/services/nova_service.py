"""Nova (Claude) commentary for IFRS 15 rev-rec reconciliation endpoints."""

from __future__ import annotations

import os
from typing import Optional


async def call_nova(system: str, user: str, max_tokens: int = 800) -> str:
    """Call Anthropic Claude; returns plain text or a fallback message if unavailable."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return "Nova commentary unavailable — ANTHROPIC_API_KEY not configured."

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=max_tokens,
            temperature=0,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return (msg.content[0].text or "").strip()
    except Exception as exc:
        return f"Nova commentary could not be generated: {exc}"
