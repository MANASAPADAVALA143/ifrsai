"""IFRS 16 IBR benchmark — hardcoded base rates (update quarterly)."""

from __future__ import annotations

from typing import Any, Dict

# Base policy rates as at March 2026 — update quarterly
BASE_RATES = {
    "India": 6.25,
    "UAE": 4.85,
    "UK": 4.75,
    "US": 5.30,
    "Singapore": 3.65,
}

CREDIT_SPREADS = {
    "AAA": 0.25,
    "AA": 0.50,
    "A": 0.75,
    "BBB": 1.25,
    "BB": 2.00,
    "B": 3.00,
}


def benchmark_ibr(
    country: str,
    credit_rating: str,
    lease_term_years: int,
    currency: str = "USD",
) -> Dict[str, Any]:
    country_key = country.strip()
    base = BASE_RATES.get(country_key)
    if base is None:
        for k, v in BASE_RATES.items():
            if k.lower() in country_key.lower():
                base = v
                country_key = k
                break
    if base is None:
        base = 5.0
        country_key = country or "Default"

    rating = credit_rating.upper().strip()
    spread = CREDIT_SPREADS.get(rating, 1.25)

    term_adj = 0.0
    if lease_term_years > 7:
        term_adj = 0.50
    elif lease_term_years > 3:
        term_adj = 0.25

    mid = round(base + spread + term_adj, 2)
    low = round(mid - 0.25, 2)
    high = round(mid + 0.25, 2)

    basis_parts = [f"{country_key} policy/base rate {base}%", f"{rating} spread +{spread}%"]
    if term_adj:
        basis_parts.append(f"term adjustment +{term_adj}%")

    return {
        "ibr_low": low,
        "ibr_mid": mid,
        "ibr_high": high,
        "benchmark_basis": " + ".join(basis_parts),
        "guidance": (
            f"This IBR range ({low}%–{high}%, midpoint {mid}%) is a defensible starting point "
            f"for Big 4 audit when incremental borrowing rate is not directly observable. "
            f"Document entity-specific adjustments (collateral, currency, lease-specific risk)."
        ),
        "currency": currency,
    }
