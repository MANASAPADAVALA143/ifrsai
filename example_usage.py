"""
IFRS 16 Lease Accounting - Complete Example Usage
Demonstrates all features: extraction, calculation, and Excel export
"""

import os
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from ifrs16_extractor import IFRS16LeaseExtractor
from ifrs16_calculator import IFRS16Calculator, LeaseInput
from ifrs16_excel_export import IFRS16ExcelExporter


def example_1_manual_calculation():
    """
    Example 1: Manual lease calculation
    Direct calculation without AI extraction
    """
    print("\n" + "="*70)
    print("EXAMPLE 1: MANUAL LEASE CALCULATION")
    print("="*70)
    
    # Create lease input
    lease = LeaseInput(
        lease_id="LEASE-2024-001",
        asset_description="Commercial Office Space - 5,000 sq ft, Tech Park, Hyderabad",
        lessee_name="TechCorp India Pvt. Ltd.",
        lessor_name="Prime Properties Ltd.",
        commencement_date=datetime(2024, 1, 1),
        lease_term_months=36,
        monthly_payment=Decimal('50000'),
        annual_discount_rate=Decimal('0.085'),  # 8.5%
        initial_direct_costs=Decimal('40000'),  # Stamp duty + legal fees
        escalation_rate=Decimal('0.05'),  # 5% annual
        currency="INR"
    )
    
    # Calculate
    print("\n📊 Calculating IFRS 16 metrics...")
    calculator = IFRS16Calculator()
    results = calculator.calculate_full_ifrs16(lease)
    
    # Display key results
    print(f"\n✅ Calculation Complete!")
    print(f"\n🏢 Lease Details:")
    print(f"   Lease ID: {results['disclosure_data']['lease_id']}")
    print(f"   Asset: {results['disclosure_data']['asset']}")
    print(f"   Term: {results['disclosure_data']['term_months']} months")
    
    print(f"\n💰 Initial Measurement:")
    print(f"   Lease Liability: ₹{results['lease_liability']:,.2f}")
    print(f"   ROU Asset: ₹{results['rou_asset']:,.2f}")
    print(f"   Monthly Depreciation: ₹{results['monthly_depreciation']:,.2f}")
    
    print(f"\n📈 Year 1 P&L Impact:")
    print(f"   Interest Expense: ₹{results['year_1_impact']['interest_expense']:,.2f}")
    print(f"   Depreciation: ₹{results['year_1_impact']['depreciation_expense']:,.2f}")
    print(f"   Total P&L: ₹{results['year_1_impact']['total_p_l_expense']:,.2f}")
    print(f"   EBITDA Improvement: ₹{results['year_1_impact']['ebitda_improvement']:,.2f}")
    
    # Export to Excel
    print(f"\n📄 Exporting to Excel...")
    output_dir = Path("outputs")
    output_dir.mkdir(exist_ok=True)
    
    excel_file = output_dir / f"IFRS16_{lease.lease_id}.xlsx"
    exporter = IFRS16ExcelExporter()
    exporter.export_ifrs16_workbook(results, str(excel_file))
    
    print(f"✅ Excel report saved: {excel_file}")
    
    return results


def example_2_ai_extraction():
    """
    Example 2: AI-powered contract extraction
    Extract lease terms using Claude API
    """
    print("\n" + "="*70)
    print("EXAMPLE 2: AI-POWERED CONTRACT EXTRACTION")
    print("="*70)
    
    # Check for API key
    api_key = os.getenv('ANTHROPIC_API_KEY')
    if not api_key:
        print("\n⚠️  ANTHROPIC_API_KEY not found!")
        print("To use AI extraction:")
        print("1. Get API key from https://console.anthropic.com/")
        print("2. Set environment variable:")
        print("   Windows: set ANTHROPIC_API_KEY=your-key")
        print("   Linux/Mac: export ANTHROPIC_API_KEY=your-key")
        print("\nSkipping AI extraction example...")
        return None
    
    # Sample contract
    contract_text = """
    COMMERCIAL LEASE AGREEMENT
    
    This Lease Agreement is entered into on January 1, 2024
    
    BETWEEN:
    Lessor: Prime Properties Ltd., a company incorporated under the Companies Act
    Registered Office: Mumbai, India
    
    AND:
    Lessee: TechCorp India Pvt. Ltd.
    Registered Office: Hyderabad, India
    
    1. LEASED PREMISES
    The Lessor agrees to lease the following property:
    - Location: 5th Floor, Tech Park, Hitech City, Hyderabad
    - Area: 5,000 square feet
    - Type: Commercial office space
    - Use: Corporate office and business operations
    
    2. LEASE TERM
    Commencement Date: January 1, 2024
    End Date: December 31, 2026
    Duration: 36 months (Three years)
    
    3. RENT AND PAYMENTS
    Monthly Rent: INR 50,000 (Indian Rupees Fifty Thousand Only)
    Payment Due Date: 1st day of each month
    Payment Method: NEFT/RTGS to Lessor's designated bank account
    
    Escalation Clause: The monthly rent shall increase by 5% per annum starting
    from the beginning of the second year (January 1, 2025) and third year
    (January 1, 2026).
    
    4. SECURITY DEPOSIT
    Amount: INR 150,000 (Refundable at end of lease term)
    
    5. INITIAL COSTS
    The following costs shall be borne by the Lessee:
    - Stamp Duty: INR 25,000
    - Legal Documentation Fees: INR 15,000
    - Broker Commission: INR 30,000
    Total Initial Direct Costs: INR 70,000
    
    6. RENEWAL OPTIONS
    The Lessee shall have the option to renew this lease for two additional
    periods of 12 months each, at the prevailing market rent to be mutually
    agreed upon.
    
    7. TERMINATION
    Either party may terminate this lease with 6 months' written notice after
    completion of the second year, without penalty.
    
    8. MAINTENANCE
    - Lessee: Responsible for interior maintenance, utilities (electricity, water)
    - Lessor: Responsible for structural repairs and property tax
    
    9. DISCOUNT RATE
    For accounting purposes, the Lessee's incremental borrowing rate is 8.5% per annum.
    
    IN WITNESS WHEREOF, the parties have executed this Agreement.
    
    Signed and Delivered
    For Prime Properties Ltd.          For TechCorp India Pvt. Ltd.
    [Signature]                         [Signature]
    Date: January 1, 2024              Date: January 1, 2024
    """
    
    print("\n🤖 Extracting lease terms using Claude API...")
    
    try:
        extractor = IFRS16LeaseExtractor(api_key=api_key)
        extracted_data = extractor.extract_lease_terms(contract_text)
        
        print(f"✅ Extraction complete!")
        
        # Validate extraction
        validation = extractor.validate_extraction(extracted_data)
        
        print(f"\n📊 Validation Results:")
        print(f"   Valid: {validation['is_valid']}")
        print(f"   Errors: {validation['error_count']}")
        print(f"   Warnings: {validation['warning_count']}")
        print(f"   Requires Review: {validation['requires_review']}")
        
        if validation['warnings']:
            print(f"\n⚠️  Warnings:")
            for warning in validation['warnings']:
                print(f"   - {warning}")
        
        # Display extracted key fields
        print(f"\n📄 Extracted Data (Key Fields):")
        try:
            print(f"   Lessee: {extracted_data['basic_info']['lessee_name']['value']}")
            print(f"   Lessor: {extracted_data['basic_info']['lessor_name']['value']}")
            print(f"   Commencement: {extracted_data['dates']['commencement_date']['value']}")
            print(f"   Term: {extracted_data['dates']['lease_term_months']['value']} months")
            print(f"   Monthly Rent: {extracted_data['payments']['monthly_amount']['value']}")
            print(f"   Discount Rate: {extracted_data['discount_rate']['stated_rate']['value']}")
        except (KeyError, TypeError) as e:
            print(f"   (Some fields may not be extracted)")
        
        # Save extraction
        output_dir = Path("outputs")
        output_dir.mkdir(exist_ok=True)
        extraction_file = output_dir / "extraction_result.json"
        extractor.save_extraction(extracted_data, str(extraction_file))
        
        return extracted_data
        
    except Exception as e:
        print(f"❌ Extraction error: {e}")
        return None


def example_3_multiple_leases():
    """
    Example 3: Batch calculation for multiple leases
    Calculate IFRS 16 for a portfolio of leases
    """
    print("\n" + "="*70)
    print("EXAMPLE 3: BATCH CALCULATION (MULTIPLE LEASES)")
    print("="*70)
    
    # Define multiple leases
    leases = [
        LeaseInput(
            lease_id="LEASE-2024-001",
            asset_description="Office - Hyderabad",
            commencement_date=datetime(2024, 1, 1),
            lease_term_months=36,
            monthly_payment=Decimal('50000'),
            annual_discount_rate=Decimal('0.085'),
            initial_direct_costs=Decimal('40000'),
            currency="INR"
        ),
        LeaseInput(
            lease_id="LEASE-2024-002",
            asset_description="Warehouse - Mumbai",
            commencement_date=datetime(2024, 2, 1),
            lease_term_months=60,
            monthly_payment=Decimal('100000'),
            annual_discount_rate=Decimal('0.09'),
            initial_direct_costs=Decimal('75000'),
            currency="INR"
        ),
        LeaseInput(
            lease_id="LEASE-2024-003",
            asset_description="Retail Space - Delhi",
            commencement_date=datetime(2024, 3, 1),
            lease_term_months=24,
            monthly_payment=Decimal('75000'),
            annual_discount_rate=Decimal('0.08'),
            initial_direct_costs=Decimal('30000'),
            currency="INR"
        )
    ]
    
    calculator = IFRS16Calculator()
    results_list = []
    
    print(f"\n📊 Calculating {len(leases)} leases...")
    
    for lease in leases:
        print(f"\n   Processing {lease.lease_id}...")
        results = calculator.calculate_full_ifrs16(lease)
        results_list.append(results)
    
    # Summary statistics
    print(f"\n✅ Batch Calculation Complete!")
    print(f"\n📈 Portfolio Summary:")
    
    total_liability = sum(r['lease_liability'] for r in results_list)
    total_rou = sum(r['rou_asset'] for r in results_list)
    total_y1_expense = sum(r['year_1_impact']['total_p_l_expense'] for r in results_list)
    
    print(f"   Total Leases: {len(leases)}")
    print(f"   Total Lease Liability: ₹{total_liability:,.2f}")
    print(f"   Total ROU Assets: ₹{total_rou:,.2f}")
    print(f"   Total Year 1 P&L: ₹{total_y1_expense:,.2f}")
    
    print(f"\n📋 Individual Lease Summary:")
    for result in results_list:
        print(f"   {result['disclosure_data']['lease_id']}: " +
              f"Liability ₹{result['lease_liability']:,.2f}, " +
              f"ROU ₹{result['rou_asset']:,.2f}")
    
    return results_list


def example_4_scenario_analysis():
    """
    Example 4: Scenario analysis
    Compare different discount rates and terms
    """
    print("\n" + "="*70)
    print("EXAMPLE 4: SCENARIO ANALYSIS")
    print("="*70)
    
    base_lease = {
        "lease_id": "LEASE-SCENARIO",
        "asset_description": "Office Space - Scenario Analysis",
        "commencement_date": datetime(2024, 1, 1),
        "lease_term_months": 36,
        "monthly_payment": Decimal('50000'),
        "initial_direct_costs": Decimal('40000'),
        "currency": "INR"
    }
    
    # Scenario: Different discount rates
    discount_rates = [0.06, 0.08, 0.10, 0.12]
    
    print(f"\n📊 Analyzing impact of discount rates...")
    print(f"\nBase: Monthly payment ₹50,000, Term 36 months")
    print(f"\n{'Discount Rate':<15} {'Lease Liability':<20} {'Year 1 Interest':<20}")
    print("-" * 55)
    
    calculator = IFRS16Calculator()
    
    for rate in discount_rates:
        lease = LeaseInput(
            **base_lease,
            annual_discount_rate=Decimal(str(rate))
        )
        results = calculator.calculate_full_ifrs16(lease)
        
        print(f"{rate*100:>6.1f}%        " +
              f"₹{results['lease_liability']:>15,.2f}    " +
              f"₹{results['year_1_impact']['interest_expense']:>15,.2f}")
    
    print(f"\n💡 Observation: Higher discount rates result in lower lease liability")


def main():
    """
    Main function to run all examples
    """
    print("="*70)
    print("IFRS 16 LEASE ACCOUNTING AUTOMATION")
    print("Complete Examples and Usage Guide")
    print("="*70)
    
    try:
        # Example 1: Manual calculation
        example_1_manual_calculation()
        
        # Example 2: AI extraction (only if API key available)
        example_2_ai_extraction()
        
        # Example 3: Batch calculation
        example_3_multiple_leases()
        
        # Example 4: Scenario analysis
        example_4_scenario_analysis()
        
        print("\n" + "="*70)
        print("✅ ALL EXAMPLES COMPLETED SUCCESSFULLY!")
        print("="*70)
        print("\n📁 Check the 'outputs' folder for generated files:")
        print("   - Excel reports (.xlsx)")
        print("   - JSON extractions (.json)")
        print("\n📖 For API usage, run: python app.py")
        print("   Then visit: http://localhost:8000/api/docs")
        print("\n" + "="*70)
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()

