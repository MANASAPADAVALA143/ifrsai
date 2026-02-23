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
    discounts: Decimal = Decimal('0')
    rebates: Decimal = Decimal('0')
    financing_adjustment: Decimal = Decimal('0')
    currency: str = "USD"
    performance_obligations: List[PerformanceObligation] = field(default_factory=list)


class IFRS15Calculator:
    """IFRS 15 5-step revenue recognition calculator"""
    
    def __init__(self):
        self.precision = Decimal('0.01')
    
    def calculate_transaction_price(self, contract: IFRS15Input) -> Decimal:
        """
        Step 3: Determine transaction price
        
        Transaction Price = Fixed + Variable - Discounts - Rebates + Financing
        
        Args:
            contract: IFRS15Input with pricing components
            
        Returns:
            Total transaction price
        """
        
        transaction_price = (
            contract.fixed_consideration +
            contract.variable_consideration -
            contract.discounts -
            contract.rebates +
            contract.financing_adjustment
        )
        
        return transaction_price.quantize(self.precision, ROUND_HALF_UP)
    
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
        
        # Step 1: Identify contract (assumed valid input)
        # Step 2: Identify performance obligations (in input)
        
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
            'allocations': {k: float(v) for k, v in allocations.items()},
            'recognition_schedule': recognition_schedule,
            'contract_balances': balances,
            'journal_entries': journal_entries,
            'disclosure_data': disclosure,
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
