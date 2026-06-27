import json
import urllib.request
from datetime import datetime
from decimal import Decimal

from ifrs16_calculator import IFRS16Calculator, LeaseInput
from ifrs16_excel_export import IFRS16ExcelExporter

lease = LeaseInput(
    lease_id="DEMO-001",
    asset_description="Test",
    commencement_date=datetime(2024, 1, 1),
    lease_term_months=12,
    monthly_payment=Decimal("50000"),
    annual_discount_rate=Decimal("0.08"),
    currency="AED",
)
results = IFRS16Calculator().calculate_full_ifrs16(lease)
r2 = json.loads(json.dumps(results, default=str))
print("schedule len", len(r2.get("amortization_schedule", [])))
print("disclosure keys", list((r2.get("disclosure_data") or {}).keys())[:5])
try:
    b = IFRS16ExcelExporter().export_ifrs16_workbook_bytes(r2)
    print("local export ok", len(b))
except Exception as e:
    print("local export fail", type(e).__name__, e)

payload = {"leases": [{"lease_id": "DEMO-001", "calculation_results": r2}]}
req = urllib.request.Request(
    "http://127.0.0.1:9000/api/ifrs16/export-excel-bulk",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        print("api ok", resp.status, "exported", resp.headers.get("X-Exported-Count"), len(resp.read()))
except urllib.error.HTTPError as e:
    print("api err", e.code, e.read().decode()[:800])
