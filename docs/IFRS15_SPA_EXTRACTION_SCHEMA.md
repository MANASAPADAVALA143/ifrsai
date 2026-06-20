# IFRS 15 UAE SPA Extraction — Schema & Field Mapping

Backend: `ifrs15_extractor.py` → `extract_uae_spa_terms()`  
API: `POST /api/ifrs15/extract-contract?contract_type=uae_spa`  
Frontend mapper (no UI yet): `frontend/lib/ifrs15-contract-extraction.ts`

## Extractor JSON structure

Every scalar field uses the IFRS 16 confidence envelope:

```json
{
  "value": "<extracted>",
  "confidence": 85,
  "source_text": "exact quote from SPA",
  "assumptions": "notes or empty"
}
```

### Top-level sections

| Section | Purpose |
|---------|---------|
| `contract_identification` | SPA ref, Oqood, RERA, contract date |
| `property` | Project, unit, type, area, floor |
| `parties` | Developer, buyer, Emirates ID |
| `financial` | Price, booking, VAT, payment plan array |
| `construction_timeline` | Start, completion, handover, % complete |
| `ifrs15_specific` | PO, recognition method, cancellation, penalties |
| `validation` | Missing fields, low-confidence list, overall score |
| `extraction_metadata` | Model, tokens, language, overall_confidence |

### Payment plan item shape

```json
{
  "label": "On 30% completion",
  "amount_aed": 245000,
  "pct": 10,
  "due_date": null,
  "trigger": "completion_pct"
}
```

Triggers: `booking` | `months` | `completion_pct` | `handover` | `other`

---

## Field mapping → IFRS 15 Main (Revenue Calculate)

| Extractor path | Main form / API field | Notes |
|----------------|----------------------|-------|
| `parties.buyer_name` | `customer_name` | Step 1 |
| `parties.developer_name` | `vendor_name` | Step 1 |
| `contract_identification.contract_date` | `effective_date` | ISO date |
| `contract_identification.spa_reference` | `contract_id` | Fallback: unit number |
| `financial.contract_value_aed` | `fixed_consideration` | Step 3 transaction price |
| `financial.booking_amount_aed` | `cash_received` | Deposit received |
| `construction_timeline` dates | `contract_term_months` | Months from SPA date → handover |
| `ifrs15_specific.performance_obligation` | `performance_obligations[0].description` | |
| `ifrs15_specific.revenue_recognition_method` | `recognition_method_hint` | over_time / point_in_time |
| — | `currency` | Always `AED` for UAE SPA |

---

## Field mapping → Real Estate UAE module

| Extractor path | Real Estate form state | Notes |
|----------------|------------------------|-------|
| `property.project_name` | `projectName` | |
| `contract_identification.rera_registration` | `reraNumber` | Required for calc |
| `contract_identification.oqood_number` | `oqoodNumber` | DLD filing |
| `contract_identification.spa_reference` | `spaReference` | |
| `contract_identification.contract_date` | `spaExecutionDate` | |
| `construction_timeline.construction_start_date` | `constructionStart` | |
| `construction_timeline.expected_handover_date` | `expectedHandover` | |
| `financial.contract_value_aed` | `contractValue` | |
| `financial.booking_amount_aed` | `depositReceived` | |
| `financial.vat_amount_aed` | `vatAmount` | |
| `financial.handover_payment_aed` | `handoverPayment` | |
| `parties.buyer_name` | `buyerName` | Unit row |
| `parties.developer_name` | `developerName` | |
| `parties.buyer_eid` | `buyerEid` | |
| `property.unit_number` | `unitNumber` | |
| `property.unit_type` | `unitType` | apartment/villa/office |
| `property.floor_area_sqft` | `floorAreaSqft` | |
| `property.floor_number` | `floorNumber` | |
| `construction_timeline.current_completion_pct` | `completionPct` | |
| `ifrs15_specific.cancellation_terms` | `cancellationTerms` | Law 8/2007 |
| `financial.payment_plan[]` | `milestones[]` + `escrowReceipts[]` | See below |

### Payment plan → milestones table

| Plan field | Milestone column |
|------------|------------------|
| `label` | `milestone` |
| `pct` | `completion_pct_required` |
| `amount_aed` | `amount_released` |
| `due_date` | escrow receipt `date` |

---

## Confidence badges (frontend — Step 5, not built yet)

| Score | Badge | Action |
|-------|-------|--------|
| ≥ 80% | ✦ PDF 92% (green) | Auto-accept |
| 50–79% | ✦ PDF 65% (amber) | Review recommended |
| < 50% | ✦ PDF 38% (red) | Manual review required |

Badge clears when user edits the field (same as IFRS 16 `clearedVerifyFields` pattern).

Reuse: `ExtractedFieldBadge.tsx` from IFRS 16 (generic props).

---

## Relationship to existing extractors

| Module | Role | Status |
|--------|------|--------|
| `ifrs15_extractor.extract_contract_terms` | Generic IFRS 15 5-step (SaaS, services) | Keep for `/api/ifrs15/upload-contract` |
| `ifrs15_extractor.extract_uae_spa_terms` | **New** UAE SPA with per-field confidence | `/api/ifrs15/extract-contract` |
| `spa_parser.py` + `arabic_pdf_handler.py` | Legacy real estate upload | Migrate to unified schema |
| `ifrs16_extractor.py` | Pattern reference | ✅ |

---

## Test contract (Downtown Views II)

Expected extraction targets:

| Field | Expected value | Min confidence |
|-------|----------------|----------------|
| project_name | Downtown Views II — Tower B | 80% |
| unit_number | 1205 | 80% |
| floor_area_sqft | 1450 | 80% |
| contract_value_aed | 2450000 | 90% |
| rera_registration | RERA-DT2-2024-001 | 85% |
| oqood_number | DLD-2024-OQ-48291 | 85% |
| buyer_name | Mohammed Al Rashidi | 80% |
| contract_date | 2024-03-15 | 90% |
| payment_plan | 7 instalments | 75% |
| vat_amount_aed | 122500 | 80% |
| cancellation_terms | Law 8/2007 | 70% |

Run: `python test_ifrs15_spa_extraction.py` (mock text, no API key required for structure test).

---

## Next implementation steps (frontend — deferred)

1. `ContractPdfUploadBar.tsx` — clone `LeasePdfUploadBar.tsx`
2. Wire into `/dashboard/ifrs15` Step 1 + `/dashboard/ifrs15/realestate`
3. Bulk upload on portfolio page (20 PDFs, progress bar)
4. Deprecate duplicate `spa_parser` path once unified extractor validated
