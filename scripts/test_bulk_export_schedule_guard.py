"""Verify bulk ZIP export requires amortization_schedule (with optional recalc from lease_data)."""
from __future__ import annotations

import io
import json
import sys
import unittest
import zipfile
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ifrs16_calculator import IFRS16Calculator, LeaseInput  # noqa: E402


def _full_results() -> dict:
    lease = LeaseInput(
        lease_id="FULL-001",
        asset_description="Office",
        commencement_date=datetime(2024, 1, 1),
        lease_term_months=12,
        monthly_payment=Decimal("50000"),
        annual_discount_rate=Decimal("0.08"),
        currency="AED",
    )
    raw = IFRS16Calculator().calculate_full_ifrs16(lease)
    out = raw.copy()
    out["amortization_schedule"] = out["amortization_schedule"].to_dict(orient="records")
    return json.loads(json.dumps(out, default=str))


def _totals_only() -> dict:
    full = _full_results()
    return {
        "lease_id": "PARTIAL-001",
        "lease_liability": full["lease_liability"],
        "rou_asset": full["rou_asset"],
    }


def _lease_data_for_recalc() -> dict:
    return {
        "id": "RECALC-001",
        "lease_id": "RECALC-001",
        "asset": "Warehouse",
        "title": "Warehouse",
        "dates": {"commencement": "2024-01-01", "end": "2024-12-31", "term_months": 12},
        "payments": {"monthly": 50000, "currency": "AED"},
        "monthly_payment": 50000,
        "currency": "AED",
        "discount_rate": 8.0,
        "liability": 0,
        "rou": 0,
        "results": {},
    }


class BulkExportScheduleGuardTests(unittest.TestCase):
    def test_resolve_helpers(self):
        from app import (  # noqa: WPS433
            IFRS16BulkExportExcelItem,
            _has_amortization_schedule,
            _resolve_bulk_export_results,
        )

        full = _full_results()
        self.assertTrue(_has_amortization_schedule(full))
        self.assertFalse(_has_amortization_schedule(_totals_only()))

        ok_item = IFRS16BulkExportExcelItem(
            lease_id="FULL-001",
            calculation_results=full,
        )
        resolved, skip = _resolve_bulk_export_results(ok_item)
        self.assertIsNone(skip)
        self.assertTrue(_has_amortization_schedule(resolved or {}))

        skip_item = IFRS16BulkExportExcelItem(
            lease_id="PARTIAL-001",
            calculation_results=_totals_only(),
        )
        resolved, skip = _resolve_bulk_export_results(skip_item)
        self.assertIsNone(resolved)
        self.assertIn("missing amortization schedule", skip or "")

        recalc_item = IFRS16BulkExportExcelItem(
            lease_id="RECALC-001",
            calculation_results=_totals_only(),
            lease_data=_lease_data_for_recalc(),
        )
        resolved, skip = _resolve_bulk_export_results(recalc_item)
        self.assertIsNone(skip, skip)
        self.assertIsNotNone(resolved)
        self.assertTrue(_has_amortization_schedule(resolved or {}))
        self.assertGreater(len(resolved.get("amortization_schedule", [])), 0)

    def test_bulk_export_zip_manifest(self):
        import urllib.error
        import urllib.request

        full = _full_results()
        payload = {
            "leases": [
                {"lease_id": "FULL-001", "calculation_results": full},
                {"lease_id": "PARTIAL-001", "calculation_results": _totals_only()},
                {
                    "lease_id": "RECALC-001",
                    "calculation_results": _totals_only(),
                    "lease_data": _lease_data_for_recalc(),
                },
            ]
        }
        req = urllib.request.Request(
            "http://127.0.0.1:9000/api/ifrs16/export-excel-bulk",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
                exported = resp.headers.get("X-Exported-Count")
        except urllib.error.HTTPError as e:
            self.fail(f"API error {e.code}: {e.read().decode()[:500]}")

        self.assertEqual(exported, "2")
        zf = zipfile.ZipFile(io.BytesIO(data))
        manifest = zf.read("_export_manifest.txt").decode()
        self.assertIn("OK FULL-001", manifest)
        self.assertIn("OK RECALC-001", manifest)
        self.assertIn("SKIP PARTIAL-001: missing amortization schedule (recalculate first)", manifest)

        full_xlsx = zf.read("IFRS16_FULL-001.xlsx")
        recalc_xlsx = zf.read("IFRS16_RECALC-001.xlsx")
        self.assertGreater(len(full_xlsx), 5000)
        self.assertGreater(len(recalc_xlsx), 5000)


if __name__ == "__main__":
    unittest.main(verbosity=2)
