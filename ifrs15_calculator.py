"""
IFRS 15 Revenue Recognition Calculator
5-step revenue recognition model implementation
"""

import pandas as pd
import numpy as np
from datetime import datetime
from dateutil.relativedelta import relativedelta
from decimal import Decimal, ROUND_HALF_UP
from dataclasses import dataclass, field
from typing import Dict, List, Optional
import json


@dataclass
class PerformanceObligation:
    """Individual performance obligation"""
    obligation_id: str
    description: str
    standalone_selling_price: Decimal
    recognition_method: str  # "over_time" or "point_in_time"
    duration_months: int = 0  # For over-time recognition
    transfer_date: Optional[datetime] = None  # For point-in-time
    completion_percentage: Decimal = Decimal('0')  # For over-time custom %


@dataclass
class IFRS15Input:
    """IFRS 15 contract input"""
    contract_id: str
    customer_name: str
    vendor_name: str = ""
    effective_date: datetime = datetime.now()
    contract_term_months: int = 12
    fixed_consideration: Decimal = Decimal('0')
    variable_consideration: Decimal = Decimal('0')
    # IFRS 15 §56-58 — variable consideration constraint
    variable_consideration_constrained: Decimal = Decimal('0')   # override; 0 = not set, use pct
    constraint_percentage: Decimal = Decimal('100')               # % of VC that is "highly probable" (0–100)
    constraint_method: str = "percentage"                         # "percentage" | "amount"
    discounts: Decimal = Decimal('0')
    rebates: Decimal = Decimal('0')
    financing_adjustment: Decimal = Decimal('0')
    currency: str = "USD"
    performance_obligations: List[PerformanceObligation] = field(default_factory=list)
    contract_type: str = "fixed_price"
    # T&M fields
    hourly_rate: Decimal = Decimal('0')
    hours_worked: Decimal = Decimal('0')
    # Capped T&M fields
    tm_cap: Decimal = Decimal('0')
    cumulative_billed: Decimal = Decimal('0')
    # POC fields (Fixed Price)
    total_estimated_cost: Decimal = Decimal('0')
    actual_cost_to_date: Decimal = Decimal('0')
    prior_revenue_recognised: Decimal = Decimal('0')
    # Maintenance
    maintenance_term_months: int = 0
    # Variable consideration extras
    volume_slabs: List[Dict] = field(default_factory=list)
    estimated_annual_volume: Decimal = Decimal('0')
    can_estimate_volume: bool = True
    sla_items: List[Dict] = field(default_factory=list)


class IFRS15Calculator:
    """IFRS 15 5-step revenue recognition calculator"""
    
    def __init__(self):
        self.precision = Decimal('0.01')

    def calculate_revenue_by_type(self, contract: IFRS15Input) -> Dict:
        """
        Route to correct revenue method based on contract_type.
        """
        if contract.contract_type == "time_and_material":
            return self._calc_tm(contract)
        elif contract.contract_type == "fixed_price":
            return self._calc_poc(contract)
        elif contract.contract_type == "capped_tm":
            return self._calc_capped_tm(contract)
        elif contract.contract_type == "maintenance":
            return self._calc_maintenance(contract)
        return self._calc_poc(contract)

    def _calc_tm(self, c: IFRS15Input) -> Dict:
        """T&M: Revenue = Hours × Rate"""
        revenue = c.hours_worked * c.hourly_rate
        return {
            "method": "Time & Material",
            "revenue_this_period": float(revenue),
            "poc_percentage": None,
            "remaining_revenue": None,
        }

    def _calc_poc(self, c: IFRS15Input) -> Dict:
        """
        POC: Revenue = (Actual Cost / Total Cost) × Contract Value − Prior Revenue
        IFRS 15 §39 — input method.
        """
        if c.total_estimated_cost <= 0:
            return {
                "method": "Fixed Price (POC)",
                "revenue_this_period": 0,
                "poc_percentage": 0,
                "error": "Total estimated cost required"
            }

        poc_pct = float(c.actual_cost_to_date / c.total_estimated_cost)
        poc_pct = min(poc_pct, 1.0)

        total_contract = c.fixed_consideration + c.variable_consideration
        cumulative_revenue = Decimal(str(poc_pct)) * total_contract
        period_revenue = max(
            Decimal('0'),
            cumulative_revenue - c.prior_revenue_recognised
        )
        remaining = total_contract - cumulative_revenue
        expected_loss = max(
            Decimal('0'),
            c.total_estimated_cost - total_contract
        )

        return {
            "method": "Fixed Price (POC)",
            "poc_percentage": round(poc_pct * 100, 2),
            "cumulative_revenue": float(cumulative_revenue),
            "revenue_this_period": float(period_revenue),
            "remaining_revenue": float(remaining),
            "onerous_contract": expected_loss > 0,
            "expected_loss": float(expected_loss),
            "formula": (
                f"POC {poc_pct*100:.1f}% × "
                f"${float(total_contract):,.0f} = "
                f"${float(cumulative_revenue):,.0f}"
            ),
        }

    def _calc_capped_tm(self, c: IFRS15Input) -> Dict:
        """
        Capped T&M:
        If cumulative billing < cap → use T&M
        If cumulative billing ≥ cap → switch to POC
        """
        tm_revenue = c.hours_worked * c.hourly_rate
        projected_total = c.cumulative_billed + tm_revenue

        if c.tm_cap <= 0 or projected_total < c.tm_cap:
            return {
                "method": "Capped T&M (T&M mode)",
                "revenue_this_period": float(tm_revenue),
                "cap_utilised_pct": float(projected_total / c.tm_cap * 100) if c.tm_cap > 0 else 0,
                "cap_remaining": float(c.tm_cap - projected_total),
                "switched_to_poc": False,
            }
        poc = self._calc_poc(c)
        poc["method"] = "Capped T&M (POC mode)"
        poc["switched_to_poc"] = True
        poc["cap_exceeded_by"] = float(projected_total - c.tm_cap)
        return poc

    def _calc_maintenance(self, c: IFRS15Input) -> Dict:
        """
        Maintenance: Straight-line unless evidence of different pattern.
        IFRS 15 §39 — output method.
        """
        total = c.fixed_consideration + c.variable_consideration
        months = c.maintenance_term_months or c.contract_term_months
        if months <= 0:
            months = 12
        monthly = total / Decimal(str(months))
        return {
            "method": "Maintenance (Straight-line)",
            "monthly_revenue": float(monthly),
            "term_months": months,
            "total_contract_value": float(total),
            "revenue_this_period": float(monthly),
        }

    def apply_volume_discount(
        self,
        base_revenue: Decimal,
        volume_slabs: list,
        estimated_annual_volume: Decimal,
        can_estimate_volume: bool = True
    ) -> Dict:
        """
        Applies volume-based discount per slab table.
        If cannot estimate → use max discount.
        """
        if not volume_slabs:
            return {
                "discounted_revenue": float(base_revenue),
                "discount_pct": 0,
                "discount_amount": 0
            }

        if not can_estimate_volume:
            max_discount = max(s.get("discount_pct", 0) for s in volume_slabs)
            discount = base_revenue * Decimal(str(max_discount / 100))
            return {
                "discounted_revenue": float(base_revenue - discount),
                "discount_pct": max_discount,
                "discount_amount": float(discount),
                "note": "Max discount applied — volume not estimable"
            }

        applicable_discount = 0
        for slab in sorted(volume_slabs, key=lambda x: x.get("min_volume", 0)):
            if estimated_annual_volume >= Decimal(str(slab.get("min_volume", 0))):
                applicable_discount = slab.get("discount_pct", 0)

        discount = base_revenue * Decimal(str(applicable_discount / 100))
        return {
            "discounted_revenue": float(base_revenue - discount),
            "discount_pct": applicable_discount,
            "discount_amount": float(discount),
        }

    def calculate_sla_penalties(self, sla_items: list) -> Dict:
        """
        Calculates SLA credits/penalties.
        These reduce revenue (negative revenue).
        """
        total_penalty = Decimal('0')
        details = []

        for sla in sla_items:
            target = sla.get("target", 0)
            actual = sla.get("actual", 0)
            monthly_fee = Decimal(str(sla.get("monthly_fee", 0)))
            multiplier = Decimal(str(sla.get("penalty_multiplier", 1)))

            if actual < target:
                breach_pct = Decimal(str(abs(target - actual) / 100))
                penalty = monthly_fee * breach_pct * multiplier
                total_penalty += penalty
                details.append({
                    "sla_name": sla.get("name", ""),
                    "target": target,
                    "actual": actual,
                    "breach": True,
                    "penalty": float(penalty),
                })
            else:
                details.append({
                    "sla_name": sla.get("name", ""),
                    "breach": False,
                    "penalty": 0,
                })

        return {
            "total_penalty": float(total_penalty),
            "net_revenue_impact": float(-total_penalty),
            "sla_details": details,
        }

    def check_onerous(
        self,
        total_contract_value: Decimal,
        total_estimated_cost: Decimal
    ) -> Dict:
        """
        IAS 37: If costs exceed revenue — recognise full loss immediately.
        """
        if total_estimated_cost > total_contract_value:
            loss = total_estimated_cost - total_contract_value
            return {
                "is_onerous": True,
                "expected_loss": float(loss),
                "provision_required": float(loss),
                "journal": {
                    "debit": "Onerous Contract Expense",
                    "credit": "Onerous Contract Provision",
                    "amount": float(loss),
                    "note": "Full loss recognised immediately per IAS 37"
                }
            }
        return {"is_onerous": False, "expected_loss": 0}

    def apply_variable_consideration_constraint(self, contract: IFRS15Input) -> Decimal:
        """
        IFRS 15 §56–58: Include variable consideration only to the extent that
        it is highly probable a significant revenue reversal will not occur.

        Two modes:
        - "amount":     use contract.variable_consideration_constrained directly
        - "percentage": constrained = variable_consideration × (constraint_percentage / 100)

        Returns the constrained variable consideration amount.
        """
        vc = contract.variable_consideration

        if contract.constraint_method == "amount" and contract.variable_consideration_constrained > 0:
            # Caller explicitly provided the constrained amount — cap it at raw VC
            return min(contract.variable_consideration_constrained, vc)

        # Percentage method (default)
        pct = max(Decimal("0"), min(Decimal("100"), contract.constraint_percentage))
        return (vc * pct / Decimal("100")).quantize(Decimal("0.01"))
    
    def calculate_transaction_price(self, contract: IFRS15Input) -> Decimal:
        """
        IFRS 15 Step 3: Determine transaction price.
        Variable consideration is constrained per §56–58 before inclusion.
        """
        constrained_vc = self.apply_variable_consideration_constraint(contract)

        transaction_price = (
            contract.fixed_consideration
            + constrained_vc
            - contract.discounts
            - contract.rebates
            + contract.financing_adjustment
        )
        return max(Decimal("0"), transaction_price)
    
    def allocate_transaction_price(
        self, 
        transaction_price: Decimal, 
        obligations: List[PerformanceObligation]
    ) -> Dict[str, Decimal]:
        """
        Step 4: Allocate transaction price to performance obligations
        
        Uses relative standalone selling price method (IFRS 15.76-80)
        
        Args:
            transaction_price: Total transaction price
            obligations: List of performance obligations
            
        Returns:
            Dictionary mapping obligation_id to allocated amount
        """
        
        if not obligations:
            raise ValueError("No performance obligations provided")
        
        # Calculate total SSP
        total_ssp = sum(ob.standalone_selling_price for ob in obligations)
        
        if total_ssp == 0:
            raise ValueError("Total standalone selling prices cannot be zero")
        
        # Allocate proportionally
        allocations = {}
        allocated_so_far = Decimal('0')
        
        for i, ob in enumerate(obligations):
            if i == len(obligations) - 1:
                # Last obligation gets remaining amount (avoid rounding errors)
                allocated = transaction_price - allocated_so_far
            else:
                allocation_pct = ob.standalone_selling_price / total_ssp
                allocated = (transaction_price * allocation_pct).quantize(
                    self.precision, ROUND_HALF_UP
                )
            
            allocations[ob.obligation_id] = allocated
            allocated_so_far += allocated
        
        return allocations
    
    def generate_recognition_schedule(
        self,
        contract: IFRS15Input,
        allocations: Dict[str, Decimal]
    ) -> pd.DataFrame:
        """
        Step 5: Generate revenue recognition schedule
        
        For each obligation:
        - Over time: Linear allocation over duration
        - Point in time: Full recognition on transfer date
        
        Args:
            contract: IFRS15Input
            allocations: Allocated amounts by obligation
            
        Returns:
            DataFrame with monthly revenue recognition
        """
        
        schedule = []
        current_date = contract.effective_date
        
        for month in range(1, contract.contract_term_months + 1):
            month_date = current_date + relativedelta(months=month - 1)
            
            for ob in contract.performance_obligations:
                allocated_amount = allocations[ob.obligation_id]
                
                if ob.recognition_method == "over_time":
                    # Linear recognition over duration
                    if ob.duration_months > 0 and month <= ob.duration_months:
                        monthly_revenue = (allocated_amount / Decimal(str(ob.duration_months))).quantize(
                            self.precision, ROUND_HALF_UP
                        )
                    else:
                        monthly_revenue = Decimal('0')
                
                elif ob.recognition_method == "point_in_time":
                    # Full recognition on transfer date
                    if ob.transfer_date and month_date.month == ob.transfer_date.month and month_date.year == ob.transfer_date.year:
                        monthly_revenue = allocated_amount
                    else:
                        monthly_revenue = Decimal('0')
                
                else:
                    monthly_revenue = Decimal('0')
                
                if monthly_revenue > 0:
                    schedule.append({
                        'Period': month,
                        'Date': month_date.strftime('%Y-%m-%d'),
                        'Month': month_date.strftime('%b %Y'),
                        'Obligation_ID': ob.obligation_id,
                        'Obligation': ob.description,
                        'Method': ob.recognition_method.replace('_', ' ').title(),
                        'Revenue': float(monthly_revenue),
                        'Cumulative': 0  # Will calculate below
                    })
        
        df = pd.DataFrame(schedule)
        
        if not df.empty:
            # Calculate cumulative revenue per obligation
            for ob in contract.performance_obligations:
                ob_mask = df['Obligation_ID'] == ob.obligation_id
                df.loc[ob_mask, 'Cumulative'] = df.loc[ob_mask, 'Revenue'].cumsum()
        
        return df
    
    def calculate_contract_balances(
        self,
        allocations: Dict[str, Decimal],
        recognition_schedule: pd.DataFrame,
        cash_received: Decimal = Decimal('0')
    ) -> Dict:
        """
        Calculate contract asset/liability balances
        
        Contract Asset: Revenue recognized > Cash received
        Contract Liability: Cash received > Revenue recognized
        
        Args:
            allocations: Allocated amounts
            recognition_schedule: Revenue schedule
            cash_received: Cash received to date
            
        Returns:
            Dictionary with balance sheet items
        """
        
        total_allocated = sum(allocations.values())
        total_recognized = Decimal(str(recognition_schedule['Revenue'].sum())) if not recognition_schedule.empty else Decimal('0')
        
        contract_balance = total_recognized - cash_received
        
        return {
            'total_transaction_price': float(total_allocated),
            'revenue_recognized_to_date': float(total_recognized),
            'cash_received_to_date': float(cash_received),
            'contract_balance': float(contract_balance),
            'is_contract_asset': contract_balance > 0,  # Recognized > Received
            'is_contract_liability': contract_balance < 0,  # Received > Recognized
            'contract_asset_amount': float(max(contract_balance, Decimal('0'))),
            'contract_liability_amount': float(abs(min(contract_balance, Decimal('0'))))
        }
    
    def generate_journal_entries(
        self,
        monthly_revenue: Decimal,
        cash_received: Decimal,
        is_contract_asset: bool,
        currency: str = "USD"
    ) -> Dict:
        """
        Generate accounting journal entries
        
        Args:
            monthly_revenue: Revenue for the period
            cash_received: Cash received in the period
            is_contract_asset: Whether it's a contract asset or liability
            currency: Currency code
            
        Returns:
            Dictionary of journal entries
        """
        
        currency_symbol = "$" if currency == "USD" else "₹" if currency == "INR" else currency
        
        entries = {}
        
        # Revenue recognition entry
        if monthly_revenue > 0:
            if is_contract_asset:
                entries['revenue_recognition'] = {
                    'description': 'Revenue recognition (Contract Asset)',
                    'entries': [
                        {
                            'account': 'Contract Asset',
                            'account_type': 'Current Asset',
                            'dr': float(monthly_revenue),
                            'cr': 0,
                            'narration': 'Revenue recognized but not yet billed'
                        },
                        {
                            'account': 'Revenue',
                            'account_type': 'Income (P&L)',
                            'dr': 0,
                            'cr': float(monthly_revenue),
                            'narration': 'IFRS 15 revenue recognition'
                        }
                    ]
                }
            else:
                entries['revenue_recognition'] = {
                    'description': 'Revenue recognition (Contract Liability)',
                    'entries': [
                        {
                            'account': 'Contract Liability',
                            'account_type': 'Current Liability',
                            'dr': float(monthly_revenue),
                            'cr': 0,
                            'narration': 'Reduction of deferred revenue'
                        },
                        {
                            'account': 'Revenue',
                            'account_type': 'Income (P&L)',
                            'dr': 0,
                            'cr': float(monthly_revenue),
                            'narration': 'IFRS 15 revenue recognition'
                        }
                    ]
                }
        
        # Cash receipt entry
        if cash_received > 0:
            entries['cash_receipt'] = {
                'description': 'Cash receipt from customer',
                'entries': [
                    {
                        'account': 'Cash/Bank',
                        'account_type': 'Current Asset',
                        'dr': float(cash_received),
                        'cr': 0,
                        'narration': 'Payment received from customer'
                    },
                    {
                        'account': 'Contract Liability' if not is_contract_asset else 'Accounts Receivable',
                        'account_type': 'Current Liability' if not is_contract_asset else 'Current Asset',
                        'dr': 0,
                        'cr': float(cash_received),
                        'narration': 'Customer payment received'
                    }
                ]
            }
        
        return entries
    
    def generate_disclosure_data(
        self,
        contract: IFRS15Input,
        allocations: Dict[str, Decimal],
        recognition_schedule: pd.DataFrame
    ) -> Dict:
        """
        Generate IFRS 15 disclosure data
        
        Args:
            contract: IFRS15Input
            allocations: Allocated amounts
            recognition_schedule: Revenue schedule
            
        Returns:
            Dictionary with disclosure information
        """
        
        # Revenue by obligation
        revenue_by_obligation = []
        for ob in contract.performance_obligations:
            if not recognition_schedule.empty:
                ob_schedule = recognition_schedule[recognition_schedule['Obligation_ID'] == ob.obligation_id]
                recognized = float(ob_schedule['Revenue'].sum()) if not ob_schedule.empty else 0.0
            else:
                recognized = 0.0
            
            allocated = float(allocations[ob.obligation_id])
            
            revenue_by_obligation.append({
                'obligation_id': ob.obligation_id,
                'obligation': ob.description,
                'recognition_method': ob.recognition_method,
                'allocated_amount': allocated,
                'revenue_recognized': recognized,
                'remaining': allocated - recognized
            })
        
        # Remaining performance obligations
        total_remaining = sum(item['remaining'] for item in revenue_by_obligation)
        
        disclosure = {
            'contract_details': {
                'contract_id': contract.contract_id,
                'customer': contract.customer_name,
                'vendor': contract.vendor_name,
                'effective_date': contract.effective_date.strftime('%Y-%m-%d'),
                'term_months': contract.contract_term_months,
                'currency': contract.currency
            },
            'transaction_price_components': {
                'fixed_consideration': float(contract.fixed_consideration),
                'variable_consideration': float(contract.variable_consideration),
                'discounts': float(contract.discounts),
                'rebates': float(contract.rebates),
                'financing_adjustment': float(contract.financing_adjustment),
                'total': float(self.calculate_transaction_price(contract))
            },
            'performance_obligations': revenue_by_obligation,
            'remaining_performance_obligations': {
                'total_remaining': total_remaining,
                'disclosure_note': f'Revenue of {contract.currency} {total_remaining:,.2f} expected to be recognized over remaining contract term'
            }
        }
        
        return disclosure
    
    def calculate_full_ifrs15(self, contract: IFRS15Input, cash_received: Decimal = Decimal('0')) -> Dict:
        """
        Execute full IFRS 15 5-step model
        
        Args:
            contract: IFRS15Input with all contract details
            cash_received: Cash received to date (optional)
            
        Returns:
            Complete calculation results
        """
        
        if not contract.performance_obligations:
            raise ValueError("No performance obligations defined")
        
        # Contract-type revenue engine and overlays
        revenue_engine_result = self.calculate_revenue_by_type(contract)
        base_period_revenue = Decimal(str(revenue_engine_result.get("revenue_this_period", 0)))
        volume_result = self.apply_volume_discount(
            base_revenue=base_period_revenue,
            volume_slabs=contract.volume_slabs,
            estimated_annual_volume=contract.estimated_annual_volume,
            can_estimate_volume=contract.can_estimate_volume,
        )
        sla_result = self.calculate_sla_penalties(contract.sla_items)
        net_period_revenue = Decimal(str(volume_result.get("discounted_revenue", 0))) - Decimal(
            str(sla_result.get("total_penalty", 0))
        )
        revenue_engine_result["revenue_after_discounts_and_sla"] = float(net_period_revenue)
        onerous_check = self.check_onerous(
            contract.fixed_consideration + contract.variable_consideration,
            contract.total_estimated_cost
        ) if contract.contract_type in ("fixed_price", "capped_tm") else {"is_onerous": False, "expected_loss": 0}

        # Step 1: Identify contract (assumed valid input)
        # Step 2: Identify performance obligations (in input)
        constrained_vc = self.apply_variable_consideration_constraint(contract)
        vc_reversed = contract.variable_consideration - constrained_vc   # amount excluded
        
        # Step 3: Determine transaction price
        transaction_price = self.calculate_transaction_price(contract)
        
        # Step 4: Allocate transaction price
        allocations = self.allocate_transaction_price(
            transaction_price, 
            contract.performance_obligations
        )
        
        # Step 5: Recognize revenue
        recognition_schedule = self.generate_recognition_schedule(
            contract, 
            allocations
        )
        
        # Calculate contract balances
        balances = self.calculate_contract_balances(allocations, recognition_schedule, cash_received)
        
        # Generate journal entries (example for first month)
        if not recognition_schedule.empty:
            first_month_revenue = Decimal(str(recognition_schedule.head(1)['Revenue'].sum()))
        else:
            first_month_revenue = Decimal('0')
        
        journal_entries = self.generate_journal_entries(
            first_month_revenue,
            cash_received,
            balances['is_contract_asset'],
            contract.currency
        )
        
        # Generate disclosure data
        disclosure = self.generate_disclosure_data(contract, allocations, recognition_schedule)
        
        return {
            'transaction_price': float(transaction_price),
            'variable_consideration_analysis': {
                'raw_variable_consideration': float(contract.variable_consideration),
                'constraint_method': contract.constraint_method,
                'constraint_percentage': float(contract.constraint_percentage),
                'constrained_variable_consideration': float(constrained_vc),
                'amount_excluded_by_constraint': float(vc_reversed),
                'amount_excluded': float(vc_reversed),
                'constraint_applied': vc_reversed > 0,
            },
            'allocations': {k: float(v) for k, v in allocations.items()},
            'recognition_schedule': recognition_schedule,
            'contract_balances': balances,
            'journal_entries': journal_entries,
            'disclosure_data': disclosure,
            'revenue_engine_result': revenue_engine_result,
            'volume_discount_result': volume_result,
            'sla_result': sla_result,
            'onerous_check': onerous_check,
            'validation': {
                'total_allocated': float(sum(allocations.values())),
                'allocation_matches_transaction_price': abs(sum(allocations.values()) - transaction_price) < Decimal('0.01'),
                'obligations_count': len(contract.performance_obligations)
            },
            'calculation_metadata': {
                'calculation_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'standard': 'IFRS 15'
            }
        }
    
    def export_to_json(self, results: Dict, filename: str):
        """Export results to JSON file"""
        results_copy = results.copy()
        if 'recognition_schedule' in results_copy:
            results_copy['recognition_schedule'] = results_copy['recognition_schedule'].to_dict(orient='records')
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(results_copy, f, indent=2, ensure_ascii=False)
        
        print(f"Results exported to: {filename}")


# Example usage
if __name__ == "__main__":
    # Sample software contract (from extracted data)
    contract = IFRS15Input(
        contract_id="CONTRACT-2024-001",
        customer_name="ABC Corporation",
        vendor_name="TechSoft Solutions Ltd.",
        effective_date=datetime(2024, 1, 1),
        contract_term_months=12,
        fixed_consideration=Decimal('750000'),
        variable_consideration=Decimal('20000'),  # Customer satisfaction bonus
        discounts=Decimal('0'),
        rebates=Decimal('0'),
        financing_adjustment=Decimal('0'),
        currency="USD",
        performance_obligations=[
            PerformanceObligation(
                obligation_id="PO-1",
                description="Software License",
                standalone_selling_price=Decimal('500000'),
                recognition_method="point_in_time",
                transfer_date=datetime(2024, 1, 1)
            ),
            PerformanceObligation(
                obligation_id="PO-2",
                description="Implementation Services",
                standalone_selling_price=Decimal('150000'),
                recognition_method="over_time",
                duration_months=6
            ),
            PerformanceObligation(
                obligation_id="PO-3",
                description="Technical Support (Year 1)",
                standalone_selling_price=Decimal('75000'),
                recognition_method="over_time",
                duration_months=12
            ),
            PerformanceObligation(
                obligation_id="PO-4",
                description="Training Services",
                standalone_selling_price=Decimal('25000'),
                recognition_method="point_in_time",
                transfer_date=datetime(2024, 7, 1)
            )
        ]
    )
    
    calc = IFRS15Calculator()
    results = calc.calculate_full_ifrs15(contract, cash_received=Decimal('250000'))
    
    print("="*70)
    print("IFRS 15 REVENUE RECOGNITION CALCULATION")
    print("="*70)
    
    print(f"\n1. TRANSACTION PRICE")
    print(f"   Total: ${results['transaction_price']:,.2f}")
    
    print(f"\n2. ALLOCATION TO PERFORMANCE OBLIGATIONS")
    for ob_id, amount in results['allocations'].items():
        print(f"   {ob_id}: ${amount:,.2f}")
    
    print(f"\n3. REVENUE RECOGNITION SCHEDULE (First 10 entries)")
    if not results['recognition_schedule'].empty:
        print(results['recognition_schedule'].head(10).to_string(index=False))
    
    print(f"\n4. CONTRACT BALANCES")
    print(f"   Total Transaction Price: ${results['contract_balances']['total_transaction_price']:,.2f}")
    print(f"   Revenue Recognized: ${results['contract_balances']['revenue_recognized_to_date']:,.2f}")
    print(f"   Cash Received: ${results['contract_balances']['cash_received_to_date']:,.2f}")
    print(f"   Contract Balance: ${results['contract_balances']['contract_balance']:,.2f}")
    if results['contract_balances']['is_contract_liability']:
        print(f"   → Contract Liability (Deferred Revenue): ${results['contract_balances']['contract_liability_amount']:,.2f}")
    elif results['contract_balances']['is_contract_asset']:
        print(f"   → Contract Asset (Unbilled): ${results['contract_balances']['contract_asset_amount']:,.2f}")
    
    print(f"\n5. DISCLOSURE DATA - REVENUE BY OBLIGATION")
    for item in results['disclosure_data']['performance_obligations']:
        print(f"   {item['obligation']}:")
        print(f"     Method: {item['recognition_method']}")
        print(f"     Allocated: ${item['allocated_amount']:,.2f}")
        print(f"     Recognized: ${item['revenue_recognized']:,.2f}")
        print(f"     Remaining: ${item['remaining']:,.2f}")

