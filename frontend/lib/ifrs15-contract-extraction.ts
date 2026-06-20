/**
 * Maps UAE SPA extractor JSON (ifrs15_extractor.extract_uae_spa_terms) → IFRS 15 form fields.
 * Mirrors frontend/lib/ifrs16-lease-extraction.ts pattern. UI wiring is separate.
 */

export type ExtractionConfidenceMap = Record<string, number>;

export type Ifrs15ContractExtractionResult = {
  /** Patch for main IFRS 15 calculate form (step 1–3) */
  mainFormPatch: Record<string, unknown>;
  /** Patch for UAE Real Estate module form */
  realEstateFormPatch: Record<string, unknown>;
  /** Milestones for escrow / payment plan tables */
  paymentPlanRows: Array<{
    milestone: string;
    completion_pct_required: string;
    amount_released: string;
    due_date?: string;
  }>;
  /** Escrow receipts derived from payment plan */
  escrowReceipts: Array<{ date: string; amount: string; buyer_name?: string }>;
  confidences: ExtractionConfidenceMap;
  tabsWithData: Set<string>;
  contractData: Record<string, unknown> | null;
  fieldCount: number;
  avgConfidence: number;
  overallConfidence: number;
};

function getVal(obj: unknown): unknown {
  if (obj == null) return null;
  if (typeof obj === 'object' && obj !== null && 'value' in obj) {
    return (obj as { value: unknown }).value;
  }
  return obj;
}

function getConf(obj: unknown): number | undefined {
  if (obj != null && typeof obj === 'object' && 'confidence' in obj) {
    const c = Number((obj as { confidence: unknown }).confidence);
    return Number.isFinite(c) ? c : undefined;
  }
  return undefined;
}

function dig(data: unknown, ...path: string[]): unknown {
  let cur: unknown = data;
  for (const p of path) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setConf(map: ExtractionConfidenceMap, field: string, obj: unknown, hasValue: boolean) {
  const c = getConf(obj);
  if (hasValue && c != null) map[field] = c;
}

function has(v: unknown): boolean {
  return v != null && String(v).trim() !== '';
}

function formatDate(raw: unknown): string {
  if (raw == null) return '';
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : '';
}

function formatNum(raw: unknown): string {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

/** Map raw API response → form patches for main IFRS 15 + Real Estate UAE. */
export function buildIfrs15ContractExtractionResult(raw: unknown): Ifrs15ContractExtractionResult {
  const extractedBlob =
    raw != null && typeof raw === 'object' && 'extracted_data' in (raw as object)
      ? (raw as { extracted_data: unknown }).extracted_data
      : raw;

  const data =
    extractedBlob != null && typeof extractedBlob === 'object' && !Array.isArray(extractedBlob)
      ? (extractedBlob as Record<string, unknown>)
      : {};

  const meta = (data.extraction_metadata as Record<string, unknown>) || {};
  const confidences: ExtractionConfidenceMap = {};

  const ci = (data.contract_identification as Record<string, unknown>) || {};
  const prop = (data.property as Record<string, unknown>) || {};
  const parties = (data.parties as Record<string, unknown>) || {};
  const fin = (data.financial as Record<string, unknown>) || {};
  const tl = (data.construction_timeline as Record<string, unknown>) || {};
  const ifrs = (data.ifrs15_specific as Record<string, unknown>) || {};

  const spaRef = getVal(ci.spa_reference);
  const oqood = getVal(ci.oqood_number);
  const rera = getVal(ci.rera_registration);
  const contractDate = formatDate(getVal(ci.contract_date));
  const projectName = String(getVal(prop.project_name) ?? '').trim();
  const unitNumber = String(getVal(prop.unit_number) ?? '').trim();
  const unitType = String(getVal(prop.unit_type) ?? '').trim();
  const floorArea = getVal(prop.floor_area_sqft);
  const floorNumber = getVal(prop.floor_number);
  const developer = String(getVal(parties.developer_name) ?? '').trim();
  const buyer = String(getVal(parties.buyer_name) ?? '').trim();
  const buyerEid = String(getVal(parties.buyer_eid) ?? '').trim();
  const contractValue = getVal(fin.contract_value_aed);
  const booking = getVal(fin.booking_amount_aed);
  const handoverPay = getVal(fin.handover_payment_aed);
  const vat = getVal(fin.vat_amount_aed);
  const paymentPlan = getVal(fin.payment_plan);
  const constructionStart = formatDate(getVal(tl.construction_start_date));
  const expectedCompletion = formatDate(getVal(tl.expected_completion_date));
  const expectedHandover = formatDate(getVal(tl.expected_handover_date));
  const completionPct = getVal(tl.current_completion_pct);
  const performanceObligation = String(getVal(ifrs.performance_obligation) ?? '').trim();
  const revMethod = String(getVal(ifrs.revenue_recognition_method) ?? '').trim();
  const cancellation = String(getVal(ifrs.cancellation_terms) ?? '').trim();

  setConf(confidences, 'spaReference', ci.spa_reference, has(spaRef));
  setConf(confidences, 'oqoodNumber', ci.oqood_number, has(oqood));
  setConf(confidences, 'reraNumber', ci.rera_registration, has(rera));
  setConf(confidences, 'contractDate', ci.contract_date, has(contractDate));
  setConf(confidences, 'projectName', prop.project_name, has(projectName));
  setConf(confidences, 'unitNumber', prop.unit_number, has(unitNumber));
  setConf(confidences, 'buyerName', parties.buyer_name, has(buyer));
  setConf(confidences, 'developerName', parties.developer_name, has(developer));
  setConf(confidences, 'contractValue', fin.contract_value_aed, has(contractValue));
  setConf(confidences, 'expectedHandover', tl.expected_handover_date, has(expectedHandover));
  setConf(confidences, 'paymentPlan', fin.payment_plan, Array.isArray(paymentPlan) && paymentPlan.length > 0);

  const contractId = String(spaRef || unitNumber || `SPA-${Date.now()}`);
  const termMonths = (() => {
    if (!contractDate || !expectedHandover) return 24;
    const s = new Date(contractDate);
    const e = new Date(expectedHandover);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 24;
    return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
  })();

  const mainFormPatch: Record<string, unknown> = {};
  if (has(buyer)) mainFormPatch.customer_name = buyer;
  if (has(developer)) mainFormPatch.vendor_name = developer;
  if (has(contractDate)) mainFormPatch.effective_date = contractDate;
  mainFormPatch.contract_id = contractId;
  mainFormPatch.contract_term_months = termMonths;
  if (has(contractValue)) mainFormPatch.fixed_consideration = Number(contractValue);
  mainFormPatch.currency = 'AED';
  if (has(booking)) mainFormPatch.cash_received = Number(booking);
  if (has(revMethod)) {
    mainFormPatch.recognition_method_hint = revMethod;
  }
  if (has(performanceObligation)) {
    mainFormPatch.performance_obligations = [
      {
        obligation_id: 'PO-SPA-1',
        description: performanceObligation,
        recognition_method: revMethod.toLowerCase().includes('point') ? 'point_in_time' : 'over_time',
        duration_months: termMonths,
        transfer_date: expectedHandover || null,
      },
    ];
  }

  const realEstateFormPatch: Record<string, unknown> = {
    projectName: projectName || undefined,
    reraNumber: String(rera ?? ''),
    spaExecutionDate: contractDate || undefined,
    constructionStart: constructionStart || contractDate || undefined,
    expectedHandover: expectedHandover || expectedCompletion || undefined,
    contractValue: formatNum(contractValue),
    depositReceived: formatNum(booking),
    vatApplicable: vat ? 'yes' : 'no',
    buyerName: buyer || undefined,
    developerName: developer || undefined,
    unitNumber: unitNumber || undefined,
    unitType: unitType || undefined,
    floorAreaSqft: formatNum(floorArea),
    floorNumber: floorNumber != null ? String(floorNumber) : undefined,
    oqoodNumber: oqood != null ? String(oqood) : undefined,
    spaReference: spaRef != null ? String(spaRef) : undefined,
    buyerEid: buyerEid || undefined,
    handoverPayment: formatNum(handoverPay),
    vatAmount: formatNum(vat),
    completionPct: completionPct != null ? String(completionPct) : undefined,
    cancellationTerms: cancellation || undefined,
  };

  const paymentPlanRows: Ifrs15ContractExtractionResult['paymentPlanRows'] = [];
  const escrowReceipts: Ifrs15ContractExtractionResult['escrowReceipts'] = [];

  if (Array.isArray(paymentPlan)) {
    for (const row of paymentPlan) {
      const r = row as Record<string, unknown>;
      const label = String(r.label ?? r.milestone ?? 'Instalment');
      const amount = Number(r.amount_aed ?? r.amount ?? 0);
      const pct = r.pct != null ? String(r.pct) : '';
      const due = formatDate(r.due_date);
      paymentPlanRows.push({
        milestone: label,
        completion_pct_required: pct,
        amount_released: Number.isFinite(amount) ? String(amount) : '',
        due_date: due || undefined,
      });
      if (Number.isFinite(amount) && amount > 0) {
        escrowReceipts.push({
          date: due || contractDate || new Date().toISOString().slice(0, 10),
          amount: String(amount),
          buyer_name: buyer || undefined,
        });
      }
    }
  }

  const tabsWithData = new Set<string>();
  if (buyer || developer || contractDate || contractValue) tabsWithData.add('contract');
  if (paymentPlanRows.length) tabsWithData.add('financial');
  if (projectName || unitNumber) tabsWithData.add('property');

  const scores = Object.values(confidences);
  const fieldCount = scores.length;
  const avgConfidence =
    fieldCount > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / fieldCount) : 0;
  const overallConfidence = Number(meta.overall_confidence ?? avgConfidence) || avgConfidence;

  return {
    mainFormPatch,
    realEstateFormPatch,
    paymentPlanRows,
    escrowReceipts,
    confidences,
    tabsWithData,
    contractData: Object.keys(data).length ? { ...data } : null,
    fieldCount,
    avgConfidence,
    overallConfidence,
  };
}

/** UAE SPA extractor JSON (not generic 5-step). */
export function isUaeSpaExtraction(extracted: unknown): boolean {
  if (extracted == null || typeof extracted !== 'object') return false;
  const d = extracted as Record<string, unknown>;
  return Boolean(d.contract_identification && d.financial && d.property);
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Map UAE SPA extraction → IFRS 15 /api/ifrs15/calculate payload. */
export function mapUaeSpaToCalculatePayload(extracted: Record<string, unknown>): Record<string, unknown> {
  const result = buildIfrs15ContractExtractionResult({ extracted_data: extracted });
  const m = result.mainFormPatch;
  const termMonths = toFiniteNumber(m.contract_term_months, 24);
  const fixed = toFiniteNumber(m.fixed_consideration, 0);
  const rawPos = Array.isArray(m.performance_obligations) ? m.performance_obligations : [];
  const re = result.realEstateFormPatch;
  const handover = String(re.expectedHandover || '').slice(0, 10) || null;
  const constructionStart = String(re.constructionStart || '').slice(0, 10);
  const completionPct = toFiniteNumber(re.completionPct, 0);
  const ifrs = (extracted.ifrs15_specific as Record<string, unknown>) || {};
  const revMethod = String(getVal(ifrs.revenue_recognition_method) ?? '').toLowerCase();
  const isOverTimeConstruction =
    revMethod.includes('over') || revMethod.includes('time') || revMethod.includes('construction');

  const performance_obligations =
    rawPos.length > 0
      ? rawPos.map((p, i) => {
          const row = p as Record<string, unknown>;
          return {
            obligation_id: String(row.obligation_id || `PO-SPA-${i + 1}`),
            description: String(
              row.description ||
                'Off-plan unit — IFRS 15.35(c) over time, input method (cost-to-cost / completion %)'
            ),
            standalone_selling_price: fixed,
            recognition_method: String(row.recognition_method || 'over_time'),
            duration_months: toFiniteNumber(row.duration_months, termMonths),
            transfer_date: (row.transfer_date as string) || handover,
          };
        })
      : [
          {
            obligation_id: 'PO-SPA-1',
            description:
              'Off-plan unit — IFRS 15.35(c) over time, input method (cost-to-cost / completion %)',
            standalone_selling_price: fixed,
            recognition_method: 'over_time',
            duration_months: termMonths,
            transfer_date: handover,
          },
        ];

  const payload: Record<string, unknown> = {
    contract_id: String(m.contract_id || `SPA-${Date.now()}`),
    customer_name: String(m.customer_name || ''),
    vendor_name: String(m.vendor_name || ''),
    effective_date: String(m.effective_date || new Date().toISOString().slice(0, 10)),
    contract_term_months: termMonths,
    fixed_consideration: fixed,
    variable_consideration: 0,
    variable_consideration_constrained: 0,
    constraint_percentage: 100,
    constraint_method: 'percentage',
    discounts: 0,
    rebates: 0,
    financing_adjustment: 0,
    currency: String(m.currency || 'AED'),
    contract_type: 'fixed_price',
    hourly_rate: 0,
    hours_worked: 0,
    tm_cap: 0,
    cumulative_billed: toFiniteNumber(m.cash_received, 0),
    total_estimated_cost: 0,
    actual_cost_to_date: 0,
    prior_revenue_recognised: 0,
    maintenance_term_months: 0,
    volume_slabs: [],
    estimated_annual_volume: 0,
    can_estimate_volume: true,
    sla_items: [],
    cash_received: toFiniteNumber(m.cash_received, 0),
    payment_terms: '',
    performance_obligations,
  };

  // Drive IFRS 15.35(c) input method on main Calculate (not straight-line contract term)
  if (constructionStart || handover || completionPct > 0 || isOverTimeConstruction) {
    payload.construction_start = constructionStart || undefined;
    payload.expected_handover = handover || undefined;
    payload.construction_completion_pct = completionPct > 0 ? completionPct : undefined;
    payload.progress_measurement = 'input_costs';
    payload.current_date = new Date().toISOString().slice(0, 10);
  }

  return payload;
}

/** Coerce calculate payload numbers — API rejects null/NaN (JSON null). */
export function sanitizeIfrs15CalculatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const num = (k: string, fallback = 0) => {
    payload[k] = toFiniteNumber(payload[k], fallback);
    return payload;
  };
  [
    'fixed_consideration',
    'variable_consideration',
    'variable_consideration_constrained',
    'constraint_percentage',
    'discounts',
    'rebates',
    'financing_adjustment',
    'cash_received',
    'hourly_rate',
    'hours_worked',
    'tm_cap',
    'cumulative_billed',
    'total_estimated_cost',
    'actual_cost_to_date',
    'prior_revenue_recognised',
    'estimated_annual_volume',
  ].forEach((k) => num(k));
  payload.contract_term_months = Math.max(1, Math.round(toFiniteNumber(payload.contract_term_months, 12)));
  payload.maintenance_term_months = Math.round(toFiniteNumber(payload.maintenance_term_months, 0));
  const pos = Array.isArray(payload.performance_obligations) ? payload.performance_obligations : [];
  payload.performance_obligations = pos.map((p, i) => {
    const row = { ...(p as Record<string, unknown>) };
    row.standalone_selling_price = toFiniteNumber(row.standalone_selling_price, 0);
    row.duration_months = Math.max(0, Math.round(toFiniteNumber(row.duration_months, 12)));
    row.obligation_id = String(row.obligation_id || `PO-${i + 1}`);
    row.description = String(row.description || 'Revenue');
    row.recognition_method = String(row.recognition_method || 'over_time');
    return row;
  });
  return payload;
}

export function confidenceLabel(score: number): string {
  if (score >= 80) return 'High';
  if (score >= 50) return 'Medium';
  return 'Low';
}

export function confidenceBadgeClass(score: number): string {
  if (score >= 80) return 'text-green-700 bg-green-50 border-green-200';
  if (score >= 50) return 'text-amber-800 bg-amber-50 border-amber-200';
  return 'text-red-700 bg-red-50 border-red-200';
}

export function mapLowConfidenceToLegacy(fields: string[]): string[] {
  const map: Record<string, string> = {
    rera_registration: 'rera_registration_number',
    contract_value_aed: 'contract_price_aed',
    expected_handover_date: 'handover_date',
    project_name: 'project_name',
    buyer_name: 'buyer_name',
    developer_name: 'developer_name',
    unit_number: 'unit_number',
    contract_date: 'contract_date',
  };
  return fields.map((f) => map[f] || f);
}

/** Apply mapped extraction to Real Estate UAE form setters. */
export function applyRealEstateExtractionResult(
  result: Ifrs15ContractExtractionResult,
  apply: {
    setContractValue: (v: string) => void;
    setConstructionStart: (v: string) => void;
    setSpaExecutionDate: (v: string) => void;
    setExpectedHandover: (v: string) => void;
    setSpaHandoverDate?: (v: string) => void;
    setProjectName: (v: string) => void;
    setReraNumber: (v: string) => void;
    setEscrowReceipts: (r: Array<{ date: string; amount: string; buyer_name?: string }>) => void;
    setMilestones: (m: Array<{ milestone: string; completion_pct_required: string; amount_released: string }>) => void;
  }
): void {
  const f = result.realEstateFormPatch;
  if (f.contractValue) apply.setContractValue(String(f.contractValue));
  if (f.constructionStart) apply.setConstructionStart(String(f.constructionStart).slice(0, 10));
  if (f.spaExecutionDate) apply.setSpaExecutionDate(String(f.spaExecutionDate).slice(0, 10));
  if (f.expectedHandover) {
    const d = String(f.expectedHandover).slice(0, 10);
    apply.setExpectedHandover(d);
    apply.setSpaHandoverDate?.(d);
  }
  if (f.projectName) apply.setProjectName(String(f.projectName));
  if (f.reraNumber) apply.setReraNumber(String(f.reraNumber));
  if (result.escrowReceipts.length) apply.setEscrowReceipts(result.escrowReceipts);
  if (result.paymentPlanRows.length) {
    apply.setMilestones(
      result.paymentPlanRows.map((r) => ({
        milestone: r.milestone,
        completion_pct_required: r.completion_pct_required,
        amount_released: r.amount_released,
      }))
    );
  }
}

/** Legacy spa_parser keys for backward-compatible display. */
export function toLegacySpaExtracted(data: Record<string, unknown>): Record<string, unknown> {
  const ci = (data.contract_identification as Record<string, unknown>) || {};
  const prop = (data.property as Record<string, unknown>) || {};
  const parties = (data.parties as Record<string, unknown>) || {};
  const fin = (data.financial as Record<string, unknown>) || {};
  const tl = (data.construction_timeline as Record<string, unknown>) || {};
  const plan = getVal(fin.payment_plan);
  return {
    property_unit_number: getVal(prop.unit_number),
    buyer_name: getVal(parties.buyer_name),
    developer_name: getVal(parties.developer_name),
    project_name: getVal(prop.project_name),
    total_contract_price: getVal(fin.contract_value_aed),
    handover_date: getVal(tl.expected_handover_date),
    agreement_date: getVal(ci.contract_date),
    rera_registration_number: getVal(ci.rera_registration),
    oqood_number: getVal(ci.oqood_number),
    payment_schedule: Array.isArray(plan) ? plan : [],
  };
}
