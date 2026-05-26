"""Oqood amendment requirement assessment for UAE real estate modifications."""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Any, Dict, List, Literal

from pydantic import BaseModel, Field

from backend.app.services.ifrs15_realestate import UAE_CENTRAL_BANK_PEG


class OqoodTriggerField(str, Enum):
    PRICE_CHANGE = "price_change"
    UNIT_CHANGE = "unit_swap"
    HANDOVER_EXTENSION = "handover_extension"
    BUYER_TRANSFER = "buyer_name_transfer"
    PAYMENT_PLAN_CHANGE = "payment_plan_restructure"
    AREA_CHANGE = "unit_area_change"


class OqoodAssessment(BaseModel):
    requires_oqood_amendment: bool
    triggered_by: List[OqoodTriggerField] = Field(default_factory=list)
    amendment_fee_aed: float
    amendment_fee_display: str
    ifrs15_modification_type: Literal["new_contract", "modify_existing"]
    journal_entry_impact: str
    law_reference: str = "Dubai Law No. 13 of 2008, Article 3"
    warning_message: str
    action_required: str


def _format_fee_display(currency: str = "AED", exchange_rate: float = UAE_CENTRAL_BANK_PEG) -> str:
    cur = (currency or "AED").upper()
    fee_aed = 2000.0
    if cur == "USD":
        fee = fee_aed / float(exchange_rate or UAE_CENTRAL_BANK_PEG)
        return f"USD {fee:,.2f}"
    return f"AED {fee_aed:,.2f}"


def assess_oqood_requirement(modification: Dict[str, Any]) -> OqoodAssessment:
    """Assess whether a modification requires Oqood amendment filing with DLD."""
    mod_type = str(modification.get("modification_type") or modification.get("type") or "").strip().lower()
    currency = str(modification.get("currency") or "AED")
    exchange_rate = float(modification.get("exchange_rate") or UAE_CENTRAL_BANK_PEG)
    _ = modification.get("old_value")
    _ = modification.get("new_value")
    _ = modification.get("modification_date") or date.today().isoformat()

    type_map: Dict[str, OqoodTriggerField] = {
        "price_change": OqoodTriggerField.PRICE_CHANGE,
        "unit_swap": OqoodTriggerField.UNIT_CHANGE,
        "handover_extension": OqoodTriggerField.HANDOVER_EXTENSION,
        "extension": OqoodTriggerField.HANDOVER_EXTENSION,
        "buyer_transfer": OqoodTriggerField.BUYER_TRANSFER,
        "buyer_name_transfer": OqoodTriggerField.BUYER_TRANSFER,
        "payment_plan_change": OqoodTriggerField.PAYMENT_PLAN_CHANGE,
        "payment_plan_restructure": OqoodTriggerField.PAYMENT_PLAN_CHANGE,
        "area_change": OqoodTriggerField.AREA_CHANGE,
        "unit_area_change": OqoodTriggerField.AREA_CHANGE,
    }

    trigger = type_map.get(mod_type)
    triggered_by = [trigger] if trigger else []
    requires_amendment = trigger not in (None, OqoodTriggerField.PAYMENT_PLAN_CHANGE)

    if trigger in (OqoodTriggerField.UNIT_CHANGE, OqoodTriggerField.AREA_CHANGE):
        ifrs15_mod = "new_contract"
        journal_impact = "Prospective allocation as a new contract (distinct revised good/service)."
    else:
        ifrs15_mod = "modify_existing"
        journal_impact = "Cumulative catch-up to revenue and contract asset/liability."

    if requires_amendment:
        warning = (
            "This modification requires an Oqood amendment with Dubai Land Department. "
            "Filing must occur before or concurrent with the contract modification effective date."
        )
        action = (
            "1. Prepare Oqood amendment form (DLD portal)\n"
            "2. Pay AED 2,000 amendment fee\n"
            f"3. Update IFRS 15 modification — {ifrs15_mod} treatment\n"
            "4. Rerun revenue recognition schedule"
        )
    else:
        warning = (
            "Payment plan restructure does not require Oqood amendment. "
            "Document internally and update IFRS 15 schedule."
        )
        action = "Update payment schedule in system. No DLD filing required."

    fee_aed = 2000.0 if requires_amendment else 0.0
    fee_display = _format_fee_display(currency, exchange_rate) if requires_amendment else f"{currency.upper()} 0.00"

    return OqoodAssessment(
        requires_oqood_amendment=requires_amendment,
        triggered_by=triggered_by,
        amendment_fee_aed=fee_aed,
        amendment_fee_display=fee_display,
        ifrs15_modification_type=ifrs15_mod,
        journal_entry_impact=journal_impact,
        warning_message=warning,
        action_required=action,
    )

