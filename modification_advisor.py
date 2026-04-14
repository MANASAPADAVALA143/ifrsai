"""
IFRS 16 Modification AI Advisor
Maps extractor-style hints + modification inputs into §44 vs §45 treatment guidance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
import json
import re


@dataclass
class ModificationSignal:
    source: str
    field: str
    value: Any
    description: str


@dataclass
class TreatmentAdvice:
    recommended_type: str
    ifrs_reference: str
    treatment_label: str
    confidence: str
    headline: str
    reasoning: list[str]
    signals: list[ModificationSignal] = field(default_factory=list)
    user_action_required: str = ""
    journal_hint: str = ""


def _normalise(val: Any) -> str:
    if val is None:
        return ""
    return str(val).strip().lower()


def _flatten_remeasurement_triggers(rt: Any) -> str:
    if rt is None:
        return ""
    if isinstance(rt, dict):
        try:
            return json.dumps(rt)
        except (TypeError, ValueError):
            return str(rt)
    if isinstance(rt, list):
        return " ".join(_flatten_remeasurement_triggers(x) if not isinstance(x, str) else x for x in rt)
    return str(rt)


def _detect_signals(
    extractor_hints: dict,
    modification_inputs: dict,
) -> list[ModificationSignal]:
    signals: list[ModificationSignal] = []

    rt = extractor_hints.get("remeasurement_triggers")
    if isinstance(rt, list):
        for t in rt:
            signals.append(
                ModificationSignal(
                    source="extractor",
                    field="remeasurement_triggers",
                    value=t,
                    description=f"Contract remeasurement trigger: {t}",
                )
            )
    elif isinstance(rt, dict) and rt:
        flat = _flatten_remeasurement_triggers(rt)
        signals.append(
            ModificationSignal(
                source="extractor",
                field="remeasurement_triggers",
                value=flat,
                description=f"Contract remeasurement triggers (structured): {flat[:500]}",
            )
        )
    elif rt:
        signals.append(
            ModificationSignal(
                source="extractor",
                field="remeasurement_triggers",
                value=rt,
                description=f"Contract remeasurement trigger: {rt}",
            )
        )

    renewal = extractor_hints.get("renewalOptions") or extractor_hints.get("renewal_options")
    if renewal:
        signals.append(
            ModificationSignal(
                source="extractor",
                field="renewalOptions",
                value=renewal,
                description=f"Renewal/extension option found in contract: {renewal}",
            )
        )

    termination = extractor_hints.get("terminationClauses") or extractor_hints.get("termination_clauses")
    if termination:
        signals.append(
            ModificationSignal(
                source="extractor",
                field="terminationClauses",
                value=termination,
                description=f"Termination clause found: {termination}",
            )
        )

    escalation = extractor_hints.get("escalationClause") or extractor_hints.get("escalation_clause")
    if escalation:
        signals.append(
            ModificationSignal(
                source="extractor",
                field="escalationClause",
                value=escalation,
                description=f"Escalation/rent review clause: {escalation}",
            )
        )

    additional_assets = extractor_hints.get("additionalAssets") or extractor_hints.get("additional_assets")
    if additional_assets:
        signals.append(
            ModificationSignal(
                source="extractor",
                field="additionalAssets",
                value=additional_assets,
                description=f"Additional asset(s) mentioned: {additional_assets}",
            )
        )

    mod_type = _normalise(modification_inputs.get("modification_type", ""))
    if mod_type:
        signals.append(
            ModificationSignal(
                source="user_input",
                field="modification_type",
                value=mod_type,
                description=f"User selected modification type: {mod_type}",
            )
        )

    scope_change = modification_inputs.get("scope_change")
    if scope_change is not None:
        signals.append(
            ModificationSignal(
                source="user_input",
                field="scope_change",
                value=scope_change,
                description=f"Scope change indicator: {scope_change}",
            )
        )

    new_payment = modification_inputs.get("new_payment")
    old_payment = modification_inputs.get("original_payment")
    if new_payment is not None and old_payment is not None:
        try:
            op = float(old_payment)
            np = float(new_payment)
            if op != 0:
                delta_pct = ((np - op) / op) * 100
                signals.append(
                    ModificationSignal(
                        source="rule",
                        field="payment_delta_pct",
                        value=round(delta_pct, 1),
                        description=f"Payment {'increased' if delta_pct > 0 else 'decreased'} by {abs(delta_pct):.1f}%",
                    )
                )
        except (ValueError, ZeroDivisionError):
            pass

    new_term = modification_inputs.get("new_lease_term_months")
    old_term = modification_inputs.get("original_lease_term_months")
    if new_term is not None and old_term is not None:
        try:
            delta = int(new_term) - int(old_term)
            signals.append(
                ModificationSignal(
                    source="rule",
                    field="term_delta_months",
                    value=delta,
                    description=f"Lease term {'extended' if delta > 0 else 'reduced'} by {abs(delta)} months",
                )
            )
        except ValueError:
            pass

    return signals


def _apply_paragraph_44(
    signals: list[ModificationSignal],
    extractor_hints: dict,
    modification_inputs: dict,
) -> TreatmentAdvice | None:
    scope_signals = [
        s
        for s in signals
        if s.field in ("additionalAssets", "scope_change")
        and _normalise(s.value) not in ("false", "0", "no", "none", "")
    ]

    scope_keywords = re.compile(
        r"\b(additional\s+(floor|unit|space|asset|premises|area)|expand|add\s+floor|"
        r"scope\s+increase|new\s+asset|extra\s+(unit|space|floor))\b",
        re.IGNORECASE,
    )
    free_text_fields = [
        str(extractor_hints.get(k, ""))
        for k in ("remeasurement_triggers", "additionalAssets", "contractNotes", "description")
    ]
    free_text = " ".join(free_text_fields)
    keyword_hit = bool(scope_keywords.search(free_text))

    has_scope_increase = bool(scope_signals) or keyword_hit

    payment_delta_signals = [s for s in signals if s.field == "payment_delta_pct"]
    has_payment_increase = any(s.value > 0 for s in payment_delta_signals)

    user_type = _normalise(modification_inputs.get("modification_type", ""))
    user_said_scope_increase = "scope_increase" in user_type or "scope increase" in user_type

    if (has_scope_increase or user_said_scope_increase) and (has_payment_increase or not payment_delta_signals):
        reasons = [
            "Contract adds right to use an additional identified asset — §44(a) criterion met.",
        ]
        if has_payment_increase:
            delta = next((s.value for s in payment_delta_signals), None)
            reasons.append(
                f"Consideration increases by {delta}% — verify this is commensurate with "
                "the stand-alone price of the additional asset to confirm §44(b)."
            )
        else:
            reasons.append(
                "No payment delta detected yet — confirm that consideration increases "
                "commensurate with stand-alone price of the new asset (§44(b))."
            )
        reasons.append(
            "Accounting treatment: account for the additional asset as a NEW separate lease. "
            "Original lease continues unchanged."
        )

        return TreatmentAdvice(
            recommended_type="scope_increase",
            ifrs_reference="IFRS 16 §44",
            treatment_label="Separate new lease",
            confidence="high" if (has_scope_increase and has_payment_increase) else "medium",
            headline="Scope increase — this looks like a separate new lease under §44",
            reasoning=reasons,
            signals=signals,
            user_action_required=(
                "Confirm the stand-alone price of the additional asset is consistent "
                "with the payment increase. If not commensurate → fall back to §45 remeasurement."
            ),
            journal_hint=(
                "Recognise new ROU asset + new lease liability for the additional asset only. "
                "No adjustment to original lease."
            ),
        )

    return None


def _apply_paragraph_45(
    signals: list[ModificationSignal],
    extractor_hints: dict,
    modification_inputs: dict,
) -> TreatmentAdvice:
    user_type = _normalise(modification_inputs.get("modification_type", ""))
    term_delta_signals = [s for s in signals if s.field == "term_delta_months"]
    payment_delta_signals = [s for s in signals if s.field == "payment_delta_pct"]
    has_renewal = any(s.field == "renewalOptions" for s in signals)
    has_termination = any(s.field == "terminationClauses" for s in signals)
    has_escalation = any(s.field == "escalationClause" for s in signals)
    has_cpi = any(
        "cpi" in _normalise(s.value) or "index" in _normalise(s.value)
        for s in signals
        if s.field == "remeasurement_triggers"
    )

    if "scope_decrease" in user_type or "scope decrease" in user_type:
        return TreatmentAdvice(
            recommended_type="scope_decrease",
            ifrs_reference="IFRS 16 §45(a)",
            treatment_label="Remeasure — scope decrease",
            confidence="high",
            headline="Scope decrease — remeasure at modification date under §45(a)",
            reasoning=[
                "Scope reduction does not meet §44 criteria — treat as modification of existing lease.",
                "At modification date: reduce ROU asset carrying amount proportionately, "
                "recognise gain/loss on partial termination.",
                "Remeasure remaining lease liability at revised discount rate.",
                "Adjust ROU asset for the remeasured liability.",
            ],
            signals=signals,
            user_action_required=(
                "Provide: modification date, reduced scope %, revised monthly payment, "
                "revised IBR at modification date."
            ),
            journal_hint=(
                "Dr Lease Liability (partial derecognition) / Cr ROU Asset + P&L gain or loss."
            ),
        )

    if (
        any(s.value > 0 for s in term_delta_signals)
        or has_renewal
        or "extension" in user_type
        or "renewal" in user_type
    ):
        term_delta = next((s.value for s in term_delta_signals), None)
        return TreatmentAdvice(
            recommended_type="extension",
            ifrs_reference="IFRS 16 §45(b) + §46",
            treatment_label="Remeasure — lease term extension",
            confidence="high" if term_delta else "medium",
            headline="Lease term extended — remeasure liability at revised IBR under §45(b)",
            reasoning=[
                f"Lease term extended by {term_delta} months." if term_delta else
                "Renewal / extension option detected in contract.",
                "At modification date: remeasure lease liability using revised remaining payments "
                "discounted at a revised IBR (§46).",
                "Adjust ROU asset carrying amount by the same amount as the liability adjustment.",
                "No gain/loss recognised — carrying amounts updated only.",
            ],
            signals=signals,
            user_action_required=(
                "Provide: modification effective date, new lease end date, "
                "revised IBR as of modification date."
            ),
            journal_hint=(
                "Dr ROU Asset / Cr Lease Liability (for liability increase). "
                "Or Dr Lease Liability / Cr ROU Asset (for decrease)."
            ),
        )

    if (
        any(s.value < 0 for s in term_delta_signals)
        or has_termination
        or "termination" in user_type
    ):
        return TreatmentAdvice(
            recommended_type="termination",
            ifrs_reference="IFRS 16 §45(b)",
            treatment_label="Remeasure — early termination / term reduction",
            confidence="high",
            headline="Early termination or term reduction — remeasure at modification date",
            reasoning=[
                "Lease term is being shortened — remeasure liability over revised shorter term.",
                "Use revised IBR at modification date to discount remaining (shorter) payment stream.",
                "Derecognise portion of ROU asset and recognise termination gain/loss.",
            ],
            signals=signals,
            user_action_required=(
                "Provide: new termination date, any penalty payments, revised IBR."
            ),
            journal_hint=(
                "Dr Lease Liability (full remaining) / Cr ROU Asset (NBV) ± P&L termination gain/loss."
            ),
        )

    if has_cpi or "index" in user_type or "cpi" in user_type or "rent_review" in user_type:
        return TreatmentAdvice(
            recommended_type="index_rate_change",
            ifrs_reference="IFRS 16 §42 + §45(c)",
            treatment_label="Remeasure — CPI / index change",
            confidence="high",
            headline="CPI or index-linked rent change — remeasure under §42/§45(c)",
            reasoning=[
                "Index-linked payment change triggers remeasurement under IFRS 16 §42.",
                "Remeasure lease liability using revised payments (updated index) "
                "discounted at the ORIGINAL discount rate (not revised IBR — §45(c)).",
                "Adjust ROU asset by the liability change — no P&L impact at remeasurement.",
                "Update `cpi_index_current` in the system and recalculate to generate "
                "updated schedules.",
            ],
            signals=signals,
            user_action_required=(
                "Provide: new CPI index value, review date. "
                "Important: use ORIGINAL IBR (not revised) for discounting."
            ),
            journal_hint=(
                "Dr ROU Asset / Cr Lease Liability (if payments increase). "
                "Reverse if payments decrease."
            ),
        )

    if "ibr" in user_type or "ibr_change" in user_type or "discount" in user_type:
        return TreatmentAdvice(
            recommended_type="ibr_change",
            ifrs_reference="IFRS 16 §45(c)",
            treatment_label="Remeasure — IBR / discount rate change",
            confidence="high",
            headline="IBR change triggers remeasurement under §45(c)",
            reasoning=[
                "Change in IBR or reference rate triggers remeasurement.",
                "Remeasure lease liability at revised rate — adjust ROU asset accordingly.",
                "Effective date = date the IBR change is recognised.",
            ],
            signals=signals,
            user_action_required="Provide: revised IBR (%), effective date of rate change.",
            journal_hint="Dr ROU Asset / Cr Lease Liability (or reverse for rate decrease).",
        )

    if payment_delta_signals or has_escalation or "rent_review" in user_type:
        delta = next((s.value for s in payment_delta_signals), None)
        if isinstance(delta, (int, float)):
            pay_line = (
                f"Monthly payment {'increased' if delta > 0 else 'changed'} by {abs(delta):.1f}%."
            )
        else:
            pay_line = "Payment change detected."
        return TreatmentAdvice(
            recommended_type="rent_review",
            ifrs_reference="IFRS 16 §45(c)",
            treatment_label="Remeasure — rent review / payment change",
            confidence="medium",
            headline="Payment change — remeasure at revised payment stream under §45(c)",
            reasoning=[
                pay_line,
                "Remeasure lease liability using new payment stream discounted at revised IBR.",
                "Adjust ROU asset by the liability remeasurement amount.",
            ],
            signals=signals,
            user_action_required="Provide: new monthly payment, effective date, revised IBR.",
            journal_hint="Dr ROU Asset / Cr Lease Liability (or reverse if payment decreases).",
        )

    return TreatmentAdvice(
        recommended_type="remeasurement",
        ifrs_reference="IFRS 16 §45",
        treatment_label="Remeasure existing lease",
        confidence="low",
        headline="Modification detected — likely a §45 remeasurement, but more detail needed",
        reasoning=[
            "Not enough signals to determine exact modification sub-type.",
            "Under §45 the default treatment is: remeasure lease liability at revised IBR, "
            "adjust ROU asset by the same amount.",
            "Review the modification type and provide payment / term changes for precise guidance.",
        ],
        signals=signals,
        user_action_required=(
            "Select the modification type and fill in revised payment / term / IBR "
            "to get precise accounting guidance."
        ),
        journal_hint="Dr ROU Asset / Cr Lease Liability (direction depends on payment change).",
    )


def advise_modification(
    extractor_hints: dict,
    modification_inputs: dict,
) -> dict:
    hints = extractor_hints if isinstance(extractor_hints, dict) else {}
    inputs = modification_inputs if isinstance(modification_inputs, dict) else {}

    signals = _detect_signals(hints, inputs)

    advice = _apply_paragraph_44(signals, hints, inputs)
    if advice is None:
        advice = _apply_paragraph_45(signals, hints, inputs)

    return {
        "recommended_type": advice.recommended_type,
        "ifrs_reference": advice.ifrs_reference,
        "treatment_label": advice.treatment_label,
        "confidence": advice.confidence,
        "headline": advice.headline,
        "reasoning": advice.reasoning,
        "user_action_required": advice.user_action_required,
        "journal_hint": advice.journal_hint,
        "signals": [
            {
                "source": s.source,
                "field": s.field,
                "description": s.description,
            }
            for s in advice.signals
        ],
    }
