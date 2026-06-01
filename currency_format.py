"""
Currency display helpers — INR uses Indian grouping; other ISO codes use Western grouping.
Used by app responses, IFRS 16 Excel export, and calculator disclosure strings.
"""

from __future__ import annotations


def currency_display_symbol(currency: str) -> str:
    c = (currency or "INR").upper().strip()
    if c == "INR":
        return "₹"
    return {
        "AED": "AED ",
        "GBP": "£",
        "USD": "$",
        "EUR": "€",
        "AUD": "A$",
        "SGD": "S$",
    }.get(c, c + " ")


def format_currency_value(amount: float, currency: str = "INR") -> str:
    """
    INR → Indian digit grouping + ₹.
    All others → international thousands separators + currency symbol.
    """
    c = (currency or "INR").upper().strip()
    neg = amount < 0
    a = abs(float(amount))

    if c == "INR":
        whole = int(a)
        frac = int(round((a - whole) * 100))
        if frac >= 100:
            whole += frac // 100
            frac = frac % 100
        s = str(whole)
        if len(s) > 3:
            last3 = s[-3:]
            rest = s[:-3]
            parts = []
            while len(rest) > 2:
                parts.append(rest[-2:])
                rest = rest[:-2]
            if rest:
                parts.append(rest)
            parts.reverse()
            s = ",".join(parts) + "," + last3
        if frac:
            s = f"{s}.{frac:02d}"
        return f"{'−' if neg else ''}₹{s}"

    symbol = {
        "AED": "AED ",
        "GBP": "£",
        "USD": "$",
        "EUR": "€",
        "AUD": "A$",
        "SGD": "S$",
    }.get(c, f"{c} ")
    formatted = f"{a:,.2f}"
    return f"{'−' if neg else ''}{symbol}{formatted}"


def excel_money_number_format(currency: str) -> str:
    """
    openpyxl cell number_format: Western grouping for non-INR; Indian-style pattern for INR.
    """
    sym = currency_display_symbol(currency)
    c = (currency or "INR").upper().strip()
    if c == "INR":
        return f'"{sym}"#,##,##0.00'
    return f'"{sym}"#,##0.00'
