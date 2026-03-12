"""
IFRS 16 Excel Export Module
Professional Excel workbook generation with multiple sheets
"""

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, Color
from openpyxl.utils.dataframe import dataframe_to_rows
from openpyxl.chart import BarChart, Reference, LineChart
import pandas as pd
from typing import Dict
from datetime import datetime
from pathlib import Path


class IFRS16ExcelExporter:
    """Export IFRS 16 calculations to professional Excel format"""
    
    def __init__(self):
        # Styling
        self.header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
        self.header_font = Font(bold=True, color="FFFFFF", size=11)
        self.title_font = Font(bold=True, size=14, color="1F4E78")
        self.subtitle_font = Font(bold=True, size=12, color="1F4E78")
        self.border = Border(
            left=Side(style='thin', color='000000'),
            right=Side(style='thin', color='000000'),
            top=Side(style='thin', color='000000'),
            bottom=Side(style='thin', color='000000')
        )
        self.thick_border = Border(
            left=Side(style='medium', color='000000'),
            right=Side(style='medium', color='000000'),
            top=Side(style='medium', color='000000'),
            bottom=Side(style='medium', color='000000')
        )
    
    def export_ifrs16_workbook(self, results: Dict, filename: str):
        """
        Create complete IFRS 16 Excel workbook with multiple sheets
        
        Sheets:
        1. Summary
        2. Amortization Schedule
        3. Journal Entries
        4. Maturity Analysis
        5. Disclosure Notes
        
        Args:
            results: Dictionary from IFRS16Calculator.calculate_full_ifrs16()
            filename: Output filename (path)
        """
        
        # Ensure output directory exists
        output_path = Path(filename)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        wb = Workbook()
        
        # Remove default sheet
        if 'Sheet' in wb.sheetnames:
            wb.remove(wb['Sheet'])
        
        # Create sheets
        self._create_summary_sheet(wb, results)
        self._create_amortization_sheet(wb, results)
        self._create_journal_entries_sheet(wb, results)
        self._create_maturity_sheet(wb, results)
        self._create_disclosure_sheet(wb, results)
        
        # Save workbook
        wb.save(filename)
        print(f"✅ Excel workbook saved: {filename}")
    
    def _create_summary_sheet(self, wb: Workbook, results: Dict):
        """Summary sheet with key metrics and overview"""
        
        ws = wb.create_sheet("Summary", 0)
        
        # Title
        ws['A1'] = "IFRS 16 LEASE ACCOUNTING SUMMARY"
        ws['A1'].font = self.title_font
        ws.merge_cells('A1:D1')
        ws['A1'].alignment = Alignment(horizontal='center', vertical='center')
        ws.row_dimensions[1].height = 25
        
        # Lease details section
        row = 3
        ws[f'A{row}'] = "LEASE DETAILS"
        ws[f'A{row}'].font = self.subtitle_font
        ws.merge_cells(f'A{row}:B{row}')
        row += 1
        
        lease_details = [
            ("Lease ID:", results['disclosure_data']['lease_id']),
            ("Asset:", results['disclosure_data']['asset']),
            ("Lessee:", results['disclosure_data']['lessee']),
            ("Lessor:", results['disclosure_data']['lessor']),
            ("Commencement Date:", results['disclosure_data']['commencement']),
            ("End Date:", results['disclosure_data']['end_date']),
            ("Lease Term:", f"{results['disclosure_data']['term_months']} months"),
            ("Discount Rate:", f"{results['disclosure_data']['discount_rate_pct']:.2f}%"),
            ("Currency:", results['disclosure_data']['currency'])
        ]
        
        for label, value in lease_details:
            ws[f'A{row}'] = label
            ws[f'B{row}'] = value
            ws[f'A{row}'].font = Font(bold=True, size=10)
            row += 1
        
        # Initial measurement section
        row += 1
        ws[f'A{row}'] = "INITIAL MEASUREMENT"
        ws[f'A{row}'].font = self.subtitle_font
        ws.merge_cells(f'A{row}:D{row}')
        row += 1
        
        ws[f'A{row}'] = "Metric"
        ws[f'B{row}'] = "Amount"
        ws[f'A{row}'].font = self.header_font
        ws[f'B{row}'].font = self.header_font
        ws[f'A{row}'].fill = self.header_fill
        ws[f'B{row}'].fill = self.header_fill
        
        currency_symbol = "₹" if results['disclosure_data']['currency'] == "INR" else results['disclosure_data']['currency']
        
        metrics = [
            ("Lease Liability", results['lease_liability']),
            ("Right-of-Use Asset", results['rou_asset']),
            ("Monthly Depreciation", results['monthly_depreciation']),
            ("Total Interest Expense", results['total_interest'])
        ]
        
        for metric_name, value in metrics:
            row += 1
            ws[f'A{row}'] = metric_name
            ws[f'B{row}'] = value
            ws[f'B{row}'].number_format = f'"{currency_symbol}"#,##0.00'
            ws[f'A{row}'].border = self.border
            ws[f'B{row}'].border = self.border
        
        # Balance sheet classification
        row += 2
        ws[f'A{row}'] = "BALANCE SHEET CLASSIFICATION"
        ws[f'A{row}'].font = self.subtitle_font
        ws.merge_cells(f'A{row}:D{row}')
        row += 1
        
        ws[f'A{row}'] = "Classification"
        ws[f'B{row}'] = "Amount"
        ws[f'A{row}'].font = self.header_font
        ws[f'B{row}'].font = self.header_font
        ws[f'A{row}'].fill = self.header_fill
        ws[f'B{row}'].fill = self.header_fill
        
        bs_items = [
            ("Current Portion", results['liability_split']['current_portion']),
            ("Non-Current Portion", results['liability_split']['non_current_portion']),
            ("Total Lease Liability", results['liability_split']['total_liability'])
        ]
        
        for item_name, value in bs_items:
            row += 1
            ws[f'A{row}'] = item_name
            ws[f'B{row}'] = value
            ws[f'B{row}'].number_format = f'"{currency_symbol}"#,##0.00'
            ws[f'A{row}'].border = self.border
            ws[f'B{row}'].border = self.border
            
            if item_name == "Total Lease Liability":
                ws[f'A{row}'].font = Font(bold=True)
                ws[f'B{row}'].font = Font(bold=True)
        
        # Year 1 P&L Impact
        row += 2
        ws[f'A{row}'] = "YEAR 1 P&L IMPACT"
        ws[f'A{row}'].font = self.subtitle_font
        ws.merge_cells(f'A{row}:D{row}')
        row += 1
        
        ws[f'A{row}'] = "Item"
        ws[f'B{row}'] = "Amount"
        ws[f'A{row}'].font = self.header_font
        ws[f'B{row}'].font = self.header_font
        ws[f'A{row}'].fill = self.header_fill
        ws[f'B{row}'].fill = self.header_fill
        
        y1_items = [
            ("Interest Expense", results['year_1_impact']['interest_expense']),
            ("Depreciation Expense", results['year_1_impact']['depreciation_expense']),
            ("Total P&L Expense", results['year_1_impact']['total_p_l_expense']),
            ("Cash Outflow", results['year_1_impact']['cash_outflow']),
            ("EBITDA Improvement", results['year_1_impact']['ebitda_improvement'])
        ]
        
        for item_name, value in y1_items:
            row += 1
            ws[f'A{row}'] = item_name
            ws[f'B{row}'] = value
            ws[f'B{row}'].number_format = f'"{currency_symbol}"#,##0.00'
            ws[f'A{row}'].border = self.border
            ws[f'B{row}'].border = self.border
            
            if item_name == "Total P&L Expense":
                ws[f'A{row}'].font = Font(bold=True)
                ws[f'B{row}'].font = Font(bold=True)
        
        # Total lease cost
        row += 2
        ws[f'A{row}'] = "TOTAL LEASE COST"
        ws[f'A{row}'].font = self.subtitle_font
        ws.merge_cells(f'A{row}:D{row}')
        row += 1
        
        ws[f'A{row}'] = "Component"
        ws[f'B{row}'] = "Amount"
        ws[f'A{row}'].font = self.header_font
        ws[f'B{row}'].font = self.header_font
        ws[f'A{row}'].fill = self.header_fill
        ws[f'B{row}'].fill = self.header_fill
        
        cost_items = [
            ("Total Lease Payments", results['total_lease_cost']['total_payments']),
            ("Initial Direct Costs", results['total_lease_cost']['initial_costs']),
            ("Total Interest Component", results['total_lease_cost']['total_interest']),
            ("Grand Total", results['total_lease_cost']['grand_total'])
        ]
        
        for item_name, value in cost_items:
            row += 1
            ws[f'A{row}'] = item_name
            ws[f'B{row}'] = value
            ws[f'B{row}'].number_format = f'"{currency_symbol}"#,##0.00'
            ws[f'A{row}'].border = self.border
            ws[f'B{row}'].border = self.border
            
            if item_name == "Grand Total":
                ws[f'A{row}'].font = Font(bold=True)
                ws[f'B{row}'].font = Font(bold=True)
                ws[f'A{row}'].border = self.thick_border
                ws[f'B{row}'].border = self.thick_border
        
        # Metadata
        row += 3
        ws[f'A{row}'] = f"Generated: {results['calculation_metadata']['calculation_date']}"
        ws[f'A{row}'].font = Font(size=9, italic=True, color="666666")
        
        # Auto-size columns
        ws.column_dimensions['A'].width = 35
        ws.column_dimensions['B'].width = 20
    
    def _create_amortization_sheet(self, wb: Workbook, results: Dict):
        """Amortization schedule sheet with full payment table"""
        
        ws = wb.create_sheet("Amortization Schedule")
        
        # Title
        ws['A1'] = "LEASE LIABILITY AMORTIZATION SCHEDULE"
        ws['A1'].font = self.title_font
        ws.merge_cells('A1:H1')
        ws['A1'].alignment = Alignment(horizontal='center')
        ws.row_dimensions[1].height = 25
        
        # Subtitle
        ws['A2'] = f"Lease ID: {results['disclosure_data']['lease_id']}"
        ws['A2'].font = Font(size=10, italic=True)
        ws.merge_cells('A2:H2')
        
        # Add DataFrame to sheet
        df = results['amortization_schedule']
        
        row_offset = 4
        for r_idx, row in enumerate(dataframe_to_rows(df, index=False, header=True), row_offset):
            for c_idx, value in enumerate(row, 1):
                cell = ws.cell(row=r_idx, column=c_idx, value=value)
                
                # Header row
                if r_idx == row_offset:
                    cell.font = self.header_font
                    cell.fill = self.header_fill
                    cell.alignment = Alignment(horizontal='center', vertical='center')
                else:
                    # Format numbers
                    if c_idx >= 4 and c_idx <= 8:  # Amount columns
                        currency_symbol = "₹" if results['disclosure_data']['currency'] == "INR" else results['disclosure_data']['currency']
                        cell.number_format = f'"{currency_symbol}"#,##0.00'
                
                cell.border = self.border
        
        # Auto-size columns
        for col in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']:
            ws.column_dimensions[col].width = 15
    
    def _create_journal_entries_sheet(self, wb: Workbook, results: Dict):
        """Journal entries sheet with all accounting entries"""
        
        ws = wb.create_sheet("Journal Entries")
        
        ws['A1'] = "ACCOUNTING JOURNAL ENTRIES"
        ws['A1'].font = self.title_font
        ws.merge_cells('A1:D1')
        ws['A1'].alignment = Alignment(horizontal='center')
        ws.row_dimensions[1].height = 25
        
        currency_symbol = "₹" if results['disclosure_data']['currency'] == "INR" else results['disclosure_data']['currency']
        
        row = 3
        
        # Entry 1: Initial Recognition
        ws[f'A{row}'] = "1. INITIAL RECOGNITION"
        ws[f'A{row}'].font = self.subtitle_font
        ws.merge_cells(f'A{row}:D{row}')
        row += 1
        
        ws[f'A{row}'] = "Date: " + results['journal_entries']['initial_recognition']['date']
        ws[f'A{row}'].font = Font(italic=True)
        row += 1
        ws[f'A{row}'] = "Description: " + results['journal_entries']['initial_recognition']['description']
        ws[f'A{row}'].font = Font(italic=True)
        ws.merge_cells(f'A{row}:D{row}')
        row += 1
        
        ws[f'A{row}'] = "Account"
        ws[f'B{row}'] = f"Debit ({currency_symbol})"
        ws[f'C{row}'] = f"Credit ({currency_symbol})"
        ws[f'D{row}'] = "Narration"
        for col in ['A', 'B', 'C', 'D']:
            ws[f'{col}{row}'].font = self.header_font
            ws[f'{col}{row}'].fill = self.header_fill
            ws[f'{col}{row}'].border = self.border
        
        for entry in results['journal_entries']['initial_recognition']['entries']:
            row += 1
            ws[f'A{row}'] = entry['account']
            ws[f'B{row}'] = entry['dr'] if entry['dr'] > 0 else ""
            ws[f'C{row}'] = entry['cr'] if entry['cr'] > 0 else ""
            ws[f'D{row}'] = entry['narration']
            
            if entry['dr'] > 0:
                ws[f'B{row}'].number_format = f'"{currency_symbol}"#,##0.00'
            if entry['cr'] > 0:
                ws[f'C{row}'].number_format = f'"{currency_symbol}"#,##0.00'
            
            for col in ['A', 'B', 'C', 'D']:
                ws[f'{col}{row}'].border = self.border
        
        # Entry 2: Monthly Depreciation
        row += 2
        ws[f'A{row}'] = "2. MONTHLY DEPRECIATION (Recurring)"
        ws[f'A{row}'].font = self.subtitle_font
        ws.merge_cells(f'A{row}:D{row}')
        row += 1
        
        ws[f'A{row}'] = "Frequency: " + results['journal_entries']['monthly_depreciation']['frequency']
        ws[f'A{row}'].font = Font(italic=True)
        row += 1
        
        ws[f'A{row}'] = "Account"
        ws[f'B{row}'] = f"Debit ({currency_symbol})"
        ws[f'C{row}'] = f"Credit ({currency_symbol})"
        ws[f'D{row}'] = "Narration"
        for col in ['A', 'B', 'C', 'D']:
            ws[f'{col}{row}'].font = self.header_font
            ws[f'{col}{row}'].fill = self.header_fill
            ws[f'{col}{row}'].border = self.border
        
        for entry in results['journal_entries']['monthly_depreciation']['entries']:
            row += 1
            ws[f'A{row}'] = entry['account']
            ws[f'B{row}'] = entry['dr'] if entry['dr'] > 0 else ""
            ws[f'C{row}'] = entry['cr'] if entry['cr'] > 0 else ""
            ws[f'D{row}'] = entry['narration']
            
            if entry['dr'] > 0:
                ws[f'B{row}'].number_format = f'"{currency_symbol}"#,##0.00'
            if entry['cr'] > 0:
                ws[f'C{row}'].number_format = f'"{currency_symbol}"#,##0.00'
            
            for col in ['A', 'B', 'C', 'D']:
                ws[f'{col}{row}'].border = self.border
        
        # Entry 3: Monthly Payment
        row += 2
        ws[f'A{row}'] = "3. MONTHLY LEASE PAYMENT (Example - Month 1)"
        ws[f'A{row}'].font = self.subtitle_font
        ws.merge_cells(f'A{row}:D{row}')
        row += 1
        
        ws[f'A{row}'] = "Frequency: " + results['journal_entries']['monthly_payment_example']['frequency']
        ws[f'A{row}'].font = Font(italic=True)
        row += 1
        
        ws[f'A{row}'] = "Account"
        ws[f'B{row}'] = f"Debit ({currency_symbol})"
        ws[f'C{row}'] = f"Credit ({currency_symbol})"
        ws[f'D{row}'] = "Narration"
        for col in ['A', 'B', 'C', 'D']:
            ws[f'{col}{row}'].font = self.header_font
            ws[f'{col}{row}'].fill = self.header_fill
            ws[f'{col}{row}'].border = self.border
        
        for entry in results['journal_entries']['monthly_payment_example']['entries']:
            row += 1
            ws[f'A{row}'] = entry['account']
            ws[f'B{row}'] = entry['dr'] if entry['dr'] > 0 else ""
            ws[f'C{row}'] = entry['cr'] if entry['cr'] > 0 else ""
            ws[f'D{row}'] = entry['narration']
            
            if entry['dr'] > 0:
                ws[f'B{row}'].number_format = f'"{currency_symbol}"#,##0.00'
            if entry['cr'] > 0:
                ws[f'C{row}'].number_format = f'"{currency_symbol}"#,##0.00'
            
            for col in ['A', 'B', 'C', 'D']:
                ws[f'{col}{row}'].border = self.border
        
        # Column widths
        ws.column_dimensions['A'].width = 40
        ws.column_dimensions['B'].width = 18
        ws.column_dimensions['C'].width = 18
        ws.column_dimensions['D'].width = 45
    
    def _create_maturity_sheet(self, wb: Workbook, results: Dict):
        """Maturity analysis sheet with payment breakdown by year"""
        
        ws = wb.create_sheet("Maturity Analysis")
        
        ws['A1'] = "LEASE PAYMENT MATURITY ANALYSIS"
        ws['A1'].font = self.title_font
        ws.merge_cells('A1:B1')
        ws['A1'].alignment = Alignment(horizontal='center')
        ws.row_dimensions[1].height = 25
        
        ws['A2'] = "Future lease payments by period"
        ws['A2'].font = Font(italic=True, size=10)
        ws.merge_cells('A2:B2')
        
        row = 4
        ws[f'A{row}'] = "Period"
        ws[f'B{row}'] = "Future Payments"
        ws[f'A{row}'].font = self.header_font
        ws[f'B{row}'].font = self.header_font
        ws[f'A{row}'].fill = self.header_fill
        ws[f'B{row}'].fill = self.header_fill
        ws[f'A{row}'].border = self.border
        ws[f'B{row}'].border = self.border
        
        currency_symbol = "₹" if results['disclosure_data']['currency'] == "INR" else results['disclosure_data']['currency']
        
        for period, amount in results['maturity_analysis'].items():
            row += 1
            ws[f'A{row}'] = period.replace('_', ' ')
            ws[f'B{row}'] = amount
            ws[f'B{row}'].number_format = f'"{currency_symbol}"#,##0.00'
            ws[f'A{row}'].border = self.border
            ws[f'B{row}'].border = self.border
            
            if period == 'Total':
                ws[f'A{row}'].font = Font(bold=True)
                ws[f'B{row}'].font = Font(bold=True)
                ws[f'A{row}'].border = self.thick_border
                ws[f'B{row}'].border = self.thick_border
        
        ws.column_dimensions['A'].width = 20
        ws.column_dimensions['B'].width = 20
    
    def _create_disclosure_sheet(self, wb: Workbook, results: Dict):
        """Disclosure notes sheet for financial statements"""
        
        ws = wb.create_sheet("Disclosure Notes")
        
        ws['A1'] = "IFRS 16 DISCLOSURE NOTES"
        ws['A1'].font = self.title_font
        ws.merge_cells('A1:B1')
        ws['A1'].alignment = Alignment(horizontal='center')
        ws.row_dimensions[1].height = 25
        
        row = 3
        ws[f'A{row}'] = "Note: Leases (IFRS 16)"
        ws[f'A{row}'].font = Font(bold=True, size=12)
        ws.merge_cells(f'A{row}:B{row}')
        
        row += 2
        disclosure_text = f"""The Company has adopted IFRS 16 'Leases' with effect from {results['disclosure_data']['commencement']}.

The Company has lease contracts for office premises. The Company's obligations under its leases are secured by the lessor's title to the leased assets.

The Company has recognized right-of-use assets and lease liabilities for these leases. The details are as follows:

Right-of-Use Assets:
- Asset description: {results['disclosure_data']['asset']}
- Carrying amount: {results['disclosure_data']['currency']} {results['rou_asset']:,.2f}
- Accumulated depreciation: Depreciated on a straight-line basis over lease term

Lease Liabilities:
- Total lease liability: {results['disclosure_data']['currency']} {results['lease_liability']:,.2f}
- Current portion: {results['disclosure_data']['currency']} {results['liability_split']['current_portion']:,.2f}
- Non-current portion: {results['disclosure_data']['currency']} {results['liability_split']['non_current_portion']:,.2f}

The Company has used incremental borrowing rate of {results['disclosure_data']['discount_rate_pct']:.2f}% to calculate the present value of lease payments.

Amounts recognized in statement of profit and loss:
- Depreciation expense: {results['disclosure_data']['currency']} {results['year_1_impact']['depreciation_expense']:,.2f} (Year 1)
- Interest expense: {results['disclosure_data']['currency']} {results['year_1_impact']['interest_expense']:,.2f} (Year 1)
- Total expense: {results['disclosure_data']['currency']} {results['year_1_impact']['total_p_l_expense']:,.2f} (Year 1)

Cash outflow for leases: {results['disclosure_data']['currency']} {results['year_1_impact']['cash_outflow']:,.2f} (Year 1)

The maturity analysis of lease liabilities is presented in the 'Maturity Analysis' sheet.

Report generated on: {results['calculation_metadata']['calculation_date']}
"""
        
        # Write disclosure text with wrapping
        ws[f'A{row}'] = disclosure_text
        ws[f'A{row}'].alignment = Alignment(wrap_text=True, vertical='top')
        ws.merge_cells(f'A{row}:B{row+50}')
        
        ws.column_dimensions['A'].width = 100
        ws.column_dimensions['B'].width = 20


# Example usage
if __name__ == "__main__":
    print("IFRS 16 Excel Exporter")
    print("="*70)
    print("\nThis module exports IFRS 16 calculations to Excel format.")
    print("\nUsage:")
    print("  from ifrs16_calculator import IFRS16Calculator, LeaseInput")
    print("  from ifrs16_excel_export import IFRS16ExcelExporter")
    print("  from datetime import datetime")
    print("  from decimal import Decimal")
    print()
    print("  # Calculate lease")
    print("  lease = LeaseInput(...)")
    print("  calc = IFRS16Calculator()")
    print("  results = calc.calculate_full_ifrs16(lease)")
    print()
    print("  # Export to Excel")
    print("  exporter = IFRS16ExcelExporter()")
    print("  exporter.export_ifrs16_workbook(results, 'output.xlsx')")
    print()
    print("See example_usage.py for a complete working example.")

