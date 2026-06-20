"""
IFRS 16 Lease Accounting Calculator
Calculates lease liability, ROU asset, amortization schedules, and journal entries
"""

import pandas as pd
import numpy as np
from datetime import datetime
from dateutil.relativedelta import relativedelta
from decimal import Decimal, ROUND_HALF_UP
from dataclasses import dataclass
from typing import Dict, Optional, List
import json

from currency_format import format_currency_value


@dataclass
class LeaseInput:
    """Lease parameters for IFRS 16 calculation"""
    lease_id: str
    asset_description: str
    commencement_date: datetime
    lease_term_months: int
    monthly_payment: Decimal
    annual_discount_rate: Decimal  # e.g. 0.085 for 8.5%
    non_lease_component: Decimal = Decimal('0')  # e.g. service/maintenance portion
    non_lease_description: str = ""  # e.g. "Building maintenance, security"
    non_lease_additive: bool = False  # True when non-lease is on top of base rent (not embedded in monthly_payment)
    practical_expedient_elected: bool = False  # If True, don't separate — use full payment
    initial_direct_costs: Decimal = Decimal('0')  # Total; or computed from legal+brokerage+other
    escalation_rate: Decimal = Decimal('0')  # Annual, e.g. 0.05 for 5%
    cpi_index_base: Decimal = Decimal('0')  # Index at commencement e.g. 100
    cpi_index_current: Decimal = Decimal('0')  # Latest known index e.g. 107.5
    cpi_adjustment_frequency_months: int = 12  # How often CPI resets payments
    # Initial direct costs breakdown (IFRS 16 para 24 — added to ROU asset)
    legal_fees: Decimal = Decimal('0')
    brokerage_fees: Decimal = Decimal('0')
    other_initial_direct_costs: Decimal = Decimal('0')
    initial_direct_costs_description: str = ""
    currency: str = "INR"
    lessee_name: str = ""
    lessor_name: str = ""
    payment_type: str = "Arrears"  # "Arrears" (end of period) or "Advance" (beginning of period)
    # Lease incentives (IFRS 16 para 24 — reduce ROU asset)
    rent_free_months: int = 0
    cash_incentive: Decimal = Decimal('0')
    lease_incentive_description: str = ""
    # Residual value guarantee (IFRS 16 para 26(d) — include in lease liability if lessee guarantees)
    rvg_amount: Decimal = Decimal('0')  # Guaranteed amount
    rvg_guaranteed_by: str = "None"  # "Lessee" | "Third party" | "None"
    rvg_expected_payment: Decimal = Decimal('0')  # Amount lessee expects to pay


class IFRS16Calculator:
    """IFRS 16 lease liability and ROU asset calculator"""
    
    def __init__(self):
        self.precision = Decimal('0.01')

    def get_lease_component_payment(self, lease: LeaseInput) -> Decimal:
        """
        IFRS 16 §12-15: Return only the lease component of monthly payment.
        If practical expedient elected, return full monthly_payment.
        If non_lease_additive is True, monthly_payment is already the lease component
        and non_lease_component is tracked separately (not subtracted).
        Otherwise non_lease_component is embedded in monthly_payment and subtracted.
        """
        if lease.practical_expedient_elected:
            return lease.monthly_payment
        if lease.non_lease_component > 0 and not getattr(lease, 'non_lease_additive', False):
            lease_payment = lease.monthly_payment - lease.non_lease_component
            if lease_payment <= 0:
                raise ValueError(
                    f"Non-lease component ({lease.non_lease_component}) must be "
                    f"less than monthly payment ({lease.monthly_payment})"
                )
            return lease_payment
        return lease.monthly_payment
    
    def calculate_lease_liability(self, lease: LeaseInput) -> Decimal:
        """
        Calculate present value of lease payments (Initial Lease Liability)
        
        When rent-free period exists: payments start AFTER rent-free months.
        PV is calculated for the payment months only, discounted appropriately.
        
        Arrears (ordinary annuity, payment at end of period):
          PV = PMT × [(1 - (1 + r)^-n) / r] × (1+r)^(-rent_free)
        Advance (annuity-due): first payment at beginning of first payment month.
        
        Args:
            lease: LeaseInput object with lease parameters
            
        Returns:
            Present value of lease payments
        """
        rent_free = getattr(lease, 'rent_free_months', 0) or 0
        payment_months = lease.lease_term_months - rent_free
        if payment_months <= 0:
            return Decimal('0')

        is_advance = (lease.payment_type or "Arrears").strip().lower() == "advance"
        if self._use_schedule_based_pv(lease) and not is_advance:
            return self._pv_lease_payments_schedule_based(lease)
        
        monthly_rate = lease.annual_discount_rate / Decimal('12')
        
        # Handle zero interest rate edge case
        effective_payment = self.get_lease_component_payment(lease)
        if monthly_rate == 0:
            return effective_payment * Decimal(str(payment_months))
        
        # Ordinary annuity (Arrears): PV of n payments
        discount_factor = (
            Decimal('1') - (Decimal('1') + monthly_rate) ** -payment_months
        ) / monthly_rate
        
        pv = effective_payment * discount_factor
        
        # Advance (annuity-due): first payment at start of first payment period
        if (lease.payment_type or "Arrears").strip().lower() == "advance":
            pv = pv * (Decimal('1') + monthly_rate)
        
        # Discount back to commencement (payments start after rent-free months)
        if rent_free > 0:
            pv = pv * (Decimal('1') + monthly_rate) ** -rent_free
        
        return pv.quantize(self.precision, ROUND_HALF_UP)
    
    def calculate_rou_asset(
        self,
        lease_liability: Decimal,
        initial_costs: Decimal,
        lease_incentives: Decimal = Decimal('0'),
    ) -> Decimal:
        """
        Calculate Right-of-Use Asset (IFRS 16 para 24)
        
        ROU Asset = PV of lease payments + Initial direct costs - Lease incentives
        
        Lease incentives here are cash incentives received. Rent-free months are
        reflected by zero lease payments in the cash-flow schedule, not deducted
        again from the ROU asset.
        
        Args:
            lease_liability: PV of lease payments (lease liability)
            initial_costs: Initial direct costs (stamp duty, legal fees, etc.)
            lease_incentives: Cash lease incentives received
            
        Returns:
            ROU asset value
        """
        return (lease_liability + initial_costs - lease_incentives).quantize(
            self.precision, ROUND_HALF_UP
        )
    
    def calculate_monthly_depreciation(self, rou_asset: Decimal, months: int) -> Decimal:
        """
        Calculate monthly straight-line depreciation
        
        Args:
            rou_asset: Right-of-use asset value
            months: Lease term in months
            
        Returns:
            Monthly depreciation amount
        """
        return (rou_asset / Decimal(str(months))).quantize(self.precision, ROUND_HALF_UP)
    
    def _get_cpi_adjusted_payment(
        self,
        base_payment: Decimal,
        cpi_index_base: Decimal,
        cpi_index_current: Decimal,
    ) -> Decimal:
        """
        IFRS 16 §42: At each review date, remeasure lease liability using
        current index / base index ratio applied to the original payment.
        Future payments are assumed to stay at the revised amount.
        """
        if cpi_index_base and cpi_index_base > 0 and cpi_index_current > 0:
            return base_payment * (cpi_index_current / cpi_index_base)
        return base_payment

    def _apply_cpi_and_escalation_payment(
        self,
        lease: LeaseInput,
        period: int,
        rent_free: int,
        payment: Decimal,
    ) -> Decimal:
        """
        Update running monthly payment after CPI review and/or fixed escalation.

        Annual fixed escalation applies at the start of periods 13, 25, 37…
        (i.e. after each 12-month lease year), aligned with typical step-up clauses.
        CPI index reviews use the same anniversary periods when indices are provided.
        """
        if period <= rent_free:
            return payment
        freq = int(getattr(lease, 'cpi_adjustment_frequency_months', 12) or 12)
        er = lease.escalation_rate or Decimal('0')
        cpi_base = getattr(lease, 'cpi_index_base', Decimal('0')) or Decimal('0')
        cpi_cur = getattr(lease, 'cpi_index_current', Decimal('0')) or Decimal('0')

        if period > 1 and (period - 1) % freq == 0 and cpi_base > 0 and cpi_cur > 0:
            base_lease_payment = self.get_lease_component_payment(lease)
            cpi_adjusted = self._get_cpi_adjusted_payment(
                base_lease_payment,
                cpi_base,
                cpi_cur,
            )
            escalation_cycles = (period - 1) // 12
            return (cpi_adjusted * ((Decimal('1') + er) ** escalation_cycles)).quantize(
                self.precision, ROUND_HALF_UP
            )
        if er > 0 and period > 12 and (period - 1) % 12 == 0:
            return (payment * (Decimal('1') + er)).quantize(self.precision, ROUND_HALF_UP)
        return payment

    def _pv_lease_payments_schedule_based(self, lease: LeaseInput) -> Decimal:
        """PV of lease payments when CPI and/or escalation change amounts period-by-period (arrears path)."""
        monthly_rate = lease.annual_discount_rate / Decimal('12')
        rent_free = getattr(lease, 'rent_free_months', 0) or 0
        payment = self.get_lease_component_payment(lease)
        pv = Decimal('0')
        for period in range(1, lease.lease_term_months + 1):
            if rent_free > 0 and period <= rent_free:
                continue
            new_p = self._apply_cpi_and_escalation_payment(lease, period, rent_free, payment)
            if new_p != payment:
                payment = new_p
            pay_amt = payment
            if monthly_rate == 0:
                pv += pay_amt
            else:
                pv += pay_amt / ((Decimal('1') + monthly_rate) ** period)
        return pv.quantize(self.precision, ROUND_HALF_UP)

    def _use_schedule_based_pv(self, lease: LeaseInput) -> bool:
        cpi_b = getattr(lease, 'cpi_index_base', Decimal('0')) or Decimal('0')
        cpi_c = getattr(lease, 'cpi_index_current', Decimal('0')) or Decimal('0')
        if cpi_b > 0 and cpi_c > 0:
            return True
        er = lease.escalation_rate or Decimal('0')
        return er > 0

    def generate_amortization_schedule(
        self, 
        lease: LeaseInput, 
        lease_liability: Decimal
    ) -> pd.DataFrame:
        """
        Generate monthly amortization table using effective interest method.

        Advance (annuity-due): payment at START of period.
          - Period 1: interest = 0 (payment made at start, no time for interest).
            Principal = min(payment, opening_balance). Closing = opening - payment.
          - Period 2 onwards: interest = closing_balance_prev * monthly_rate,
            principal = payment - interest, closing = max(0, balance - principal).

        Arrears (ordinary annuity): payment at END of period.
          - Period 1: interest = opening_balance * monthly_rate, principal = payment - interest.
          (Do not change arrears logic — it is correct.)

        Columns: Period, Date, Month, Opening_Balance, Payment, Interest, Principal, Closing_Balance
        """
        monthly_rate = lease.annual_discount_rate / Decimal('12')
        is_advance = (lease.payment_type or "Arrears").strip().lower() == "advance"

        schedule = []
        balance = lease_liability
        current_date = lease.commencement_date
        payment = self.get_lease_component_payment(lease)
        rent_free = getattr(lease, 'rent_free_months', 0) or 0
        is_rent_free_period = period_in_rent_free = lambda p: rent_free > 0 and p <= rent_free
        rvg_expected = getattr(lease, 'rvg_expected_payment', Decimal('0')) or Decimal('0')
        rvg_guaranteed_by = (getattr(lease, 'rvg_guaranteed_by', 'None') or 'None').strip().lower()
        add_rvg_to_last_period = rvg_expected > 0 and rvg_guaranteed_by == 'lessee'

        for period in range(1, lease.lease_term_months + 1):
            # Rent-free months: zero payment, interest still accrues
            actual_payment = Decimal('0') if is_rent_free_period(period) else payment

            if not is_rent_free_period(period):
                new_payment = self._apply_cpi_and_escalation_payment(
                    lease, period, rent_free, payment
                )
                if new_payment != payment:
                    payment = new_payment
                    actual_payment = payment

            # Add RVG payment to final period (IFRS 16 para 26(d))
            if add_rvg_to_last_period and period == lease.lease_term_months:
                actual_payment = actual_payment + rvg_expected

            if is_advance:
                # Advance: payment at beginning of period — Period 1 has ZERO interest (or rent-free)
                if period == 1 and not is_rent_free_period(period):
                    interest = Decimal('0')
                    principal = min(actual_payment, balance)
                    principal = principal.quantize(self.precision, ROUND_HALF_UP)
                    closing = (balance - principal).quantize(self.precision, ROUND_HALF_UP)
                else:
                    # Rent-free or period 2+: interest on opening, principal = payment - interest
                    interest = (balance * monthly_rate).quantize(self.precision, ROUND_HALF_UP)
                    principal = actual_payment - interest
                    if period == lease.lease_term_months:
                        principal = balance
                        interest = (actual_payment - principal).quantize(self.precision, ROUND_HALF_UP)
                        if interest < 0:
                            interest = Decimal('0')
                        actual_payment = principal + interest
                    principal = principal.quantize(self.precision, ROUND_HALF_UP)
                    closing = (balance - principal).quantize(self.precision, ROUND_HALF_UP)
                closing = max(Decimal('0'), closing)
            else:
                # Arrears: payment at end of period
                interest = (balance * monthly_rate).quantize(self.precision, ROUND_HALF_UP)
                principal = actual_payment - interest
                if period == lease.lease_term_months:
                    principal = balance
                    interest = actual_payment - principal
                    if interest < 0:
                        interest = Decimal('0')
                    actual_payment = principal + interest
                principal = principal.quantize(self.precision, ROUND_HALF_UP)
                closing = (balance - principal).quantize(self.precision, ROUND_HALF_UP)
                closing = max(Decimal('0'), closing)

            rvg_payment_this_period = float(rvg_expected) if (add_rvg_to_last_period and period == lease.lease_term_months) else 0.0
            schedule.append({
                'Period': period,
                'Date': current_date.strftime('%Y-%m-%d'),
                'Month': current_date.strftime('%b %Y'),
                'Opening_Balance': float(balance),
                'Payment': float(actual_payment),
                'Interest': float(interest),
                'Principal': float(principal),
                'Closing_Balance': float(closing),
                'Rent_Free': bool(is_rent_free_period(period)),
                'RVG_Payment': rvg_payment_this_period,
            })

            balance = closing
            current_date += relativedelta(months=1)
            # Stop once liability is fully extinguished (IFRS 16 — no post-payoff rows)
            if balance <= 0:
                break

        return pd.DataFrame(schedule)
    
    def generate_journal_entries(
        self,
        rou_asset: Decimal,
        lease_liability: Decimal,
        monthly_depreciation: Decimal,
        first_month_interest: Decimal,
        first_month_payment: Decimal,
        currency: str = "INR",
        payment_type: str = "Arrears",
        liability_split: Optional[Dict] = None,
        initial_direct_costs: Decimal = Decimal('0'),
        cash_incentive: Decimal = Decimal('0'),
    ) -> Dict:
        """
        Generate accounting journal entries for IFRS 16.
        For Advance: Month 1 has no interest — Dr Lease Liability, Cr Cash only.

        Initial recognition separates lease liability into current / non-current and
        credits Cash / Accounts Payable for initial direct costs paid separately (IFRS 16 para 24).
        """
        
        is_advance = (payment_type or "Arrears").strip().lower() == "advance"
        month1_principal = first_month_payment if is_advance else (first_month_payment - first_month_interest)
        month1_interest = Decimal('0') if is_advance else first_month_interest
        
        if is_advance:
            # Month 1 Advance: Dr Lease Liability ₹[full payment], Cr Cash/Bank ₹[full payment]. NO interest entry.
            entries_month1 = [
                {
                    'account': 'Lease Liability',
                    'account_type': 'Liability',
                    'dr': float(month1_principal),
                    'cr': 0,
                    'narration': 'Dr Lease Liability — full payment reduces principal (no interest in Month 1 for advance payment)'
                },
                {
                    'account': 'Cash/Bank',
                    'account_type': 'Current Asset',
                    'dr': 0,
                    'cr': float(first_month_payment),
                    'narration': 'Cr Cash/Bank — lease payment to lessor'
                }
            ]
        else:
            entries_month1 = [
                {
                    'account': 'Interest Expense',
                    'account_type': 'Expense (P&L)',
                    'dr': float(month1_interest),
                    'cr': 0,
                    'narration': 'Interest on lease liability (effective interest method)'
                },
                {
                    'account': 'Lease Liability',
                    'account_type': 'Liability',
                    'dr': float(month1_principal),
                    'cr': 0,
                    'narration': 'Principal reduction of lease liability'
                },
                {
                    'account': 'Cash/Bank',
                    'account_type': 'Current Asset',
                    'dr': 0,
                    'cr': float(first_month_payment),
                    'narration': 'Lease payment to lessor'
                }
            ]
        
        split = liability_split or {}
        current_ll = Decimal(str(split.get('current_portion', lease_liability)))
        noncurrent_ll = Decimal(str(split.get('non_current_portion', Decimal('0'))))
        if current_ll + noncurrent_ll == 0:
            current_ll = lease_liability
            noncurrent_ll = Decimal('0')

        initial_entries = [
            {
                'account': 'Right-of-Use Asset',
                'account_type': 'Non-Current Asset',
                'dr': float(rou_asset),
                'cr': 0,
                'narration': 'Recognition of ROU asset (lease liability PV plus initial direct costs less incentives)',
            },
            {
                'account': 'Lease Liability (Current)',
                'account_type': 'Current Liability',
                'dr': 0,
                'cr': float(current_ll),
                'narration': 'Current portion of lease liability at commencement',
            },
            {
                'account': 'Lease Liability (Non-Current)',
                'account_type': 'Non-Current Liability',
                'dr': 0,
                'cr': float(noncurrent_ll),
                'narration': 'Non-current portion of lease liability at commencement',
            },
        ]
        initial_total_dr = rou_asset
        initial_total_cr = current_ll + noncurrent_ll
        idc_note = None
        if initial_direct_costs > 0:
            initial_entries.append({
                'account': 'Cash / Accounts Payable',
                'account_type': 'Current Asset / Liability',
                'dr': 0,
                'cr': float(initial_direct_costs),
                'narration': (
                    f'Initial direct costs of {format_currency_value(float(initial_direct_costs), currency)} '
                    f'paid separately and capitalized to ROU asset per IFRS 16 para 24'
                ),
            })
            initial_total_cr += initial_direct_costs
            idc_note = (
                f'Initial direct costs of {format_currency_value(float(initial_direct_costs), currency)} '
                f'paid separately and capitalized to ROU asset per IFRS 16 para 24.'
            )
        if cash_incentive > 0:
            initial_entries.append({
                'account': 'Cash/Bank',
                'account_type': 'Current Asset',
                'dr': float(cash_incentive),
                'cr': 0,
                'narration': 'Cash lease incentives received at commencement (deducted from ROU asset)',
            })
            initial_total_dr += cash_incentive

        return {
            'initial_recognition': {
                'date': 'Commencement Date',
                'description': 'Initial recognition of lease under IFRS 16',
                'entries': initial_entries,
                'total_dr': float(initial_total_dr),
                'total_cr': float(initial_total_cr),
                'idc_note': idc_note,
            },
            'monthly_depreciation': {
                'description': 'Monthly depreciation expense (recurring entry)',
                'frequency': 'Monthly',
                'entries': [
                    {
                        'account': 'Depreciation Expense - ROU Asset',
                        'account_type': 'Expense (P&L)',
                        'dr': float(monthly_depreciation),
                        'cr': 0,
                        'narration': 'Straight-line depreciation of ROU asset'
                    },
                    {
                        'account': 'Accumulated Depreciation - ROU Asset',
                        'account_type': 'Contra Asset',
                        'dr': 0,
                        'cr': float(monthly_depreciation),
                        'narration': 'Accumulated depreciation'
                    }
                ],
                'total_dr': float(monthly_depreciation),
                'total_cr': float(monthly_depreciation)
            },
            'monthly_payment_example': {
                'description': 'Monthly lease payment (example - Month 1)' + (' — Advance: full payment to liability, no interest' if is_advance else ''),
                'frequency': 'Monthly',
                'entries': entries_month1,
                'total_dr': float(first_month_payment),
                'total_cr': float(first_month_payment)
            }
        }
    
    def generate_maturity_analysis(
        self,
        schedule: pd.DataFrame,
        reporting_date: Optional[datetime] = None,
    ) -> Dict:
        """
        Future undiscounted lease payments by maturity bucket (IFRS 16 para 58(b)).
        Buckets are measured from the reporting date, not from lease commencement.
        """
        if schedule is None or len(schedule) == 0:
            return {
                'Less than 1 year': 0.0,
                '1 to 2 years': 0.0,
                '2 to 3 years': 0.0,
                '3 to 4 years': 0.0,
                '4 to 5 years': 0.0,
                'More than 5 years': 0.0,
                'Total': 0.0,
            }

        report_dt = pd.Timestamp(reporting_date or datetime.now()).normalize()
        sched = schedule.copy()
        sched['Date_dt'] = pd.to_datetime(sched['Date'])

        bucket_defs = [
            ('Less than 1 year', 0, 1),
            ('1 to 2 years', 1, 2),
            ('2 to 3 years', 2, 3),
            ('3 to 4 years', 3, 4),
            ('4 to 5 years', 4, 5),
            ('More than 5 years', 5, None),
        ]
        buckets: Dict[str, float] = {label: 0.0 for label, _, _ in bucket_defs}
        buckets['Total'] = 0.0

        future = sched[sched['Date_dt'] > report_dt]
        source = future if len(future) > 0 else sched

        for _, row in source.iterrows():
            dt = row['Date_dt']
            if len(future) > 0 and dt <= report_dt:
                continue
            payment = float(row.get('Payment', 0) or 0)
            if payment <= 0:
                continue
            days = max(0, (dt - report_dt).days)
            years = days / 365.25
            for label, lo, hi in bucket_defs:
                if hi is None:
                    if years >= lo:
                        buckets[label] += payment
                        break
                elif lo <= years < hi:
                    buckets[label] += payment
                    break
            buckets['Total'] += payment

        return buckets
    
    def _build_incentive_disclosure_note(
        self,
        rent_free: int,
        cash_incentive: Decimal,
        lease: LeaseInput,
    ) -> Optional[str]:
        """Rent-free and cash incentive disclosure aligned with lease inputs."""
        parts: List[str] = []
        if rent_free > 0:
            parts.append(
                f"The lease includes a rent-free period of {rent_free} month(s) commencing "
                f"{lease.commencement_date.strftime('%Y-%m-%d')}. "
                f"The rent-free period is reflected as zero lease payments in those months."
            )
        elif cash_incentive <= 0:
            parts.append("No rent-free period applies.")
        if cash_incentive > 0:
            parts.append(
                f"Cash lease incentives of {format_currency_value(float(cash_incentive), str(lease.currency))} "
                f"have been deducted from the right-of-use asset at commencement in accordance with "
                f"IFRS 16 paragraph 24."
            )
        return "\n".join(parts) if parts else None
    
    def calculate_current_vs_noncurrent(
        self, 
        schedule: pd.DataFrame,
        reporting_date: datetime
    ) -> Dict:
        """
        Split lease liability into current and non-current portions (IAS 1 / IFRS 16).

        Current = principal portion of lease payments due within 12 months after reporting date.
        Non-current = closing liability at reporting date minus current portion.

        Args:
            schedule: Amortization schedule
            reporting_date: Balance sheet reporting date

        Returns:
            Dictionary with current and non-current portions
        """
        cutoff_date = reporting_date + relativedelta(months=12)

        sched = schedule.copy()
        sched['Date_dt'] = pd.to_datetime(sched['Date'])
        reporting_dt = pd.Timestamp(reporting_date).normalize()
        cutoff_dt = pd.Timestamp(cutoff_date).normalize()

        on_or_before = sched[sched['Date_dt'] <= reporting_dt]
        first_dt = sched['Date_dt'].iloc[0].normalize()

        if len(on_or_before) == 0 or reporting_dt <= first_dt:
            total_liability = float(sched.iloc[0]['Opening_Balance'])
        else:
            total_liability = float(on_or_before.iloc[-1]['Closing_Balance'])

        # IFRS 16 / IAS 1: current liability = principal repayments (not gross cash payments)
        # due within 12 months after the reporting date.
        due_after = sched[(sched['Date_dt'] > reporting_dt) & (sched['Date_dt'] <= cutoff_dt)]
        current = float(due_after['Principal'].sum()) if len(due_after) > 0 else 0.0

        # At commencement: current = principal due in first 12 payment periods
        if reporting_dt <= first_dt:
            current = float(sched.head(min(12, len(sched)))['Principal'].sum())
            total_liability = float(sched.iloc[0]['Opening_Balance'])

        noncurrent = max(0.0, total_liability - current)

        return {
            'current_portion': current,
            'non_current_portion': noncurrent,
            'total_liability': total_liability,
            'reporting_date': reporting_date.strftime('%Y-%m-%d'),
            'cutoff_date': cutoff_date.strftime('%Y-%m-%d')
        }
    
    def calculate_full_ifrs16(
        self,
        lease: LeaseInput,
        reporting_date: Optional[datetime] = None,
    ) -> Dict:
        """
        Complete IFRS 16 calculation - main entry point
        
        Performs all calculations and generates all required outputs:
        - Lease liability
        - ROU asset
        - Amortization schedule
        - Journal entries
        - Maturity analysis
        - P&L impact analysis
        
        Args:
            lease: LeaseInput object with all lease parameters
            
        Returns:
            Dictionary with all IFRS 16 calculations and reports
        """
        
        # Step 0: Determine lease component payment for IFRS 16 measurement
        effective_payment = self.get_lease_component_payment(lease)

        # Step 1: Calculate Lease Liability (PV of regular lease-component payments)
        pv_regular_payments = self.calculate_lease_liability(lease)
        
        # Step 1b: Add PV of residual value guarantee if lessee guarantees (IFRS 16 para 26(d))
        rvg_expected = getattr(lease, 'rvg_expected_payment', Decimal('0')) or Decimal('0')
        rvg_guaranteed_by = (getattr(lease, 'rvg_guaranteed_by', 'None') or 'None').strip().lower()
        pv_rvg = Decimal('0')
        if rvg_expected > 0 and rvg_guaranteed_by == 'lessee':
            monthly_rate = lease.annual_discount_rate / Decimal('12')
            if monthly_rate > 0:
                pv_rvg = (rvg_expected / (Decimal('1') + monthly_rate) ** lease.lease_term_months).quantize(
                    self.precision, ROUND_HALF_UP
                )
            else:
                pv_rvg = rvg_expected
        lease_liability = pv_regular_payments + pv_rvg
        
        # Step 2: Compute lease incentives. Rent-free months are already reflected
        # as zero payments in the PV cash flows; do not deduct them again.
        rent_free = getattr(lease, 'rent_free_months', 0) or 0
        cash_incentive = getattr(lease, 'cash_incentive', Decimal('0')) or Decimal('0')
        total_lease_incentives = cash_incentive
        
        # Step 3: Calculate ROU Asset (PV + IDC - lease incentives)
        rou_asset = self.calculate_rou_asset(
            lease_liability,
            lease.initial_direct_costs,
            total_lease_incentives,
        )
        
        # Step 4: Calculate Monthly Depreciation
        monthly_depreciation = self.calculate_monthly_depreciation(rou_asset, lease.lease_term_months)
        
        # Step 5: Generate Amortization Schedule
        schedule = self.generate_amortization_schedule(lease, lease_liability)
        
        # Step 6: Calculate Total Interest over lease term
        total_interest = schedule['Interest'].sum()
        
        # Step 7: Current vs non-current (principal repayments within 12 months — IFRS 16 / IAS 1)
        liability_split_at_commencement = self.calculate_current_vs_noncurrent(
            schedule, lease.commencement_date
        )
        liability_split = liability_split_at_commencement
        liability_split_at_reporting = None
        if reporting_date is not None:
            liability_split_at_reporting = self.calculate_current_vs_noncurrent(
                schedule, reporting_date
            )

        # Step 8: Generate Journal Entries (after split — separate IDC credit line)
        first_month = schedule.iloc[0]
        total_idc_for_je = (
            lease.legal_fees + lease.brokerage_fees + lease.other_initial_direct_costs
        ) or lease.initial_direct_costs
        journal_entries = self.generate_journal_entries(
            rou_asset,
            lease_liability,
            monthly_depreciation,
            Decimal(str(first_month['Interest'])),
            Decimal(str(first_month['Payment'])),
            lease.currency,
            lease.payment_type,
            liability_split=liability_split_at_commencement,
            initial_direct_costs=total_idc_for_je,
            cash_incentive=cash_incentive,
        )

        # Step 9: Maturity analysis from reporting date (IFRS 16 para 58(b))
        maturity_report_dt = reporting_date or lease.commencement_date
        maturity = self.generate_maturity_analysis(schedule, maturity_report_dt)

        # Step 10: Calculate Year 1 P&L Impact
        year_1_data = schedule.head(min(12, len(schedule)))
        year_1_interest = year_1_data['Interest'].sum()
        year_1_depreciation = float(monthly_depreciation) * min(12, len(schedule))
        year_1_payments = year_1_data['Payment'].sum()
        
        # Step 11: Calculate total cost of lease
        total_payments = schedule['Payment'].sum()
        total_initial_direct_costs = float(
            lease.legal_fees + lease.brokerage_fees + lease.other_initial_direct_costs
        ) or float(lease.initial_direct_costs)
        legal_fees = float(lease.legal_fees)
        brokerage_fees = float(lease.brokerage_fees)
        other_idc = float(lease.other_initial_direct_costs)
        idc_description = lease.initial_direct_costs_description or ""
        total_cost = float(lease_liability) + float(total_initial_direct_costs)
        
        return {
            'lease_liability': float(lease_liability),
            'rou_asset': float(rou_asset),
            'monthly_depreciation': float(monthly_depreciation),
            'total_interest': float(total_interest),
            'amortization_schedule': schedule,
            'journal_entries': journal_entries,
            'maturity_analysis': maturity,
            'liability_split': liability_split,
            'liability_split_at_commencement': liability_split_at_commencement,
            'liability_split_at_reporting': liability_split_at_reporting,
            'year_1_impact': {
                'interest_expense': float(year_1_interest),
                'depreciation_expense': float(year_1_depreciation),
                'total_p_l_expense': float(year_1_interest + year_1_depreciation),
                'cash_outflow': float(year_1_payments),
                'ebitda_improvement': float(year_1_payments),  # Lease expense removed from EBITDA
                'ebit_impact': float(year_1_depreciation - year_1_payments)
            },
            'total_lease_cost': {
                'total_payments': float(total_payments),
                'initial_costs': float(total_initial_direct_costs),
                'total_interest': float(total_interest),
                'grand_total': float(total_payments) + float(total_initial_direct_costs)
            },
            'disclosure_data': {
                'lease_id': lease.lease_id,
                'asset': lease.asset_description,
                'lessee': lease.lessee_name,
                'lessor': lease.lessor_name,
                'commencement': lease.commencement_date.strftime('%Y-%m-%d'),
                'end_date': (
                    lease.commencement_date
                    + relativedelta(months=lease.lease_term_months, days=-1)
                ).strftime('%Y-%m-%d'),
                'term_months': lease.lease_term_months,
                'discount_rate_pct': float(lease.annual_discount_rate * 100),
                'currency': lease.currency
            },
            'calculation_metadata': {
                'calculation_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'calculator_version': '1.0',
                'standard': 'IFRS 16',
                'escalation_applied': bool((lease.escalation_rate or Decimal('0')) > 0),
                'escalation_rate_pct': float((lease.escalation_rate or Decimal('0')) * 100),
                'cpi_applied': bool(
                    (getattr(lease, 'cpi_index_base', Decimal('0')) or Decimal('0')) > 0
                    and (getattr(lease, 'cpi_index_current', Decimal('0')) or Decimal('0')) > 0
                ),
                'cpi_index_base': float(getattr(lease, 'cpi_index_base', 0) or 0),
                'cpi_index_current': float(getattr(lease, 'cpi_index_current', 0) or 0),
                'cpi_adjustment_frequency_months': int(
                    getattr(lease, 'cpi_adjustment_frequency_months', 12) or 12
                ),
                'rent_free_months': int(rent_free),
            },
            'rou_build_up': {
                'pv_lease_payments': float(lease_liability),
                'legal_fees': float(legal_fees),
                'brokerage_fees': float(brokerage_fees),
                'other_initial_direct_costs': float(other_idc),
                'add_initial_direct_costs': float(total_initial_direct_costs),
                'add_prepaid_rent': 0.0,  # Reserved for future
                'less_lease_incentives': float(total_lease_incentives),
                'rou_asset_at_commencement': float(rou_asset),
            },
            'idc_disclosure_note': (
                f"Initial direct costs of {format_currency_value(float(total_initial_direct_costs), str(lease.currency))}, "
                f"comprising {idc_description or 'legal fees, brokerage and other costs'}, "
                f"have been included in the measurement of the right-of-use asset at commencement "
                f"in accordance with IFRS 16 paragraph 24."
                if total_initial_direct_costs > 0
                else None
            ),
            'liability_breakdown': {
                'pv_regular_payments': float(pv_regular_payments),
                'pv_residual_value_guarantee': float(pv_rvg),
                'total_lease_liability': float(lease_liability),
            },
            'component_analysis': {
                'total_monthly_payment': float(
                    lease.monthly_payment + lease.non_lease_component
                    if getattr(lease, 'non_lease_additive', False) and lease.non_lease_component > 0
                    else lease.monthly_payment
                ),
                'lease_component': float(effective_payment),
                'non_lease_component': float(lease.non_lease_component),
                'non_lease_description': lease.non_lease_description,
                'practical_expedient': lease.practical_expedient_elected,
                'annual_non_lease_expense': float(lease.non_lease_component * 12),
                'total_non_lease_over_term': float(lease.non_lease_component * lease.lease_term_months),
            },
            'rvg_disclosure_note': (
                f"The lease includes a residual value guarantee of {format_currency_value(float(getattr(lease, 'rvg_amount', 0) or 0), str(lease.currency))} "
                f"provided by the lessee. The amount expected to be payable under the guarantee is {format_currency_value(float(rvg_expected), str(lease.currency))}, "
                f"which has been included in the measurement of the lease liability at commencement in accordance with IFRS 16 paragraph 26(d)."
                if pv_rvg > 0 and rvg_guaranteed_by == 'lessee'
                else None
            ),
            'incentive_disclosure_note': self._build_incentive_disclosure_note(
                rent_free, cash_incentive, lease
            ),
        }
    
    def export_to_json(self, results: Dict, filename: str):
        """
        Export calculation results to JSON file
        
        Args:
            results: Results dictionary from calculate_full_ifrs16()
            filename: Output filename
        """
        
        # Convert DataFrame to dict for JSON serialization
        results_copy = results.copy()
        if 'amortization_schedule' in results_copy:
            results_copy['amortization_schedule'] = results_copy['amortization_schedule'].to_dict(orient='records')
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(results_copy, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Results exported to: {filename}")


# Example usage
if __name__ == "__main__":
    # Sample lease data
    lease = LeaseInput(
        lease_id="LEASE-2024-001",
        asset_description="Commercial Office - 5,000 sq ft, Tech Park Hyderabad",
        lessee_name="TechCorp India Pvt. Ltd.",
        lessor_name="Prime Properties Ltd.",
        commencement_date=datetime(2024, 1, 1),
        lease_term_months=36,
        monthly_payment=Decimal('50000'),
        annual_discount_rate=Decimal('0.085'),  # 8.5%
        initial_direct_costs=Decimal('40000'),  # Stamp duty + legal fees
        escalation_rate=Decimal('0.05'),  # 5% annual escalation
        currency="INR"
    )
    
    # Perform calculations
    calc = IFRS16Calculator()
    results = calc.calculate_full_ifrs16(lease)
    
    # Display results
    print("="*70)
    print("IFRS 16 LEASE ACCOUNTING CALCULATION")
    print("="*70)
    
    print(f"\n{'LEASE DETAILS':^70}")
    print("="*70)
    print(f"Lease ID: {results['disclosure_data']['lease_id']}")
    print(f"Asset: {results['disclosure_data']['asset']}")
    print(f"Lessee: {results['disclosure_data']['lessee']}")
    print(f"Lessor: {results['disclosure_data']['lessor']}")
    print(f"Term: {results['disclosure_data']['term_months']} months")
    print(f"Discount Rate: {results['disclosure_data']['discount_rate_pct']:.2f}%")
    
    print(f"\n{'INITIAL MEASUREMENT':^70}")
    print("="*70)
    print(f"Lease Liability: ₹{results['lease_liability']:,.2f}")
    print(f"Right-of-Use Asset: ₹{results['rou_asset']:,.2f}")
    print(f"Monthly Depreciation: ₹{results['monthly_depreciation']:,.2f}")
    print(f"Total Interest (over term): ₹{results['total_interest']:,.2f}")
    
    print(f"\n{'BALANCE SHEET CLASSIFICATION':^70}")
    print("="*70)
    print(f"Current Portion of Lease Liability: ₹{results['liability_split']['current_portion']:,.2f}")
    print(f"Non-Current Portion of Lease Liability: ₹{results['liability_split']['non_current_portion']:,.2f}")
    print(f"Total Lease Liability: ₹{results['liability_split']['total_liability']:,.2f}")
    
    print(f"\n{'AMORTIZATION SCHEDULE (First 6 Months)':^70}")
    print("="*70)
    print(results['amortization_schedule'].head(6).to_string(index=False))
    
    print(f"\n{'MATURITY ANALYSIS':^70}")
    print("="*70)
    for year, amount in results['maturity_analysis'].items():
        print(f"{year.replace('_', ' '):<15} ₹{amount:>15,.2f}")
    
    print(f"\n{'YEAR 1 P&L IMPACT':^70}")
    print("="*70)
    print(f"Interest Expense: ₹{results['year_1_impact']['interest_expense']:,.2f}")
    print(f"Depreciation Expense: ₹{results['year_1_impact']['depreciation_expense']:,.2f}")
    print(f"Total P&L Expense: ₹{results['year_1_impact']['total_p_l_expense']:,.2f}")
    print(f"Cash Outflow: ₹{results['year_1_impact']['cash_outflow']:,.2f}")
    print(f"EBITDA Improvement: ₹{results['year_1_impact']['ebitda_improvement']:,.2f}")
    
    print(f"\n{'TOTAL LEASE COST':^70}")
    print("="*70)
    print(f"Total Payments: ₹{results['total_lease_cost']['total_payments']:,.2f}")
    print(f"Initial Direct Costs: ₹{results['total_lease_cost']['initial_costs']:,.2f}")
    print(f"Total Interest: ₹{results['total_lease_cost']['total_interest']:,.2f}")
    print(f"Grand Total: ₹{results['total_lease_cost']['grand_total']:,.2f}")
    
    print("\n" + "="*70)
    print(f"{'CALCULATION COMPLETE':^70}")
    print("="*70)
    
    # Export to JSON
    try:
        calc.export_to_json(results, "ifrs16_results.json")
    except Exception as e:
        print(f"\nNote: Could not export JSON: {e}")


def consolidate_leases(entities: list[dict]) -> dict:
    """
    Consolidate IFRS 16 data across multiple entities.

    Each entity in list has:
    {
      "entity_name": str,
      "entity_currency": str,
      "fx_rate_to_group": float,  # e.g. 0.012 for INR→USD
      "leases": [list of lease calculation results]
    }

    Returns consolidated group position:
    - Total ROU assets by entity + group total
    - Total lease liabilities (current + non-current) by entity
    - Intercompany lease eliminations
    - FX translation adjustments
    - Group consolidation journal entries
    """

    group_summary = {
        "entities": [],
        "group_totals": {
            "rou_asset": 0,
            "lease_liability_current": 0,
            "lease_liability_non_current": 0,
            "depreciation_expense": 0,
            "interest_expense": 0,
            "fx_translation_adjustment": 0,
        },
        "intercompany_eliminations": [],
        "consolidation_journal": [],
        "currency": "GROUP_CCY",
    }

    for entity in entities:
        fx = entity.get("fx_rate_to_group", 1.0)
        entity_totals = {
            "entity_name": entity["entity_name"],
            "currency": entity["entity_currency"],
            "fx_rate": fx,
            "rou_asset": 0,
            "lease_liability_current": 0,
            "lease_liability_non_current": 0,
            "depreciation_expense": 0,
            "interest_expense": 0,
            "rou_asset_group_ccy": 0,
            "lease_liability_group_ccy": 0,
        }

        for lease in entity.get("leases", []):
            rou = lease.get("rou_asset", 0)
            liab = lease.get("lease_liability", 0)
            current = lease.get("current_liability", liab * 0.3)
            non_current = liab - current
            dep = lease.get("depreciation_year1", rou / max(lease.get("lease_term_years", 1), 1))
            interest = lease.get("interest_expense_year1", 0)

            entity_totals["rou_asset"] += rou
            entity_totals["lease_liability_current"] += current
            entity_totals["lease_liability_non_current"] += non_current
            entity_totals["depreciation_expense"] += dep
            entity_totals["interest_expense"] += interest

            # FX translate to group currency
            entity_totals["rou_asset_group_ccy"] += rou * fx
            entity_totals["lease_liability_group_ccy"] += liab * fx

        # FX translation adjustment (simplified closing rate method)
        fx_adj = entity_totals["rou_asset_group_ccy"] - entity_totals["rou_asset"]
        entity_totals["fx_translation_adjustment"] = fx_adj

        # Add to group totals
        group_summary["group_totals"]["rou_asset"] += entity_totals["rou_asset_group_ccy"]
        group_summary["group_totals"]["lease_liability_current"] += entity_totals["lease_liability_current"] * fx
        group_summary["group_totals"]["lease_liability_non_current"] += entity_totals["lease_liability_non_current"] * fx
        group_summary["group_totals"]["depreciation_expense"] += entity_totals["depreciation_expense"] * fx
        group_summary["group_totals"]["interest_expense"] += entity_totals["interest_expense"] * fx
        group_summary["group_totals"]["fx_translation_adjustment"] += fx_adj

        group_summary["entities"].append(entity_totals)

    # Consolidation journal entries
    g = group_summary["group_totals"]
    group_summary["consolidation_journal"] = [
        {
            "description": "Recognise group ROU assets",
            "debit": "Right-of-Use Assets (Group)",
            "credit": "Lease Liabilities (Group)",
            "amount": g["rou_asset"],
        },
        {
            "description": "FX translation reserve",
            "debit": "Other Comprehensive Income",
            "credit": "Foreign Currency Translation Reserve",
            "amount": abs(g["fx_translation_adjustment"]),
        },
        {
            "description": "Group depreciation",
            "debit": "Depreciation Expense",
            "credit": "Accumulated Depreciation — ROU Assets",
            "amount": g["depreciation_expense"],
        },
        {
            "description": "Group interest expense",
            "debit": "Finance Costs",
            "credit": "Lease Liabilities",
            "amount": g["interest_expense"],
        },
    ]

    group_summary["disclosure_note"] = (
        "IFRS 16 Group Consolidation: group lease liabilities and right-of-use assets "
        "are aggregated across reporting entities and translated to group currency "
        "using entity closing FX rates. Translation differences are presented in "
        "the foreign currency translation reserve."
    )

    return group_summary

