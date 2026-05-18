"""Shared Supabase client for backend services (single init point)."""

from __future__ import annotations

import os
from typing import Optional

_client = None


def get_supabase_client():
    """Return the module-level Supabase client (lazy init)."""
    global _client
    if _client is not None:
        return _client

    url = (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
    url = url.rstrip("/")
    if url.endswith("/rest/v1"):
        url = url[: -len("/rest/v1")]
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_KEY")
        or os.getenv("SUPABASE_ANON_KEY")
        or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or ""
    ).strip()

    if not url or not key:
        raise RuntimeError(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
            "(or NEXT_PUBLIC_* equivalents) in the environment."
        )

    from supabase import create_client

    _client = create_client(url, key)
    return _client


def is_supabase_configured() -> bool:
    try:
        get_supabase_client()
        return True
    except RuntimeError:
        return False
