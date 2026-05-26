"""RERA escrow release vs construction completion — UAE Law No. 8 of 2007, Article 8."""

from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, Field


class EscrowReleaseViolation(BaseModel):
    is_violation: bool
    escrow_release_pct: float
    construction_completion_pct: float
    excess_pct: float
    excess_amount_aed: float
    violation_message: str
    law_reference: str = "UAE Law No. 8 of 2007, Article 8"
    blocking: bool = False
    resolution_steps: List[str] = Field(default_factory=list)


def validate_escrow_release(
    escrow_receipts: List[Dict[str, Any]],
    escrow_releases: List[Dict[str, Any]],
    construction_completion_pct: float,
    contract_price_aed: float,
) -> EscrowReleaseViolation:
    """
    escrow_release_pct = (total released to developer / contract price) × 100.
    Violation when escrow_release_pct > construction_completion_pct.
    """
    _ = escrow_receipts  # symmetry / future linkage to receipt timing checks
    total_released = sum(float(r.get("amount") or 0) for r in (escrow_releases or []))

    cp = float(contract_price_aed or 0)
    completion = float(construction_completion_pct or 0)

    if cp <= 0:
        escrow_release_pct = 0.0 if total_released <= 0 else 100.0
    else:
        escrow_release_pct = round((total_released / contract_price_aed) * 100, 2)

    if escrow_release_pct > completion:
        excess_pct = round(escrow_release_pct - construction_completion_pct, 2)
        excess_amount_aed = round((excess_pct / 100) * contract_price_aed, 2)
        msg = (
            f"RERA ESCROW VIOLATION: Escrow released ({escrow_release_pct:.2f}%) "
            f"exceeds construction completion ({completion:.2f}%). "
            f"Excess release: AED {excess_amount_aed:,.2f}. "
            f"This violates UAE Law No. 8 of 2007, Article 8."
        )
        steps = [
            "1. Halt any further escrow release immediately.",
            f"2. Recover excess released amount: AED {excess_amount_aed:,.2f}",
            "3. Obtain updated RERA construction completion certificate.",
            "4. Resubmit escrow release request only up to verified completion %.",
            "5. Report to Dubai Land Department if releases already disbursed.",
            "6. Consult RERA compliance officer before reprocessing.",
        ]
        return EscrowReleaseViolation(
            is_violation=True,
            escrow_release_pct=escrow_release_pct,
            construction_completion_pct=completion,
            excess_pct=excess_pct,
            excess_amount_aed=excess_amount_aed,
            violation_message=msg,
            law_reference="UAE Law No. 8 of 2007, Article 8",
            blocking=True,
            resolution_steps=steps,
        )

    return EscrowReleaseViolation(
        is_violation=False,
        escrow_release_pct=escrow_release_pct,
        construction_completion_pct=completion,
        excess_pct=0.0,
        excess_amount_aed=0.0,
        violation_message="Escrow release is within permitted completion percentage.",
        law_reference="UAE Law No. 8 of 2007, Article 8",
        blocking=False,
        resolution_steps=[],
    )


def rera_escrow_violation_response_body(ev: EscrowReleaseViolation) -> Dict[str, Any]:
    """422 JSON body with discriminator `error` for frontend."""
    return {
        "error": "RERA_ESCROW_VIOLATION",
        "message": ev.violation_message,
        "is_violation": ev.is_violation,
        "escrow_release_pct": ev.escrow_release_pct,
        "construction_completion_pct": ev.construction_completion_pct,
        "excess_pct": ev.excess_pct,
        "excess_amount_aed": ev.excess_amount_aed,
        "law_reference": ev.law_reference,
        "resolution_steps": ev.resolution_steps,
        "blocking": bool(ev.is_violation),
    }
