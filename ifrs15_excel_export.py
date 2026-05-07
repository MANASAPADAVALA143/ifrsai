"""
IFRS 15 Excel Export Module
Professional Excel workbook generation with six-sheet audit pack (master summary + five core sheets)
"""

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

from currency_format import format_currency_value, excel_money_number_format


class IFRS15ExcelExporter:
    """Export IFRS 15 calculation results to a professional workbook (optional master summary + five core sheets)."""

    def __init__(self) -> None:
        self.header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
        self.header_font = Font(bold=True, color="FFFFFF", size=11)
        self.title_font = Font(bold=True, size=14, color="1F4E78")
        self.subtitle_font = Font(bold=True, size=12, color="1F4E78")
        self.alt_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
        self.total_fill = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
        self.border = Border(
            left=Side(style="thin", color="000000"),
            right=Side(style="thin", color="000000"),
            top=Side(style="thin", color="000000"),
            bottom=Side(style="thin", color="000000"),
        )

    def _write_master_summary_placeholder(self, ws: Any) -> None:
        """Sheet 1 when no master report payload is supplied with the audit pack download."""
        dark_blue = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
        ws.merge_cells("A1:D8")
        cell = ws["A1"]
        cell.value = (
            "IFRS 15 Master Summary\n\n"
            "Run all modules and Generate Master Report to populate this sheet."
        )
        cell.font = Font(bold=True, size=14, color="FFFFFF")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.fill = dark_blue
        for i in range(1, 9):
            ws.row_dimensions[i].height = 18
        ws.column_dimensions["A"].width = 44
        ws.column_dimensions["B"].width = 22
        ws.column_dimensions["C"].width = 44
        ws.column_dimensions["D"].width = 36

    def _write_master_summary_sheet(self, ws: Any, master_report: Dict[str, Any]) -> None:
        ccy = (master_report.get("contract_overview") or {}).get("currency") or "USD"
        ccy = str(ccy).upper()
        money_fmt = excel_money_number_format(ccy)

        dark_blue = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
        orange_hdr = PatternFill(start_color="F4B084", end_color="F4B084", fill_type="solid")
        hdr_f = Font(bold=True, size=11, color="1F4E78")

        cust = master_report.get("customer_name") or "—"
        gen = master_report.get("generated_at") or ""
        ws.merge_cells("A1:D3")
        cell = ws["A1"]
        cell.value = f"IFRS 15 Revenue Recognition\nMaster Compliance Report\nContract: {cust} | Generated: {gen}"
        cell.font = Font(bold=True, size=14, color="FFFFFF")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.fill = dark_blue
        ws.row_dimensions[1].height = 18
        ws.row_dimensions[2].height = 18
        ws.row_dimensions[3].height = 18

        r = 5

        def section_header(title: str) -> None:
            nonlocal r
            ws.merge_cells(f"A{r}:D{r}")
            c = ws[f"A{r}"]
            c.value = title
            c.font = hdr_f
            c.fill = orange_hdr
            c.alignment = Alignment(horizontal="left", vertical="center")
            r += 1

        def row_pair(left: str, right: Any, money: bool = False) -> None:
            nonlocal r
            ws[f"A{r}"] = left
            ws[f"A{r}"].font = Font(bold=True, size=10)
            ws[f"A{r}"].border = self.border
            ws[f"B{r}"] = right
            ws[f"B{r}"].border = self.border
            if money and isinstance(right, (int, float)):
                ws[f"B{r}"].number_format = money_fmt
            r += 1

        co = master_report.get("contract_overview") or {}
        section_header("CONTRACT OVERVIEW")
        row_pair("Contract Value", float(co.get("total_contract_value", 0) or 0), True)
        row_pair("Term (months)", int(co.get("contract_term_months", 0) or 0))
        row_pair("Obligations", int(co.get("number_of_obligations", 0) or 0))
        row_pair("Recognition Pattern", co.get("recognition_pattern", "—"))
        row_pair("Currency", co.get("currency", "USD"))
        r += 1

        fs = master_report.get("financial_summary") or {}
        section_header("FINANCIAL SUMMARY")
        row_pair("Gross Revenue", float(fs.get("gross_revenue", 0) or 0), True)
        row_pair("Net Revenue", float(fs.get("net_revenue", 0) or 0), True)
        row_pair("Revenue Basis", fs.get("revenue_basis", "—"))
        row_pair("Deferred Revenue", float(fs.get("deferred_revenue", 0) or 0), True)
        row_pair("Contract Assets", float(fs.get("contract_assets", 0) or 0), True)
        row_pair("Variable Consideration (included)", float(fs.get("variable_consideration_included", 0) or 0), True)
        row_pair("Variable Consideration (constrained amt)", float(fs.get("variable_consideration_constrained", 0) or 0), True)
        row_pair("Commission Asset", float(fs.get("commission_asset_recognised", 0) or 0), True)
        row_pair("Commission Monthly Amortisation", float(fs.get("commission_monthly_amortisation", 0) or 0), True)
        row_pair("Total RPO", float(fs.get("total_rpo", 0) or 0), True)
        r += 1

        f5 = master_report.get("five_step_status") or {}
        section_header("5-STEP STATUS")
        row_pair("Step 1 — Contract identified", "✓" if f5.get("step1_contract_identified") else "✗")
        row_pair("Step 2 — Obligations count", int(f5.get("step2_obligations_identified", 0) or 0))
        row_pair("Step 3 — Transaction price", float(f5.get("step3_transaction_price", 0) or 0), True)
        row_pair("Step 3 — VC included", "✓" if f5.get("step3_variable_consideration_included") else "✗")
        row_pair("Step 4 — Allocation", f5.get("step4_allocation_method", "SSP"))
        row_pair("Step 5 — Revenue recognised", float(f5.get("step5_revenue_recognised", 0) or 0), True)
        row_pair("Step 5 — Deferred", float(f5.get("step5_deferred", 0) or 0), True)
        row_pair("All steps + modules complete", "✓" if f5.get("all_steps_complete") else "✗")
        r += 1

        asm = master_report.get("assessments") or {}
        section_header("ASSESSMENTS")
        ws[f"A{r}"] = "Module"
        ws[f"B{r}"] = "Assessed"
        ws[f"C{r}"] = "Key Finding"
        ws[f"D{r}"] = "Risk"
        for col in ("A", "B", "C", "D"):
            c = ws[f"{col}{r}"]
            c.font = self.header_font
            c.fill = self.header_fill
            c.border = self.border
        r += 1
        rows_asm = [
            ("Modifications", asm.get("modifications"), lambda x: f"Catch-up {x.get('total_catch_up_amount', 0)}", lambda b: "Yes" if b.get("risk_flag") else "No"),
            ("Variable consideration", asm.get("variable_consideration"), lambda x: f"{x.get('method', '')} / {x.get('constraint_level', '')}", lambda b: "Yes" if b.get("risk_flag") else "No"),
            ("RPO", asm.get("rpo"), lambda x: f"Total RPO {x.get('total_rpo', 0)}", lambda b: "—"),
            ("Contract costs", asm.get("contract_costs"), lambda x: f"Asset {x.get('asset_amount', 0)}", lambda b: "Yes" if b.get("impairment_flag") else "No"),
            ("Principal / Agent", asm.get("principal_agent"), lambda x: str(x.get("conclusion", "")), lambda b: "Yes" if b.get("borderline") else "No"),
            ("Licence of IP", asm.get("license"), lambda x: str(x.get("license_type", "")), lambda b: "Yes" if b.get("royalty_exception") else "No"),
        ]
        for name, block, fn, rfn in rows_asm:
            b = block or {}
            assessed = "Yes" if b.get("assessed") else "No"
            kf = fn(b) if b.get("assessed") else "—"
            rf = rfn(b) if b.get("assessed") else "—"
            ws[f"A{r}"] = name
            ws[f"B{r}"] = assessed
            ws[f"C{r}"] = kf
            ws[f"D{r}"] = rf
            for col in ("A", "B", "C", "D"):
                ws[f"{col}{r}"].border = self.border
            r += 1
        r += 1

        section_header("RISK FLAGS")
        risks = master_report.get("risk_flags") or []
        if not risks:
            ws.merge_cells(f"A{r}:D{r}")
            c = ws[f"A{r}"]
            c.value = "No risk flags identified"
            c.font = Font(bold=True, color="006100")
            c.fill = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
            r += 1
        else:
            ws[f"A{r}"] = "Severity"
            ws[f"B{r}"] = "Module"
            ws[f"C{r}"] = "Message"
            ws[f"D{r}"] = "Action"
            for col in ("A", "B", "C", "D"):
                ws[f"{col}{r}"].font = self.header_font
                ws[f"{col}{r}"].fill = self.header_fill
                ws[f"{col}{r}"].border = self.border
            r += 1
            for rf in risks:
                sev = str(rf.get("severity", "LOW"))
                fill = (
                    PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
                    if sev == "HIGH"
                    else PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid")
                    if sev == "MEDIUM"
                    else PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid")
                )
                ws[f"A{r}"] = sev
                ws[f"B{r}"] = rf.get("module", "")
                ws[f"C{r}"] = rf.get("message", "")
                ws[f"D{r}"] = rf.get("action_required", "")
                for col in ("A", "B", "C", "D"):
                    c = ws[f"{col}{r}"]
                    c.border = self.border
                    c.fill = fill
                r += 1
        r += 1

        ar = master_report.get("audit_readiness") or {}
        section_header("AUDIT READINESS")
        score = int(ar.get("score", 0) or 0)
        lvl = str(ar.get("level", ""))
        sc_fill = (
            PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
            if lvl == "Ready"
            else PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid")
            if lvl == "Needs Review"
            else PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
        )
        ws.merge_cells(f"A{r}:D{r}")
        c = ws[f"A{r}"]
        c.value = f"Audit Readiness Score: {score}/100 — {lvl}"
        c.font = Font(bold=True, size=14)
        c.fill = sc_fill
        c.alignment = Alignment(horizontal="center")
        r += 1
        ws[f"A{r}"] = "Item"
        ws[f"B{r}"] = "Status"
        ws[f"C{r}"] = "Note"
        for col in ("A", "B", "C"):
            ws[f"{col}{r}"].font = self.header_font
            ws[f"{col}{r}"].fill = self.header_fill
            ws[f"{col}{r}"].border = self.border
        r += 1
        for it in ar.get("checklist") or []:
            st = str(it.get("status", ""))
            colf = Font(color="006100") if st == "complete" else Font(color="9CA3AF") if st == "not_applicable" else Font(color="C00000")
            ws[f"A{r}"] = it.get("item", "")
            ws[f"B{r}"] = st
            ws[f"C{r}"] = it.get("note", "")
            ws[f"A{r}"].font = colf
            ws[f"B{r}"].font = colf
            for col in ("A", "B", "C"):
                ws[f"{col}{r}"].border = self.border
            r += 1
        r += 1

        section_header("AI NARRATIVE")
        ws.merge_cells(f"A{r}:D{r + 20}")
        nar = ws[f"A{r}"]
        nar.value = master_report.get("ai_narrative") or "—"
        nar.font = Font(name="Times New Roman", size=11)
        nar.alignment = Alignment(wrap_text=True, vertical="top")
        nar.border = self.border

        ws.column_dimensions["A"].width = 44
        ws.column_dimensions["B"].width = 22
        ws.column_dimensions["C"].width = 44
        ws.column_dimensions["D"].width = 36

    def export_ifrs15_workbook(
        self,
        results: Dict[str, Any],
        contract_meta: Dict[str, Any],
        filename: str,
        master_report: Optional[Dict[str, Any]] = None,
    ) -> None:
        output_path = Path(filename)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        wb = Workbook()
        if "Sheet" in wb.sheetnames:
            wb.remove(wb["Sheet"])

        currency = (contract_meta.get("currency") or "USD").upper()
        money_fmt = excel_money_number_format(currency)

        ws_master = wb.create_sheet("IFRS 15 Master Summary", 0)
        if master_report is not None:
            self._write_master_summary_sheet(ws_master, master_report)
        else:
            self._write_master_summary_placeholder(ws_master)

        self._create_summary_sheet(wb, results, contract_meta, money_fmt)
        self._create_schedule_sheet(wb, results, contract_meta, money_fmt)
        self._create_journal_entries_sheet(wb, results, money_fmt)
        self._create_obligations_sheet(wb, results, contract_meta, money_fmt)
        self._create_disclosures_sheet(wb, results, contract_meta, money_fmt, currency)

        wb.save(filename)

    def export_ifrs15_master_report(self, master_report: Dict[str, Any], filename: str) -> None:
        """Standalone workbook: IFRS 15 Master Summary as first (and only) sheet."""
        output_path = Path(filename)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        wb = Workbook()
        if "Sheet" in wb.sheetnames:
            wb.remove(wb["Sheet"])
        ws = wb.create_sheet("IFRS 15 Master Summary", 0)
        self._write_master_summary_sheet(ws, master_report)
        wb.save(filename)

    def _create_summary_sheet(self, wb: Workbook, results: Dict[str, Any], contract_meta: Dict[str, Any], money_fmt: str) -> None:
        ccy = (contract_meta.get("currency") or "USD").upper()
        ws = wb.create_sheet("Summary", 1)
        ws["A1"] = "IFRS 15 Revenue Recognition — Summary"
        ws["A1"].font = self.title_font
        ws.merge_cells("A1:B1")
        ws["A1"].alignment = Alignment(horizontal="center")

        balances = results.get("contract_balances", {}) or {}
        perf_obs = (results.get("disclosure_data", {}) or {}).get("performance_obligations", []) or []
        rec_method = "Point in Time" if all((x.get("recognition_method") == "point_in_time" for x in perf_obs)) else "Over Time"

        rows = [
            ("Customer Name", contract_meta.get("customer_name") or "—"),
            ("Contract Date", contract_meta.get("effective_date") or "—"),
            ("Contract Duration (months)", contract_meta.get("contract_term_months") or 0),
            ("Total Contract Value", float(results.get("transaction_price", 0) or 0)),
            ("Total Revenue Recognised (this period)", float(balances.get("revenue_recognized_to_date", 0) or 0)),
            ("Deferred Revenue — Contract Liability", float(balances.get("contract_liability_amount", 0) or 0)),
            ("Contract Assets", float(balances.get("contract_asset_amount", 0) or 0)),
            ("No. of Performance Obligations", len(perf_obs)),
            ("Recognition Method (Over Time / Point in Time)", rec_method),
            ("Report Generated Date", datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        ]

        row = 3
        for key, value in rows:
            ws[f"A{row}"] = key
            ws[f"A{row}"].font = Font(bold=True)
            ws[f"A{row}"].border = self.border
            ws[f"B{row}"] = value
            ws[f"B{row}"].border = self.border
            if isinstance(value, (int, float)) and "obligations" not in key.lower() and "months" not in key.lower():
                ws[f"B{row}"].number_format = money_fmt
            row += 1

        # --- Variable Consideration (IFRS 15.50–58) ---
        vc_shade = PatternFill(start_color="D9E2F3", end_color="D9E2F3", fill_type="solid")
        row += 1
        ws[f"A{row}"] = "Variable Consideration"
        ws[f"A{row}"].font = self.subtitle_font
        ws[f"A{row}"].fill = vc_shade
        ws[f"B{row}"].fill = vc_shade
        ws.merge_cells(f"A{row}:B{row}")
        row += 1

        vca = (results.get("variable_consideration_assessment") or contract_meta.get("variable_consideration_assessment") or None)
        if vca and isinstance(vca, dict) and (vca.get("expected_amount") is not None or vca.get("constrained_amount") is not None):
            meth = (vca.get("method") or "").replace("_", " ").title()
            if meth.strip().title() in ("Most Likely", "Most_Likely"):
                meth_line = "Most Likely"
            else:
                meth_line = "Expected Value" if "expected" in (vca.get("method") or "").lower() else meth
            vc_rows = [
                ("Estimation Method", meth_line),
                ("Unconstrained Amount", float(vca.get("expected_amount", 0) or 0)),
                ("Constraint Level", (vca.get("constraint_level") or "none").title()),
                ("Constraint Reduction", f"{format_currency_value(float(vca.get('reduction_amount', 0) or 0), ccy)} ({float(vca.get('reduction_pct', 0) or 0):.1f}%)"),
                ("Amount Included in TP", float(vca.get("include_in_transaction_price", 0) or vca.get("constrained_amount", 0) or 0)),
                ("Active Constraint Factors", ", ".join(vca.get("active_factors") or []) or "—"),
            ]
            for vlabel, vval in vc_rows:
                ws[f"A{row}"] = vlabel
                ws[f"A{row}"].font = Font(bold=True, size=10)
                ws[f"A{row}"].border = self.border
                ws[f"B{row}"] = vval
                ws[f"B{row}"].border = self.border
                if isinstance(vval, (int, float)) and vlabel not in ("Constraint Level",):
                    ws[f"B{row}"].number_format = money_fmt
                row += 1
        else:
            ws[f"A{row}"] = "—"
            ws[f"B{row}"] = "Not applicable — fixed price contract"
            ws[f"A{row}"].font = Font(italic=True, size=10, color="6B7280")
            ws[f"B{row}"].font = Font(italic=True, size=10, color="6B7280")
            row += 1

        ws.column_dimensions["A"].width = 48
        ws.column_dimensions["B"].width = 30

    def _create_schedule_sheet(self, wb: Workbook, results: Dict[str, Any], contract_meta: Dict[str, Any], money_fmt: str) -> None:
        ws = wb.create_sheet("Revenue Schedule", 2)
        ws["A1"] = "REVENUE RECOGNITION SCHEDULE"
        ws["A1"].font = self.title_font
        ws.merge_cells("A1:G1")
        ws["A1"].alignment = Alignment(horizontal="center")

        headers = [
            "Period",
            "Performance Obligation",
            "Opening Balance",
            "Revenue Recognised",
            "Closing Balance",
            "Cumulative Recognised",
            "Status",
        ]
        for idx, header in enumerate(headers, start=1):
            cell = ws.cell(row=3, column=idx, value=header)
            cell.font = self.header_font
            cell.fill = self.header_fill
            cell.border = self.border

        raw_schedule = results.get("revenue_schedule") or results.get("recognition_schedule") or []
        total_rev = 0.0
        row_no = 4
        for i, item in enumerate(raw_schedule):
            revenue = float(item.get("Revenue", item.get("revenue", item.get("revenue_amount", 0))) or 0)
            cumulative = float(item.get("Cumulative", item.get("cumulative_recognized", item.get("closing_balance", revenue))) or 0)
            opening = cumulative - revenue
            status = "Recognised" if revenue > 0 else "Deferred"
            values = [
                item.get("Period", item.get("Month", item.get("Date", i + 1))),
                item.get("Obligation", item.get("Obligation_ID", item.get("obligation", "—"))),
                opening,
                revenue,
                cumulative,
                cumulative,
                status,
            ]
            for col, val in enumerate(values, start=1):
                cell = ws.cell(row=row_no, column=col, value=val)
                cell.border = self.border
                if col in (3, 4, 5, 6):
                    cell.number_format = money_fmt
                if i % 2 == 1:
                    cell.fill = self.alt_fill
            total_rev += revenue
            row_no += 1

        ws.cell(row=row_no, column=1, value="TOTAL").font = Font(bold=True)
        ws.cell(row=row_no, column=4, value=total_rev).number_format = money_fmt
        ws.cell(row=row_no, column=4).font = Font(bold=True)
        for col in range(1, 8):
            c = ws.cell(row=row_no, column=col)
            c.fill = self.total_fill
            c.border = self.border

        ws.freeze_panes = "A4"
        widths = [12, 34, 18, 20, 18, 22, 14]
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[chr(64 + i)].width = w

    def _create_journal_entries_sheet(self, wb: Workbook, results: Dict[str, Any], money_fmt: str) -> None:
        ws = wb.create_sheet("Journal Entries", 3)
        ws["A1"] = "JOURNAL ENTRIES"
        ws["A1"].font = self.title_font
        ws.merge_cells("A1:F1")
        ws["A1"].alignment = Alignment(horizontal="center")

        headers = ["Period", "Date", "Account", "Dr", "Cr", "Description"]
        for idx, header in enumerate(headers, start=1):
            cell = ws.cell(row=3, column=idx, value=header)
            cell.font = self.header_font
            cell.fill = self.header_fill
            cell.border = self.border

        balances = results.get("contract_balances", {}) or {}
        rec = float(balances.get("revenue_recognized_to_date", 0) or 0)
        def_rev = float(balances.get("contract_liability_amount", 0) or 0)
        contract_asset = float(balances.get("contract_asset_amount", 0) or 0)
        base_date = datetime.now().strftime("%Y-%m-%d")

        rows = [
            ["Initial", base_date, "Accounts Receivable / Contract Asset", contract_asset or def_rev, "", "Initial recognition"],
            ["Initial", base_date, "Contract Liability (Deferred Revenue)", "", def_rev, "Initial recognition"],
            ["Current", base_date, "Contract Liability", rec, "", "Revenue recognition"],
            ["Current", base_date, "Revenue", "", rec, "Revenue recognition"],
        ]
        journal_entries = (((results.get("journal_entries") or {}).get("revenue_recognition") or {}).get("entries") or [])
        for j in journal_entries:
            rows.append(["Current", base_date, j.get("account", "—"), float(j.get("dr", 0) or 0), float(j.get("cr", 0) or 0), j.get("narration", "Generated entry")])

        row_no = 4
        for r in rows:
            for col, val in enumerate(r, start=1):
                cell = ws.cell(row=row_no, column=col, value=val)
                cell.border = self.border
                if col in (4, 5) and isinstance(val, (int, float)) and val != 0:
                    cell.number_format = money_fmt
            row_no += 1

        widths = [12, 14, 40, 16, 16, 40]
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[chr(64 + i)].width = w

    def _create_obligations_sheet(self, wb: Workbook, results: Dict[str, Any], contract_meta: Dict[str, Any], money_fmt: str) -> None:
        ws = wb.create_sheet("Obligations Detail", 4)
        ws["A1"] = "PERFORMANCE OBLIGATIONS DETAIL"
        ws["A1"].font = self.title_font
        ws.merge_cells("A1:J1")
        ws["A1"].alignment = Alignment(horizontal="center")

        headers = [
            "Obligation No.",
            "Description",
            "SSP",
            "Allocated Amount",
            "% of Total",
            "Recognition Pattern",
            "Start Date",
            "End Date",
            "Revenue to Date",
            "Revenue Remaining",
        ]
        for idx, header in enumerate(headers, start=1):
            cell = ws.cell(row=3, column=idx, value=header)
            cell.font = self.header_font
            cell.fill = self.header_fill
            cell.border = self.border

        perf_obs: List[Dict[str, Any]] = ((results.get("disclosure_data") or {}).get("performance_obligations") or [])
        term_months = int(contract_meta.get("contract_term_months") or 0)
        start_date = contract_meta.get("effective_date") or "—"
        total_tp = float(results.get("transaction_price", 0) or 0)

        row_no = 4
        for idx, ob in enumerate(perf_obs, start=1):
            allocated = float(ob.get("allocated_amount", 0) or 0)
            recognized = float(ob.get("revenue_recognized", 0) or 0)
            remaining = float(ob.get("remaining", max(allocated - recognized, 0)) or 0)
            pct = (allocated / total_tp * 100) if total_tp else 0
            values = [
                ob.get("obligation", f"PO-{idx}"),
                ob.get("description", ob.get("obligation", f"PO-{idx}")),
                allocated,
                allocated,
                pct,
                (ob.get("recognition_method", "over_time") or "over_time").replace("_", " ").title(),
                start_date,
                f"+{term_months} months",
                recognized,
                remaining,
            ]
            for col, val in enumerate(values, start=1):
                cell = ws.cell(row=row_no, column=col, value=val)
                cell.border = self.border
                if col in (3, 4, 9, 10):
                    cell.number_format = money_fmt
                if col == 5:
                    cell.number_format = "0.00"
            row_no += 1

        widths = [16, 28, 14, 16, 12, 20, 14, 14, 16, 18]
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[chr(64 + i)].width = w

        # Contract Modifications Log
        row_no += 2
        ws[f"A{row_no}"] = "Contract Modifications Log"
        ws[f"A{row_no}"].font = self.subtitle_font
        ws.merge_cells(f"A{row_no}:J{row_no}")
        row_no += 1

        mod_headers = [
            "Modification Date",
            "Type",
            "Price Change",
            "Catch-Up Amount",
            "Direction",
            "Assessed By",
            "Notes",
        ]
        for idx, header in enumerate(mod_headers, start=1):
            cell = ws.cell(row=row_no, column=idx, value=header)
            cell.font = self.header_font
            cell.fill = self.header_fill
            cell.border = self.border
        row_no += 1

        modifications = results.get("modifications_log") or []
        if not modifications:
            ws[f"A{row_no}"] = "No modifications recorded"
            ws[f"A{row_no}"].font = Font(italic=True, color="6B7280")
            ws.merge_cells(f"A{row_no}:G{row_no}")
        else:
            for mod in modifications:
                vals = [
                    mod.get("modification_date", ""),
                    mod.get("type", ""),
                    float(mod.get("price_change", 0) or 0),
                    float(mod.get("catch_up_amount", 0) or 0),
                    mod.get("direction", ""),
                    mod.get("assessed_by", "System"),
                    mod.get("notes", ""),
                ]
                for col, val in enumerate(vals, start=1):
                    c = ws.cell(row=row_no, column=col, value=val)
                    c.border = self.border
                    if col in (3, 4):
                        c.number_format = money_fmt
                row_no += 1
        if not modifications:
            row_no += 1
        row_no += 2

        section_dark = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
        section_font = Font(bold=True, color="FFFFFF", size=11)

        ws[f"A{row_no}"] = "Principal vs Agent Assessment (IFRS 15.B34)"
        ws[f"A{row_no}"].font = section_font
        ws[f"A{row_no}"].fill = section_dark
        ws[f"B{row_no}"].fill = section_dark
        ws.merge_cells(f"A{row_no}:B{row_no}")
        row_no += 1

        pa = (results.get("principal_agent_assessment") or contract_meta.get("principal_agent_assessment") or None)
        if pa and isinstance(pa, dict):
            pa_rows = [
                ("Conclusion", pa.get("conclusion", "—")),
                ("Revenue Basis", pa.get("revenue_recognition", "—")),
                ("Gross Revenue", float(pa.get("gross_revenue", 0) or 0)),
                ("Net Revenue (Fee)", float(pa.get("net_revenue", 0) or 0)),
                ("Revenue Recognised", float(pa.get("revenue_to_recognise", 0) or 0)),
                ("Commission Rate", f"{float(pa.get('commission_rate_pct', 0) or 0):.2f}%"),
                ("Borderline Flag", "Yes" if pa.get("borderline") else "No"),
            ]
            for lbl, val in pa_rows:
                ws[f"A{row_no}"] = lbl
                ws[f"A{row_no}"].font = Font(bold=True, size=10)
                ws[f"A{row_no}"].border = self.border
                ws[f"B{row_no}"] = val
                ws[f"B{row_no}"].border = self.border
                if isinstance(val, (int, float)):
                    ws[f"B{row_no}"].number_format = money_fmt
                row_no += 1
        else:
            ws[f"A{row_no}"] = "Principal/agent"
            ws[f"B{row_no}"] = "Principal/agent assessment not applicable"
            ws[f"A{row_no}"].font = Font(italic=True, size=10, color="6B7280")
            ws[f"B{row_no}"].font = Font(italic=True, size=10, color="6B7280")
            ws.merge_cells(f"B{row_no}:J{row_no}")
            row_no += 1

        row_no += 2
        ws[f"A{row_no}"] = "Licence of IP Classification (IFRS 15.B52)"
        ws[f"A{row_no}"].font = section_font
        ws[f"A{row_no}"].fill = section_dark
        ws[f"B{row_no}"].fill = section_dark
        ws.merge_cells(f"A{row_no}:B{row_no}")
        row_no += 1

        lic = (results.get("license_classification") or contract_meta.get("license_classification") or None)
        if lic and isinstance(lic, dict):
            lt = str(lic.get("license_type", "")).replace("_", " ").title()
            pat = "Over Time" if lic.get("pattern") == "OVER_TIME" else "Point in Time"
            monthly = lic.get("revenue_per_period")
            monthly_s = "N/A" if lic.get("pattern") != "OVER_TIME" else float(monthly or 0)
            lic_rows = [
                ("Licence Type", lt),
                ("Recognition Pattern", pat),
                ("Transaction Price", float(lic.get("transaction_price", 0) or 0)),
                ("Licence Term", f"{int(lic.get('licence_term_months', 0) or 0)} months"),
                ("Monthly Revenue", monthly_s if isinstance(monthly_s, str) else float(monthly_s)),
                ("Royalty Exception", "Yes" if lic.get("royalty_exception") else "No"),
            ]
            for lbl, val in lic_rows:
                ws[f"A{row_no}"] = lbl
                ws[f"A{row_no}"].font = Font(bold=True, size=10)
                ws[f"A{row_no}"].border = self.border
                ws[f"B{row_no}"] = val
                ws[f"B{row_no}"].border = self.border
                if isinstance(val, (int, float)):
                    ws[f"B{row_no}"].number_format = money_fmt
                row_no += 1
        else:
            ws[f"A{row_no}"] = "Licence"
            ws[f"B{row_no}"] = "Licence classification not applicable"
            ws[f"A{row_no}"].font = Font(italic=True, size=10, color="6B7280")
            ws[f"B{row_no}"].font = Font(italic=True, size=10, color="6B7280")
            ws.merge_cells(f"B{row_no}:J{row_no}")
            row_no += 1

    def _create_disclosures_sheet(
        self,
        wb: Workbook,
        results: Dict[str, Any],
        contract_meta: Dict[str, Any],
        money_fmt: str,
        currency: str,
    ) -> None:
        ws = wb.create_sheet("Disclosure Notes", 5)
        ws["A1"] = "IFRS 15 DISCLOSURE NOTES"
        ws["A1"].font = self.title_font
        ws.merge_cells("A1:B1")
        ws["A1"].alignment = Alignment(horizontal="center")

        balances = results.get("contract_balances", {}) or {}
        disclosure = results.get("disclosure_data", {}) or {}
        perf_obs = disclosure.get("performance_obligations", []) or []
        tp = float(results.get("transaction_price", 0) or 0)
        rec = float(balances.get("revenue_recognized_to_date", 0) or 0)

        sections = [
            ("1. Accounting Policy", "Revenue is recognised when performance obligations are satisfied and control transfers to the customer."),
            ("2. Disaggregation of Revenue", f"Total recognised revenue: {format_currency_value(rec, currency)}."),
            ("3. Contract Balances", f"Contract Assets: {format_currency_value(float(balances.get('contract_asset_amount', 0) or 0), currency)}; Contract Liabilities: {format_currency_value(float(balances.get('contract_liability_amount', 0) or 0), currency)}."),
            ("4. Performance Obligations", f"Number of obligations: {len(perf_obs)}."),
            ("5. Transaction Price Allocated to RPO", f"Unrecognised (RPO): {format_currency_value(max(tp - rec, 0), currency)}."),
            ("6. Significant Judgements", "Judgement is applied in identifying distinct obligations, estimating variable consideration and determining recognition pattern."),
        ]

        row = 3
        for title, body in sections:
            ws[f"A{row}"] = title
            ws[f"A{row}"].font = self.subtitle_font
            row += 1
            ws[f"A{row}"] = body
            ws[f"A{row}"].alignment = Alignment(wrap_text=True, vertical="top")
            ws.merge_cells(f"A{row}:B{row}")
            row += 2

        # Contract balances table
        ws[f"A{row}"] = "Contract Balance Type"
        ws[f"B{row}"] = "Amount"
        ws[f"A{row}"].font = self.header_font
        ws[f"B{row}"].font = self.header_font
        ws[f"A{row}"].fill = self.header_fill
        ws[f"B{row}"].fill = self.header_fill
        row += 1
        for label, amount in [
            ("Contract Asset", float(balances.get("contract_asset_amount", 0) or 0)),
            ("Contract Liability", float(balances.get("contract_liability_amount", 0) or 0)),
            ("Revenue Recognised to Date", rec),
        ]:
            ws[f"A{row}"] = label
            ws[f"B{row}"] = amount
            ws[f"B{row}"].number_format = money_fmt
            ws[f"A{row}"].border = self.border
            ws[f"B{row}"].border = self.border
            row += 1

        section_dark = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
        section_font = Font(bold=True, color="FFFFFF", size=11)

        row += 1
        ws[f"A{row}"] = "Remaining Performance Obligations (IFRS 15.120)"
        ws[f"A{row}"].font = section_font
        ws[f"A{row}"].fill = section_dark
        ws[f"B{row}"].fill = section_dark
        ws.merge_cells(f"A{row}:B{row}")
        row += 1

        rpo = (results.get("rpo_disclosure") or contract_meta.get("rpo_disclosure") or None)
        if rpo and isinstance(rpo, dict):
            rpo_rows = [
                ("Total RPO", float(rpo.get("total_rpo", 0) or 0)),
                ("— Within 1 Year", float(rpo.get("within_1_year", 0) or 0)),
                ("— 1 to 2 Years", float(rpo.get("one_to_two_years", 0) or 0)),
                ("— Beyond 2 Years", float(rpo.get("beyond_2_years", 0) or 0)),
                ("Disclosure Required", "Yes" if rpo.get("disclosure_required") else "No"),
                (
                    "Practical Expedient",
                    "Available" if rpo.get("practical_expedient_available") else "Not Available",
                ),
            ]
            for lbl, val in rpo_rows:
                ws[f"A{row}"] = lbl
                ws[f"A{row}"].font = Font(bold=True, size=10)
                ws[f"A{row}"].border = self.border
                ws[f"B{row}"] = val
                ws[f"B{row}"].border = self.border
                if isinstance(val, (int, float)):
                    ws[f"B{row}"].number_format = money_fmt
                row += 1
            row += 1
            ws[f"A{row}"] = "Obligation"
            ws[f"B{row}"] = "RPO Amount"
            ws[f"C{row}"] = "Bucket"
            ws[f"D{row}"] = "Expected Date"
            for col in ("A", "B", "C", "D"):
                c = ws[f"{col}{row}"]
                c.font = self.header_font
                c.fill = self.header_fill
                c.border = self.border
            row += 1
            for ob in rpo.get("by_obligation") or []:
                if not isinstance(ob, dict):
                    continue
                ws[f"A{row}"] = ob.get("obligation_name", "")
                ws[f"B{row}"] = float(ob.get("rpo_amount", 0) or 0)
                ws[f"C{row}"] = str(ob.get("bucket", ""))
                ws[f"D{row}"] = ob.get("expected_completion_date", "")
                ws[f"B{row}"].number_format = money_fmt
                for col in ("A", "B", "C", "D"):
                    ws[f"{col}{row}"].border = self.border
                row += 1
        else:
            ws[f"A{row}"] = "RPO"
            ws[f"B{row}"] = "Not assessed — run RPO disclosure in the app"
            ws[f"A{row}"].font = Font(italic=True, size=10, color="6B7280")
            ws[f"B{row}"].font = Font(italic=True, size=10, color="6B7280")
            ws.merge_cells(f"B{row}:D{row}")
            row += 1

        row += 1
        ws[f"A{row}"] = "Costs to Obtain Contracts (IFRS 15.91)"
        ws[f"A{row}"].font = section_font
        ws[f"A{row}"].fill = section_dark
        ws[f"B{row}"].fill = section_dark
        ws.merge_cells(f"A{row}:B{row}")
        row += 1

        cc = (results.get("contract_costs_assessment") or contract_meta.get("contract_costs_assessment") or None)
        if cc and isinstance(cc, dict):
            cc_rows = [
                ("Commission Amount", float(cc.get("commission_amount", 0) or 0)),
                ("Practical Expedient Used", "Yes" if cc.get("use_practical_expedient") else "No"),
                ("Asset Recognised", float(cc.get("total_asset_recognised", 0) or 0)),
                ("Monthly Amortisation", float(cc.get("monthly_amortisation", 0) or 0)),
                ("Contract Term", f"{int(cc.get('contract_term_months', 0) or 0)} months"),
                ("Impairment Flag", "Yes" if cc.get("impairment_flag") else "No"),
            ]
            for lbl, val in cc_rows:
                ws[f"A{row}"] = lbl
                ws[f"A{row}"].font = Font(bold=True, size=10)
                ws[f"A{row}"].border = self.border
                ws[f"B{row}"] = val
                ws[f"B{row}"].border = self.border
                if isinstance(val, (int, float)):
                    ws[f"B{row}"].number_format = money_fmt
                row += 1
            row += 1
            ws[f"A{row}"] = "Month"
            ws[f"B{row}"] = "Opening"
            ws[f"C{row}"] = "Amortisation"
            ws[f"D{row}"] = "Closing"
            for col in ("A", "B", "C", "D"):
                c = ws[f"{col}{row}"]
                c.font = self.header_font
                c.fill = self.header_fill
                c.border = self.border
            row += 1
            sched = list(cc.get("amortisation_schedule") or [])[:12]
            for line in sched:
                if not isinstance(line, dict):
                    continue
                ws[f"A{row}"] = line.get("month", "")
                ws[f"B{row}"] = float(line.get("opening_balance", 0) or 0)
                ws[f"C{row}"] = float(line.get("amortisation", 0) or 0)
                ws[f"D{row}"] = float(line.get("closing_balance", 0) or 0)
                for col in ("B", "C", "D"):
                    ws[f"{col}{row}"].number_format = money_fmt
                for col in ("A", "B", "C", "D"):
                    ws[f"{col}{row}"].border = self.border
                row += 1
        else:
            ws[f"A{row}"] = "Contract costs"
            ws[f"B{row}"] = "No contract costs assessed for this contract"
            ws[f"A{row}"].font = Font(italic=True, size=10, color="6B7280")
            ws[f"B{row}"].font = Font(italic=True, size=10, color="6B7280")
            ws.merge_cells(f"B{row}:D{row}")
            row += 1

        ws.column_dimensions["A"].width = 52
        ws.column_dimensions["B"].width = 24
        ws.column_dimensions["C"].width = 22
        ws.column_dimensions["D"].width = 18
