"""
CRIT-001 remediation: JWT-based firm_id verification for Phase 0 endpoints.

How it works
------------
The frontend authenticates users via Supabase Auth and receives a JWT.
Each request to Phase 0 endpoints must carry that JWT as:
  Authorization: Bearer <jwt>

This module validates the JWT signature using SUPABASE_JWT_SECRET, extracts
the firm_id from app_metadata.firm_id, and returns it as the authoritative
tenant identifier.

The X-Firm-Id header is still read for DX convenience but is ONLY used
to verify it matches the JWT claim — it cannot override the JWT.

Development / test bypass
-------------------------
Set IFRS15_AUTH_DISABLED=true to skip JWT validation.  The endpoint will
then fall back to the X-Firm-Id header (or the IFRS15_FIRM_ID env var).
This mode logs a prominent warning and must NEVER be enabled in production.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import Header, HTTPException, Request

logger = logging.getLogger(__name__)

_AUTH_DISABLED_FLAG = "IFRS15_AUTH_DISABLED"
_JWT_SECRET_ENV = "SUPABASE_JWT_SECRET"


def _auth_disabled() -> bool:
    return os.getenv(_AUTH_DISABLED_FLAG, "").strip().lower() in ("true", "1", "yes")


def _fallback_firm_id(request: Request, x_firm_id: Optional[str]) -> str:
    if x_firm_id and str(x_firm_id).strip():
        return str(x_firm_id).strip()
    hdr = request.headers.get("x-firm-id") or request.headers.get("X-Firm-Id")
    if hdr and str(hdr).strip():
        return str(hdr).strip()
    return os.getenv("IFRS15_FIRM_ID", "default")


def get_verified_firm_id(
    request: Request,
    x_firm_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
) -> str:
    """
    FastAPI dependency: validates the Supabase JWT and returns the firm_id.

    Usage:
        @router.post("/")
        async def my_endpoint(firm_id: str = Depends(get_verified_firm_id)):
            ...
    """
    if _auth_disabled():
        logger.warning(
            "IFRS15_AUTH_DISABLED=true — JWT validation is BYPASSED. "
            "This must never be set in production."
        )
        return _fallback_firm_id(request, x_firm_id)

    # Extract the JWT from the Authorization header.
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail={
                "error": "MISSING_TOKEN",
                "message": "Authorization: Bearer <token> header is required",
            },
        )

    token = authorization[len("Bearer "):].strip()
    jwt_secret = os.getenv(_JWT_SECRET_ENV, "").strip()
    if not jwt_secret:
        # Misconfiguration — fail closed, not open.
        logger.error(
            "SUPABASE_JWT_SECRET is not set. Cannot validate JWT. "
            "Set the env var from your Supabase dashboard → Settings → API → JWT Secret."
        )
        raise HTTPException(
            status_code=503,
            detail={
                "error": "AUTH_MISCONFIGURED",
                "message": "Authentication is not configured on this server",
            },
        )

    # Validate the JWT.
    try:
        import jwt as pyjwt  # PyJWT
        payload = pyjwt.decode(
            token,
            jwt_secret,
            algorithms=["HS256"],
            options={"require": ["exp", "sub"]},
        )
    except Exception as exc:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "INVALID_TOKEN",
                "message": "JWT validation failed",
                "detail": str(exc),
            },
        ) from exc

    # Extract firm_id from app_metadata (Supabase custom claim set at signup).
    app_metadata = payload.get("app_metadata") or {}
    jwt_firm_id = (app_metadata.get("firm_id") or "").strip()

    if not jwt_firm_id:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "MISSING_FIRM_CLAIM",
                "message": "JWT does not contain app_metadata.firm_id claim",
            },
        )

    # Verify that the X-Firm-Id header (if supplied) matches the JWT claim.
    header_firm_id = _fallback_firm_id(request, x_firm_id)
    if header_firm_id and header_firm_id != "default" and header_firm_id != jwt_firm_id:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "FIRM_MISMATCH",
                "message": "X-Firm-Id header does not match JWT firm claim",
            },
        )

    return jwt_firm_id
